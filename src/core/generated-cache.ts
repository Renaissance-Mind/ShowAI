import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { libraryFingerprint } from "./library-fingerprints";
import { withLibraryLock } from "./library-lock";
import { CoreError } from "./model";
import { readingCachePath, readingCacheRecords } from "./reading-cache";

export const GENERATED_CACHE_MAX_AGE_MS = 7 * 86400000;
export const GENERATED_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const minimumAgeMs = 3600000;
export const previewCachePath =
  /^local\/agent-previews\/[a-f0-9]{64}\/page\.(?:html|inline\.html|online\.html|compact\.html|showai\.json)$/;
export const generatedCacheRecordPath =
  /^local\/generated-cache\/[a-f0-9]{64}\.json$/;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
interface CacheRecord {
  format: "showai-generated-cache";
  version: 1;
  path: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}
export function generatedCachePath(path: string) {
  return readingCachePath.test(path) || previewCachePath.test(path);
}
export async function recordGeneratedCache(
  root: string,
  absolute: string,
  contents: string | Buffer,
) {
  const path = relative(root, absolute).split(sep).join("/");
  if (!generatedCachePath(path))
    throw new CoreError("INVALID_PATH", "Invalid generated cache path.");
  const record: CacheRecord = {
    format: "showai-generated-cache",
    version: 1,
    path,
    sha256: digest(contents),
    bytes: Buffer.byteLength(contents),
    createdAt: new Date().toISOString(),
  };
  await atomicLibraryFile(
    root,
    join(root, "local", "generated-cache", `${digest(path)}.json`),
    Buffer.from(JSON.stringify(record)),
  );
}
export async function writeGeneratedCache(
  root: string,
  path: string,
  contents: string | Buffer,
) {
  if (!generatedCachePath(relative(root, path).split(sep).join("/")))
    throw new CoreError("INVALID_PATH", "Invalid generated cache path.");
  return withLibraryLock(
    root,
    async () => {
      const existing = await readLibraryBytes(root, path);
      const bytes = Buffer.isBuffer(contents)
        ? contents
        : Buffer.from(contents);
      if (existing && !existing.equals(bytes))
        throw new CoreError(
          "CONFLICT",
          "A generated output was modified; it has been retained.",
        );
      if (!existing) await atomicLibraryFile(root, path, bytes);
      await recordGeneratedCache(root, path, bytes);
      return path;
    },
    "generated-cache",
  );
}
export async function generatedCacheRecords(root: string) {
  const records: { path: string; record: Omit<CacheRecord, "format"> }[] =
    await readingCacheRecords(root);
  const directory = join(root, "local", "generated-cache");
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const bytes = await readLibraryBytes(root, join(directory, name));
    if (!bytes) continue;
    const record = JSON.parse(bytes.toString("utf8")) as CacheRecord;
    if (
      record.format !== "showai-generated-cache" ||
      record.version !== 1 ||
      !generatedCachePath(record.path) ||
      !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 0 ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      name !== `${digest(record.path)}.json`
    )
      throw new CoreError("INVALID_DATA", "Invalid generated cache record.");
    records.push({ path: `local/generated-cache/${name}`, record });
  }
  return records;
}
export async function collectGeneratedCache(root: string, now = Date.now()) {
  return withLibraryLock(
    root,
    async () => {
      const records = (await generatedCacheRecords(root)).sort(
        (a, b) =>
          Date.parse(a.record.createdAt) - Date.parse(b.record.createdAt),
      );
      let bytes = records.reduce((sum, item) => sum + item.record.bytes, 0);
      let freedBytes = 0,
        files = 0,
        retained = 0;
      for (const item of records) {
        const age = now - Date.parse(item.record.createdAt);
        if (
          age < minimumAgeMs ||
          (age < GENERATED_CACHE_MAX_AGE_MS &&
            bytes <= GENERATED_CACHE_MAX_BYTES)
        )
          continue;
        const current = await libraryFingerprint(
          root,
          join(root, item.record.path),
        );
        if (
          current &&
          (current.bytes !== item.record.bytes ||
            current.sha256 !== item.record.sha256)
        ) {
          retained++;
          continue;
        }
        if (current) {
          await rm(join(root, item.record.path), { force: true });
          freedBytes += current.bytes;
          files++;
        }
        await rm(join(root, item.path), { force: true });
        bytes -= item.record.bytes;
      }
      return { freedBytes, files, retained };
    },
    "generated-cache",
  );
}
