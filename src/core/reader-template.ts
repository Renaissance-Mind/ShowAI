import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleReader } from "../portable/reader-bundle.mjs";
import type { ShowDocument } from "../types";

export async function readerFileExists(path: string) {
  return access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}
export async function findViewerTemplate(explicit?: string): Promise<string> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const candidates = explicit
    ? [resolve(explicit)]
    : [
        ...(process.env.SHOWAI_VIEWER
          ? [resolve(process.env.SHOWAI_VIEWER)]
          : []),
        resolve(directory, "../assets/viewer.html"),
        resolve(directory, "../dist-portable/portable.html"),
        resolve(directory, "../../dist-portable/portable.html"),
      ];
  for (const path of candidates) if (await readerFileExists(path)) return path;
  throw new Error(
    "The ShowAI viewer is missing. Build the application first or set SHOWAI_VIEWER to the bundled viewer.html.",
  );
}
export async function buildReaderTemplate(
  documents: ShowDocument[],
  explicit?: string,
) {
  const full = await findViewerTemplate(explicit),
    archive = join(dirname(full), "reader-source.json");
  return !explicit && (await readerFileExists(archive))
    ? bundleReader(archive, documents)
    : readFile(full, "utf8");
}
