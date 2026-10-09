import { readdir, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "./library-files";
import { CoreError } from "./model";
import type { LibraryManifest } from "./history-model";
export interface ContentMigration {
  format: "showai-content-migration-v1";
  id: string;
  libraryId: string;
  sourceHead: string | null;
  state: "copying" | "verified" | "activated" | "complete" | "superseded";
  copied: number;
}
export async function contentMigrations(root: string, libraryId: string) {
  const parent = join(root, "local", "migrations"),
    names = await readdir(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const result: ContentMigration[] = [];
  for (const name of names) {
    if (!/^[a-f0-9-]{36}$/.test(name)) continue;
    const bytes = await readLibraryBytes(
      root,
      join(parent, name, "migration.json"),
    );
    if (!bytes) continue;
    const value = JSON.parse(bytes.toString()) as ContentMigration;
    if (
      value.format !== "showai-content-migration-v1" ||
      value.id !== name ||
      !["copying", "verified", "activated", "complete", "superseded"].includes(
        value.state,
      ) ||
      !Number.isSafeInteger(value.copied) ||
      value.copied < 0
    )
      throw new CoreError("INVALID_DATA", "Invalid content migration journal.");
    if (value.libraryId === libraryId) result.push(value);
  }
  return result;
}
export async function saveContentMigration(
  root: string,
  journal: ContentMigration,
) {
  return atomicLibraryFile(
    root,
    join(root, "local", "migrations", journal.id, "migration.json"),
    Buffer.from(JSON.stringify(journal, null, 2)),
  );
}
export async function retainActivatedGit(
  root: string,
  manifest: LibraryManifest,
) {
  for (const journal of await contentMigrations(root, manifest.id)) {
    if (journal.state !== "verified" && journal.state !== "activated") continue;
    const source = join(root, "repository.git"),
      destination = join(
        root,
        "local",
        "migrations",
        journal.id,
        "legacy-repository.git",
      );
    await safeLibraryPath(root, source);
    await safeLibraryPath(root, destination);
    const exists = async (path: string) =>
      readdir(path).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
    const [from, to] = await Promise.all([exists(source), exists(destination)]);
    if (from && to)
      throw new CoreError(
        "CONFLICT",
        "Both original history archives exist; no migration copy was overwritten.",
      );
    if (from) {
      await mkdir(join(root, "local", "migrations", journal.id), {
        recursive: true,
      });
      await rename(source, destination);
    }
    if (!from && !to)
      throw new CoreError(
        "INVALID_DATA",
        "The original migration archive is missing.",
      );
    journal.state = "complete";
    await saveContentMigration(root, journal);
  }
}
