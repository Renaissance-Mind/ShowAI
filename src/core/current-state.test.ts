import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ContentLibrary } from "./content-library";
import { GitLibrary as LegacyGitLibrary } from "./git-library";
import { SqliteLibrary } from "./sqlite-library";
import { FileStore } from "./store";
import { EditorDrafts } from "./editor-drafts";
import { LibraryOperations } from "./library-operations";
import { AgentService } from "../agent/service";
import { encodeFile } from "./history-codec";
import { withLibrarySnapshot } from "./library-runtime";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-current-state-"));
  roots.push(root);
  const library = new ContentLibrary(root);
  await library.initialize();
  return { root, library, store: new FileStore(root) };
}
it("replaces local content without recording prior saves or building readers, while retaining per-resource concurrency tokens", async () => {
  const { root, library, store } = await fixture();
  const project = await store.createProject({ name: "Current content" });
  let page = await store.createPage(project.id, { title: "Initial" });
  const other = await store.createPage(project.id, { title: "Other" });
  for (let i = 0; i < 15; i++)
    page = await store.savePage(
      project.id,
      page.document.id,
      { ...page.document, title: `Current ${i}` },
      page.hash,
      page.revision,
    );
  expect((await store.readPage(project.id, other.document.id)).revision).toBe(
    other.revision,
  );
  await expect(
    store.savePage(
      project.id,
      page.document.id,
      page.document,
      page.hash,
      other.revision,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await library.history()).toEqual([]);
  expect(
    (await library.tree()).some((entry) =>
      /runtimes\/|reader\.json|\/history\//.test(entry.path),
    ),
  ).toBe(false);
  const db = new DatabaseSync(join(root, "history", "content.sqlite"));
  try {
    expect(db.prepare("SELECT COUNT(*) AS n FROM revisions").get()!.n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM changes").get()!.n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM current_state").get()!.n).toBe(
      1,
    );
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM blobs WHERE oid NOT IN(SELECT oid FROM current_files)",
        )
        .get()!.n,
    ).toBe(0);
  } finally {
    db.close();
  }
  await library.verify();
  expect(() =>
    new AgentService({ root }).historicalPage(
      project.id,
      page.document.id,
      other.revision!,
    ),
  ).toThrow(/removed/);
  const restored = await new FileStore(root).readPage(
    project.id,
    page.document.id,
  );
  expect(restored.document.title).toBe("Current 14");
});
it("preserves preexisting archive bytes while subsequent saves keep only current content", async () => {
  const donor = await fixture(),
    target = await fixture();
  const path = "projects/archive/settings.json";
  await donor.library.writeFiles(
    new Map([[path, Buffer.from('{"original":"retained"}')]]),
    { actor: { kind: "human" }, channel: "desktop" },
  );
  const head = (await donor.library.head())!;
  const entry = await donor.library.entryAt(head);
  const sqlite = new SqliteLibrary(target.root);
  await sqlite.commit(
    { ...entry, parents: [] },
    encodeFile(path, Buffer.from('{"original":"retained"}')),
    null,
    true,
  );
  await mkdir(join(target.library.workspace, "projects", "archive"), {
    recursive: true,
  });
  await writeFile(
    join(target.library.workspace, path),
    '{"original":"retained"}',
  );
  for (let i = 0; i < 3; i++)
    await target.library.writeFiles(
      new Map([[path, Buffer.from(JSON.stringify({ current: i }))]]),
      { actor: { kind: "human" }, channel: "desktop" },
    );
  expect(
    JSON.parse((await sqlite.readFile(path, head)).toString()).original,
  ).toBe("retained");
  const db = new DatabaseSync(join(target.root, "history", "content.sqlite"));
  try {
    expect(db.prepare("SELECT COUNT(*) AS n FROM revisions").get()!.n).toBe(1);
  } finally {
    db.close();
  }
  await target.library.verify();
});
it("merges an active draft with its retained baseline without reading content history", async () => {
  const { root, library, store } = await fixture();
  const project = await store.createProject({ name: "Draft recovery" });
  const first = await store.createPage(project.id, { title: "Baseline" });
  const drafts = new EditorDrafts(root);
  const draft = { ...first.document, title: "Local draft" };
  await drafts.save({
    kind: "page",
    clientId: "window-1",
    projectId: project.id,
    resourceId: first.document.id,
    baseRevision: first.revision,
    baseContent: first.document,
    content: draft,
  });
  await store.savePage(
    project.id,
    first.document.id,
    { ...first.document, icon: "📄" },
    first.hash,
    first.revision,
  );
  const preview = await new LibraryOperations(root).previewMerge({
    projectId: project.id,
    pageId: first.document.id,
    baseRevision: first.revision!,
    document: draft,
  });
  expect(preview.conflicts).toEqual([]);
  expect(preview.document.title).toBe("Local draft");
  expect(preview.document.icon).toBe("📄");
  expect(await library.history()).toEqual([]);
});
it("pins a current read while a cooperating writer waits, then publishes the next state", async () => {
  const { root, store } = await fixture();
  const project = await store.createProject({ name: "Read isolation" });
  const first = await store.createPage(project.id, { title: "Before" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const reading = withLibrarySnapshot(root, async () => {
    entered();
    await gate;
    expect(
      (await store.readPage(project.id, first.document.id)).document.title,
    ).toBe("Before");
  });
  await ready;
  const writing = store.savePage(
    project.id,
    first.document.id,
    { ...first.document, title: "After" },
    first.hash,
    first.revision,
  );
  release();
  await reading;
  await writing;
  expect(
    (await store.readPage(project.id, first.document.id)).document.title,
  ).toBe("After");
  expect(
    JSON.parse(await readFile(join(root, "library.json"), "utf8")).storage,
  ).toBe("sqlite");
});

it("activates current storage on a legacy library write while retaining its original archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-current-legacy-"));
  roots.push(root);
  const legacy = new LegacyGitLibrary(root);
  await legacy.initialize();
  const path = "projects/legacy/settings.json";
  const original = Buffer.from('{"value":"original"}');
  await legacy.writeFiles(new Map([[path, original]]), {
    actor: { kind: "human" },
    channel: "desktop",
  });
  const prior = (await legacy.head())!;
  const legacyBytes = await legacy.readFile(path);
  const current = new ContentLibrary(root);
  await current.writeFiles(
    new Map([[path, Buffer.from('{"value":"current"}')]]),
    { actor: { kind: "human" }, channel: "desktop" },
  );
  expect((await current.manifest()).storage).toBe("sqlite");
  expect(JSON.parse((await current.readFile(path)).toString()).value).toBe(
    "current",
  );
  expect(await new SqliteLibrary(root).readFile(path, prior)).toEqual(
    legacyBytes,
  );
  expect(await current.history()).toEqual([]);
  await current.verify();
});
