import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { versionedLibrary } from "./library-runtime";
import { GitLibrary } from "./git-library";
import { CoreError } from "./model";
import { safeLibraryPath, readLibraryBytes } from "./library-files";
const entries = (path: string) =>
  readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
async function empty(root: string) {
  for (const name of await entries(root)) {
    if (["agent-runtime.json", "local", ".locks"].includes(name)) continue;
    if (
      ["projects", "packages", "publications"].includes(name) &&
      !(await entries(join(root, name))).length
    )
      continue;
    return false;
  }
  return true;
}
/** New empty libraries use history by default; existing originals need reviewed import. */
export async function openLibrary(home: string) {
  const root = resolve(home),
    existing = versionedLibrary(root);
  if (existing) return { mode: "versioned" as const, initialized: false };
  await safeLibraryPath(root, root);
  if (
    await readLibraryBytes(root, join(root, "local", "library-bootstrap.json"))
  ) {
    await new GitLibrary(root).initialize();
    return { mode: "versioned" as const, initialized: true };
  }
  if (!(await empty(root)))
    return { mode: "legacy" as const, initialized: false };
  try {
    await new GitLibrary(root).initialize();
  } catch (error) {
    if (
      !(error instanceof CoreError) ||
      error.code !== "CONFLICT" ||
      (await empty(root))
    )
      throw error;
    return { mode: "legacy" as const, initialized: false };
  }
  return { mode: "versioned" as const, initialized: true };
}
