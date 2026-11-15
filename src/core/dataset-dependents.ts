import { join } from "node:path";
import { isPlainObject } from "../datasets/operations.mjs";
import { readLibraryBytes } from "./library-files";
import { readLibraryFile } from "./library-runtime";
import { CoreError } from "./model";
import type { FileStore } from "./store";


class DependencyIndex {
  private readonly inputs = new Map<string, string[]>();
  private built?: Promise<void>;
  constructor(readonly store: FileStore) {}

  private async read(projectId: string, datasetId: string) {
    const path = join(
      this.store.datasetFiles().directory(projectId),
      `${datasetId}.json`,
    );
    let bytes: Buffer | null | undefined;
    try {
      bytes =
        (await readLibraryFile(this.store.root, path)) ??
        (await readLibraryBytes(this.store.root, path));
    } catch (error) {
      if (error instanceof CoreError && error.code === "NOT_FOUND")
        return undefined;
      throw error;
    }
    if (!bytes?.includes('"transform"')) return undefined;
    const dataset = JSON.parse(bytes.toString("utf8")) as {
      transform?: { inputs?: unknown };
    };
    const inputs = dataset?.transform?.inputs;
    if (!isPlainObject(inputs)) return undefined;
    return Object.values(inputs).flatMap((input) =>
      typeof input === "string"
        ? [`${projectId}/${input}`]
        : isPlainObject(input) &&
            typeof input.project === "string" &&
            typeof input.dataset === "string"
          ? [`${input.project}/${input.dataset}`]
          : [],
    );
  }

  private async update(projectId: string, datasetId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(datasetId)) return;
    const inputs = await this.read(projectId, datasetId);
    const key = `${projectId}/${datasetId}`;
    if (inputs) this.inputs.set(key, inputs);
    else this.inputs.delete(key);
  }

  private async project(projectId: string) {
    for (const key of [...this.inputs.keys()])
      if (key.startsWith(`${projectId}/`)) this.inputs.delete(key);
    const files = this.store.datasetFiles();
    const names = await files
      .names(files.directory(projectId))
      .catch((error) => {
        if (error instanceof CoreError && error.code === "NOT_FOUND") return [];
        throw error;
      });
    for (const name of names) await this.update(projectId, name.slice(0, -5));
  }

  build(): Promise<void> {
    this.built ??= (async () => {
      for (const project of await this.store.listProjects({
        includeArchived: true,
      }))
        await this.project(project.id);
    })().catch((error) => {
      this.built = undefined;
      throw error;
    });
    return this.built;
  }

  async refresh(keys: string[]) {
    for (const key of keys) {
      const [projectId, datasetId] = key.split("/");
      if (!projectId || !datasetId) continue;
      if (datasetId === "*") await this.project(projectId);
      else await this.update(projectId, datasetId);
    }
  }

  readers(key: string): string[] {
    return [...this.inputs]
      .filter(([, inputs]) => inputs.includes(key))
      .map(([transform]) => transform);
  }

  dependents(keys: string[]): string[] {
    const reached = new Set<string>();
    const queue = [...keys];
    const matches = (input: string, key: string) =>
      key.endsWith("/*") ? input.startsWith(key.slice(0, -1)) : input === key;
    while (queue.length) {
      const key = queue.shift()!;
      for (const [transform, inputs] of this.inputs) {
        if (reached.has(transform) || keys.includes(transform)) continue;
        if (inputs.some((input) => matches(input, key))) {
          reached.add(transform);
          queue.push(transform);
        }
      }
    }
    return [...reached];
  }
}

const indexes = new Map<string, DependencyIndex>();

export async function datasetDependents(
  store: FileStore,
  changed: string[],
): Promise<string[]> {
  let index = indexes.get(store.root);
  if (!index) {
    index = new DependencyIndex(store);
    indexes.set(store.root, index);
  }
  await index.build();
  await index.refresh(changed);
  return index.dependents(changed);
}

export async function transformsReading(
  store: FileStore,
  key: string,
): Promise<string[]> {
  const index = new DependencyIndex(store);
  await index.build();
  return index.readers(key);
}
