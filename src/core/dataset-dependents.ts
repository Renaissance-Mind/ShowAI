import { join } from "node:path";
import { isPlainObject } from "../datasets/operations.mjs";
import { readLibraryBytes } from "./library-files";
import { readLibraryFile } from "./library-runtime";
import { CoreError } from "./model";
import type { FileStore } from "./store";

// Transform datasets are computed from other datasets. When an input changes
// (a library write, a linked file, a sync), the windows showing a transform
// computed from it refresh too: change notifications name the changed
// datasets together with every transform that reads them, directly or
// through other transforms. Dataset keys are "projectId/datasetId";
// "projectId/*" stands for every dataset of the project.

/** The inputs of every transform dataset of a library. */
class DependencyIndex {
  /** Transform key → keys of its inputs. */
  private readonly inputs = new Map<string, string[]>();
  private built?: Promise<void>;
  constructor(readonly store: FileStore) {}

  /** The input keys of a stored dataset; undefined unless it is a transform. */
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
    // Only files that mention a transform need parsing.
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

  /** Reads the definitions of changed datasets again. */
  async refresh(keys: string[]) {
    for (const key of keys) {
      const [projectId, datasetId] = key.split("/");
      if (!projectId || !datasetId) continue;
      if (datasetId === "*") await this.project(projectId);
      else await this.update(projectId, datasetId);
    }
  }

  /** Transforms with the key among their inputs. */
  readers(key: string): string[] {
    return [...this.inputs]
      .filter(([, inputs]) => inputs.includes(key))
      .map(([transform]) => transform);
  }

  /** Transforms computed from any of the keys, transitively, not including the keys. */
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

/**
 * Transforms that must refresh because the given datasets changed (their
 * files, sources or definitions). The index of the library is built on first
 * use and kept current from the keys of later changes.
 */
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

/** Transforms with a dataset among their inputs, read from the library's current files. */
export async function transformsReading(
  store: FileStore,
  key: string,
): Promise<string[]> {
  const index = new DependencyIndex(store);
  await index.build();
  return index.readers(key);
}
