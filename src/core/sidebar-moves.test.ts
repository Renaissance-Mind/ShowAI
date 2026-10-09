import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { ContentLibrary as GitLibrary } from "./content-library";
import { orderSidebarItems } from "./sidebar-order";
import { blankDocument } from "./catalog";

describe.each([false, true])("sidebar moves (versioned: %s)", (versioned) => {
  let home: string, store: FileStore;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "showai-sidebar-move-"));
    if (versioned) await new GitLibrary(home).initialize();
    store = new FileStore(home);
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("persists project order, groups and pinning across a reopened store", async () => {
    const a = await store.createProject({ name: "A" }),
      b = await store.createProject({ name: "B" });
    await store.arrangeProject(a.id, "projects", b.id, "before");
    const reopened = new FileStore(home);
    expect(
      orderSidebarItems(
        await reopened.listProjects(),
        (await reopened.readSidebar()).projectOrder,
      ).map((item) => item.id),
    ).toEqual([a.id, b.id]);
    const sidebar = await store.createProjectGroup("Research"),
      group = sidebar.groups[0];
    await store.arrangeProject(a.id, group.id);
    expect((await reopened.readSidebar()).projectGroups[a.id]).toBe(group.id);
    await store.arrangeProject(a.id, "pinned");
    expect(
      (await reopened.listProjects()).find((item) => item.id === a.id)?.pinned,
    ).toBe(true);
    await store.arrangeProject(a.id, "projects", b.id, "after");
    expect((await reopened.readSidebar()).projectGroups[a.id]).toBeUndefined();
    expect(
      (await reopened.listProjects()).find((item) => item.id === a.id)?.pinned,
    ).toBe(false);
    const baseline = await reopened.readSidebar();
    await expect(
      store.arrangeProject(a.id, group.id, b.id),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(await reopened.readSidebar()).toEqual(baseline);
  });

  it("orders mixed folder/page siblings and retains order after content edits", async () => {
    const project = await store.createProject({ name: "Research" });
    const folder = await store.createFolder(project.id, { name: "Folder" });
    const a = await store.createPage(project.id, { title: "A" }),
      b = await store.createPage(project.id, { title: "B" });
    await store.arrangeEntry({
      kind: "page",
      projectId: project.id,
      id: a.document.id,
      destinationProjectId: project.id,
      parentId: null,
      relativeId: folder.id,
      baseHash: a.hash,
      baseRevision: a.revision,
    });
    const order = (await store.readSidebar()).entryOrder![project.id];
    expect(order.indexOf(a.document.id)).toBeLessThan(order.indexOf(folder.id));
    const changed = await store.updatePageMetadata(
      project.id,
      b.document.id,
      { title: "B edited" },
      b.hash,
      b.revision,
    );
    expect(
      (await new FileStore(home).readSidebar()).entryOrder![project.id],
    ).toEqual(order);
    await store.arrangeEntry({
      kind: "page",
      projectId: project.id,
      id: changed.document.id,
      destinationProjectId: project.id,
      parentId: folder.id,
      baseHash: changed.hash,
      baseRevision: changed.revision,
    });
    expect(
      (await store.readPage(project.id, b.document.id)).document.parentId,
    ).toBe(folder.id);
    const moved = await store.readPage(project.id, b.document.id);
    await store.updatePageMetadata(
      project.id,
      b.document.id,
      { favorite: true },
      moved.hash,
      moved.revision,
    );
    expect((await store.readSidebar()).entryOrder![project.id][0]).toBe(
      b.document.id,
    );
    await store.updateFolder(project.id, folder.id, { pinned: true });
    expect((await store.readSidebar()).entryOrder![project.id][0]).toBe(
      folder.id,
    );
  });

  it("moves a page across projects with the same id, content and image bytes", async () => {
    const a = await store.createProject({ name: "A" }),
      b = await store.createProject({ name: "B" });
    const folder = await store.createFolder(b.id, { name: "Destination" });
    const initial = { ...blankDocument(), title: "Original" };
    const page = await store.createPage(a.id, {
      document: {
        ...initial,
        cover: "data:image/png;base64,aW1hZ2U=",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { id: "paragraph" },
              content: [{ type: "text", text: "Keep this text" }],
            },
          ],
        },
        comments: [
          {
            id: "comment",
            text: "Keep comment",
            resolved: false,
            createdAt: initial.createdAt,
          },
        ],
      },
    });
    await store.arrangeEntry({
      kind: "page",
      projectId: a.id,
      id: page.document.id,
      destinationProjectId: b.id,
      parentId: folder.id,
      baseHash: page.hash,
      baseRevision: page.revision,
    });
    const moved = await new FileStore(home).readPage(b.id, page.document.id);
    expect(moved.document).toMatchObject({
      ...page.document,
      parentId: folder.id,
      updatedAt: expect.any(String),
    });
    expect(await store.listPages(a.id)).toEqual([]);
    expect((await store.listPages(b.id))[0].id).toBe(page.document.id);
    if (versioned) await new GitLibrary(home).verify();
  });

  it("rejects stale pages, invalid destinations and cyclic folder moves without changing organization", async () => {
    const project = await store.createProject({ name: "Research" });
    const folder = await store.createFolder(project.id, { name: "Folder" });
    const child = await store.createFolder(project.id, {
      name: "Child",
      parentId: folder.id,
    });
    const page = await store.createPage(project.id);
    const changed = await store.updatePageMetadata(
      project.id,
      page.document.id,
      { title: "Newer" },
      page.hash,
      page.revision,
    );
    const sidebar = await store.readSidebar();
    await expect(
      store.arrangeEntry({
        kind: "page",
        projectId: project.id,
        id: page.document.id,
        destinationProjectId: project.id,
        parentId: folder.id,
        baseHash: page.hash,
        baseRevision: page.revision,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      store.arrangeEntry({
        kind: "folder",
        projectId: project.id,
        id: folder.id,
        destinationProjectId: project.id,
        parentId: child.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    await expect(
      store.arrangeEntry({
        kind: "page",
        projectId: project.id,
        id: page.document.id,
        destinationProjectId: project.id,
        parentId: null,
        relativeId: "missing",
        baseHash: changed.hash,
        baseRevision: changed.revision,
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(await store.readSidebar()).toEqual(sidebar);
    expect(
      (await store.readPage(project.id, page.document.id)).document.parentId,
    ).toBeNull();
    await store.arrangeEntry({
      kind: "folder",
      projectId: project.id,
      id: child.id,
      destinationProjectId: project.id,
      parentId: null,
      relativeId: folder.id,
    });
    expect(
      (await store.listFolders(project.id)).find((item) => item.id === child.id)
        ?.parentId,
    ).toBeNull();
  });
});
