import { constants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { CoreError } from "./model";
import { atomicRename } from "./atomic-rename";

export async function safeLibraryPath(
  root: string,
  path: string,
): Promise<string> {
  root = resolve(root);
  const target = resolve(path),
    local = relative(root, target);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new CoreError("INVALID_PATH", "Library file leaves its root.");
  let current = root;
  for (const part of ["", ...local.split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new CoreError(
        "INVALID_PATH",
        `Library paths must not contain symbolic links: ${current}`,
      );
    if (current !== target && info && !info.isDirectory())
      throw new CoreError(
        "INVALID_PATH",
        "A library parent is not a directory.",
      );
  }
  return target;
}

export async function readLibraryBytes(
  root: string,
  path: string,
): Promise<Buffer | null> {
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
    if (!before.isFile() || before.size > 256 * 1024 * 1024)
      throw new CoreError("INVALID_DATA", "Invalid library file.");
    const bytes = await file.readFile();
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new CoreError(
        "CONFLICT",
        "The external file is still being written. Retry when it finishes.",
      );
    return bytes;
  } finally {
    await file.close();
  }
}

export async function atomicLibraryFile(
  root: string,
  path: string,
  bytes: Buffer,
): Promise<void> {
  await safeLibraryPath(root, path);
  await mkdir(dirname(path), { recursive: true });
  await safeLibraryPath(root, path);
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await safeLibraryPath(root, path);
    await atomicRename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  if (process.platform !== "win32") {
    const parent = await open(dirname(path), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
}
