import { afterEach, expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  readdir,
  stat,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ContentLibrary } from "./content-library";
import { SqliteLibrary } from "./sqlite-library";
import { GitLibrary } from "./git-library";
import { migrateGitContent } from "./content-migration";
import { FileStore } from "./store";
import { withChangeContext } from "./history-context";
import { WorkspaceProtection } from "./workspace-conflicts";
const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of clean.splice(0).reverse()) await done();
});
async function fixture() {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "sqlite-library-"));
  clean.push(() => rm(root, { recursive: true }));
  const library = new ContentLibrary(root);
  await library.initialize();
  const store = new FileStore(root),
    project = await store.createProject({ name: "SQLite library" });
  const page = await store.createPage(project.id, { title: "Initial page" });
  return { root, library, store, project, page };
}
/**
 * The first FileStore write activates SQLite on a legacy root, so legacy
 * content is committed directly through the original Git library.
 */
async function legacyFixture() {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "sqlite-library-"));
  clean.push(() => rm(root, { recursive: true }));
  const source = new FileStore(join(root, "..", `${basename(root)}-source`));
  clean.push(() => rm(source.root, { recursive: true }));
  const project = await source.createProject({ name: "SQLite library" });
  const page = await source.createPage(project.id, { title: "Initial page" });
  const library = new GitLibrary(root);
  await library.initialize();
  const projectPath = `projects/${project.id}/project.json`,
    path = `projects/${project.id}/pages/${page.document.id}.json`;
  await library.writeFiles(
    new Map([
      [projectPath, await readFile(join(source.root, projectPath))],
      [path, await readFile(page.path)],
    ]),
    { actor: { kind: "human" }, channel: "desktop" },
  );
  const artifact = JSON.parse((await readFile(page.path)).toString());
  artifact.document.title = "Before migration";
  await library.writeFiles(
    new Map([[path, Buffer.from(JSON.stringify(artifact))]]),
    {
      actor: {
        kind: "agent",
        harness: "codex",
        sessionId: "01a11f62-833b-7dd1-9e4d-7fc66ca4dd16",
      },
      channel: "cli",
    },
  );
  return { root, library, project, page, path };
}
test("SQLite saves current content with guarded resource revisions and author attribution without Git", async () => {
  const f = await fixture();
  expect((await f.library.manifest()).storage).toBe("sqlite");
  await expect(stat(join(f.root, "repository.git"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const original = await f.store.readPage(f.project.id, f.page.document.id),
    baseline = original.revision;
  const changed = structuredClone(original.document);
  changed.title = "Saved SQLite page";
  await withChangeContext(
    { actor: { kind: "human", label: "Author" }, channel: "desktop" },
    () =>
      f.store.savePage(
        f.project.id,
        f.page.document.id,
        changed,
        original.hash,
        baseline,
      ),
  );
  const saved = await f.store.readPage(f.project.id, f.page.document.id);
  expect(saved.document.title).toBe("Saved SQLite page");
  expect(saved.revision).not.toBe(baseline);
  await expect(
    f.store.savePage(
      f.project.id,
      f.page.document.id,
      original.document,
      original.hash,
      baseline,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const path = `projects/${f.project.id}/pages/${f.page.document.id}.json`;
  expect((await f.library.entryAt((await f.library.head())!)).actor.label).toBe(
    "Author",
  );
  // Superseded revisions are not retained, so they cannot be restored.
  await expect(
    f.library.restore([path], baseline!, {
      actor: { kind: "human", label: "Author" },
      channel: "desktop",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await f.store.readPage(f.project.id, f.page.document.id)).document.title,
  ).toBe("Saved SQLite page");
  await f.library.compact();
  await f.library.verify();
});
test("operation retries return their original response and reject reused IDs with changed input", async () => {
  const f = await fixture(),
    context = {
      actor: {
        kind: "agent" as const,
        harness: "codex",
        sessionId: "01a11f62-833b-7dd1-9e4d-7fc66ca4dd16",
      },
      channel: "mcp" as const,
      operationId: crypto.randomUUID(),
      requestFingerprint: "a".repeat(64),
    };
  const first = await f.library.transaction(context, () =>
    f.store.createPage(f.project.id, { title: "Idempotent page" }),
  );
  const replay = await f.library.transaction(context, () =>
    f.store.createPage(f.project.id, { title: "Must not be created" }),
  );
  expect(replay.value.document.id).toBe(first.value.document.id);
  expect(replay.value.document.title).toBe("Idempotent page");
  await expect(
    f.library.transaction(
      { ...context, requestFingerprint: "b".repeat(64) },
      () => f.store.createPage(f.project.id, { title: "Different request" }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await f.store.listPages(f.project.id)).filter(
      (page) => page.title === "Idempotent page",
    ),
  ).toHaveLength(1);
  await f.store.createPage(f.project.id, { title: "Newer edit" });
  const head = await f.library.head();
  await expect(
    f.library.transaction(context, () =>
      f.store.createPage(f.project.id, { title: "Must not be created" }),
    ),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: expect.stringMatching(/newer edits/),
  });
  expect(await f.library.head()).toBe(head);
});
test("a committed SQLite operation recovers its projection and preserves concurrent external bytes", async () => {
  const f = await fixture(),
    library = new SqliteLibrary(f.root),
    path = `projects/${f.project.id}/pages/${f.page.document.id}.json`,
    before = await library.head();
  const bytes = await library.readFile(path),
    document = JSON.parse(bytes.toString());
  document.title = "Recovered projection";
  const saved = await library.writeFiles(
    new Map([[path, Buffer.from(JSON.stringify(document))]]),
    { actor: { kind: "human" }, channel: "desktop" },
  );
  const id = crypto.randomUUID(),
    directory = join(f.root, "local/transactions", id);
  await mkdir(directory, { recursive: true });
  await import("./library-files").then(({ atomicLibraryFile }) =>
    atomicLibraryFile(
      f.root,
      join(directory, "journal.json"),
      Buffer.from(
        JSON.stringify({
          id,
          parent: before,
          candidate: saved!.revision,
          paths: [path],
          before: { [path]: null },
        }),
      ),
    ),
  );
  await library.recover();
  expect(await readdir(join(f.root, "local/transactions"))).toEqual([]);
  const projected = join(library.workspace, path);
  const external = structuredClone(document);
  external.title = "External version";
  await import("./library-files").then(({ atomicLibraryFile }) =>
    atomicLibraryFile(f.root, projected, Buffer.from(JSON.stringify(external))),
  );
  await expect(
    library.writeFiles(
      new Map([[path, Buffer.from(JSON.stringify(document))]]),
      { actor: { kind: "human" }, channel: "desktop" },
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(JSON.parse(await readFile(projected, "utf8")).title).toBe(
    "External version",
  );
  expect(
    (await new WorkspaceProtection(library).list(path)).some(
      (record) => record.state === "unresolved",
    ),
  ).toBe(true);
});
test("legacy Git content and operation history migrate losslessly into SQLite", async () => {
  const f = await legacyFixture(),
    path = f.path,
    store = new FileStore(f.root);
  const history = await f.library.history({ limit: 1000 }),
    head = await f.library.head(),
    bytes = await f.library.readFile(path),
    original = await f.library.readFile(path, history.at(-1)!.revision);
  const manifest = await new ContentLibrary(f.root).initialize();
  expect(manifest.id).toBe((await f.library.manifest()).id);
  expect(manifest.storage).toBe("sqlite");
  const sqlite = new ContentLibrary(f.root);
  expect(await sqlite.head()).toBe(head);
  // Current storage exposes no history; the migrated records stay archived.
  expect(await sqlite.history({ limit: 1000 })).toEqual([]);
  expect(await new SqliteLibrary(f.root).history({ limit: 1000 })).toEqual(
    history,
  );
  expect(await sqlite.readFile(path)).toEqual(bytes);
  expect(
    await new SqliteLibrary(f.root).readFile(path, history.at(-1)!.revision),
  ).toEqual(original);
  await sqlite.verify();
  const current = await store.readPage(f.project.id, f.page.document.id);
  expect(current.document.title).toBe("Before migration");
  await store.savePage(
    f.project.id,
    f.page.document.id,
    { ...current.document, title: "After migration" },
    current.hash,
    current.revision,
  );
  expect(
    (await store.readPage(f.project.id, f.page.document.id)).document.title,
  ).toBe("After migration");
  await expect(stat(join(f.root, "repository.git"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const migrations = await readdir(join(f.root, "local/migrations"));
  expect(migrations).toHaveLength(1);
  expect(
    (
      await stat(
        join(
          f.root,
          "local/migrations",
          migrations[0],
          "legacy-repository.git",
        ),
      )
    ).isDirectory(),
  ).toBe(true);
});
test("corrupt SQLite objects are reported while readable workspace files remain intact", async () => {
  const f = await fixture(),
    library = new ContentLibrary(f.root),
    path = `projects/${f.project.id}/pages/${f.page.document.id}.json`,
    projection = await readFile(join(f.root, "workspace", path));
  const db = new DatabaseSync(join(f.root, "history/content.sqlite"));
  const id = (await library.tree()).find((entry) => entry.path === path)!.oid;
  db.prepare("UPDATE blobs SET data=?,codec=0 WHERE oid=?").run(
    Buffer.from("damaged content"),
    id,
  );
  db.close();
  await expect(library.verify()).rejects.toMatchObject({
    code: "INVALID_DATA",
  });
  await expect(library.readFile(path)).rejects.toMatchObject({
    code: "INVALID_DATA",
  });
  expect(await readFile(join(f.root, "workspace", path))).toEqual(projection);
});
test("migration resumes a durable copied prefix and a history directory installed before its marker", async () => {
  const f = await legacyFixture(),
    entries = (await f.library.history({ limit: 1000 })).reverse(),
    sourceHead = await f.library.head(),
    manifest = await f.library.manifest();
  const id = crypto.randomUUID(),
    directory = join(f.root, "local/migrations", id),
    staged = new SqliteLibrary(join(directory, "library"));
  await staged.initialize();
  const first = entries[0],
    bytes = await (f.library as GitLibrary).encodedFiles(
      (await f.library.tree(first.revision)).map((entry) => entry.path),
      first.revision,
    );
  // Migration copies legacy entries into the retained archive.
  await staged.commit(first, bytes, null, true);
  await writeFile(
    join(directory, "migration.json"),
    JSON.stringify({
      format: "showai-content-migration-v1",
      id,
      libraryId: manifest.id,
      sourceHead,
      state: "copying",
      copied: 0,
    }),
  );
  await migrateGitContent(f.root);
  expect(await new SqliteLibrary(f.root).history({ limit: 1000 })).toEqual(
    [...entries].reverse(),
  );
  expect(await readdir(join(f.root, "local/migrations"))).toEqual([id]);
  // Reconstruct the actual atomic-rename window: verified SQLite files exist,
  // while the durable marker still points at the retained original authority.
  await rename(
    join(directory, "legacy-repository.git"),
    join(f.root, "repository.git"),
  );
  await writeFile(join(f.root, "library.json"), JSON.stringify(manifest));
  const journalPath = join(directory, "migration.json"),
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.state = "verified";
  await writeFile(journalPath, JSON.stringify(journal));
  await migrateGitContent(f.root);
  expect(await new ContentLibrary(f.root).head()).toBe(sourceHead);
  expect(JSON.parse(await readFile(journalPath, "utf8")).state).toBe(
    "complete",
  );
}, 60_000);
test("startup finishes archiving the original after the SQLite marker has already committed", async () => {
  const f = await legacyFixture();
  await migrateGitContent(f.root);
  const id = (await readdir(join(f.root, "local/migrations")))[0],
    directory = join(f.root, "local/migrations", id),
    path = join(directory, "migration.json"),
    journal = JSON.parse(await readFile(path, "utf8"));
  await rename(
    join(directory, "legacy-repository.git"),
    join(f.root, "repository.git"),
  );
  journal.state = "activated";
  await writeFile(path, JSON.stringify(journal));
  const library = new ContentLibrary(f.root),
    head = await library.head();
  await library.initialize();
  expect(await library.head()).toBe(head);
  expect(JSON.parse(await readFile(path, "utf8")).state).toBe("complete");
  await expect(stat(join(f.root, "repository.git"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
