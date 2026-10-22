import { createHash, randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
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
import {
  DatasetSourceLinks,
  externalPath,
  fileProblem,
  isDatasetSource,
  readExternal,
  serializeSource,
  sourceFormat,
  writeExternal,
  type DatasetSource,
  type ExternalFileState,
  type ExternalRead,
  type SourceFormat,
} from "./dataset-sources";

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
  /**
   * The value lives in a file outside the library, linked on each device
   * (see dataset-sources). The stored file then has no value.
   */
  source?: DatasetSource;
  value: unknown;
}
export interface DatasetRecord {
  dataset: DatasetDocument;
  hash: string;
  revision?: string;
  path: string;
  /** The linked file the value was read from. */
  external?: ExternalFileState;
}
/** An external source as listed: linked on this device and readable, or why not. */
export type DatasetSourceSummary = DatasetSource & {
  path?: string;
  bytes?: number;
  available: boolean;
  error?: string;
};
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
  source?: DatasetSourceSummary;
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
        "source",
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
  if (dataset.source !== undefined && !isDatasetSource(dataset.source))
    throw new CoreError("INVALID_DATA", "Invalid dataset source.");
  // An external dataset's stored file has no value; its file supplies it.
  if (dataset.source && dataset.value === undefined) return dataset;
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

/** The dataset as stored in the library: an external dataset keeps no value. */
function storedDataset(dataset: DatasetDocument): Omit<
  DatasetDocument,
  "value"
> & {
  value?: unknown;
} {
  if (!dataset.source) return dataset;
  const { value: _value, ...stored } = dataset;
  return stored;
}

/** Checks a value for a dataset, naming where it came from on failure. */
function assertDatasetValue(
  value: unknown,
  schema: JsonSchema | undefined,
  origin?: string,
) {
  try {
    assertJsonTree(value);
    assertContent(value, "Dataset value", CAPACITY.datasetBytes);
    if (schema) assertProps(schema, value);
  } catch (error) {
    if (!origin) invalid(error);
    const message = error instanceof Error ? error.message : String(error);
    throw new CoreError("INVALID_DATA", `${origin}: ${message}`);
  }
}

function sourceUnavailable(
  dataset: DatasetDocument,
  path: string | undefined,
  problem: string,
): CoreError {
  const error = new CoreError(
    "SOURCE_UNAVAILABLE",
    path
      ? `Dataset "${dataset.name}" reads ${path}, which cannot be read on this device (${problem}). Fix or restore the file, or link another file with dataset_write(action:link).`
      : `Dataset "${dataset.name}" reads an external file${dataset.source?.name ? ` (${dataset.source.name})` : ""} that is not linked on this device. Link it with dataset_write(action:link) or in the shared data dialog.`,
  );
  error.details = {
    datasetId: dataset.id,
    name: dataset.name,
    source: { ...dataset.source, ...(path ? { path } : {}) },
  };
  return error;
}

interface LoadedDataset {
  record: DatasetRecord;
  /** The external file as read, for a write that replaces it. */
  read?: ExternalRead;
}

export interface DatasetLinkInput {
  /** An existing dataset to link; omitted creates a new dataset. */
  datasetId?: string;
  /** New dataset id (creation only). */
  id?: string;
  name?: string;
  description?: string;
  schema?: JsonSchema;
  /** Absolute path of a file outside the library. */
  path: string;
  format?: SourceFormat;
  /**
   * "file" adopts the file's content as the value; "dataset" writes the
   * current value (or `value` when creating) into a new file. An existing
   * file is never overwritten.
   */
  use?: "file" | "dataset";
  /** The value of a new dataset whose file does not exist yet. */
  value?: unknown;
  origin?: DatasetDocument["origin"];
}

export class DatasetStore {
  private readonly files;
  readonly links: DatasetSourceLinks;
  constructor(readonly store: FileStore) {
    this.files = store.datasetFiles();
    this.links = new DatasetSourceLinks(store.root);
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

  /** The stored dataset file, without reading an external source. */
  private async stored(
    projectId: string,
    datasetId: string,
  ): Promise<{ dataset: DatasetDocument; path: string }> {
    const path = this.path(projectId, datasetId);
    let value: unknown;
    try {
      value = await this.files.readJson(path);
    } catch (error) {
      if (error instanceof CoreError && error.code === "NOT_FOUND")
        throw new CoreError("NOT_FOUND", `Dataset not found: ${datasetId}`);
      throw error;
    }
    return { dataset: validateDataset(value, datasetId), path };
  }

  /** Reads the linked file of an external dataset. */
  private async readSource(
    projectId: string,
    dataset: DatasetDocument,
    linked?: string,
  ): Promise<ExternalRead> {
    const path = linked ?? (await this.links.get(projectId, dataset.id));
    if (!path) throw sourceUnavailable(dataset, undefined, "not linked");
    let read: ExternalRead;
    try {
      read = await readExternal(
        path,
        dataset.source!.format,
        CAPACITY.datasetBytes,
      );
    } catch (error) {
      if (error instanceof CoreError) {
        if (error.code === "CONFLICT") throw error;
        throw sourceUnavailable(dataset, path, error.message);
      }
      throw sourceUnavailable(dataset, path, fileProblem(error));
    }
    try {
      assertDatasetValue(read.value, dataset.schema, basename(path));
    } catch (error) {
      throw sourceUnavailable(
        dataset,
        path,
        error instanceof Error ? error.message : String(error),
      );
    }
    return read;
  }

  private async load(
    projectId: string,
    datasetId: string,
  ): Promise<LoadedDataset> {
    const { dataset: stored, path } = await this.stored(projectId, datasetId);
    const revision = await this.revision(path);
    let dataset = stored;
    let read: ExternalRead | undefined;
    if (stored.source) {
      read = await this.readSource(projectId, stored);
      dataset = {
        ...stored,
        updatedAt: [stored.updatedAt, read.state.modifiedAt].sort().at(-1)!,
        value: read.value,
      };
    }
    return {
      record: {
        dataset,
        hash: datasetHash(dataset),
        path,
        ...(revision ? { revision } : {}),
        ...(read ? { external: read.state } : {}),
      },
      ...(read ? { read } : {}),
    };
  }

  private async record(
    projectId: string,
    datasetId: string,
  ): Promise<DatasetRecord> {
    return (await this.load(projectId, datasetId)).record;
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
      let record: DatasetRecord;
      let source: DatasetSourceSummary | undefined;
      try {
        record = await this.record(projectId, id);
        if (record.dataset.source)
          source = {
            ...record.dataset.source,
            path: record.external!.path,
            bytes: record.external!.bytes,
            available: true,
          };
      } catch (error) {
        // A missing or broken linked file still lists the dataset.
        if (!(
          error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE"
        ))
          throw error;
        const { dataset, path } = await this.stored(projectId, id);
        const linked = (error.details?.source as { path?: string }).path;
        source = {
          ...dataset.source!,
          ...(linked ? { path: linked } : {}),
          available: false,
          error: error.message,
        };
        const revision = await this.revision(path);
        record = {
          dataset,
          hash: datasetHash(dataset),
          path,
          ...(revision ? { revision } : {}),
        };
      }
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
        bytes:
          record.dataset.value === undefined
            ? 0
            : Buffer.byteLength(JSON.stringify(record.dataset.value)),
        ...(record.dataset.origin ? { origin: record.dataset.origin } : {}),
        ...(source ? { source } : {}),
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
    await this.files.write(
      path,
      `${JSON.stringify(storedDataset(dataset), null, 2)}\n`,
    );
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
      await this.assertAbsent(projectId, id);
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

  private async assertAbsent(projectId: string, id: string) {
    const exists = await this.stored(projectId, id).then(
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
  }

  /**
   * Keeps a dataset's value in a file outside the library: creates a dataset
   * from a file, moves an existing dataset's value into a new file, or links
   * this device's copy of an external dataset's file.
   */
  async link(
    projectId: string,
    input: DatasetLinkInput,
  ): Promise<DatasetRecord & { created: boolean; wroteFile: boolean }> {
    const path = externalPath(this.root, input.path);
    const format = sourceFormat(path, input.format);
    if (input.use !== undefined && !["file", "dataset"].includes(input.use))
      throw new CoreError("INVALID_DATA", 'use is "file" or "dataset".');
    const id =
      input.datasetId !== undefined
        ? assertId(input.datasetId)
        : input.id === undefined
          ? randomUUID()
          : assertId(input.id);
    return this.files.lock(`dataset-${projectId}-${id}`, async () => {
      await this.files.readProject(projectId);
      const exists = await stat(path).then(
        (info) => {
          if (!info.isFile())
            throw new CoreError("INVALID_PATH", `${path} is not a file.`);
          return true;
        },
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw new CoreError(
            "INVALID_PATH",
            `Cannot use ${path}: ${fileProblem(error)}.`,
          );
        },
      );
      const use = input.use ?? (exists ? "file" : "dataset");
      if (use === "file" && !exists)
        throw new CoreError(
          "NOT_FOUND",
          `${path} does not exist. Choose an existing file, or use "dataset" to write the data into a new file.`,
        );
      if (use === "dataset" && exists)
        throw new CoreError(
          "CONFLICT",
          `${path} already exists and is never overwritten. Choose a new file name, or use "file" to read this file instead.`,
        );
      const now = new Date().toISOString();
      const source: DatasetSource = {
        kind: "file",
        format,
        name: basename(path),
      };
      let current: LoadedDataset | undefined;
      let base: DatasetDocument;
      if (input.datasetId === undefined) {
        await this.assertAbsent(projectId, id);
        if (typeof input.name !== "string" || !input.name.trim())
          throw new CoreError("INVALID_DATA", "A new dataset needs a name.");
        if (use === "file" && input.value !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            "The file supplies the value; omit value, or choose a new file to write it into.",
          );
        if (use === "dataset" && input.value === undefined)
          throw new CoreError(
            "INVALID_DATA",
            "Give the value to write into the new file.",
          );
        base = {
          format: "showai-dataset",
          version: 1,
          id,
          name: input.name.trim(),
          ...(input.description ? { description: input.description } : {}),
          createdAt: now,
          updatedAt: now,
          ...(input.origin ? { origin: input.origin } : {}),
          ...(input.schema ? { schema: input.schema } : {}),
          value: input.value,
        };
      } else {
        if (input.value !== undefined || input.id !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            "Linking an existing dataset takes its value from the file or the dataset; omit value and id.",
          );
        const stored = await this.stored(projectId, id);
        if (stored.dataset.source && stored.dataset.source.format !== format)
          throw new CoreError(
            "INVALID_DATA",
            `This dataset reads a ${stored.dataset.source.format} file; choose a .${stored.dataset.source.format} file.`,
          );
        if (!stored.dataset.source && use === "file" && input.use !== "file")
          throw new CoreError(
            "CONFLICT",
            `Both the dataset and ${basename(path)} hold data. Pass use "file" to replace the dataset's value with the file, or choose a new file name to write the dataset into.`,
          );
        if (use === "dataset") current = await this.load(projectId, id);
        base = current?.record.dataset ?? stored.dataset;
        if (input.name !== undefined || input.description !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            "Rename an existing dataset with dataset_write(action:apply).",
          );
      }
      let value: unknown;
      let wroteFile = false;
      if (use === "dataset") {
        value = base.value;
        assertDatasetValue(value, base.schema);
        await writeExternal(path, serializeSource(value, format), null).catch(
          (error) => {
            if (error instanceof CoreError) throw error;
            throw new CoreError(
              "INVALID_PATH",
              `Cannot write ${path}: ${fileProblem(error)}.`,
            );
          },
        );
        wroteFile = true;
      }
      const dataset = validateDataset({
        ...base,
        source,
        ...(input.datasetId === undefined || !base.source
          ? { updatedAt: now }
          : {}),
        value: undefined,
      });
      const read = await this.readSource(projectId, dataset, path);
      const stored = await this.stored(projectId, id).catch((error) => {
        if (error instanceof CoreError && error.code === "NOT_FOUND")
          return undefined;
        throw error;
      });
      if (
        !stored ||
        canonicalJson(storedDataset(stored.dataset)) !==
          canonicalJson(storedDataset({ ...dataset, value: undefined }))
      )
        await this.write(
          this.path(projectId, id),
          dataset,
          stored ? ((await this.revision(stored.path)) ?? null) : null,
        );
      await this.links.set(projectId, id, path);
      const loaded = {
        ...dataset,
        updatedAt: [dataset.updatedAt, read.state.modifiedAt].sort().at(-1)!,
        value: read.value,
      };
      return {
        dataset: loaded,
        hash: datasetHash(loaded),
        path: this.path(projectId, id),
        external: read.state,
        created: input.datasetId === undefined,
        wroteFile,
      };
    });
  }

  /**
   * Copies an external dataset's current value into the library and stops
   * reading the file; the file itself is left as it is.
   */
  async embed(
    projectId: string,
    datasetId: string,
    input: { baseHash?: string } = {},
  ): Promise<DatasetRecord> {
    return this.files.lock(`dataset-${projectId}-${datasetId}`, async () => {
      await this.files.readProject(projectId);
      const { record } = await this.load(projectId, datasetId);
      if (!record.dataset.source)
        throw new CoreError(
          "INVALID_DATA",
          "This dataset already keeps its value in the library.",
        );
      if (input.baseHash !== undefined && input.baseHash !== record.hash)
        throw new CoreError(
          "CONFLICT",
          "The dataset changed since it was read.",
          { currentHash: record.hash, currentRevision: record.revision },
        );
      const { source: _source, ...rest } = record.dataset;
      const dataset = validateDataset({
        ...rest,
        updatedAt: new Date().toISOString(),
      });
      await this.write(record.path, dataset, record.revision ?? null);
      await this.links.set(projectId, datasetId, null);
      return { dataset, hash: datasetHash(dataset), path: record.path };
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
      const loaded = await this.load(projectId, datasetId);
      const current = loaded.record;
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
          error.details = { datasetId, conflicts: result.conflicts };
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
      const metadataChanged =
        name !== current.dataset.name ||
        description !== current.dataset.description ||
        schema !== current.dataset.schema;
      if (!result.changed && !metadataChanged)
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
      let external = current.external;
      if (loaded.read) {
        const { read } = loaded;
        if (result.changed) {
          // Serializing first rejects values the file format cannot hold.
          const text = serializeSource(
            dataset.value,
            read.state.format,
            read.layout,
          );
          await writeExternal(read.state.path, text, read.stamp);
          external = (
            await this.readSource(projectId, dataset, read.state.path)
          ).state;
        }
        if (metadataChanged)
          await this.write(current.path, dataset, current.revision ?? null);
      } else await this.write(current.path, dataset, current.revision ?? null);
      return {
        record: {
          dataset,
          hash: datasetHash(dataset),
          path: current.path,
          ...(external ? { external } : {}),
        },
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

  /**
   * Deletes an unused dataset; bound blocks must be detached first. An
   * external dataset's file is kept; only its link is removed.
   */
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
      const stored = await this.stored(projectId, datasetId);
      // An unreadable linked file still lets the dataset be deleted by its stored hash.
      const current = await this.record(projectId, datasetId).catch((error) => {
        if (error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE")
          return {
            ...stored,
            hash: datasetHash(stored.dataset),
            revision: undefined,
          };
        throw error;
      });
      if (current.hash !== input.baseHash)
        throw new CoreError(
          "CONFLICT",
          "The dataset changed since it was read.",
          {
            currentHash: current.hash,
            currentRevision: current.revision,
          },
        );
      const revision = current.revision ?? (await this.revision(stored.path));
      const state = libraryMutations.getStore();
      const managed = logicalPath(this.root, stored.path);
      if (state && managed)
        state.expected.set(
          managed,
          state.expected.get(managed) ?? revision ?? null,
        );
      await this.files.remove(stored.path);
      await this.links.set(projectId, datasetId, null);
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
