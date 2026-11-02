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
  DEFAULT_REFRESH_SECONDS,
  DatasetSourceLinks,
  externalPath,
  fetchSource,
  fileProblem,
  isDatasetSource,
  readExternal,
  refreshSeconds,
  serializeSource,
  sourceFormat,
  sourceUrl,
  sourceWritable,
  writeExternal,
  type DatasetSource,
  type ExternalFileState,
  type ExternalRead,
  type RemoteSourceState,
  type SourceFormat,
  type UrlSource,
} from "./dataset-sources";
import {
  DatasetValueCache,
  cacheOrigin,
  type CachedValue,
} from "./dataset-cache";
import {
  datasetWarning,
  type DatasetReadStatus,
  type DatasetWarning,
  type Editable,
  type WarningCode,
} from "../datasets/warnings.mjs";

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
   * The value lives outside the library: in a file linked on each device, or
   * at an http(s) address (see dataset-sources). The stored file then has no
   * value.
   */
  source?: DatasetSource;
  value: unknown;
}
export interface DatasetRecord {
  dataset: DatasetDocument;
  hash: string;
  revision?: string;
  path: string;
  /** The linked file the value was read from (for a stale value, as last read). */
  external?: ExternalFileState;
  /** The online data the value was fetched from (for a stale value, as last fetched). */
  remote?: RemoteSourceState;
  /**
   * ok: the value was read now (online data: within its refresh interval).
   * stale: the source cannot be read; the value is the last one read on
   * this device, from cachedAt, and cannot be written.
   */
  status: Exclude<DatasetReadStatus, "empty">;
  /** Whether writes are accepted: library data and JSON/CSV/TSV files. */
  editable: Editable;
  /** Why the value is stale; empty when status is ok. */
  warnings: DatasetWarning[];
  cachedAt?: string;
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
  status: DatasetReadStatus;
  editable: Editable;
  warnings: DatasetWarning[];
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
    const failure = new CoreError("INVALID_DATA", `${origin}: ${message}`);
    failure.details = {
      reason:
        (error as { code?: string })?.code === "CAPACITY_EXCEEDED"
          ? "TOO_LARGE"
          : "SHAPE_CHANGED",
    };
    throw failure;
  }
}

/** The warning code a failed source read carries, and its readable cause. */
function problemOf(error: unknown): { problem: string; reason: WarningCode } {
  if (error instanceof CoreError)
    return {
      problem: error.message,
      reason:
        (error.details?.reason as WarningCode | undefined) ??
        (error.code === "INVALID_DATA" ? "PARSE_FAILED" : "SOURCE_MISSING"),
    };
  return { problem: fileProblem(error), reason: "SOURCE_MISSING" };
}

function sourceUnavailable(
  dataset: DatasetDocument,
  path: string | undefined,
  problem: string,
  reason: WarningCode,
): CoreError {
  const source = dataset.source;
  const error = new CoreError(
    "SOURCE_UNAVAILABLE",
    source?.kind === "url"
      ? `Dataset "${dataset.name}" reads ${source.url}, which cannot be read now (${problem}).`
      : path
        ? `Dataset "${dataset.name}" reads ${path}, which cannot be read on this device (${problem}). Fix or restore the file, or link another file with dataset_write(action:link).`
        : `Dataset "${dataset.name}" reads an external file${source?.name ? ` (${source.name})` : ""} that is not linked on this device. Link it with dataset_write(action:link) or in the shared data dialog.`,
  );
  error.details = {
    datasetId: dataset.id,
    name: dataset.name,
    source: { ...source, ...(path ? { path } : {}) },
    reason,
  };
  return error;
}

/**
 * The warning of a source that could not be read. `cachedAt` names the
 * stale value shown instead; without it the dataset has no value here.
 */
export function unavailableWarning(
  error: CoreError,
  cachedAt?: string,
): DatasetWarning {
  const details = error.details as {
    datasetId: string;
    source?: { kind?: string };
    reason?: WarningCode;
  };
  return datasetWarning(
    details.reason ?? "SOURCE_MISSING",
    details.datasetId,
    cachedAt
      ? `${error.message} Showing the value last read on this device at ${cachedAt}; it cannot be changed until the source can be read again.`
      : error.message,
    {
      source: details.source?.kind === "url" ? "url" : "file",
      ...(cachedAt ? {} : { level: "error" as const }),
    },
  );
}

/** Rejects writes to read-only data before anything is changed. */
function readOnly(dataset: DatasetDocument): CoreError {
  const source = dataset.source!;
  const message =
    source.kind === "url"
      ? `Dataset "${dataset.name}" reads online data from ${source.url}, which ShowAI does not write. Change it at its source, or copy it into the library (dataset_write link path:null) to edit it here.`
      : `Dataset "${dataset.name}" reads a .${source.format} file, which ShowAI does not write. Change the file itself, or copy the data into the library (dataset_write link path:null) to edit it here.`;
  const error = new CoreError("READ_ONLY", message);
  error.details = {
    datasetId: dataset.id,
    name: dataset.name,
    source,
    reason: "READ_ONLY",
    warning: datasetWarning("READ_ONLY", dataset.id, message, {
      source: source.kind === "url" ? "url" : "file",
    }),
  };
  return error;
}

/**
 * Throws unless a read can be the base of a write: read-only sources are
 * READ_ONLY, a stale value is SOURCE_UNAVAILABLE.
 */
export function assertWritable(record: DatasetRecord): void {
  if (record.status === "stale") {
    const warning = record.warnings[0];
    const error = new CoreError(
      "SOURCE_UNAVAILABLE",
      `${warning?.message ?? `Dataset "${record.dataset.name}" shows a stale value.`} Nothing was written.`,
    );
    error.details = {
      datasetId: record.dataset.id,
      name: record.dataset.name,
      source: record.dataset.source,
      reason: warning?.code,
    };
    throw error;
  }
  if (record.editable === false) throw readOnly(record.dataset);
}

interface LoadedDataset {
  record: DatasetRecord;
  /** The external file as read, for a write that replaces it. */
  read?: ExternalRead;
}

const later = (a: string, b?: string) => (b && b > a ? b : a);

export interface DatasetLinkInput {
  /** An existing dataset to link; omitted creates a new dataset. */
  datasetId?: string;
  /** New dataset id (creation only). */
  id?: string;
  name?: string;
  description?: string;
  schema?: JsonSchema;
  /** Absolute path of a file outside the library; or give url. */
  path?: string;
  /** http(s) address of online data (read-only); or give path. */
  url?: string;
  /** Online data: seconds before a read fetches again (0 = only on refresh). */
  refreshSeconds?: number;
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
  readonly cache: DatasetValueCache;
  constructor(readonly store: FileStore) {
    this.files = store.datasetFiles();
    this.links = new DatasetSourceLinks(store.root);
    this.cache = new DatasetValueCache(store.root);
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

  /** Reads the linked file of an external dataset and keeps the value as last good. */
  private async readFile(
    projectId: string,
    dataset: DatasetDocument,
    linked?: string,
  ): Promise<ExternalRead> {
    const path = linked ?? (await this.links.get(projectId, dataset.id));
    if (!path)
      throw sourceUnavailable(
        dataset,
        undefined,
        "not linked",
        "SOURCE_NOT_LINKED",
      );
    let read: ExternalRead;
    try {
      read = await readExternal(
        path,
        dataset.source!.format,
        CAPACITY.datasetBytes,
      );
    } catch (error) {
      if (error instanceof CoreError && error.code === "CONFLICT") throw error;
      const { problem, reason } = problemOf(error);
      throw sourceUnavailable(dataset, path, problem, reason);
    }
    try {
      assertDatasetValue(read.value, dataset.schema, basename(path));
    } catch (error) {
      const { problem, reason } = problemOf(error);
      throw sourceUnavailable(dataset, path, problem, reason);
    }
    await this.cache.write({
      projectId,
      datasetId: dataset.id,
      origin: cacheOrigin(dataset.source!, path),
      bytes: read.state.bytes,
      value: read.value,
    });
    return read;
  }

  /**
   * Online data: the cached value while it is younger than the refresh
   * interval, otherwise fetched again (conditionally, when the last response
   * named an ETag or Last-Modified).
   */
  private async readUrl(
    projectId: string,
    dataset: DatasetDocument,
    refresh: boolean,
  ): Promise<{ value: unknown; state: RemoteSourceState }> {
    const source = dataset.source as UrlSource;
    const origin = cacheOrigin(source);
    const cached = await this.cache.read(projectId, dataset.id, origin);
    const state = (entry: CachedValue): RemoteSourceState => ({
      url: source.url,
      format: source.format,
      bytes: entry.bytes,
      fetchedAt: entry.readAt,
      ...(entry.lastModified && Number.isFinite(Date.parse(entry.lastModified))
        ? { modifiedAt: new Date(entry.lastModified).toISOString() }
        : {}),
    });
    const interval = source.refreshSeconds ?? DEFAULT_REFRESH_SECONDS;
    if (
      cached &&
      !refresh &&
      (interval === 0 ||
        Date.now() - Date.parse(cached.failure?.at ?? cached.readAt) <
          interval * 1000)
    ) {
      // A failed fetch is not retried on every read; the last value stays stale.
      if (cached.failure)
        throw sourceUnavailable(
          dataset,
          undefined,
          cached.failure.problem,
          cached.failure.reason,
        );
      return { value: cached.value, state: state(cached) };
    }
    let fetched: Awaited<ReturnType<typeof fetchSource>>;
    let value: unknown;
    try {
      fetched = await fetchSource(
        source.url,
        source.format,
        CAPACITY.datasetBytes,
        cached ? { etag: cached.etag, lastModified: cached.lastModified } : {},
      );
      value = fetched.notModified ? cached!.value : fetched.value;
      assertDatasetValue(value, dataset.schema, source.url);
    } catch (error) {
      const { problem, reason } = problemOf(error);
      if (cached) {
        const { format: _f, version: _v, hash: _h, ...kept } = cached;
        await this.cache.write(
          {
            ...kept,
            failure: { at: new Date().toISOString(), reason, problem },
          },
          { always: true },
        );
      }
      throw sourceUnavailable(dataset, undefined, problem, reason);
    }
    const etag = fetched.etag ?? cached?.etag;
    const lastModified = fetched.lastModified ?? cached?.lastModified;
    const entry = await this.cache.write(
      {
        projectId,
        datasetId: dataset.id,
        origin,
        bytes: fetched.notModified ? cached!.bytes : fetched.bytes,
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
        value,
      },
      { always: true },
    );
    return { value, state: state(entry) };
  }

  /**
   * The dataset with its current value. With `fallback`, an external source
   * that cannot be read returns the last value read on this device as
   * stale; without a cached value (or without fallback) it throws
   * SOURCE_UNAVAILABLE. Writes load without fallback.
   */
  private async load(
    projectId: string,
    datasetId: string,
    options: { fallback?: boolean; refresh?: boolean } = {},
  ): Promise<LoadedDataset> {
    const { dataset: stored, path } = await this.stored(projectId, datasetId);
    const revision = await this.revision(path);
    const base = { path, ...(revision ? { revision } : {}) };
    const source = stored.source;
    if (!source)
      return {
        record: {
          dataset: stored,
          hash: datasetHash(stored),
          ...base,
          status: "ok",
          editable: true,
          warnings: [],
        },
      };
    const editable = sourceWritable(source);
    try {
      if (source.kind === "url") {
        const { value, state } = await this.readUrl(
          projectId,
          stored,
          !!options.refresh,
        );
        const dataset = {
          ...stored,
          updatedAt: later(stored.updatedAt, state.modifiedAt),
          value,
        };
        return {
          record: {
            dataset,
            hash: datasetHash(dataset),
            ...base,
            remote: state,
            status: "ok",
            editable,
            warnings: [],
          },
        };
      }
      const read = await this.readFile(projectId, stored);
      const dataset = {
        ...stored,
        updatedAt: later(stored.updatedAt, read.state.modifiedAt),
        value: read.value,
      };
      return {
        record: {
          dataset,
          hash: datasetHash(dataset),
          ...base,
          external: read.state,
          status: "ok",
          editable,
          warnings: [],
        },
        read,
      };
    } catch (error) {
      if (
        !options.fallback ||
        !(error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE")
      )
        throw error;
      const linked = (error.details?.source as { path?: string } | undefined)
        ?.path;
      // An unlinked file has no source to have been read from on this device.
      const cached =
        source.kind === "url" || linked
          ? await this.cache.read(
              projectId,
              stored.id,
              cacheOrigin(source, linked),
            )
          : undefined;
      if (!cached) throw error;
      const dataset = { ...stored, value: cached.value };
      return {
        record: {
          dataset,
          hash: datasetHash(dataset),
          ...base,
          ...(source.kind === "url"
            ? {
                remote: {
                  url: source.url,
                  format: source.format,
                  bytes: cached.bytes,
                  fetchedAt: cached.readAt,
                },
              }
            : {
                external: {
                  path: linked!,
                  format: source.format,
                  bytes: cached.bytes,
                  modifiedAt: cached.readAt,
                },
              }),
          status: "stale",
          editable: false,
          warnings: [unavailableWarning(error, cached.readAt)],
          cachedAt: cached.readAt,
        },
      };
    }
  }

  /**
   * The dataset with its current value; an unreadable external source gives
   * its last value read on this device (status stale). `refresh` fetches
   * online data now instead of within its refresh interval.
   */
  async read(
    projectId: string,
    datasetId: string,
    options: { refresh?: boolean } = {},
  ): Promise<DatasetRecord> {
    await this.files.readProject(projectId);
    return (
      await this.load(projectId, datasetId, {
        fallback: true,
        refresh: options.refresh,
      })
    ).record;
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
      let record: DatasetRecord | undefined;
      let unavailable: CoreError | undefined;
      try {
        record = (await this.load(projectId, id, { fallback: true })).record;
      } catch (error) {
        // A missing or broken source without a cached value still lists the dataset.
        if (!(
          error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE"
        ))
          throw error;
        unavailable = error;
      }
      let source: DatasetSourceSummary | undefined;
      let summary: Omit<DatasetSummary, "id" | "bytes" | "source">;
      let bytes = 0;
      if (record) {
        const { dataset } = record;
        if (dataset.source)
          source = {
            ...dataset.source,
            ...(record.external
              ? { path: record.external.path, bytes: record.external.bytes }
              : {}),
            ...(record.remote ? { bytes: record.remote.bytes } : {}),
            available: record.status === "ok",
            ...(record.status === "stale"
              ? { error: record.warnings[0]?.message }
              : {}),
          };
        bytes = Buffer.byteLength(JSON.stringify(dataset.value));
        summary = {
          name: dataset.name,
          ...(dataset.description ? { description: dataset.description } : {}),
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
          hash: record.hash,
          ...(record.revision ? { revision: record.revision } : {}),
          ...(dataset.origin ? { origin: dataset.origin } : {}),
          status: record.status,
          editable: record.editable,
          warnings: record.warnings,
        };
      } else {
        const { dataset, path } = await this.stored(projectId, id);
        const linked = (
          unavailable!.details?.source as { path?: string } | undefined
        )?.path;
        source = {
          ...dataset.source!,
          ...(linked ? { path: linked } : {}),
          available: false,
          error: unavailable!.message,
        };
        const revision = await this.revision(path);
        summary = {
          name: dataset.name,
          ...(dataset.description ? { description: dataset.description } : {}),
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
          hash: datasetHash(dataset),
          ...(revision ? { revision } : {}),
          ...(dataset.origin ? { origin: dataset.origin } : {}),
          status: "empty",
          editable: false,
          warnings: [unavailableWarning(unavailable!)],
        };
      }
      summaries.push({
        id,
        ...summary,
        bytes,
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
      return {
        dataset,
        hash: datasetHash(dataset),
        path,
        status: "ok",
        editable: true,
        warnings: [],
      };
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
   * Keeps a dataset's value outside the library: creates a dataset from a
   * file or online data, moves an existing dataset's value into a new file,
   * replaces it with a file's or address's content, or links this device's
   * copy of an external dataset's file.
   */
  async link(
    projectId: string,
    input: DatasetLinkInput,
  ): Promise<DatasetRecord & { created: boolean; wroteFile: boolean }> {
    if ((input.path === undefined) === (input.url === undefined))
      throw new CoreError(
        "INVALID_DATA",
        "Give either path (a file on this device) or url (online data).",
      );
    if (input.use !== undefined && !["file", "dataset"].includes(input.use))
      throw new CoreError("INVALID_DATA", 'use is "file" or "dataset".');
    const online = input.url !== undefined;
    const path = online ? undefined : externalPath(this.root, input.path);
    const url = online ? sourceUrl(input.url) : undefined;
    const format = sourceFormat(path ?? new URL(url!).pathname, input.format);
    if (!online && input.refreshSeconds !== undefined)
      throw new CoreError(
        "INVALID_DATA",
        "refreshSeconds applies to online data; a linked file is read on every read.",
      );
    const refresh = refreshSeconds(input.refreshSeconds);
    const source: DatasetSource = online
      ? {
          kind: "url",
          format,
          url: url!,
          ...(basename(new URL(url!).pathname)
            ? { name: basename(new URL(url!).pathname).slice(0, 255) }
            : {}),
          ...(refresh !== undefined ? { refreshSeconds: refresh } : {}),
        }
      : { kind: "file", format, name: basename(path!) };
    if (input.use === "dataset" && !sourceWritable(source))
      throw new CoreError(
        "READ_ONLY",
        online
          ? "Online data is read-only: ShowAI cannot write a dataset to an address. Link the address to read it."
          : `ShowAI does not write .${format} files. Choose a .json, .csv or .tsv file to write the dataset into.`,
      );
    const id =
      input.datasetId !== undefined
        ? assertId(input.datasetId)
        : input.id === undefined
          ? randomUUID()
          : assertId(input.id);
    return this.files.lock(`dataset-${projectId}-${id}`, async () => {
      await this.files.readProject(projectId);
      const exists = online
        ? true
        : await stat(path!).then(
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
      let current: LoadedDataset | undefined;
      let base: DatasetDocument;
      if (input.datasetId === undefined) {
        await this.assertAbsent(projectId, id);
        if (typeof input.name !== "string" || !input.name.trim())
          throw new CoreError("INVALID_DATA", "A new dataset needs a name.");
        if (use === "file" && input.value !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            `${online ? "The address" : "The file"} supplies the value; omit value${online ? "" : ", or choose a new file to write it into"}.`,
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
            "Linking an existing dataset takes its value from the source or the dataset; omit value and id.",
          );
        const stored = await this.stored(projectId, id);
        const previous = stored.dataset.source;
        // Other devices link their own copy of the same file format.
        if (previous?.kind === "file" && !online && previous.format !== format)
          throw new CoreError(
            "INVALID_DATA",
            `This dataset reads a ${previous.format} file; choose a .${previous.format} file.`,
          );
        if (!previous && use === "file" && input.use !== "file")
          throw new CoreError(
            "CONFLICT",
            online
              ? `The dataset holds data. Pass use "file" to replace its value with the data at ${url}.`
              : `Both the dataset and ${basename(path!)} hold data. Pass use "file" to replace the dataset's value with the file, or choose a new file name to write the dataset into.`,
          );
        if (use === "dataset") current = await this.load(projectId, id);
        base = current?.record.dataset ?? stored.dataset;
        if (input.name !== undefined || input.description !== undefined)
          throw new CoreError(
            "INVALID_DATA",
            "Rename an existing dataset with dataset_write(action:apply).",
          );
      }
      let wroteFile = false;
      if (use === "dataset") {
        const value = base.value;
        assertDatasetValue(value, base.schema);
        await writeExternal(path!, serializeSource(value, format), null).catch(
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
        ...(input.datasetId === undefined ||
        !base.source ||
        canonicalJson(base.source) !== canonicalJson(source)
          ? { updatedAt: now }
          : {}),
        value: undefined,
      });
      let value: unknown;
      let external: ExternalFileState | undefined;
      let remote: RemoteSourceState | undefined;
      if (online) {
        const read = await this.readUrl(projectId, dataset, true);
        value = read.value;
        remote = read.state;
      } else {
        const read = await this.readFile(projectId, dataset, path);
        value = read.value;
        external = read.state;
      }
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
      // Online data needs no device link; a file link it replaces is dropped.
      await this.links.set(projectId, id, online ? null : path!);
      const loaded = {
        ...dataset,
        updatedAt: later(
          dataset.updatedAt,
          external?.modifiedAt ?? remote?.modifiedAt,
        ),
        value,
      };
      return {
        dataset: loaded,
        hash: datasetHash(loaded),
        path: this.path(projectId, id),
        ...(external ? { external } : {}),
        ...(remote ? { remote } : {}),
        status: "ok" as const,
        editable: sourceWritable(source),
        warnings: [],
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
      await this.cache.remove(projectId, datasetId);
      return {
        dataset,
        hash: datasetHash(dataset),
        path: record.path,
        status: "ok",
        editable: true,
        warnings: [],
      };
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
      // Read-only data refuses value changes before its source is read;
      // renaming it (or changing its schema) still works from a stale read.
      const { dataset: stored } = await this.stored(projectId, datasetId);
      const readOnlySource = !!stored.source && !sourceWritable(stored.source);
      if (readOnlySource && operations.length) throw readOnly(stored);
      const loaded = await this.load(projectId, datasetId, {
        fallback: readOnlySource,
      });
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
          external = (await this.readFile(projectId, dataset, read.state.path))
            .state;
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
          ...(current.remote ? { remote: current.remote } : {}),
          status: current.status,
          editable: current.editable,
          warnings: current.warnings,
          ...(current.cachedAt ? { cachedAt: current.cachedAt } : {}),
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
      const storedHash = datasetHash(stored.dataset);
      // An unreadable source still lets the dataset be deleted by the hash
      // listed for it: its stale value's, or the stored file's.
      const current = await this.load(projectId, datasetId, { fallback: true })
        .then(({ record }) => record)
        .catch((error) => {
          if (error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE")
            return { hash: storedHash, revision: undefined, status: "stale" };
          throw error;
        });
      if (
        current.hash !== input.baseHash &&
        !(current.status === "stale" && input.baseHash === storedHash)
      )
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
      await this.cache.remove(projectId, datasetId);
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
    const context = changeContext();
    const actor = context.actor;
    // A real Agent session is one reader across its connections; anything
    // else is one reader per MCP connection (or per actor outside MCP).
    const reader =
      actor.sessionId || !context.readerId
        ? [actor.kind, actor.harness, actor.sessionId]
        : ["connection", context.readerId];
    return join(
      this.directory(),
      "readers",
      `${createHash("sha256")
        .update(JSON.stringify([...reader, projectId, datasetId]))
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
    // A stale value is not the source's; no write may merge from it.
    if (record.status !== "ok") return;
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
