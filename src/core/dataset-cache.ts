import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./canonical";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { assertId } from "./store";
import type { WarningCode } from "../datasets/warnings.mjs";


export interface CachedValue {
  format: "showai-dataset-cache";
  version: 1;
  projectId: string;
  datasetId: string;
  origin: string;
  hash: string;
  readAt: string;
  bytes: number;
  etag?: string;
  lastModified?: string;
  failure?: { at: string; reason: WarningCode; problem: string };
  transform?: { key: string; ms: number };
  value: unknown;
}

export function valueHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function cacheOrigin(
  source: { kind: string; format: string; url?: string },
  path?: string,
): string {
  return source.kind === "url"
    ? `url:${source.format}:${source.url}`
    : `file:${source.format}:${path}`;
}

const FILE_REWRITE_MS = 10 * 60_000;

export class DatasetValueCache {
  private static written = new Map<
    string,
    { origin: string; hash: string; at: number }
  >();

  constructor(readonly home: string) {}

  path(projectId: string, datasetId: string): string {
    return join(
      this.home,
      "local",
      "dataset-cache",
      assertId(projectId),
      `${assertId(datasetId)}.json`,
    );
  }

  async read(
    projectId: string,
    datasetId: string,
    origin: string,
  ): Promise<CachedValue | undefined> {
    const bytes = await readLibraryBytes(
      this.home,
      this.path(projectId, datasetId),
    );
    if (!bytes) return undefined;
    const entry = JSON.parse(bytes.toString()) as CachedValue;
    if (
      entry?.format !== "showai-dataset-cache" ||
      entry.version !== 1 ||
      entry.origin !== origin ||
      typeof entry.hash !== "string" ||
      !Number.isFinite(Date.parse(entry.readAt))
    )
      return undefined;
    return entry;
  }

  async write(
    input: Omit<CachedValue, "format" | "version" | "hash" | "readAt"> & {
      readAt?: string;
    },
    options: { always?: boolean } = {},
  ): Promise<CachedValue> {
    const entry: CachedValue = {
      format: "showai-dataset-cache",
      version: 1,
      projectId: input.projectId,
      datasetId: input.datasetId,
      origin: input.origin,
      hash: valueHash(input.value),
      readAt: input.readAt ?? new Date().toISOString(),
      bytes: input.bytes,
      ...(input.etag ? { etag: input.etag } : {}),
      ...(input.lastModified ? { lastModified: input.lastModified } : {}),
      ...(input.failure ? { failure: input.failure } : {}),
      ...(input.transform ? { transform: input.transform } : {}),
      value: input.value,
    };
    const path = this.path(input.projectId, input.datasetId);
    const key = `${this.home}\0${path}`;
    const last = DatasetValueCache.written.get(key);
    if (
      !options.always &&
      last?.origin === entry.origin &&
      last.hash === entry.hash &&
      Date.now() - last.at < FILE_REWRITE_MS
    )
      return entry;
    await atomicLibraryFile(
      this.home,
      path,
      Buffer.from(JSON.stringify(entry)),
    );
    DatasetValueCache.written.set(key, {
      origin: entry.origin,
      hash: entry.hash,
      at: Date.now(),
    });
    return entry;
  }

  async remove(projectId: string, datasetId: string): Promise<void> {
    const path = this.path(projectId, datasetId);
    DatasetValueCache.written.delete(`${this.home}\0${path}`);
    await rm(path, { force: true });
  }
}
