import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CoreError } from "./model";

/** A host-supplied project directory is exact; cwd falls back to its Git root. */
export async function projectDirectory(
  sourceDirectory?: string,
): Promise<string> {
  const directory = await realpath(resolve(sourceDirectory ?? process.cwd()));
  if (!(await lstat(directory)).isDirectory())
    throw new CoreError(
      "INVALID_PATH",
      "The project source must be a directory.",
    );
  if (sourceDirectory !== undefined) return directory;
  let candidate = directory;
  while (true) {
    const marker = await lstat(join(candidate, ".git")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (marker?.isDirectory() || marker?.isFile()) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return directory;
    candidate = parent;
  }
}
