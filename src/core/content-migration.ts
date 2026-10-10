import { mkdir, readFile, rename, statfs, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { GitLibrary } from "./git-library";
import { SqliteLibrary } from "./sqlite-library";
import { withLibraryLock } from "./library-lock";
import { atomicLibraryFile, safeLibraryPath } from "./library-files";
import { CoreError } from "./model";
import type { FileChanges, LibraryManifest } from "./history-model";
import {
  contentMigrations,
  saveContentMigration,
  retainActivatedGit,
  type ContentMigration,
} from "./content-migration-journal";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

/** Preserve revision IDs and every reachable operation. The original Git archive
 * stays retained locally; normal SQLite saving never opens or invokes it. */
export async function migrateGitContent(
  home: string,
): Promise<LibraryManifest> {
  const root = resolve(home),
    legacy = new GitLibrary(root);
  const current = JSON.parse(
    await readFile(join(root, "library.json"), "utf8"),
  ) as LibraryManifest;
  if (current.storage === "sqlite") return new SqliteLibrary(root).manifest();
  await legacy.recover();
  await legacy.verify();
  return withLibraryLock(root, async () => {
    const manifest = await legacy.manifest(),
      head = await legacy.head();
    const space = await statfs(root);
    if (Number(space.bavail) * Number(space.bsize) < 5 * 1024 ** 3)
      throw new CoreError(
        "CONFLICT",
        "At least 5 GiB of free space is required to preserve the original history during migration.",
      );
    const unfinished = (await contentMigrations(root, manifest.id)).filter(
      (entry) => ["copying", "verified", "activated"].includes(entry.state),
    );
    if (unfinished.length > 1)
      throw new CoreError(
        "CONFLICT",
        "More than one unfinished content migration needs review.",
      );
    let journal: ContentMigration | undefined = unfinished[0];
    if (journal && journal.sourceHead !== head) {
      const source = join(root, "history"),
        back = join(
          root,
          "local",
          "migrations",
          journal.id,
          "library",
          "history",
        );
      if (
        await access(join(source, "content.sqlite")).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )
      ) {
        await safeLibraryPath(root, back);
        await rename(source, back);
      }
      journal.state = "superseded";
      await saveContentMigration(root, journal);
      journal = undefined;
    }
    journal ??= {
      format: "showai-content-migration-v1",
      id: randomUUID(),
      libraryId: manifest.id,
      sourceHead: head,
      state: "copying",
      copied: 0,
    } as ContentMigration;
    const directory = join(root, "local", "migrations", journal.id),
      staged = join(directory, "library");
    await safeLibraryPath(root, staged);
    await mkdir(directory, { recursive: true });
    const save = () => saveContentMigration(root, journal!);
    await save();
    const installed = await access(
      join(root, "history", "content.sqlite"),
    ).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (
      installed &&
      journal.state !== "verified" &&
      journal.state !== "activated"
    )
      throw new CoreError(
        "CONFLICT",
        "Unverified installed history was retained.",
      );
    const target = new SqliteLibrary(installed ? root : staged);
    if (!installed) await target.initialize();
    const revisions = head ? await legacy.migrationRevisions(head) : [];
    let previous = await target.head();
    const boundary = previous ? revisions.indexOf(previous) : -1;
    if (previous && boundary < 0)
      throw new CoreError(
        "INVALID_DATA",
        "The migration checkpoint does not belong to its original history.",
      );
    let lastTree = new Map(
      previous
        ? (await legacy.tree(previous)).map((entry) => [entry.path, entry.oid])
        : [],
    );
    journal.copied = boundary + 1;
    for (let offset = boundary + 1; offset < revisions.length; offset += 20) {
      const batch = await Promise.all(
        revisions
          .slice(offset, offset + 20)
          .map((revision) => legacy.entryAt(revision)),
      );
      for (const entry of batch) {
        if (
          entry.parents.length !== (previous ? 1 : 0) ||
          (previous && entry.parents[0] !== previous)
        )
          throw new CoreError(
            "CONFLICT",
            "Non-linear original history was retained for a reviewed import.",
          );
        const tree = new Map(
          (await legacy.tree(entry.revision)).map((item) => [
            item.path,
            item.oid,
          ]),
        );
        const changed = [...tree.keys()].filter(
          (path) => tree.get(path) !== lastTree.get(path),
        );
        const encoded: FileChanges = await legacy.encodedFiles(
          changed,
          entry.revision,
        );
        for (const path of lastTree.keys())
          if (!tree.has(path)) encoded.set(path, null);
        await target.commit(entry, encoded, previous, true);
        previous = entry.revision;
        lastTree = tree;
        journal.copied++;
      }
      await save();
      const available = await statfs(root);
      if (Number(available.bavail) * Number(available.bsize) < 2 * 1024 ** 3)
        throw new CoreError(
          "CONFLICT",
          "Migration paused before exhausting disk space. Its original history and durable checkpoint are retained.",
        );
    }
    await target.verify();
    if ((await target.head()) !== head || (await legacy.head()) !== head)
      throw new CoreError(
        "CONFLICT",
        "The library changed during migration; all copies were retained.",
      );
    const paths = [...lastTree.keys()].filter(
      (path) => !/^projects\/[^/]+\/pages\/[^/]+\/nodes\//.test(path),
    );
    for (let offset = 0; offset < paths.length; offset += 50) {
      const chunk = paths.slice(offset, offset + 50),
        original = head
          ? await legacy.readFiles(chunk, head)
          : new Map<string, Buffer>(),
        restored = head
          ? await target.readFiles(chunk, head)
          : new Map<string, Buffer>();
      for (const path of chunk)
        if (sha(original.get(path)!) !== sha(restored.get(path)!))
          throw new CoreError(
            "INVALID_DATA",
            "Migrated content differs from its original revision.",
          );
    }
    journal.state = "verified";
    await save();
    const destination = join(root, "history");
    await safeLibraryPath(root, destination);
    if (!installed) await rename(target.repository, destination);
    const updated: LibraryManifest = { ...manifest, storage: "sqlite" };
    await atomicLibraryFile(
      root,
      join(root, "library.json"),
      Buffer.from(JSON.stringify(updated, null, 2) + "\n"),
    );
    journal.state = "activated";
    await save();
    // The archive keeps all Git objects and refs, including unreachable originals.
    await retainActivatedGit(root, updated);
    return updated;
  });
}
