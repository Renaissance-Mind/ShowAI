import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FileStore } from "./store";
import { ContentLibrary } from "./content-library";
import { directoryEntries, sortDirectoryItems } from "./directory-sort";

const entries = [
  {
    id: "folder",
    name: "文件10",
    pinned: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-03-01",
  },
  {
    id: "page",
    name: "文件2",
    pinned: false,
    createdAt: "2026-02-01",
    updatedAt: "2026-02-01",
  },
  {
    id: "pin",
    name: "置顶",
    pinned: true,
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
  },
];
const ids = (items: { id: string }[]) => items.map((item) => item.id);

it("sorts mixed children by natural name or descending dates with pins first", () => {
  expect(ids(sortDirectoryItems(entries))).toEqual(["pin", "folder", "page"]);
  expect(ids(sortDirectoryItems(entries, { sortBy: "name" }))).toEqual([
    "pin",
    "page",
    "folder",
  ]);
  expect(ids(sortDirectoryItems(entries, { sortBy: "createdAt" }))).toEqual([
    "pin",
    "page",
    "folder",
  ]);
  expect(
    ids(
      sortDirectoryItems(entries, { sortBy: "updatedAt" }, [
        "page",
        "folder",
        "pin",
      ]),
    ),
  ).toEqual(["pin", "folder", "page"]);
  expect(entries[0].id).toBe("folder");
});

it("uses date instants, deterministic ties and a saved manual order", () => {
  const sameName = entries.map((item) => ({
    ...item,
    pinned: false,
    name: "Same",
  }));
  expect(ids(sortDirectoryItems(sameName, { sortBy: "name" }))).toEqual([
    "folder",
    "page",
    "pin",
  ]);
  expect(
    ids(
      sortDirectoryItems(entries, {
        sortBy: "manual",
        manualOrder: ["page", "pin", "folder"],
      }),
    ),
  ).toEqual(["pin", "page", "folder"]);
  const timezoneDates = [
    { ...entries[0], updatedAt: "2026-03-01T11:00:00+08:00" },
    { ...entries[1], updatedAt: "2026-03-01T04:00:00Z" },
  ];
  expect(ids(sortDirectoryItems(timezoneDates))).toEqual(["page", "folder"]);
});

describe.each([false, true])(
  "directory preferences (versioned: %s)",
  (versioned) => {
    let home: string;
    afterEach(async () => {
      if (home) await rm(home, { recursive: true, force: true });
    });
    it("persists independent root, parent and child preferences without changing page revisions", async () => {
      home = await mkdtemp(join(tmpdir(), "showai-directory-sort-"));
      if (versioned) await new ContentLibrary(home).initialize();
      const store = new FileStore(home);
      const project = await store.createProject({ name: "Sorting" });
      const folder = await store.createFolder(project.id, { name: "Parent" });
      const child = await store.createFolder(project.id, {
        name: "Child",
        parentId: folder.id,
      });
      const sibling = await store.createFolder(project.id, { name: "Default" });
      const a = await store.createPage(project.id, {
        title: "A",
        parentId: folder.id,
      });
      const b = await store.createPage(project.id, {
        title: "B",
        parentId: folder.id,
      });
      await Promise.all([
        store.setDirectorySort(project.id, null, "name"),
        store.setDirectorySort(project.id, folder.id, "createdAt"),
        store.setDirectorySort(project.id, child.id, "name"),
      ]);
      let reopened = new FileStore(home);
      expect((await reopened.readProject(project.id)).sortBy).toBe("name");
      const saved = await reopened.listFolders(project.id);
      expect(saved.find((item) => item.id === folder.id)?.sortBy).toBe(
        "createdAt",
      );
      expect(saved.find((item) => item.id === child.id)?.sortBy).toBe("name");
      expect(
        saved.find((item) => item.id === sibling.id)?.sortBy,
      ).toBeUndefined();
      expect(
        (await reopened.listPages(project.id)).find(
          (item) => item.id === a.document.id,
        )?.createdAt,
      ).toBe(a.document.createdAt);
      await store.arrangeEntry({
        reorderOnly: true,
        kind: "page",
        projectId: project.id,
        destinationProjectId: project.id,
        parentId: folder.id,
        id: b.document.id,
        relativeId: a.document.id,
      });
      reopened = new FileStore(home);
      const manual = (await reopened.listFolders(project.id)).find(
        (item) => item.id === folder.id,
      )!;
      expect(manual.sortBy).toBe("manual");
      expect(manual.manualOrder!.indexOf(b.document.id)).toBeLessThan(
        manual.manualOrder!.indexOf(a.document.id),
      );
      await store.setDirectorySort(project.id, folder.id, "updatedAt");
      const restored = (await reopened.listFolders(project.id)).find(
        (item) => item.id === folder.id,
      )!;
      expect(restored.sortBy).toBe("updatedAt");
      expect(restored.manualOrder).toEqual(manual.manualOrder);
      const record = await reopened.readPage(project.id, a.document.id);
      expect(record.document).toEqual(a.document);
      expect(record.hash).toBe(a.hash);
      expect(record.revision).toBe(a.revision);
      await expect(
        store.setDirectorySort(project.id, "missing-folder", "name"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        store.setDirectorySort(project.id, null, "invalid" as "name"),
      ).rejects.toMatchObject({ code: "INVALID_DATA" });
      if (versioned) await new ContentLibrary(home).verify();
    });
  },
);

it("rebuilds old summary caches so creation sorting uses the original page creation date", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-sort-summary-"));
  try {
    await new ContentLibrary(home).initialize();
    const store = new FileStore(home);
    const project = await store.createProject({ name: "Cache" });
    const page = await store.createPage(project.id, { title: "Original" });
    await store.listPages(project.id);
    const path = join(home, "local", "page-summaries.json");
    const cache = JSON.parse(await readFile(path, "utf8"));
    cache.version = 1;
    for (const entry of Object.values(cache.entries) as {
      summary: { createdAt?: string };
    }[])
      delete entry.summary.createdAt;
    cache.integrity = createHash("sha256")
      .update(JSON.stringify([cache.revision, cache.entries]))
      .digest("hex");
    await writeFile(path, JSON.stringify(cache));
    await store.setDirectorySort(project.id, null, "createdAt");
    const pages = await new FileStore(home).listPages(project.id);
    expect(pages[0].createdAt).toBe(page.document.createdAt);
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2);
    expect(directoryEntries([], pages)[0].createdAt).toBe(
      page.document.createdAt,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
