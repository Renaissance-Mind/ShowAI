import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import { withLibrarySnapshot } from "./library-runtime";
import { changedResources } from "./change-notification";

describe("revision-backed list projections", () => {
  let root: string, store: FileStore, library: GitLibrary;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-performance-"));
    library = new GitLibrary(root);
    await library.initialize();
    store = new FileStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("reuses summaries without losing A → B → A resource revisions or archived visibility", async () => {
    const project = await store.createProject({ name: "Performance" });
    const a = await store.createPage(project.id, { title: "A" });
    expect((await store.listPages(project.id))[0]).toMatchObject({
      title: "A",
      revision: a.revision,
    });
    const b = await store.savePage(
      project.id,
      a.document.id,
      { ...a.document, title: "B" },
      a.hash,
      a.revision,
    );
    expect((await store.listPages(project.id))[0]).toMatchObject({
      title: "B",
      revision: b.revision,
    });
    const again = await store.savePage(
      project.id,
      a.document.id,
      { ...b.document, title: "A" },
      b.hash,
      b.revision,
    );
    expect((await store.listPages(project.id))[0]).toMatchObject({
      title: "A",
      revision: again.revision,
    });
    expect(again.revision).not.toBe(a.revision);
    expect((await store.listProjects())[0].pageCount).toBe(1);
    await store.updatePageMetadata(
      project.id,
      a.document.id,
      { archived: true },
      again.hash,
      again.revision,
    );
    expect(
      await store.listPages(project.id, { includeArchived: false }),
    ).toEqual([]);
  });
  it("keeps list snapshots coherent while a different operation commits", async () => {
    const project = await store.createProject({ name: "Snapshot" });
    const page = await store.createPage(project.id, { title: "Before" });
    let opened!: () => void, released!: () => void;
    const started = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    const prior = withLibrarySnapshot(root, async () => {
      opened();
      await gate;
      return store.listPages(project.id);
    });
    await started;
    await store.savePage(
      project.id,
      page.document.id,
      { ...page.document, title: "After" },
      page.hash,
      page.revision,
    );
    released();
    expect((await prior)[0].title).toBe("Before");
    expect((await store.listPages(project.id))[0].title).toBe("After");
  });
  it("retains external writes until actual page reads inspect and report conflicts", async () => {
    const project = await store.createProject({ name: "External" });
    const page = await store.createPage(project.id, { title: "Official" });
    await store.listPages(project.id);
    const bytes = JSON.parse(await readFile(page.path, "utf8"));
    bytes.document.title = "External";
    await writeFile(page.path, JSON.stringify(bytes));
    expect((await store.listPages(project.id))[0].title).toBe("Official");
    const checked = await store.readPage(project.id, page.document.id);
    expect(checked.workspaceConflicts?.length).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(page.path, "utf8")).document.title).toBe(
      "External",
    );
  });
  it("does not expose cached Git buffers or tree entries for mutation", async () => {
    const project = await store.createProject({ name: "Immutable" });
    const page = await store.createPage(project.id, { title: "Retained" });
    const path = `projects/${project.id}/pages/${page.document.id}.json`;
    const first = await library.readFile(path, page.revision);
    first.fill(0);
    expect(
      JSON.parse((await library.readFile(path, page.revision)).toString())
        .document.title,
    ).toBe("Retained");
    const tree = await library.tree(page.revision);
    tree[0].path = "changed";
    expect((await library.tree(page.revision))[0].path).not.toBe("changed");
  });
});
it("retains page and catalog identities in one file-change notification", () => {
  expect(
    changedResources("/library", [
      "/library/workspace/projects/p/pages/a.json",
      "/library/workspace/projects/p/packages/components/c/1.0.0/compiled.json",
    ]),
  ).toMatchObject({
    projectIds: ["p"],
    pageIds: ["a"],
    catalog: true,
    projects: true,
  });
  expect(changedResources("/library", ["/library/library.json"])).toMatchObject(
    { all: true },
  );
});
