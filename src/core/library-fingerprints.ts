import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { safeLibraryPath } from "./library-files";
import { CoreError } from "./model";
/** Streaming fingerprints cover large Git packs without loading them into memory. */
export async function libraryFingerprint(root: string, path: string) {
  await safeLibraryPath(root, path);
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!file) return null;
  try {
    const before = await file.stat();
    if (!before.isFile())
      throw new CoreError(
        "INVALID_PATH",
        "Fingerprint requires a regular file.",
      );
    const digest = createHash("sha256");
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      digest.update(chunk);
      size += chunk.length;
    }
    const after = await file.stat();
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new CoreError(
        "CONFLICT",
        "The file changed while its fingerprint was being calculated.",
      );
    return { sha256: digest.digest("hex"), bytes: size };
  } finally {
    await file.close();
  }
}
