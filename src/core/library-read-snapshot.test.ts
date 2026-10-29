import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import { LibraryIndex } from "./library-index";
import { withLibraryLock } from "./library-lock";
import { withLibrarySnapshot } from "./library-runtime";
import { WorkspaceProtection } from "./workspace-conflicts";
import { scanWorkspaceResources } from "./package-recovery";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-read-snapshot-"));
  roots.push(root);
  await new ContentLibrary(root).initialize();
  const store = new FileStore(root);
  const project = await store.createProject({ name: "Snapshot reads" });
  const page = await store.createPage(project.id, { title: "Before" });
  return { root, store, project, page };
}
function gate() {
  let open!: () => void;
  const closed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, closed };
}
/** Settles within the time a read takes, far below the 30 s lease wait. */
function promptly<T>(work: Promise<T>) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("The read waited for the lease.")),
        5000,
      ),
    ),
  ]);
}

it("lists, opens and searches while another operation holds the writer lease", async () => {
  const { root, store, project, page } = await fixture();
  const held = gate(),
    entered = gate();
  const holder = withLibraryLock(root, async () => {
    entered.open();
    await held.closed;
  });
  await entered.closed;
  try {
    const projects = await promptly(store.listProjects());
    expect(projects.map((item) => item.id)).toContain(project.id);
    expect(
      (await promptly(store.listPages(project.id))).map((item) => item.title),
    ).toEqual(["Before"]);
    const opened = await promptly(store.readPage(project.id, page.document.id));
    expect(opened.document.title).toBe("Before");
    expect(opened.workspaceConflicts).toBeUndefined();
    const found = await promptly(
      new LibraryIndex(root).search({ query: "Before", projectId: project.id }),
    );
    expect(
      found.items.some((item) => item.resourceId === page.document.id),
    ).toBe(true);
  } finally {
    held.open();
    await holder;
  }
});

it("keeps an older snapshot from reporting a newer save's workspace files as an external edit", async () => {
  const { root, store, project, page } = await fixture();
  await withLibrarySnapshot(root, async () => {
    await store.savePage(
      project.id,
      page.document.id,
      { ...page.document, title: "After" },
      page.hash,
      page.revision,
    );
    // The workspace already holds the newer save; the snapshot still reads the older state.
    expect(JSON.parse(await readFile(page.path, "utf8")).document.title).toBe(
      "After",
    );
    const pinned = await store.readPage(project.id, page.document.id);
    expect(pinned.document.title).toBe("Before");
    expect(pinned.workspaceConflicts).toBeUndefined();
  });
  expect(
    await new WorkspaceProtection(new ContentLibrary(root)).list(),
  ).toEqual([]);
  expect(
    (await store.readPage(project.id, page.document.id)).document.title,
  ).toBe("After");
});

it("confirms a workspace difference under the lease, so a save still writing its files is not recorded", async () => {
  const { root, store, project, page } = await fixture();
  const original = await readFile(page.path, "utf8");
  const changed = JSON.parse(original);
  changed.document.title = "Half written";
  const held = gate(),
    entered = gate();
  const writer = withLibraryLock(root, async () => {
    entered.open();
    await writeFile(page.path, JSON.stringify(changed));
    await held.closed;
    await writeFile(page.path, original);
  });
  await entered.closed;
  let settled = false;
  const scanning = scanWorkspaceResources(
    new ContentLibrary(root),
    project.id,
  ).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  // The difference sends the scan to the lease, where the writer still works.
  expect(settled).toBe(false);
  held.open();
  await writer;
  expect(await scanning).toEqual([]);
  expect(
    (await store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Before");
  expect(
    await new WorkspaceProtection(new ContentLibrary(root)).list(),
  ).toEqual([]);
});

it("opens a page without comparing workspace files and reports edits a scan recorded", async () => {
  const { root, store, project, page } = await fixture();
  const changed = JSON.parse(await readFile(page.path, "utf8"));
  changed.document.title = "External";
  await writeFile(page.path, JSON.stringify(changed));
  const opened = await store.readPage(project.id, page.document.id);
  expect(opened.document.title).toBe("Before");
  expect(opened.workspaceConflicts).toBeUndefined();
  await scanWorkspaceResources(new ContentLibrary(root), project.id);
  expect(
    (
      await store.readPage(project.id, page.document.id)
    ).workspaceConflicts?.map((item) => item.kind),
  ).toEqual(["modified"]);
  expect(
    (await new WorkspaceProtection(new ContentLibrary(root)).list()).length,
  ).toBe(1);
});

it("releases the read transaction when the action fails", async () => {
  const { root, store, project, page } = await fixture();
  await expect(
    withLibrarySnapshot(root, async () => {
      await store.listPages(project.id);
      throw new Error("reader failed");
    }),
  ).rejects.toThrow("reader failed");
  // A save and a fresh read after the failure see each other's state.
  await store.savePage(
    project.id,
    page.document.id,
    { ...page.document, title: "After" },
    page.hash,
    page.revision,
  );
  expect((await store.listPages(project.id)).map((item) => item.title)).toEqual(
    ["After"],
  );
});

it("leaves a file of a save still writing its workspace to that save, without the lease", async () => {
  const { root, project, page } = await fixture();
  const changed = JSON.parse(await readFile(page.path, "utf8"));
  changed.document.title = "Being written";
  await writeFile(page.path, JSON.stringify(changed));
  const journal = join(root, "local", "transactions", "in-flight");
  await mkdir(journal, { recursive: true });
  await writeFile(
    join(journal, "journal.json"),
    JSON.stringify({
      id: "in-flight",
      parent: null,
      paths: [`projects/${project.id}/pages/${page.document.id}.json`],
      before: {},
    }),
  );
  const held = gate(),
    entered = gate();
  const holder = withLibraryLock(root, async () => {
    entered.open();
    await held.closed;
  });
  await entered.closed;
  const library = new ContentLibrary(root);
  try {
    expect(await promptly(scanWorkspaceResources(library, project.id))).toEqual(
      [],
    );
  } finally {
    held.open();
    await holder;
  }
  // Once no save claims the file, the same difference is an external edit.
  await rm(journal, { recursive: true });
  expect(await scanWorkspaceResources(library, project.id)).toHaveLength(1);
});

it("scans for external edits while another operation holds the writer lease", async () => {
  const { root, store, project, page } = await fixture();
  const library = new ContentLibrary(root);
  const held = gate(),
    entered = gate();
  const holder = withLibraryLock(root, async () => {
    entered.open();
    await held.closed;
  });
  await entered.closed;
  try {
    expect(await promptly(scanWorkspaceResources(library))).toEqual([]);
  } finally {
    held.open();
    await holder;
  }
  const changed = JSON.parse(await readFile(page.path, "utf8"));
  changed.document.title = "External";
  await writeFile(page.path, JSON.stringify(changed));
  expect(
    (await scanWorkspaceResources(library)).map((item) => item.path),
  ).toEqual([`projects/${project.id}/pages/${page.document.id}.json`]);
  expect(
    (await store.readPage(project.id, page.document.id)).workspaceConflicts
      ?.length,
  ).toBe(1);
});
