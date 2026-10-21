import { createHash, randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { CAPACITY, assertContent } from "../portable/capacity.mjs";
import {
  applyOperations,
  cloneValue,
  diffValues,
  isPlainObject,
  refineOperations,
  validateOperations,
  type DatasetConflict,
  type DatasetOperation,
} from "../datasets/operations.mjs";
import { readBinding } from "../datasets/binding.mjs";
import { canonicalJson } from "./canonical";
import { CoreError } from "./model";
import { assertId, type FileStore } from "./store";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { changeContext, libraryMutations } from "./history-context";
import {
  logicalPath,
  readLibraryFile,
  versionedLibrary,
} from "./library-runtime";
import { assertProps } from "../components/custom/schema";
import type { JsonSchema } from "../components/custom/types";
import type { ShowDocument } from "./model";
import { visitNodes } from "../surface/document.mjs";

/** A project's shared data: one JSON value that several page blocks read and write. */
export interface DatasetDocument {
  format: "showai-dataset";
  version: 1;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Where the data was first shared from; informational. */
  origin?: {
    kind: string;
    componentId?: string;
    pageId?: string;
    blockId?: string;
  };
  /** Optional JSON Schema every write must satisfy. */
  schema?: JsonSchema;
  value: unknown;
}
export interface DatasetRecord {
  dataset: DatasetDocument;
  hash: string;
  revision?: string;
  path: string;
}
export interface DatasetSummary {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  hash: string;
  revision?: string;
  bytes: number;
  origin?: DatasetDocument["origin"];
}
export interface DatasetReference {
  projectId: string;
  pageId: string;
  title: string;
  blockIds: string[];
}
export interface DatasetApplyInput {
  baseHash?: string;
  baseRevision?: string;
  operations: unknown[];
  name?: string;
  description?: string | null;
  /** Replaces the JSON Schema every write must satisfy; null removes it. */
  schema?: JsonSchema | null;
  /**
   * The value the writer read. Operations without a `before` take their
   * starting value from it, and coarse replacements split into per-field
   * writes, so the write merges with changes made since.
   */
  base?: unknown;
}
export interface DatasetApplyResult {
  record: DatasetRecord;
  conflicts: DatasetConflict[];
  changed: boolean;
}

const MAX_NAME = 200;
export function datasetHash(dataset: DatasetDocument): string {
  const { createdAt: _c, updatedAt: _u, ...content } = dataset;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

function assertJsonTree(value: unknown, depth = 0): void {
  if (depth > 64)
    throw new CoreError(
      "INVALID_DATA",
      "Dataset values are nested at most 64 levels.",
    );
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new CoreError("INVALID_DATA", "Dataset numbers must be finite.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonTree(item, depth + 1);
    return;
  }
  if (!isPlainObject(value))
    throw new CoreError("INVALID_DATA", "Dataset values contain only JSON.");
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new CoreError("INVALID_DATA", `Dataset keys cannot be ${key}.`);
    assertJsonTree(item, depth + 1);
  }
}

function invalid(error: unknown): never {
  if (error instanceof CoreError) throw error;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "CAPACITY_EXCEEDED"
  )
    throw error;
  throw new CoreError(
    "INVALID_DATA",
    error instanceof Error ? error.message : String(error),
  );
}

export function validateDataset(
  value: unknown,
  expectedId?: string,
): DatasetDocument {
  if (!isPlainObject(value))
    throw new CoreError("INVALID_DATA", "Invalid dataset file.");
  const dataset = value as unknown as DatasetDocument;
  for (const key of Object.keys(dataset))
    if (
      ![
        "format",
        "version",
        "id",
        "name",
        "description",
        "createdAt",
        "updatedAt",
        "origin",
        "schema",
        "value",
      ].includes(key)
    )
      throw new CoreError("INVALID_DATA", `Unknown dataset field: ${key}.`);
  if (
    dataset.format !== "showai-dataset" ||
    dataset.version !== 1 ||
    typeof dataset.id !== "string" ||
    (expectedId !== undefined && dataset.id !== expectedId) ||
    !Number.isFinite(Date.parse(dataset.createdAt)) ||
    !Number.isFinite(Date.parse(dataset.updatedAt))
  )
    throw new CoreError(
      "INVALID_DATA",
      `Invalid dataset file${expectedId ? `: ${expectedId}` : ""}.`,
    );
  assertId(dataset.id);
  if (
    typeof dataset.name !== "string" ||
    !dataset.name.trim() ||
    dataset.name.length > MAX_NAME
  )
    throw new CoreError(
      "INVALID_DATA",
      `A dataset name has 1–${MAX_NAME} characters.`,
    );
  if (
    dataset.description !== undefined &&
    (typeof dataset.description !== "string" ||
      dataset.description.length > 4000)
  )
    throw new CoreError(
      "INVALID_DATA",
      "A dataset description is text of at most 4000 characters.",
    );
  if (dataset.origin !== undefined) {
    if (
      !isPlainObject(dataset.origin) ||
      typeof dataset.origin.kind !== "string"
    )
      throw new CoreError("INVALID_DATA", "Invalid dataset origin.");
  }
  if (dataset.schema !== undefined && !isPlainObject(dataset.schema))
    throw new CoreError(
      "INVALID_DATA",
      "A dataset schema is a JSON Schema object.",
    );
  if (!("value" in dataset))
    throw new CoreError("INVALID_DATA", "A dataset needs a value.");
  try {
    assertJsonTree(dataset.value);
    assertContent(dataset.value, "Dataset value", CAPACITY.datasetBytes);
    if (dataset.schema) assertProps(dataset.schema, dataset.value);
  } catch (error) {
    invalid(error);
  }
  return dataset;
}

/** Blocks bound to a dataset, by page. */
export function datasetReferencesIn(
  document: ShowDocument,
  pageProjectId: string,
  projectId: string,
  datasetId: string,
): string[] {
  const blocks: string[] = [];
  visitNodes(document.content, (node) => {
    if (node.type !== "widget") return;
    const binding = readBinding(node.attrs?.data);
    if (
      binding?.dataset === datasetId &&
      (binding.project ?? pageProjectId) === projectId &&
      typeof node.attrs?.id === "string"
    )
      blocks.push(node.attrs.id);
  });
  return blocks;
}

export class DatasetStore {
  private readonly files;
  constructor(readonly store: FileStore) {
    this.files = store.datasetFiles();
  }
  get root() {
    return this.files.root;
  }

  path(projectId: string, datasetId: string): string {
    return join(
      this.files.directory(assertId(projectId)),
      `${assertId(datasetId)}.json`,
    );
  }

  private async revision(path: string): Promise<string | undefined> {
    const library = versionedLibrary(this.root);
    if (!library) return undefined;
    const state = libraryMutations.getStore();
    return (
      (await library.resourceRevision(
        logicalPath(this.root, path)!,
        state?.root === library.root ? (state.head ?? undefined) : undefined,
      )) ?? undefined
    );
  }

  private async record(
    projectId: string,
    datasetId: string,
  ): Promise<DatasetRecord> {
    const path = this.path(projectId, datasetId);
    let value: unknown;
    try {
      value = await this.files.readJson(path);
    } catch (error) {
      if (error instanceof CoreError && error.code === "NOT_FOUND")
        throw new CoreError("NOT_FOUND", `Dataset not found: ${datasetId}`);
      throw error;
    }
    const dataset = validateDataset(value, datasetId);
    const revision = await this.revision(path);
    return {
      dataset,
      hash: datasetHash(dataset),
      path,
      ...(revision ? { revision } : {}),
    };
  }

  async read(projectId: string, datasetId: string): Promise<DatasetRecord> {
    await this.files.readProject(projectId);
    return this.record(projectId, datasetId);
  }

  async list(projectId: string): Promise<DatasetSummary[]> {
    await this.files.readProject(projectId);
    const names = await this.files
      .names(this.files.directory(projectId))
      .catch((error) => {
        if (error instanceof CoreError && error.code === "NOT_FOUND") return [];
        throw error;
      });
    const summaries: DatasetSummary[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) continue;
      const record = await this.record(projectId, id);
      summaries.push({
        id,
        name: record.dataset.name,
        ...(record.dataset.description
          ? { description: record.dataset.description }
          : {}),
        createdAt: record.dataset.createdAt,
        updatedAt: record.dataset.updatedAt,
        hash: record.hash,
        ...(record.revision ? { revision: record.revision } : {}),
        bytes: Buffer.byteLength(JSON.stringify(record.dataset.value)),
        ...(record.dataset.origin ? { origin: record.dataset.origin } : {}),
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async write(
    path: string,
    dataset: DatasetDocument,
    expected?: string | null,
  ) {
    const state = libraryMutations.getStore();
    const managed = logicalPath(this.root, path);
    if (
      state?.root === versionedLibrary(this.root)?.root &&
      managed &&
      expected !== undefined
    )
      state!.expected.set(managed, state!.expected.get(managed) ?? expected);
    await this.files.write(path, `${JSON.stringify(dataset, null, 2)}\n`);
  }

  async create(
    projectId: string,
    input: {
      id?: string;
      name: string;
      description?: string;
      value: unknown;
      origin?: DatasetDocument["origin"];
      schema?: JsonSchema;
    },
  ): Promise<DatasetRecord> {
    const id = input.id === undefined ? randomUUID() : assertId(input.id);
    return this.files.lock(`dataset-${projectId}-${id}`, async () => {
      await this.files.readProject(projectId);
      const path = this.path(projectId, id);
      const exists = await this.record(projectId, id).then(
        () => true,
        (error) => {
          if (error instanceof CoreError && error.code === "NOT_FOUND")
            return false;
          throw error;
        },
      );
      if (exists)
        throw new CoreError(
          "CONFLICT",
          `A dataset with id ${id} already exists.`,
        );
      const now = new Date().toISOString();
      const dataset = validateDataset({
        format: "showai-dataset",
        version: 1,
        id,
        name: typeof input.name === "string" ? input.name.trim() : input.name,
        ...(input.description ? { description: input.description } : {}),
        createdAt: now,
        updatedAt: now,
        ...(input.origin ? { origin: input.origin } : {}),
        ...(input.schema ? { schema: input.schema } : {}),
        value: cloneValue(input.value),
      });
      await this.write(path, dataset, null);
      // The committing transaction attaches the new revision.
      return { dataset, hash: datasetHash(dataset), path };
    });
  }

  /**
   * Applies operations to the current value. Each write is checked against
   * the value its author started from; different records and fields merge.
   * With conflicts nothing is written and the conflicts are returned, or
   * thrown as CONFLICT with `throwOnConflict`.
   */
  async apply(
    projectId: string,
    datasetId: string,
    input: DatasetApplyInput,
    options: { throwOnConflict?: boolean } = {},
  ): Promise<DatasetApplyResult> {
    let operations: DatasetOperation[];
    try {
      operations = validateOperations(input.operations);
    } catch (error) {
      invalid(error);
    }
    if (
      input.name !== undefined &&
      (typeof input.name !== "string" || !input.name.trim())
    )
      throw new CoreError(
        "INVALID_DATA",
        "A dataset name must be non-empty text.",
      );
    return this.files.lock(`dataset-${projectId}-${datasetId}`, async () => {
      await this.files.readProject(projectId);
      const current = await this.record(projectId, datasetId);
      const sameBase =
        (input.baseHash === undefined || input.baseHash === current.hash) &&
        (input.baseRevision === undefined ||
          !current.revision ||
          input.baseRevision === current.revision);
      let base = input.base;
      if (!sameBase && base === undefined)
        base = await new DatasetBaselines(this.root).read(
          projectId,
          datasetId,
          input.baseHash,
          input.baseRevision,
        );
      if (
        !sameBase &&
        base === undefined &&
        operations.some(
          (operation) =>
            (operation.op === "set" || operation.op === "remove") &&
            !("before" in operation) &&
            !("absent" in operation),
        )
      ) {
        const error = new CoreError(
          "MISSING_BASELINE",
          "The dataset changed since it was read and the read is unavailable. Read it again before writing.",
          { currentHash: current.hash, currentRevision: current.revision },
        );
        throw error;
      }
      const prepared = refineOperations(
        operations,
        sameBase ? current.dataset.value : base,
      );
      let result;
      try {
        result = applyOperations(current.dataset.value, prepared);
      } catch (error) {
        invalid(error);
      }
      if (result.conflicts.length) {
        if (options.throwOnConflict) {
          const error = new CoreError(
            "CONFLICT",
            `${result.conflicts.length} change(s) conflict with newer edits of the same fields. Nothing was written. Read the dataset, decide each field, then write with the new baseHash.`,
            { currentHash: current.hash, currentRevision: current.revision },
          );
          error.details = { conflicts: result.conflicts };
          throw error;
        }
        return { record: current, conflicts: result.conflicts, changed: false };
      }
      const name = input.name?.trim() ?? current.dataset.name;
      const description =
        input.description === null
          ? undefined
          : (input.description ?? current.dataset.description);
      const schema =
        input.schema === null
          ? undefined
          : (input.schema ?? current.dataset.schema);
      if (
        !result.changed &&
        name === current.dataset.name &&
        description === current.dataset.description &&
        schema === current.dataset.schema
      )
        return { record: current, conflicts: [], changed: false };
      const { description: _old, schema: _schema, ...rest } = current.dataset;
      const dataset = validateDataset({
        ...rest,
        name,
        ...(description ? { description } : {}),
        ...(schema ? { schema } : {}),
        updatedAt: new Date().toISOString(),
        value: result.value,
      });
      await this.write(current.path, dataset, current.revision ?? null);
      return {
        record: { dataset, hash: datasetHash(dataset), path: current.path },
        conflicts: [],
        changed: true,
      };
    });
  }

  /** Pages of the library whose blocks are bound to this dataset. */
  async references(
    projectId: string,
    datasetId: string,
    scope: "library" | "project" = "library",
  ): Promise<DatasetReference[]> {
    const references: DatasetReference[] = [];
    // Pages moved to other projects keep their binding; deletion checks them all.
    const projects =
      scope === "project"
        ? [{ id: projectId }]
        : await this.store.listProjects();
    for (const project of projects) {
      for (const page of await this.store.listPages(project.id)) {
        // Only pages that mention the id can bind it; skip parsing the rest.
        const path = this.store.pagePath(project.id, page.id);
        const bytes =
          (await readLibraryFile(this.root, path)) ??
          (await readLibraryBytes(this.root, path));
        if (!bytes?.includes(datasetId)) continue;
        const record = await this.store.readPage(project.id, page.id, {
          checkpoint: false,
        });
        const blockIds = datasetReferencesIn(
          record.document,
          project.id,
          projectId,
          datasetId,
        );
        if (blockIds.length)
          references.push({
            projectId: project.id,
            pageId: page.id,
            title: record.document.title,
            blockIds,
          });
      }
    }
    return references;
  }

  /** Deletes an unused dataset; bound blocks must be detached first. */
  async remove(
    projectId: string,
    datasetId: string,
    input: { baseHash: string },
  ): Promise<{ removed: true; id: string }> {
    const references = await this.references(projectId, datasetId);
    if (references.length) {
      const error = new CoreError(
        "CONFLICT",
        `The dataset is still used by ${references.length} page(s). Detach those blocks (keeping a copy) before deleting it.`,
      );
      error.details = { references };
      throw error;
    }
    return this.files.lock(`dataset-${projectId}-${datasetId}`, async () => {
      const current = await this.record(projectId, datasetId);
      if (current.hash !== input.baseHash)
        throw new CoreError(
          "CONFLICT",
          "The dataset changed since it was read.",
          {
            currentHash: current.hash,
            currentRevision: current.revision,
          },
        );
      const state = libraryMutations.getStore();
      const managed = logicalPath(this.root, current.path);
      if (state && managed)
        state.expected.set(
          managed,
          state.expected.get(managed) ?? current.revision ?? null,
        );
      await this.files.remove(current.path);
      return { removed: true as const, id: datasetId };
    });
  }
}

/**
 * Values of datasets as they were read, by content hash, so a later write
 * that names its baseHash merges with changes made since. Bounded like a cache.
 */
export class DatasetBaselines {
  constructor(readonly home: string) {}
  private directory() {
    return join(this.home, "local", "dataset-baselines");
  }
  private name(projectId: string, datasetId: string, hash: string) {
    return createHash("sha256")
      .update(JSON.stringify([projectId, datasetId, hash]))
      .digest("hex");
  }
  private slot(projectId: string, datasetId: string) {
    const actor = changeContext().actor;
    return join(
      this.directory(),
      "readers",
      `${createHash("sha256")
        .update(
          JSON.stringify([
            actor.kind,
            actor.harness,
            actor.sessionId,
            projectId,
            datasetId,
          ]),
        )
        .digest("hex")}.json`,
    );
  }
  /** The value this actor (Agent session or editor) read last, if remembered. */
  async latest(
    projectId: string,
    datasetId: string,
  ): Promise<{ hash: string; value: unknown } | undefined> {
    const bytes = await readLibraryBytes(
      this.home,
      this.slot(projectId, datasetId),
    );
    if (!bytes) return undefined;
    const { hash } = JSON.parse(bytes.toString()) as { hash: string };
    const value = await this.read(projectId, datasetId, hash);
    return value === undefined ? undefined : { hash, value };
  }
  async remember(projectId: string, record: DatasetRecord): Promise<void> {
    const actor = changeContext().actor;
    await atomicLibraryFile(
      this.home,
      this.slot(projectId, record.dataset.id),
      Buffer.from(JSON.stringify({ hash: record.hash })),
    );
    await atomicLibraryFile(
      this.home,
      join(
        this.directory(),
        `${this.name(projectId, record.dataset.id, record.hash)}.json`,
      ),
      Buffer.from(
        JSON.stringify({
          projectId,
          datasetId: record.dataset.id,
          hash: record.hash,
          revision: record.revision,
          actor: [actor.harness, actor.sessionId],
          value: record.dataset.value,
        }),
      ),
    );
    const names = (await readdir(this.directory())).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
    if (names.length <= 128) return;
    const entries = await Promise.all(
      names.map(async (name) => ({
        name,
        time: (await stat(join(this.directory(), name))).mtimeMs,
      })),
    );
    entries.sort((a, b) => b.time - a.time);
    for (const entry of entries.slice(128))
      await rm(join(this.directory(), entry.name), { force: true });
  }
  async read(
    projectId: string,
    datasetId: string,
    hash?: string,
    revision?: string,
  ): Promise<unknown> {
    const names = await readdir(this.directory()).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      },
    );
    if (hash) {
      const name = `${this.name(projectId, datasetId, hash)}.json`;
      if (!names.includes(name)) return undefined;
      const bytes = await readLibraryBytes(
        this.home,
        join(this.directory(), name),
      );
      return bytes ? JSON.parse(bytes.toString()).value : undefined;
    }
    if (!revision) return undefined;
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const bytes = await readLibraryBytes(
        this.home,
        join(this.directory(), name),
      );
      if (!bytes) continue;
      const entry = JSON.parse(bytes.toString());
      if (
        entry.projectId === projectId &&
        entry.datasetId === datasetId &&
        entry.revision === revision
      )
        return entry.value;
    }
    return undefined;
  }
}

/** Accepts the dataset file of an imported or migrated page artifact unchanged. */
export function parseDatasetFile(
  source: string,
  expectedId?: string,
): DatasetDocument {
  try {
    return validateDataset(JSON.parse(source), expectedId);
  } catch (error) {
    invalid(error);
  }
}

export interface DatasetDraft {
  format: "showai-dataset-draft";
  version: 1;
  clientId: string;
  projectId: string;
  datasetId: string;
  /** The dataset hash the pending writes started from. */
  baseHash: string;
  /** Unsaved writes; each carries its starting value. */
  pending: DatasetOperation[];
  /** Writes that conflicted and wait for a decision. */
  held: (DatasetConflict & { id: string })[];
  savedAt: string;
}

/**
 * Unsaved and conflicting dataset writes of an editor window, kept on disk
 * until they are saved or explicitly discarded.
 */
export class DatasetDrafts {
  constructor(readonly home: string) {}
  private directory() {
    return join(this.home, "local", "dataset-drafts");
  }
  private file(clientId: string, projectId: string, datasetId: string) {
    return join(
      this.directory(),
      `${createHash("sha256")
        .update(JSON.stringify([clientId, projectId, datasetId]))
        .digest("hex")}.json`,
    );
  }
  async save(
    input: Omit<DatasetDraft, "format" | "version" | "savedAt">,
  ): Promise<DatasetDraft> {
    if (
      typeof input.clientId !== "string" ||
      !input.clientId ||
      input.clientId.length > 200
    )
      throw new CoreError(
        "INVALID_DATA",
        "A dataset draft needs its editor client id.",
      );
    assertId(input.projectId);
    assertId(input.datasetId);
    if (
      typeof input.baseHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.baseHash)
    )
      throw new CoreError(
        "INVALID_DATA",
        "A dataset draft needs the dataset hash it started from.",
      );
    let pending: DatasetOperation[];
    try {
      pending = validateOperations(input.pending);
    } catch (error) {
      invalid(error);
    }
    if (!Array.isArray(input.held) || input.held.length > 5000)
      throw new CoreError("INVALID_DATA", "Invalid held dataset conflicts.");
    const draft: DatasetDraft = {
      format: "showai-dataset-draft",
      version: 1,
      clientId: input.clientId,
      projectId: input.projectId,
      datasetId: input.datasetId,
      baseHash: input.baseHash,
      pending,
      held: input.held,
      savedAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(JSON.stringify(draft));
    assertContent(draft, "Dataset draft", CAPACITY.datasetBytes * 2);
    await atomicLibraryFile(
      this.home,
      this.file(input.clientId, input.projectId, input.datasetId),
      bytes,
    );
    return draft;
  }
  async list(projectId: string, datasetId: string): Promise<DatasetDraft[]> {
    const names = await readdir(this.directory()).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      },
    );
    const drafts: DatasetDraft[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const bytes = await readLibraryBytes(
        this.home,
        join(this.directory(), name),
      );
      if (!bytes) continue;
      const draft = JSON.parse(bytes.toString()) as DatasetDraft;
      if (
        draft.format === "showai-dataset-draft" &&
        draft.projectId === projectId &&
        draft.datasetId === datasetId
      )
        drafts.push(draft);
    }
    return drafts.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }
  async remove(
    clientId: string,
    projectId: string,
    datasetId: string,
  ): Promise<void> {
    assertId(projectId);
    assertId(datasetId);
    await rm(this.file(clientId, projectId, datasetId), { force: true });
  }
}

/**
 * The part of a component's props schema that describes its shared keys, so
 * every write to the dataset keeps it valid for that component.
 */
export function sharedPropsSchema(
  schema: JsonSchema,
  local: string[],
): JsonSchema {
  if (!isPlainObject(schema) || schema.type !== "object") return schema;
  const copy = cloneValue(schema) as Record<string, unknown>;
  if (isPlainObject(copy.properties))
    for (const key of local)
      delete (copy.properties as Record<string, unknown>)[key];
  if (Array.isArray(copy.required))
    copy.required = copy.required.filter((key) => !local.includes(String(key)));
  return copy as JsonSchema;
}

/**
 * Three-way merge of two versions of a dataset file (sync): local changes are
 * replayed onto the remote version per record and field. Conflicting fields
 * keep the remote value and are returned so both inputs can be retained.
 */
export function mergeDatasetVersions(
  base: DatasetDocument,
  local: DatasetDocument,
  remote: DatasetDocument,
): { dataset: DatasetDocument; conflicts: DatasetConflict[] } {
  const operations = diffValues(base.value, local.value);
  const result = applyOperations(remote.value, operations, { atomic: false });
  const conflicts = [...result.conflicts];
  const pick = <K extends "name" | "description" | "schema">(key: K) => {
    const original = canonicalJson(base[key] ?? null),
      ours = canonicalJson(local[key] ?? null),
      theirs = canonicalJson(remote[key] ?? null);
    if (ours === theirs || original === ours) return remote[key];
    if (original === theirs) return local[key];
    conflicts.push({
      op: "set",
      path: [`$${key}`],
      reason: "changed",
      base: base[key],
      mine: local[key],
      theirs: remote[key],
    });
    return remote[key];
  };
  const name = pick("name"),
    description = pick("description"),
    schema = pick("schema");
  const { description: _d, schema: _s, ...rest } = remote;
  const dataset = {
    ...rest,
    name: name ?? remote.name,
    ...(description ? { description } : {}),
    ...(schema ? { schema } : {}),
    updatedAt: [local.updatedAt, remote.updatedAt].sort().at(-1)!,
    value: result.value,
  } as DatasetDocument;
  try {
    return { dataset: validateDataset(dataset, remote.id), conflicts };
  } catch {
    // A merged value that no longer satisfies the schema keeps the remote version.
    return {
      dataset: remote,
      conflicts: [
        {
          op: "set",
          path: [],
          reason: "invalid",
          base: undefined,
          mine: local.value,
          theirs: remote.value,
        },
      ],
    };
  }
}
