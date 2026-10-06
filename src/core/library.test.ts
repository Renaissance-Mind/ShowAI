import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileStore } from "./store";
import { exportPage } from "../agent/exporter";

describe("persistent project, folder, and page organization", () => {
  let home: string;
  let store: FileStore;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "showai-library-"));
    store = new FileStore(home);
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("reads old project files and preserves legacy page parents during editing", async () => {
    const project = await store.createProject({ name: "Legacy" });
    const path = join(store.projectPath(project.id), "project.json");
    const old = JSON.parse(await readFile(path, "utf8"));
    delete old.pinned;
    delete old.archived;
    delete old.folders;
    await writeFile(path, JSON.stringify(old));
    const first = await store.createPage(project.id);
    const saved = await store.savePage(
      project.id,
      first.document.id,
      { ...first.document, parentId: "old-parent-page" },
      first.hash,
    );
    expect((await store.listProjects())[0]).toMatchObject({
      pinned: false,
      archived: false,
      folders: [],
    });
    expect(
      (await store.listPages(project.id, { includeArchived: false }))[0],
    ).toMatchObject({ parentId: null, favorite: false });
    const changed = await store.savePage(
      project.id,
      saved.document.id,
      { ...saved.document, title: "Still editable" },
      saved.hash,
    );
    expect(changed.document.parentId).toBe("old-parent-page");
  });

  it("persists nested folders and their pages across a fresh FileStore", async () => {
    const project = await store.createProject({ name: "Research" });
    const folder = await store.createFolder(project.id, { name: "Papers" });
    const child = await store.createFolder(project.id, {
      name: "2026",
      parentId: folder.id,
    });
    const page = await store.createPage(project.id, {
      title: "Reading",
      parentId: child.id,
    });
    const reopened = new FileStore(home);
    expect(await reopened.listFolders(project.id)).toEqual(
      expect.arrayContaining([folder, child]),
    );
    expect((await reopened.listPages(project.id))[0]).toMatchObject({
      parentId: child.id,
      favorite: false,
      archived: false,
    });
    expect(
      (await reopened.readPage(project.id, page.document.id)).document.parentId,
    ).toBe(child.id);
    expect((await reopened.listProjects())[0].pageCount).toBe(1);
  });

  it("persists pinning at each level and orders pinned items first", async () => {
    const first = await store.createProject({ name: "First" });
    await store.createProject({ name: "Second" });
    await store.updateProject(first.id, { pinned: true });
    expect((await new FileStore(home).listProjects())[0].id).toBe(first.id);
    const folder = await store.createFolder(first.id, { name: "First folder" });
    await store.createFolder(first.id, { name: "Second folder" });
    await store.updateFolder(first.id, folder.id, {
      pinned: true,
      name: "Renamed",
    });
    expect((await store.listFolders(first.id))[0]).toMatchObject({
      id: folder.id,
      name: "Renamed",
      pinned: true,
    });
    const page = await store.createPage(first.id, { title: "First page" });
    await store.createPage(first.id, { title: "Second page" });
    const pinned = await store.updatePageMetadata(
      first.id,
      page.document.id,
      { favorite: true, title: "Pinned page" },
      page.hash,
    );
    expect((await new FileStore(home).listPages(first.id))[0]).toMatchObject({
      id: page.document.id,
      title: "Pinned page",
      favorite: true,
    });
    await expect(
      store.updatePageMetadata(
        first.id,
        page.document.id,
        { title: "Stale title" },
        page.hash,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", currentHash: pinned.hash });
    await store.updatePageMetadata(
      first.id,
      page.document.id,
      { favorite: false },
      pinned.hash,
    );
    expect(
      (await store.readPage(first.id, page.document.id)).document.favorite,
    ).toBe(false);
  });

  it("persists groups and membership, preserving pinning and pages when a group is removed", async () => {
    const project = await store.createProject({ name: "Grouped project" });
    const page = await store.createPage(project.id, { title: "Keep me" });
    const group = (await store.createProjectGroup("Research")).groups[0];
    await store.moveProjectToGroup(project.id, group.id);
    await store.updateProject(project.id, { pinned: true });
    await store.updateProjectGroup(group.id, "Reading");
    const reopened = new FileStore(home);
    expect(await reopened.readSidebar()).toEqual({
      groups: [{ id: group.id, name: "Reading" }],
      projectGroups: { [project.id]: group.id },
    });
    await reopened.updateProjectGroup(group.id, null);
    expect(await store.readSidebar()).toEqual({
      groups: [],
      projectGroups: {},
    });
    expect((await store.listProjects())[0].pinned).toBe(true);
    expect((await store.readPage(project.id, page.document.id)).hash).toBe(
      page.hash,
    );
  });

  it("serializes group edits and rejects missing destinations without losing membership", async () => {
    const first = await store.createProject({ name: "First" });
    const second = await store.createProject({ name: "Second" });
    await Promise.all([
      store.createProjectGroup("A"),
      new FileStore(home).createProjectGroup("B"),
    ]);
    const groups = (await store.readSidebar()).groups;
    expect(groups).toHaveLength(2);
    await Promise.all([
      store.moveProjectToGroup(first.id, groups[0].id),
      new FileStore(home).moveProjectToGroup(second.id, groups[1].id),
    ]);
    await expect(
      store.moveProjectToGroup(first.id, "missing-group"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.moveProjectToGroup("missing-project", groups[0].id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await store.readSidebar()).projectGroups).toEqual({
      [first.id]: groups[0].id,
      [second.id]: groups[1].id,
    });
    await store.moveProjectToGroup(first.id, null);
    expect((await store.readSidebar()).projectGroups).toEqual({
      [second.id]: groups[1].id,
    });
  });

  it("reports corrupt sidebar data without replacing it with empty groups", async () => {
    expect(await store.readSidebar()).toEqual({
      groups: [],
      projectGroups: {},
    });
    await writeFile(
      join(home, "sidebar.json"),
      JSON.stringify({
        groups: [],
        projectGroups: { project: "missing-group" },
      }),
    );
    await expect(store.readSidebar()).rejects.toMatchObject({
      code: "INVALID_DATA",
    });
  });

  it("moves pages only to existing visible folders with a matching content hash", async () => {
    const project = await store.createProject({ name: "Project" });
    const folder = await store.createFolder(project.id, {
      name: "Destination",
    });
    const page = await store.createPage(project.id);
    const moved = await store.updatePageMetadata(
      project.id,
      page.document.id,
      { parentId: folder.id },
      page.hash,
    );
    expect(moved.document.parentId).toBe(folder.id);
    await expect(
      store.updatePageMetadata(
        project.id,
        page.document.id,
        { parentId: "missing-folder" },
        moved.hash,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.createPage(project.id, { parentId: "../outside" }),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    const root = await store.updatePageMetadata(
      project.id,
      page.document.id,
      { parentId: null },
      moved.hash,
    );
    expect(root.document.parentId).toBeNull();
    await store.updateFolder(project.id, folder.id, { archived: true });
    await expect(
      store.updatePageMetadata(
        project.id,
        page.document.id,
        { parentId: folder.id },
        root.hash,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("archives a folder subtree without changing descendant source files", async () => {
    const project = await store.createProject({ name: "Archive" });
    const folder = await store.createFolder(project.id, { name: "Parent" });
    const child = await store.createFolder(project.id, {
      name: "Child",
      parentId: folder.id,
    });
    const hidden = await store.createPage(project.id, {
      title: "Hidden",
      parentId: child.id,
    });
    const visible = await store.createPage(project.id, { title: "Visible" });
    const before = await readFile(hidden.path, "utf8");
    await store.updateFolder(project.id, folder.id, { archived: true });
    expect(await store.listFolders(project.id)).toEqual([]);
    expect(
      (await store.listFolders(project.id, { includeArchived: true })).find(
        (item) => item.id === child.id,
      )?.archived,
    ).toBe(false);
    expect(
      (await store.listPages(project.id, { includeArchived: false })).map(
        (item) => item.id,
      ),
    ).toEqual([visible.document.id]);
    expect(await store.listPages(project.id)).toHaveLength(2);
    expect(await readFile(hidden.path, "utf8")).toBe(before);
    expect((await store.listProjects())[0]).toMatchObject({
      pageCount: 1,
      folders: [],
    });
    await expect(
      store.createPage(project.id, { parentId: child.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.createFolder(project.id, { name: "Another", parentId: child.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await store.updateFolder(project.id, folder.id, { archived: false });
    expect(
      await new FileStore(home).listPages(project.id, {
        includeArchived: false,
      }),
    ).toHaveLength(2);
  });

  it("archives projects without deleting their pages or losing session bindings", async () => {
    const binding = { harness: "codex", sessionId: "archive-session" };
    const project = await store.createProject({ name: "Project", binding });
    const page = await store.createPage(project.id);
    await store.updateProject(project.id, { archived: true });
    expect(await store.listProjects()).toEqual([]);
    expect((await store.listProjects({ includeArchived: true }))[0].id).toBe(
      project.id,
    );
    expect(
      await store.listPages(project.id, { includeArchived: false }),
    ).toEqual([]);
    expect((await store.readPage(project.id, page.document.id)).hash).toBe(
      page.hash,
    );
    expect(
      (await store.createProject({ name: "Same session", binding })).id,
    ).toBe(project.id);
    await expect(store.createPage(project.id)).rejects.toMatchObject({
      code: "INVALID_DATA",
    });
    await store.updateProject(project.id, { archived: false });
    expect((await store.listProjects())[0].pageCount).toBe(1);
  });

  it("serializes simultaneous folder creation without dropping either update", async () => {
    const project = await store.createProject({ name: "Concurrent" });
    const [first, second] = await Promise.all([
      store.createFolder(project.id, { name: "First" }),
      new FileStore(home).createFolder(project.id, { name: "Second" }),
    ]);
    expect(
      new Set((await store.listFolders(project.id)).map((folder) => folder.id)),
    ).toEqual(new Set([first.id, second.id]));
  });

  it("publishes complete projects while independent readers continuously scan real files", async () => {
    await store.listProjects();
    let complete = false;
    let scans = 0;
    const creating = Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        new FileStore(home).createProject({
          name: `Concurrent project ${index}`,
        }),
      ),
    ).finally(() => {
      complete = true;
    });
    const reader = async () => {
      const independent = new FileStore(home);
      while (!complete) {
        await independent.listProjects();
        const directories = await readdir(join(home, "projects"), {
          withFileTypes: true,
        });
        for (const entry of directories.filter(
          (entry) => entry.isDirectory() && !entry.name.startsWith("."),
        )) {
          const project = JSON.parse(
            await readFile(
              join(home, "projects", entry.name, "project.json"),
              "utf8",
            ),
          );
          expect(project.id).toBe(entry.name);
          expect(
            (
              await stat(join(home, "projects", entry.name, "pages"))
            ).isDirectory(),
          ).toBe(true);
        }
        scans++;
      }
    };
    const results = await Promise.allSettled([
      creating,
      reader(),
      reader(),
      reader(),
    ]);
    for (const result of results)
      expect(
        result.status,
        result.status === "rejected" ? String(result.reason) : "",
      ).toBe("fulfilled");
    expect(scans).toBeGreaterThan(0);
    expect(await new FileStore(home).listProjects()).toHaveLength(24);
    expect(
      (await readdir(join(home, "projects"))).some((name) =>
        name.startsWith(".create-"),
      ),
    ).toBe(false);
  }, 15000);

  it("still reports a broken published project instead of hiding missing metadata", async () => {
    await mkdir(join(home, "projects", "broken-project", "pages"), {
      recursive: true,
    });
    await expect(store.listProjects()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects corrupt cyclic folder metadata instead of looping or hiding content", async () => {
    const project = await store.createProject({ name: "Cycle" });
    const parent = await store.createFolder(project.id, { name: "Parent" });
    const child = await store.createFolder(project.id, {
      name: "Child",
      parentId: parent.id,
    });
    const path = join(store.projectPath(project.id), "project.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    metadata.folders.find(
      (folder: { id: string }) => folder.id === parent.id,
    ).parentId = child.id;
    await writeFile(path, JSON.stringify(metadata));
    await expect(store.listFolders(project.id)).rejects.toMatchObject({
      code: "INVALID_DATA",
    });
  });

  it("removes archived folder descendants from a rebuilt real static site", async () => {
    const project = await store.createProject({ name: "Site" });
    const visible = await store.createPage(project.id, {
      title: "Visible page",
    });
    const parent = await store.createFolder(project.id, {
      name: "Private folder",
    });
    const child = await store.createFolder(project.id, {
      name: "Nested",
      parentId: parent.id,
    });
    const hidden = await store.createPage(project.id, {
      title: "Hidden page",
      parentId: child.id,
    });
    const out = join(home, "site");
    const options = {
      root: home,
      projectId: project.id,
      format: "site" as const,
      out,
      templatePath: resolve("dist-portable/portable.html"),
    };
    expect((await exportPage(options)).pageIds).toContain(hidden.document.id);
    await store.updateFolder(project.id, parent.id, { archived: true });
    const result = await exportPage({ ...options, overwrite: true });
    expect(result.pageIds).toEqual([visible.document.id]);
    expect(await readFile(join(out, "index.html"), "utf8")).not.toContain(
      "Hidden page",
    );
    await expect(
      readFile(
        join(out, "sources", `${hidden.document.id}.showai.json`),
        "utf8",
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await store.readPage(project.id, hidden.document.id)).document.title,
    ).toBe("Hidden page");
  });
});
