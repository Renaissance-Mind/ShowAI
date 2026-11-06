import { createHash, randomUUID } from "node:crypto";
import { assertDatasetAccess } from "./dataset-access";
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
  parseSourceBytes,
  readExternal,
  readExternalBytes,
  refreshSeconds,
  serializeSource,
  sourceFormat,
  sourceUrl,
  sourceWritable,
  writeExternal,
  type DatasetSource,
  type ExternalFileState,
  type ExternalRead,
  type FileLayout,
  type FileSource,
  type RemoteSourceState,
  type SourceFormat,
  type UrlSource,
} from "./dataset-sources";
import {
  DatasetValueCache,
  cacheOrigin,
  type CachedValue,
} from "./dataset-cache";
import { TRANSFORM_LIMITS, runTransform } from "./dataset-transform";
import {
  BundleAgreements,
  bundleHash,
  datasetBundleKey,
  readBundle,
  storeBundle,
} from "./dataset-bundles";
import { transformsReading } from "./dataset-dependents";
import {
  datasetWarning,
  type DatasetReadStatus,
  type DatasetWarning,
  type Editable,
  type WarningCode,
} from "../datasets/warnings.mjs";

/** An input of a transform: a dataset of the same project, or of another one. */
export type TransformInput = string | { project: string; dataset: string };
/**
 * A dataset computed by a script from other datasets. The script defines
 * function transform(inputs, helpers) and returns the value; it runs in a
 * sandbox (see dataset-transform) whenever an input or the script changes.
 */
export interface DatasetTransform {
  /** Input name (the key of `inputs` in the script) → dataset. */
  inputs: Record<string, TransformInput>;
  script: string;
}
/** How the value of a transform dataset was computed. */
export interface TransformReadInfo {
  /** sha256 of the script. */
  scriptHash: string;
  inputs: Record<
    string,
    {
      projectId: string;
      datasetId: string;
      name?: string;
      hash?: string;
      status: DatasetReadStatus;
    }
  >;
  /** Milliseconds of the run that produced the value. */
  lastRunMs?: number;
  /** When that run happened. */
  ranAt?: string;
}

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
  /** The value is computed from other datasets; the stored file has no value. */
  transform?: DatasetTransform;
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
   * The copy of another device's linked file that synchronization carried
   * here (source.bundle); read when this device links no file of its own.
   */
  bundled?: BundledCopyState;
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
  /** A transform dataset: its inputs as read and its last run. */
  transform?: TransformReadInfo;
}
/** A synchronized copy of a linked file, as read on a device without the file. */
export interface BundledCopyState {
  hash: string;
  format: SourceFormat;
  bytes: number;
  updatedAt?: string;
}
/** An external source as listed: linked on this device and readable, or why not. */
export type DatasetSourceSummary = DatasetSource & {
  path?: string;
  bytes?: number;
  /** Read from the synchronized copy of another device's file. */
  bundled?: boolean;
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
  /** A transform dataset: the datasets it is computed from. */
  transform?: { inputs: Record<string, TransformInput> };
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
        "transform",
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
  if (dataset.transform !== undefined) {
    if (dataset.source !== undefined)
      throw new CoreError(
        "INVALID_DATA",
        "A dataset reads a source or is computed by a transform, not both.",
      );
    assertTransform(dataset.transform);
  }
  // An external or computed dataset's stored file has no value.
  if ((dataset.source || dataset.transform) && dataset.value === undefined)
    return dataset;
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

const INPUT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

/** Checks the shape of a transform definition (inputs and script). */
export function assertTransform(
  value: unknown,
): asserts value is DatasetTransform {
  if (!isPlainObject(value))
    throw new CoreError(
      "INVALID_DATA",
      "A transform is { inputs: { name: datasetId }, script }.",
    );
  for (const key of Object.keys(value))
    if (!["inputs", "script"].includes(key))
      throw new CoreError("INVALID_DATA", `Unknown transform field: ${key}.`);
  const { inputs, script } = value as Record<string, unknown>;
  if (!isPlainObject(inputs) || !Object.keys(inputs).length)
    throw new CoreError(
      "INVALID_DATA",
      "A transform needs inputs: { name: datasetId or {project, dataset} }.",
    );
  if (Object.keys(inputs).length > TRANSFORM_LIMITS.maxInputs)
    throw new CoreError(
      "INVALID_DATA",
      `A transform has at most ${TRANSFORM_LIMITS.maxInputs} inputs.`,
    );
  for (const [name, input] of Object.entries(inputs)) {
    if (!INPUT_NAME.test(name))
      throw new CoreError(
        "INVALID_DATA",
        `Input name ${JSON.stringify(name)} is not an identifier (letters, digits, _ or $; at most 64).`,
      );
    try {
      if (typeof input === "string") assertId(input);
      else if (
        isPlainObject(input) &&
        Object.keys(input).every((key) => ["project", "dataset"].includes(key))
      ) {
        assertId(input.project as string);
        assertId(input.dataset as string);
      } else throw new Error();
    } catch {
      throw new CoreError(
        "INVALID_DATA",
        `Input ${name} names a dataset id, or {project, dataset} for a dataset of another project.`,
      );
    }
  }
  if (typeof script !== "string" || !script.trim())
    throw new CoreError(
      "INVALID_DATA",
      "A transform needs a script defining function transform(inputs, helpers).",
    );
  if (Buffer.byteLength(script) > TRANSFORM_LIMITS.scriptBytes)
    throw new CoreError(
      "INVALID_DATA",
      `A transform script has at most ${TRANSFORM_LIMITS.scriptBytes} bytes.`,
    );
}

/** The project and dataset an input of a transform in projectId reads. */
export function transformInput(
  input: TransformInput,
  projectId: string,
): { projectId: string; datasetId: string } {
  return typeof input === "string"
    ? { projectId, datasetId: input }
    : { projectId: input.project, datasetId: input.dataset };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** Origin of a transform's last good output in local/dataset-cache. */
const TRANSFORM_ORIGIN = "transform";

/**
 * Outputs (or failures) of the last run of each transform in this process,
 * keyed by library, project and dataset; a run is reused while its inputs
 * and script are unchanged.
 */
const transformRuns = new Map<
  string,
  {
    key: string;
    ranAt: string;
    result:
      | { ok: true; value: unknown; ms: number }
      | { ok: false; code: WarningCode; message: string; ms: number };
  }
>();
const MAX_REMEMBERED_RUNS = 64;

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
  if (!dataset.source && !dataset.transform) return dataset;
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
      : reason === "NOT_BUNDLED"
        ? `Dataset "${dataset.name}" reads a file of another device${source?.name ? ` (${source.name})` : ""}; ${problem}. Link this device's copy with dataset_write(action:link) or in the shared data dialog, or let the device that links it include the file in synchronization.`
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

/**
 * The warnings of a dataset without a value: the source's, or for a
 * transform every reason its inputs or script gave none.
 */
export function unavailableWarnings(error: CoreError): DatasetWarning[] {
  const warnings = (error.details as { warnings?: DatasetWarning[] })?.warnings;
  return warnings?.length ? warnings : [unavailableWarning(error)];
}

/** Rejects writes to read-only data before anything is changed. */
function readOnly(dataset: DatasetDocument): CoreError {
  if (dataset.transform) {
    const message = `Dataset "${dataset.name}" is computed by a transform script from ${Object.keys(dataset.transform.inputs).join(", ")}; its value is read-only. Change the inputs, or the script with dataset_write(action:transform).`;
    const error = new CoreError("READ_ONLY", message);
    error.details = {
      datasetId: dataset.id,
      name: dataset.name,
      reason: "READ_ONLY",
      warning: datasetWarning("READ_ONLY", dataset.id, message, {
        stage: "transform",
      }),
    };
    return error;
  }
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
  if (record.dataset.transform) throw readOnly(record.dataset);
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

/** A transform dataset without a value: none of its inputs or runs gave one. */
function transformUnavailable(
  dataset: DatasetDocument,
  warnings: DatasetWarning[],
): CoreError {
  const error = new CoreError(
    "SOURCE_UNAVAILABLE",
    `Dataset "${dataset.name}" has no value yet: ${warnings
      .map((warning) => warning.message)
      .join(" ")}`,
  );
  error.details = {
    datasetId: dataset.id,
    name: dataset.name,
    reason: warnings[0]?.code ?? "TRANSFORM_FAILED",
    warnings,
  };
  return error;
}

interface LoadedDataset {
  record: DatasetRecord;
  /** The external file as read, for a write that replaces it. */
  read?: ExternalRead;
  /** The synchronized copy as read, for a write that replaces it. */
  bundle?: { layout: FileLayout; format: SourceFormat };
}

/** Cache origin of values read from a synchronized copy. */
const bundleOrigin = (source: FileSource) => `bundle:${source.format}`;

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
  readonly agreements: BundleAgreements;
  constructor(readonly store: FileStore) {
    this.files = store.datasetFiles();
    this.links = new DatasetSourceLinks(store.root);
    this.cache = new DatasetValueCache(store.root);
    this.agreements = new BundleAgreements(store.root);
  }
  get root() {
    return this.files.root;
  }

  path(projectId: string, datasetId: string): string {
    assertDatasetAccess(this.root, projectId);
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
   * The synchronized copy of another device's linked file, for a device that
   * links no file of its own; keeps the value as last good.
   */
  private async readBundled(
    projectId: string,
    dataset: DatasetDocument,
  ): Promise<{ value: unknown; layout: FileLayout; state: BundledCopyState }> {
    const source = dataset.source as FileSource;
    const bundle = source.bundle;
    if (!bundle)
      throw sourceUnavailable(
        dataset,
        undefined,
        "not linked",
        "SOURCE_NOT_LINKED",
      );
    const copy =
      bundle.sync && bundle.hash
        ? await readBundle(this.root, bundle.hash)
        : undefined;
    if (!copy)
      throw sourceUnavailable(
        dataset,
        undefined,
        !bundle.sync
          ? "it is synchronized without its file"
          : bundle.hash
            ? "its synchronized copy has not arrived on this device yet"
            : "the device that links it has not shared a copy yet",
        "NOT_BUNDLED",
      );
    const name = source.name ?? dataset.name;
    let parsed: { value: unknown; layout: FileLayout };
    try {
      parsed = await parseSourceBytes(copy, source.format, name);
      assertDatasetValue(parsed.value, dataset.schema, name);
    } catch (error) {
      const { problem, reason } = problemOf(error);
      throw sourceUnavailable(dataset, undefined, problem, reason);
    }
    await this.cache.write({
      projectId,
      datasetId: dataset.id,
      origin: bundleOrigin(source),
      bytes: copy.length,
      value: parsed.value,
    });
    return {
      ...parsed,
      state: {
        hash: bundle.hash!,
        format: source.format,
        bytes: copy.length,
        ...(bundle.updatedAt ? { updatedAt: bundle.updatedAt } : {}),
      },
    };
  }

  /** Why this device's file and its synchronized copy disagree, if they do. */
  private async bundleWarnings(
    projectId: string,
    dataset: DatasetDocument,
    path: string,
  ): Promise<DatasetWarning[]> {
    const source = dataset.source as FileSource;
    if (!source.bundle?.sync) return [];
    const agreement = await this.agreements.get(
      datasetBundleKey(projectId, dataset.id),
    );
    if (!agreement?.conflict) return [];
    return [
      datasetWarning(
        "WRITE_CONFLICT",
        dataset.id,
        `${basename(path)} changed on this device while another device edited the synchronized copy of "${dataset.name}". The file was kept as it is and the other version stays in the project's synchronized copy. Change the file to combine both versions; its next change is shared with the other devices.`,
      ),
    ];
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
    options: {
      fallback?: boolean;
      refresh?: boolean;
      /** Transforms being computed, as project/dataset; reaching one again is a cycle. */
      visiting?: Set<string>;
    } = {},
  ): Promise<LoadedDataset> {
    const { dataset: stored, path } = await this.stored(projectId, datasetId);
    const revision = await this.revision(path);
    const base = { path, ...(revision ? { revision } : {}) };
    if (stored.transform)
      return {
        record: await this.compute(projectId, stored, base, options),
      };
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
      const linked = await this.links.get(projectId, stored.id);
      if (!linked) {
        // Another device's file, as synchronization carried it here.
        const copy = await this.readBundled(projectId, stored);
        const dataset = {
          ...stored,
          updatedAt: later(stored.updatedAt, copy.state.updatedAt),
          value: copy.value,
        };
        return {
          record: {
            dataset,
            hash: datasetHash(dataset),
            ...base,
            bundled: copy.state,
            status: "ok",
            editable,
            warnings: [],
          },
          bundle: { layout: copy.layout, format: source.format },
        };
      }
      const read = await this.readFile(projectId, stored, linked);
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
          warnings: await this.bundleWarnings(projectId, stored, linked),
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
      // An unlinked file was read here only from its synchronized copy.
      const cached =
        source.kind === "url" || linked
          ? await this.cache.read(
              projectId,
              stored.id,
              cacheOrigin(source, linked),
            )
          : source.bundle
            ? await this.cache.read(projectId, stored.id, bundleOrigin(source))
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
            : linked
              ? {
                  external: {
                    path: linked,
                    format: source.format,
                    bytes: cached.bytes,
                    modifiedAt: cached.readAt,
                  },
                }
              : {}),
          status: "stale",
          editable: false,
          warnings: [unavailableWarning(error, cached.readAt)],
          cachedAt: cached.readAt,
        },
      };
    }
  }

  /** The inputs of a transform as read now, and why any of them has no value. */
  private async readInputs(
    projectId: string,
    datasetId: string,
    transform: DatasetTransform,
    options: { refresh?: boolean; visiting?: Set<string> },
  ) {
    const visiting = new Set(options.visiting);
    visiting.add(`${projectId}/${datasetId}`);
    const values: Record<string, unknown> = {};
    const inputs: TransformReadInfo["inputs"] = {};
    const warnings: DatasetWarning[] = [];
    let stale = false;
    let failure: DatasetWarning | undefined;
    for (const [name, reference] of Object.entries(transform.inputs)) {
      const input = transformInput(reference, projectId);
      const key = `${input.projectId}/${input.datasetId}`;
      inputs[name] = { ...input, status: "empty" };
      if (visiting.has(key)) {
        failure ??= datasetWarning(
          "TRANSFORM_FAILED",
          datasetId,
          `Input ${name} (${key}) is computed from this dataset; transform inputs cannot form a cycle. Change the inputs with dataset_write(action:transform).`,
        );
        continue;
      }
      let record: DatasetRecord;
      try {
        if (input.projectId !== projectId)
          await this.files.readProject(input.projectId);
        record = (
          await this.load(input.projectId, input.datasetId, {
            fallback: true,
            refresh: options.refresh,
            visiting,
          })
        ).record;
      } catch (error) {
        if (error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE") {
          warnings.push(...unavailableWarnings(error));
          continue;
        }
        if (error instanceof CoreError && error.code === "NOT_FOUND") {
          failure ??= datasetWarning(
            "TRANSFORM_FAILED",
            datasetId,
            `Input ${name}: dataset ${key} does not exist. Change the inputs with dataset_write(action:transform).`,
          );
          continue;
        }
        throw error;
      }
      values[name] = record.dataset.value;
      inputs[name] = {
        ...input,
        name: record.dataset.name,
        hash: record.hash,
        status: record.status,
      };
      if (record.status === "stale") {
        stale = true;
        warnings.push(...record.warnings);
      }
    }
    const empty = Object.values(inputs).some(
      (input) => input.status === "empty",
    );
    return { values, inputs, warnings, stale, empty, failure };
  }

  /**
   * The value of a transform dataset: its script run on its inputs, reused
   * while neither changed. An input without a value, or a failing run, gives
   * the last good output of this device marked stale (with `fallback`).
   */
  private async compute(
    projectId: string,
    stored: DatasetDocument,
    base: { path: string; revision?: string },
    options: { fallback?: boolean; refresh?: boolean; visiting?: Set<string> },
  ): Promise<DatasetRecord> {
    const transform = stored.transform!;
    const read = await this.readInputs(
      projectId,
      stored.id,
      transform,
      options,
    );
    const scriptHash = sha256(transform.script);
    const info = (run?: {
      ms?: number;
      ranAt?: string;
    }): TransformReadInfo => ({
      scriptHash,
      inputs: read.inputs,
      ...(run?.ms !== undefined ? { lastRunMs: run.ms } : {}),
      ...(run?.ranAt ? { ranAt: run.ranAt } : {}),
    });
    const record = (
      value: unknown,
      status: "ok" | "stale",
      warnings: DatasetWarning[],
      run: { ms?: number; ranAt?: string },
      cachedAt?: string,
    ): DatasetRecord => {
      const dataset = { ...stored, value };
      return {
        dataset,
        hash: datasetHash(dataset),
        ...base,
        status,
        editable: false,
        warnings,
        ...(cachedAt ? { cachedAt } : {}),
        transform: info(run),
      };
    };
    /** The last good output, stale, or no value at all. */
    const lastGood = async (problems: DatasetWarning[]) => {
      const cached = options.fallback
        ? await this.cache.read(projectId, stored.id, TRANSFORM_ORIGIN)
        : undefined;
      if (!cached) throw transformUnavailable(stored, problems);
      const warnings = problems.map((warning) =>
        warning.datasetId === stored.id && warning.stage === "transform"
          ? {
              ...warning,
              message: `${warning.message} Showing the output of its last successful run at ${cached.readAt}.`,
            }
          : warning,
      );
      return record(
        cached.value,
        "stale",
        warnings,
        { ms: cached.transform?.ms, ranAt: cached.readAt },
        cached.readAt,
      );
    };
    if (read.failure || read.empty)
      return lastGood(
        read.failure ? [read.failure, ...read.warnings] : read.warnings,
      );
    if (read.stale && !options.fallback)
      throw transformUnavailable(stored, read.warnings);
    const key = sha256(
      canonicalJson({
        script: scriptHash,
        schema: stored.schema ?? null,
        inputs: Object.fromEntries(
          Object.entries(read.inputs).map(([name, input]) => [
            name,
            input.hash,
          ]),
        ),
      }),
    );
    const memo = `${this.root}\0${projectId}/${stored.id}`;
    let run = transformRuns.get(memo);
    if (run?.key !== key) {
      const cached = await this.cache.read(
        projectId,
        stored.id,
        TRANSFORM_ORIGIN,
      );
      if (cached?.transform?.key === key)
        run = {
          key,
          ranAt: cached.readAt,
          result: { ok: true, value: cached.value, ms: cached.transform.ms },
        };
      else {
        const ranAt = new Date().toISOString();
        let result = await runTransform(transform.script, read.values);
        if (result.ok)
          try {
            assertDatasetValue(result.value, stored.schema, "The output");
          } catch (error) {
            const { problem, reason } = problemOf(error);
            result = {
              ok: false,
              code: reason === "TOO_LARGE" ? "TOO_LARGE" : "OUTPUT_INVALID",
              message: problem,
              ms: result.ms,
            };
          }
        run = { key, ranAt, result };
        if (result.ok)
          await this.cache.write(
            {
              projectId,
              datasetId: stored.id,
              origin: TRANSFORM_ORIGIN,
              readAt: ranAt,
              bytes: Buffer.byteLength(JSON.stringify(result.value)),
              transform: { key, ms: result.ms },
              value: result.value,
            },
            { always: true },
          );
      }
      transformRuns.delete(memo);
      transformRuns.set(memo, run);
      if (transformRuns.size > MAX_REMEMBERED_RUNS)
        transformRuns.delete(transformRuns.keys().next().value!);
    }
    const { result, ranAt } = run;
    if (!result.ok)
      return lastGood([
        datasetWarning(
          result.code,
          stored.id,
          `Transform "${stored.name}" failed: ${result.message}`,
          { stage: "transform", actions: ["ask-agent"] },
        ),
        ...read.warnings,
      ]);
    return record(result.value, read.stale ? "stale" : "ok", read.warnings, {
      ms: result.ms,
      ranAt,
    });
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
            ...(record.bundled
              ? { bytes: record.bundled.bytes, bundled: true }
              : {}),
            available: record.status === "ok",
            ...(record.status === "stale"
              ? { error: record.warnings[0]?.message }
              : {}),
          };
        bytes = Buffer.byteLength(JSON.stringify(dataset.value));
        summary = {
          ...(dataset.transform
            ? { transform: { inputs: dataset.transform.inputs } }
            : {}),
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
        if (dataset.source)
          source = {
            ...dataset.source,
            ...(linked ? { path: linked } : {}),
            available: false,
            error: unavailable!.message,
          };
        const revision = await this.revision(path);
        summary = {
          ...(dataset.transform
            ? { transform: { inputs: dataset.transform.inputs } }
            : {}),
          name: dataset.name,
          ...(dataset.description ? { description: dataset.description } : {}),
          createdAt: dataset.createdAt,
          updatedAt: dataset.updatedAt,
          hash: datasetHash(dataset),
          ...(revision ? { revision } : {}),
          ...(dataset.origin ? { origin: dataset.origin } : {}),
          status: "empty",
          editable: false,
          warnings: unavailableWarnings(unavailable!),
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
    assertDatasetAccess(this.root, projectId, true);
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
    assertDatasetAccess(this.root, projectId, true);
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
        if (stored.dataset.transform)
          throw new CoreError(
            "INVALID_DATA",
            `Dataset "${stored.dataset.name}" is computed by a transform script. Copy its output into the library with dataset_write(action:link, path:null), or create another dataset for the file.`,
          );
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
      // Another link of the same file keeps the project's packaging choice.
      const kept: DatasetSource =
        source.kind === "file" &&
        base.source?.kind === "file" &&
        base.source.bundle
          ? { ...source, bundle: base.source.bundle }
          : source;
      const dataset = validateDataset({
        ...base,
        source: kept,
        ...(input.datasetId === undefined ||
        !base.source ||
        canonicalJson(base.source) !== canonicalJson(kept)
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
      // The newly linked file counts as changed against the copy the project
      // shares, so this device shares it next (see reconcileBundle).
      await this.agreements.set(
        datasetBundleKey(projectId, id),
        kept.kind === "file" && kept.bundle?.hash
          ? {
              hash: kept.bundle.hash,
              base: kept.bundle.base ?? kept.bundle.hash,
              at: now,
            }
          : null,
      );
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
   * Rejects inputs that are missing or that are computed from the dataset
   * itself, directly or through other transforms.
   */
  private async assertInputs(
    projectId: string,
    datasetId: string,
    transform: DatasetTransform,
  ) {
    const self = `${projectId}/${datasetId}`;
    const seen = new Set<string>();
    const walk = async (
      inputs: Record<string, TransformInput>,
      owner: string,
      path: string[],
    ): Promise<void> => {
      for (const [name, reference] of Object.entries(inputs)) {
        const input = transformInput(reference, owner.split("/")[0]);
        const key = `${input.projectId}/${input.datasetId}`;
        if (key === self)
          throw new CoreError(
            "INVALID_DATA",
            `Transform inputs cannot form a cycle: ${[...path, key].join(" → ")}.`,
          );
        if (seen.has(key)) continue;
        seen.add(key);
        let stored: DatasetDocument;
        try {
          if (input.projectId !== projectId)
            await this.files.readProject(input.projectId);
          stored = (await this.stored(input.projectId, input.datasetId))
            .dataset;
        } catch (error) {
          if (
            owner === self &&
            error instanceof CoreError &&
            error.code === "NOT_FOUND"
          )
            throw new CoreError(
              "INVALID_DATA",
              `Input ${name}: dataset ${key} does not exist. Create or link it first, and name it by its id.`,
            );
          if (error instanceof CoreError && error.code === "NOT_FOUND")
            continue;
          throw error;
        }
        if (stored.transform)
          await walk(stored.transform.inputs, key, [...path, key]);
      }
    };
    await walk(transform.inputs, self, [self]);
  }

  /**
   * Creates a transform dataset, or changes the script, inputs, name,
   * description or schema of one (baseHash: its hash as read). The new
   * definition is stored like any dataset change; the value is computed
   * when it is read.
   */
  async defineTransform(
    projectId: string,
    input: {
      datasetId?: string;
      id?: string;
      name?: string;
      description?: string | null;
      schema?: JsonSchema | null;
      inputs?: Record<string, TransformInput>;
      script?: string;
      baseHash?: string;
    },
  ): Promise<{
    record?: DatasetRecord;
    created: boolean;
    changed: boolean;
    warnings?: DatasetWarning[];
  }> {
    assertDatasetAccess(this.root, projectId, true);
    const creating = input.datasetId === undefined;
    const id = creating
      ? input.id === undefined
        ? randomUUID()
        : assertId(input.id)
      : assertId(input.datasetId!);
    const result = await this.files.lock(
      `dataset-${projectId}-${id}`,
      async () => {
        await this.files.readProject(projectId);
        const now = new Date().toISOString();
        let dataset: DatasetDocument;
        let expected: string | null = null;
        if (creating) {
          await this.assertAbsent(projectId, id);
          if (typeof input.name !== "string" || !input.name.trim())
            throw new CoreError("INVALID_DATA", "A new dataset needs a name.");
          if (input.inputs === undefined || input.script === undefined)
            throw new CoreError(
              "INVALID_DATA",
              "A new transform needs inputs and a script.",
            );
          dataset = validateDataset({
            format: "showai-dataset",
            version: 1,
            id,
            name: input.name.trim(),
            ...(input.description ? { description: input.description } : {}),
            createdAt: now,
            updatedAt: now,
            ...(input.schema ? { schema: input.schema } : {}),
            transform: { inputs: input.inputs, script: input.script },
          });
        } else {
          if (input.id !== undefined)
            throw new CoreError(
              "INVALID_DATA",
              "id names a new dataset; change an existing one by datasetId.",
            );
          const { dataset: stored, path } = await this.stored(projectId, id);
          if (!stored.transform)
            throw new CoreError(
              "INVALID_DATA",
              `Dataset "${stored.name}" holds its own data. Create a new transform dataset that reads it instead.`,
            );
          const current = await this.load(projectId, id, { fallback: true })
            .then(({ record }) => record.hash)
            .catch((error) => {
              if (
                error instanceof CoreError &&
                error.code === "SOURCE_UNAVAILABLE"
              )
                return undefined;
              throw error;
            });
          const storedHash = datasetHash(stored);
          if (
            input.baseHash === undefined ||
            (input.baseHash !== current && input.baseHash !== storedHash)
          )
            throw new CoreError(
              "CONFLICT",
              input.baseHash === undefined
                ? "Changing a transform needs the baseHash you read."
                : "The dataset changed since it was read.",
              { currentHash: current ?? storedHash },
            );
          expected = (await this.revision(path)) ?? null;
          const {
            description: _description,
            schema: _schema,
            ...rest
          } = stored;
          const description =
            input.description === null
              ? undefined
              : (input.description ?? stored.description);
          const schema =
            input.schema === null ? undefined : (input.schema ?? stored.schema);
          dataset = validateDataset({
            ...rest,
            name: input.name?.trim() ?? stored.name,
            ...(description ? { description } : {}),
            ...(schema ? { schema } : {}),
            transform: {
              inputs: input.inputs ?? stored.transform.inputs,
              script: input.script ?? stored.transform.script,
            },
          });
          if (canonicalJson(dataset) === canonicalJson(stored))
            return { created: false, changed: false };
          dataset.updatedAt = now;
        }
        await this.assertInputs(projectId, id, dataset.transform!);
        await this.write(this.path(projectId, id), dataset, expected);
        return { created: creating, changed: true };
      },
    );
    // The value of the new definition, as any reader computes it.
    const record = await this.load(projectId, id, { fallback: true })
      .then((loaded) => loaded.record)
      .catch((error) => {
        if (error instanceof CoreError && error.code === "SOURCE_UNAVAILABLE")
          return { warnings: unavailableWarnings(error) };
        throw error;
      });
    return "dataset" in record
      ? { ...result, record }
      : { ...result, warnings: record.warnings };
  }

  /**
   * Runs a script on inputs without saving anything: the inputs and script
   * given, or the stored definition of datasetId for those omitted.
   */
  async tryTransform(
    projectId: string,
    input: {
      datasetId?: string;
      inputs?: Record<string, TransformInput>;
      script?: string;
    },
  ) {
    await this.files.readProject(projectId);
    const stored = input.datasetId
      ? (await this.stored(projectId, assertId(input.datasetId))).dataset
      : undefined;
    if (input.datasetId && !stored?.transform)
      throw new CoreError(
        "INVALID_DATA",
        `Dataset ${input.datasetId} is not a transform.`,
      );
    const transform = {
      inputs: input.inputs ?? stored?.transform?.inputs,
      script: input.script ?? stored?.transform?.script,
    };
    assertTransform(transform);
    const id = stored?.id ?? "dry-run";
    const read = await this.readInputs(projectId, id, transform, {});
    if (read.failure || read.empty)
      return {
        ok: false as const,
        code: read.failure?.code ?? "SOURCE_UNAVAILABLE",
        message: [read.failure, ...read.warnings]
          .filter(Boolean)
          .map((warning) => warning!.message)
          .join(" "),
        inputs: read.inputs,
        warnings: read.warnings,
      };
    const result = await runTransform(transform.script, read.values);
    if (result.ok)
      try {
        assertDatasetValue(result.value, stored?.schema, "The output");
      } catch (error) {
        const { problem, reason } = problemOf(error);
        return {
          ok: false as const,
          code: reason === "TOO_LARGE" ? "TOO_LARGE" : "OUTPUT_INVALID",
          message: problem,
          ms: result.ms,
          inputs: read.inputs,
          warnings: read.warnings,
        };
      }
    return { ...result, inputs: read.inputs, warnings: read.warnings };
  }

  /**
   * Copies an external dataset's current value (or a transform's output)
   * into the library and stops reading the file or running the script; the
   * file itself is left as it is.
   */
  async embed(
    projectId: string,
    datasetId: string,
    input: { baseHash?: string } = {},
  ): Promise<DatasetRecord> {
    assertDatasetAccess(this.root, projectId, true);
    return this.files.lock(`dataset-${projectId}-${datasetId}`, async () => {
      await this.files.readProject(projectId);
      const { record } = await this.load(projectId, datasetId);
      if (!record.dataset.source && !record.dataset.transform)
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
      const {
        source: _source,
        transform: _transform,
        ...rest
      } = record.dataset;
      const dataset = validateDataset({
        ...rest,
        updatedAt: new Date().toISOString(),
      });
      await this.write(record.path, dataset, record.revision ?? null);
      await this.links.set(projectId, datasetId, null);
      await this.agreements.set(datasetBundleKey(projectId, datasetId), null);
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
    assertDatasetAccess(this.root, projectId, true);
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
      const readOnlySource =
        !!stored.transform ||
        (!!stored.source && !sourceWritable(stored.source));
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
      let bundled = current.bundled;
      if (loaded.bundle) {
        // An edit of another device's file goes into a new synchronized
        // copy; that device writes it into its file.
        if (result.changed) {
          const bytes = Buffer.from(
            serializeSource(
              dataset.value,
              loaded.bundle.format,
              loaded.bundle.layout,
            ),
          );
          if (bytes.length > CAPACITY.packageItemBytes)
            throw new CoreError(
              "INVALID_DATA",
              `The edited copy of "${dataset.name}" is ${bytes.length} bytes; a synchronized copy holds at most ${CAPACITY.packageItemBytes} bytes.`,
            );
          const hash = await storeBundle(this.root, bytes);
          const updatedAt = new Date().toISOString();
          const previous = (dataset.source as FileSource).bundle;
          dataset.source = {
            ...(dataset.source as FileSource),
            bundle: {
              sync: true,
              hash,
              ...(previous?.base || previous?.hash
                ? { base: previous.base ?? previous.hash }
                : {}),
              bytes: bytes.length,
              updatedAt,
            },
          };
          bundled = {
            hash,
            format: loaded.bundle.format,
            bytes: bytes.length,
            updatedAt,
          };
        }
        await this.write(current.path, dataset, current.revision ?? null);
      } else if (loaded.read) {
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
          ...(bundled ? { bundled } : {}),
          ...(current.remote ? { remote: current.remote } : {}),
          ...(current.transform ? { transform: current.transform } : {}),
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

  /** The stored definition of a dataset, without reading its source. */
  async definition(
    projectId: string,
    datasetId: string,
  ): Promise<DatasetDocument> {
    return (await this.stored(projectId, assertId(datasetId))).dataset;
  }

  /**
   * Chooses whether synchronization carries a copy of a linked file to the
   * project's other devices. Turning it off drops the copy's record; the
   * other devices then show the dataset as not bundled.
   */
  async setBundle(
    projectId: string,
    datasetId: string,
    sync: boolean,
  ): Promise<{ changed: boolean }> {
    const changed = await this.files.lock(
      `dataset-${projectId}-${datasetId}`,
      async () => {
        await this.files.readProject(projectId);
        const { dataset, path } = await this.stored(projectId, datasetId);
        if (dataset.source?.kind !== "file")
          throw new CoreError(
            "INVALID_DATA",
            `Dataset "${dataset.name}" does not read a linked file; only linked files are bundled for synchronization.`,
          );
        const current = dataset.source.bundle;
        if ((current?.sync ?? true) === sync && current) return false;
        const bundle = sync ? { ...current, sync: true } : { sync: false };
        await this.write(
          path,
          validateDataset({
            ...dataset,
            source: { ...dataset.source, bundle },
          }),
          (await this.revision(path)) ?? null,
        );
        return true;
      },
    );
    if (changed && sync) await this.reconcileBundle(projectId, datasetId);
    return { changed };
  }

  /**
   * Brings this device's linked file and the project's synchronized copy
   * together. A file changed here is shared as a new copy (published); a
   * copy edited on another device is written into the unchanged file
   * (written-back); when both changed, the file is kept and the conflict is
   * reported on reads (WRITE_CONFLICT) until the file changes again.
   * `publish: false` leaves a changed file for the next synchronization.
   */
  async reconcileBundle(
    projectId: string,
    datasetId: string,
    options: { publish?: boolean } = {},
  ): Promise<{
    state:
      | "none"
      | "off"
      | "unlinked"
      | "missing"
      | "unchanged"
      | "published"
      | "written-back"
      | "pending"
      | "conflict"
      | "too-large";
    hash?: string;
    bytes?: number;
  }> {
    return this.files.lock(`dataset-${projectId}-${datasetId}`, async () => {
      const { dataset, path } = await this.stored(projectId, datasetId);
      const source = dataset.source;
      if (source?.kind !== "file") return { state: "none" };
      const bundle = source.bundle;
      if (bundle?.sync === false) return { state: "off" };
      const linked = await this.links.get(projectId, datasetId);
      if (!linked) return { state: "unlinked" };
      let file: Awaited<ReturnType<typeof readExternalBytes>>;
      try {
        file = await readExternalBytes(
          linked,
          CAPACITY.packageItemBytes,
          "a synchronized copy holds",
        );
      } catch (error) {
        if (error instanceof CoreError && error.details?.reason === "TOO_LARGE")
          return { state: "too-large" };
        if (error instanceof CoreError && error.code === "CONFLICT")
          return { state: "pending" };
        if (error instanceof CoreError || (error as NodeJS.ErrnoException).code)
          return { state: "missing" };
        throw error;
      }
      const key = datasetBundleKey(projectId, datasetId);
      const now = new Date().toISOString();
      const current = bundleHash(file.bytes);
      const agreed = await this.agreements.get(key);
      const shared = bundle?.hash;
      if (current === shared) {
        await storeBundle(this.root, file.bytes);
        if (agreed?.hash !== current || agreed.conflict)
          await this.agreements.set(key, {
            hash: current,
            base: bundle?.base ?? current,
            at: now,
          });
        return { state: "unchanged", hash: current, bytes: file.size };
      }
      const sharedChanged = shared !== undefined && shared !== agreed?.hash;
      // A conflict ends when the file changes again: the person combined both.
      const fileChanged =
        current !== agreed?.hash &&
        (!agreed?.conflict || current !== agreed.conflict.file);
      if (!sharedChanged || (agreed?.conflict && fileChanged)) {
        if (options.publish === false) return { state: "pending" };
        const hash = await storeBundle(this.root, file.bytes);
        await this.write(
          path,
          validateDataset({
            ...dataset,
            source: {
              ...source,
              bundle: {
                sync: true,
                hash,
                base: hash,
                bytes: file.size,
                updatedAt: now,
              },
            },
          }),
          (await this.revision(path)) ?? null,
        );
        await this.agreements.set(key, { hash, base: hash, at: now });
        return { state: "published", hash, bytes: file.size };
      }
      // An edit made on top of what this file last shared or received.
      const derived =
        !bundle!.base ||
        bundle!.base === agreed?.hash ||
        bundle!.base === agreed?.base;
      if (current === agreed?.hash && derived) {
        const copy = await readBundle(this.root, shared!);
        if (!copy) return { state: "pending" };
        await writeExternal(linked, copy, file.stamp);
        await this.agreements.set(key, {
          hash: shared!,
          base: bundle!.base ?? shared!,
          at: now,
        });
        return { state: "written-back", hash: shared, bytes: copy.length };
      }
      if (agreed?.conflict?.bundle !== shared || agreed.conflict.file !== current)
        await this.agreements.set(key, {
          hash: agreed?.hash ?? current,
          ...(agreed?.base ? { base: agreed.base } : {}),
          at: agreed?.at ?? now,
          conflict: { file: current, bundle: shared!, at: now },
        });
      return { state: "conflict", hash: shared };
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
    assertDatasetAccess(this.root, projectId, true);
    const transforms = await transformsReading(
      this.store,
      `${projectId}/${datasetId}`,
    );
    if (transforms.length) {
      const error = new CoreError(
        "CONFLICT",
        `The dataset is an input of ${transforms.length} transform dataset(s): ${transforms.join(", ")}. Change their inputs (or delete them) before deleting it.`,
      );
      error.details = { transforms };
      throw error;
    }
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
      await this.agreements.set(datasetBundleKey(projectId, datasetId), null);
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
  const pick = <
    K extends "name" | "description" | "schema" | "transform" | "source",
  >(
    key: K,
  ) => {
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
    schema = pick("schema"),
    transform = pick("transform"),
    // Two devices editing a synchronized copy of a file each make a new copy.
    source = pick("source");
  const {
    description: _d,
    schema: _s,
    transform: _t,
    source: _source,
    ...rest
  } = remote;
  const dataset = {
    ...rest,
    name: name ?? remote.name,
    ...(description ? { description } : {}),
    ...(schema ? { schema } : {}),
    // A script changed on two devices keeps the remote one and reports a conflict.
    ...(transform ? { transform } : {}),
    ...(source ? { source } : {}),
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
