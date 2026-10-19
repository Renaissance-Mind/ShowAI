import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../core/store";
import { applyLibraryMove, type LibraryContents } from "./library-move";
import type { LibraryDrop } from "./LibraryDrag";

let home: string, store: FileStore;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-drop-"));
  store = new FileStore(home);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
async function contents(...ids: string[]): Promise<LibraryContents> {
  return Object.fromEntries(
    await Promise.all(
      ids.map(async (id) => [
        id,
        {
          pages: await store.listPages(id),
          folders: await store.listFolders(id),
        },
      ]),
    ),
  );
}
async function setup() {
  const project = await store.createProject({ name: "Source" });
  const folder = await store.createFolder(project.id, { name: "Destination" });
  const record = await store.createPage(project.id, { title: "Moving page" });
  const drop: LibraryDrop = {
    source: {
      kind: "page",
      id: record.document.id,
      title: record.document.title,
      projectId: project.id,
      parentId: null,
      pinned: false,
    },
    projectId: project.id,
    parentId: folder.id,
  };
  return { project, folder, record, drop };
}

it("shows a folder transfer before persistence and survives stale reads without mutating saved state", async () => {
  const { project, folder, record, drop } = await setup();
  const saved = await contents(project.id);
  expect(applyLibraryMove(saved, drop)[project.id].pages[0].parentId).toBe(
    folder.id,
  );
  expect(saved[project.id].pages[0].parentId).toBeNull();
  expect(
    (await store.readPage(project.id, record.document.id)).document.parentId,
  ).toBeNull();
  const staleRead = await contents(project.id);
  await store.arrangeEntry({
    kind: "page",
    projectId: project.id,
    destinationProjectId: project.id,
    id: record.document.id,
    parentId: folder.id,
    baseHash: record.hash,
    baseRevision: record.revision,
  });
  expect(applyLibraryMove(staleRead, drop)[project.id].pages[0].parentId).toBe(
    folder.id,
  );
  const confirmed = await contents(project.id);
  expect(applyLibraryMove(confirmed, drop)).toEqual(confirmed);
});

it("rolls back a rejected transfer to the latest saved metadata", async () => {
  const { project, record, drop } = await setup();
  const saved = await contents(project.id);
  const edited = await store.savePage(
    project.id,
    record.document.id,
    { ...record.document, title: "Concurrent edit" },
    record.hash,
    record.revision,
  );
  await expect(
    store.arrangeEntry({
      kind: "page",
      projectId: project.id,
      destinationProjectId: project.id,
      id: record.document.id,
      parentId: drop.parentId!,
      baseHash: record.hash,
      baseRevision: record.revision,
    }),
  ).rejects.toThrow();
  const refreshed = await contents(project.id);
  expect(applyLibraryMove(refreshed, drop)[project.id].pages[0].title).toBe(
    edited.document.title,
  );
  expect(refreshed[project.id].pages[0].parentId).toBeNull();
  expect(saved[project.id].pages[0].title).toBe(record.document.title);
});

it("transfers across projects once, including before destination contents load", async () => {
  const { project, record, drop } = await setup();
  const destination = await store.createProject({ name: "Other" });
  const across = { ...drop, projectId: destination.id, parentId: null };
  const saved = await contents(project.id);
  const pending = applyLibraryMove(saved, across);
  expect(pending[project.id].pages).toHaveLength(0);
  expect(pending[destination.id].pages.map((page) => page.id)).toEqual([
    record.document.id,
  ]);
  expect(applyLibraryMove(pending, across)).toEqual(pending);
  await store.arrangeEntry({
    kind: "page",
    projectId: project.id,
    destinationProjectId: destination.id,
    id: record.document.id,
    parentId: null,
    baseHash: record.hash,
    baseRevision: record.revision,
  });
  const confirmed = await contents(project.id, destination.id);
  expect(applyLibraryMove(confirmed, across)).toBe(confirmed);
});

it("moves a folder with its nested pages while preserving unrelated projects", async () => {
  const { project, folder, record, drop } = await setup();
  const other = await store.createProject({ name: "Unrelated" });
  const parent = await store.createFolder(project.id, { name: "Parent" });
  await store.arrangeEntry({
    kind: "page",
    projectId: project.id,
    destinationProjectId: project.id,
    id: record.document.id,
    parentId: folder.id,
    baseHash: record.hash,
    baseRevision: record.revision,
  });
  const saved = await contents(project.id, other.id);
  const pending = applyLibraryMove(saved, {
    ...drop,
    source: { ...drop.source, kind: "folder", id: folder.id },
    parentId: parent.id,
  });
  expect(
    pending[project.id].folders.find((item) => item.id === folder.id)?.parentId,
  ).toBe(parent.id);
  expect(pending[project.id].pages[0].parentId).toBe(folder.id);
  expect(pending[other.id]).toBe(saved[other.id]);
  expect(
    saved[project.id].folders.find((item) => item.id === folder.id)?.parentId,
  ).toBeNull();
});
