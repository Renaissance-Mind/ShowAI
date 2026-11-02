import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./canonical";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { assertId } from "./store";
import type { WarningCode } from "../datasets/warnings.mjs";

// The last value read successfully from each external dataset on this
// device, under local/dataset-cache/<project>/<dataset>.json. local/ is
// outside history and synchronization. When the source cannot be read, a
// read returns this value marked stale; online data is also served from
// here until its refresh interval passes. A transform dataset keeps its last
// good output here, with the hash of the inputs and script it came from.

export interface CachedValue {
  format: "showai-dataset-cache";
  version: 1;
  projectId: string;
  datasetId: string;
  /** The source the value came from; a cache of another source is ignored. */
  origin: string;
  /** sha256 of the value's canonical JSON. */
  hash: string;
  /** When the source was last read (or confirmed unchanged). */
  readAt: string;
  /** Size of the source as read. */
  bytes: number;
  /** HTTP validators of online data, for conditional fetches. */
  etag?: string;
  lastModified?: string;
  /**
   * The last fetch of online data failed after readAt; reads stay stale
   * until the refresh interval passes or an explicit refresh succeeds.
   */
  failure?: { at: string; reason: WarningCode; problem: string };
  /**
   * A transform's output: the inputs and script it was computed from (as
   * one hash) and how long the run took.
   */
  transform?: { key: string; ms: number };
  value: unknown;
}

export function valueHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** The source identity a cached value belongs to. */
export function cacheOrigin(
  source: { kind: string; format: string; url?: string },
  path?: string,
): string {
  return source.kind === "url"
    ? `url:${source.format}:${source.url}`
    : `file:${source.format}:${path}`;
}

/** Files are read on every read; their cache is rewritten after this long without a change. */
const FILE_REWRITE_MS = 10 * 60_000;

export class DatasetValueCache {
  /** What this process last wrote, so unchanged file reads skip the write. */
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

  /**
   * Keeps a value read successfully. A file read that found the same value
   * shortly before is not written again.
   */
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
