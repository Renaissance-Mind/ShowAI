import { CAPACITY } from "../portable/capacity.mjs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { atomicRename } from "../core/atomic-rename";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "../core/library-files";
import { CoreError } from "../core/model";

const verified = new Map<string, string>();
/** Reuse verified immutable bytes; a replaced or damaged cache is checked again. */
export async function retainCachedObject(
  home: string,
  path: string,
  bytes: Buffer,
  expected: string,
) {
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new CoreError("INVALID_DATA", "同步缓存输入摘要不匹配。");
  await safeLibraryPath(home, path);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const signature =
    info &&
    `${expected}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  if (signature && verified.get(path) === signature) return false;
  const existing = info ? await readLibraryBytes(home, path) : null;
  const reused = !!existing && existing.equals(bytes);
  if (!reused) await atomicLibraryFile(home, path, bytes);
  const saved = reused ? info! : await lstat(path);
  verified.set(
    path,
    `${expected}:${saved.dev}:${saved.ino}:${saved.size}:${saved.mtimeMs}:${saved.ctimeMs}`,
  );
  if (verified.size > 4096) verified.delete(verified.keys().next().value!);
  return !reused;
}

export async function cacheDownload(
  home: string,
  path: string,
  response: Response,
  expected: string,
) {
  if (!response.body)
    throw new CoreError("INVALID_DATA", "Object response has no body.");
  await safeLibraryPath(home, path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.partial`;
  const file = await open(temporary, "wx", 0o600),
    digest = createHash("sha256"),
    reader = response.body.getReader();
  let length = 0,
    verified = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CAPACITY.syncObjectBytes) {
        await reader.cancel();
        throw new CoreError("INVALID_DATA", "Object response exceeds 64 MiB.");
      }
      digest.update(value);
      await file.writeFile(value);
    }
    if (digest.digest("hex") !== expected)
      throw new CoreError("INVALID_DATA", "下载内容摘要不匹配。");
    await file.sync();
    verified = true;
  } finally {
    reader.releaseLock();
    await file.close();
    if (!verified) await rm(temporary, { force: true });
  }
  await safeLibraryPath(home, path);
  await atomicRename(temporary, path);
}
