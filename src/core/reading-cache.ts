import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { readdir } from "node:fs/promises";
import { CoreError } from "./model";
export interface ReadingCacheRecord {
  format: "showai-reading-cache";
  version: 1;
  path: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}
export const readingCachePath =
  /^projects\/[A-Za-z0-9_-]+\/exports\/reads\/[A-Za-z0-9_-]+-[a-f0-9]{12}-[a-f0-9-]{36}\.html$/;
export async function recordReadingCache(
  root: string,
  absolute: string,
  html: string,
) {
  const path = relative(root, absolute).split(sep).join("/");
  if (!readingCachePath.test(path))
    throw new CoreError(
      "INVALID_PATH",
      "The reading cache must use a generated library path.",
    );
  const record: ReadingCacheRecord = {
    format: "showai-reading-cache",
    version: 1,
    path,
    bytes: Buffer.byteLength(html),
    sha256: createHash("sha256").update(html).digest("hex"),
    createdAt: new Date().toISOString(),
  };
  const id = createHash("sha256").update(path).digest("hex");
  await atomicLibraryFile(
    root,
    join(root, "local", "reading-cache", `${id}.json`),
    Buffer.from(JSON.stringify(record)),
  );
}
export async function readingCacheRecords(root: string) {
  const directory = join(root, "local", "reading-cache"),
    names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const records: { path: string; record: ReadingCacheRecord }[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const bytes = await readLibraryBytes(root, join(directory, name));
    if (!bytes) continue;
    const record = JSON.parse(bytes.toString("utf8")) as ReadingCacheRecord;
    if (
      record.format !== "showai-reading-cache" ||
      record.version !== 1 ||
      !readingCachePath.test(record.path) ||
      !/^[a-f0-9]{64}$/.test(record.sha256) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 0 ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      name !== `${createHash("sha256").update(record.path).digest("hex")}.json`
    )
      throw new CoreError(
        "INVALID_DATA",
        "Invalid reading cache ownership record.",
      );
    records.push({ path: `local/reading-cache/${name}`, record });
  }
  return records;
}
