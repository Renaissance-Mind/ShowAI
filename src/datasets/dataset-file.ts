import { CAPACITY, assertContent } from "../portable/capacity.mjs";
import { assertProps } from "../contract/schema";
import type { JsonSchema } from "../contract/types";
import { canonicalJson } from "../core/canonical";
import { assertId } from "../core/identifier";
import { CoreError } from "../core/model";
import {
  applyOperations,
  cloneValue,
  diffValues,
  isPlainObject,
  refineOperations,
  type DatasetConflict,
  type DatasetOperation,
} from "./operations.mjs";

export const SOURCE_FORMATS = ["json", "csv", "tsv", "xlsx"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];
export const WRITABLE_FORMATS: readonly SourceFormat[] = ["json", "csv", "tsv"];
export const SOURCE_KINDS = ["file", "url"] as const;
export const DEFAULT_REFRESH_SECONDS = 300;
export const MAX_REFRESH_SECONDS = 86_400;

export interface SourceBundle {
  sync: boolean;
  hash?: string;
  base?: string;
  bytes?: number;
  updatedAt?: string;
}
export interface FileSource {
  kind: "file";
  format: SourceFormat;
  name?: string;
  bundle?: SourceBundle;
}
export interface UrlSource {
  kind: "url";
  format: SourceFormat;
  url: string;
  name?: string;
  refreshSeconds?: number;
}
export type DatasetSource = FileSource | UrlSource;

export function sourceWritable(source: DatasetSource): boolean {
  return source.kind === "file" && WRITABLE_FORMATS.includes(source.format);
}

const validUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 2048 || !URL.canParse(value))
    return false;
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
  );
};

export function isSourceBundle(value: unknown): value is SourceBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bundle = value as Record<string, unknown>;
  return (
    typeof bundle.sync === "boolean" &&
    [bundle.hash, bundle.base].every(
      (hash) =>
        hash === undefined ||
        (typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)),
    ) &&
    (bundle.bytes === undefined ||
      (Number.isSafeInteger(bundle.bytes) && (bundle.bytes as number) >= 0)) &&
    (bundle.updatedAt === undefined ||
      (typeof bundle.updatedAt === "string" &&
        Number.isFinite(Date.parse(bundle.updatedAt)))) &&
    Object.keys(bundle).every((name) =>
      ["sync", "hash", "base", "bytes", "updatedAt"].includes(name),
    )
  );
}

export function isDatasetSource(value: unknown): value is DatasetSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const common =
    SOURCE_FORMATS.includes(source.format as SourceFormat) &&
    (source.name === undefined ||
      (typeof source.name === "string" && source.name.length <= 255));
  if (source.kind === "file")
    return (
      common &&
      (source.bundle === undefined || isSourceBundle(source.bundle)) &&
      Object.keys(source).every((name) =>
        ["kind", "format", "name", "bundle"].includes(name),
      )
    );
  return (
    source.kind === "url" &&
    common &&
    validUrl(source.url) &&
    (source.refreshSeconds === undefined ||
      (Number.isInteger(source.refreshSeconds) &&
        (source.refreshSeconds as number) >= 0 &&
        (source.refreshSeconds as number) <= MAX_REFRESH_SECONDS)) &&
    Object.keys(source).every((name) =>
      ["kind", "format", "url", "name", "refreshSeconds"].includes(name),
    )
  );
}

export const TRANSFORM_LIMITS = {
  memoryBytes: 64 * 1024 * 1024,
  timeoutMs: 2000,
  stackBytes: 256 * 1024,
  scriptBytes: 256 * 1024,
  maxInputs: 16,
  outputBytes: CAPACITY.datasetBytes,
};

export type TransformInput = string | { project: string; dataset: string };
export interface DatasetTransform {
  inputs: Record<string, TransformInput>;
  script: string;
}

export interface DatasetDocument {
  format: "showai-dataset";
  version: 1;
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  origin?: {
    kind: string;
    componentId?: string;
    pageId?: string;
    blockId?: string;
  };
  schema?: JsonSchema;
  source?: DatasetSource;
  transform?: DatasetTransform;
  value: unknown;
}

const MAX_NAME = 200;
const INPUT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

export function assertJsonTree(value: unknown, depth = 0): void {
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

export function throwInvalidData(error: unknown): never {
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

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

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
  if (utf8Bytes(script) > TRANSFORM_LIMITS.scriptBytes)
    throw new CoreError(
      "INVALID_DATA",
      `A transform script has at most ${TRANSFORM_LIMITS.scriptBytes} bytes.`,
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
  if ((dataset.source || dataset.transform) && dataset.value === undefined)
    return dataset;
  if (!("value" in dataset))
    throw new CoreError("INVALID_DATA", "A dataset needs a value.");
  try {
    assertJsonTree(dataset.value);
    assertContent(dataset.value, "Dataset value", CAPACITY.datasetBytes);
    if (dataset.schema) assertProps(dataset.schema, dataset.value);
  } catch (error) {
    throwInvalidData(error);
  }
  return dataset;
}

export interface DatasetWrite {
  operations: DatasetOperation[];
  name?: string;
  description?: string | null;
  schema?: JsonSchema | null;
}
export type DatasetWriteResult =
  | { status: "missing-baseline" }
  | { status: "conflicts"; conflicts: DatasetConflict[] }
  | { status: "unchanged" }
  | {
      status: "changed";
      dataset: DatasetDocument;
      valueChanged: boolean;
      metadataChanged: boolean;
    };

export function applyDatasetWrite(
  current: DatasetDocument,
  write: DatasetWrite,
  options: { sameBase: boolean; base?: unknown },
): DatasetWriteResult {
  const { operations } = write;
  if (
    !options.sameBase &&
    options.base === undefined &&
    operations.some(
      (operation) =>
        (operation.op === "set" || operation.op === "remove") &&
        !("before" in operation) &&
        !("absent" in operation),
    )
  )
    return { status: "missing-baseline" };
  const prepared = refineOperations(
    operations,
    options.sameBase ? current.value : options.base,
  );
  let result: ReturnType<typeof applyOperations>;
  try {
    result = applyOperations(current.value, prepared);
  } catch (error) {
    throwInvalidData(error);
  }
  if (result.conflicts.length)
    return { status: "conflicts", conflicts: result.conflicts };
  const name = write.name?.trim() ?? current.name;
  const description =
    write.description === null
      ? undefined
      : (write.description ?? current.description);
  const schema =
    write.schema === null ? undefined : (write.schema ?? current.schema);
  const metadataChanged =
    name !== current.name ||
    description !== current.description ||
    schema !== current.schema;
  if (!result.changed && !metadataChanged) return { status: "unchanged" };
  const { description: _old, schema: _schema, ...rest } = current;
  const dataset = validateDataset({
    ...rest,
    name,
    ...(description ? { description } : {}),
    ...(schema ? { schema } : {}),
    updatedAt: new Date().toISOString(),
    value: result.value,
  });
  return {
    status: "changed",
    dataset,
    valueChanged: result.changed,
    metadataChanged,
  };
}

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
    ...(transform ? { transform } : {}),
    ...(source ? { source } : {}),
    updatedAt: [local.updatedAt, remote.updatedAt].sort().at(-1)!,
    value: result.value,
  } as DatasetDocument;
  try {
    return { dataset: validateDataset(dataset, remote.id), conflicts };
  } catch {
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
