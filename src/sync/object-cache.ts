import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { atomicRename } from "../core/atomic-rename";
import { safeLibraryPath } from "../core/library-files";
import { CoreError } from "../core/model";

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
      if (length > 64 * 1024 * 1024) {
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
