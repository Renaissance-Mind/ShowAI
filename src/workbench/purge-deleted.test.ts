import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { ContentLibrary } from "../core/content-library";
import { SqliteLibrary } from "../core/sqlite-library";
import { EditorDrafts } from "../core/editor-drafts";
import { LibraryMaintenance } from "../core/library-maintenance";
import { encodeFile } from "../core/history-codec";
import { createWorkbench } from "./actions";
import type { DeletedEntries } from "../core/deleted-entries";
import type { DesktopInfo } from "../desktop/bridge";
import type { FolderMetadata, PageRecord, ProjectSummary } from "../core/model";

let home: string;
let invoke: (action: string, args?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-purge-"));
  await openLibrary(home);
  const service = new AgentService({ root: home });
  const workbench = createWorkbench(service.store, service, {
    info: () => ({ home, mode: "desktop" }) as unknown as DesktopInfo,
    openDialog: async () => ({ canceled: true, filePaths: [] }),
    saveDialog: async () => ({ canceled: true }),
    invoke: async () => null,
  });
  invoke = (action, args = {}) => workbench(action, args);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
const workspacePage = (projectId: string, pageId: string) =>
  join(home, "workspace", "projects", projectId, "pages", `${pageId}.json`);

/**
 * A page whose text and image do not compress, so their stored size is
 * measurable. The image is kept once under assets/, shared by reference.
 */
async function largePage(projectId: string, title: string, bytes = 200_000) {
  return invoke("pages:create", {
    projectId,
    document: {
      id: "large-page",
      title,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: randomBytes(bytes).toString("base64") },
            ],
          },
          {
            type: "image",
            attrs: {
              id: "large-image",
              src: `data:image/png;base64,${randomBytes(100_000).toString("base64")}`,
              alt: "",
            },
          },
        ],
      },
    },
  }) as Promise<PageRecord>;
}

describe("permanently deleting items in the trash", () => {
  it("deletes one page, its file and its editor draft, and keeps the rest", async () => {
    const project: ProjectSummary = await invoke("projects:create", {
      name: "Notes",
    });
    const gone: PageRecord = await invoke("pages:create", {
      projectId: project.id,
      title: "Gone",
    });
    const kept: PageRecord = await invoke("pages:create", {
      projectId: project.id,
      title: "Kept",
    });
    const drafts = new EditorDrafts(home);
    const discarded = await drafts.save({
      kind: "page",
      clientId: "other-window",
      projectId: project.id,
      resourceId: gone.document.id,
      content: { title: "discarded" },
    });
    await drafts.remove(discarded.id);
    await drafts.save({
      kind: "page",
      clientId: "window",
      projectId: project.id,
      resourceId: gone.document.id,
      content: { title: "unsaved" },
    });
    await invoke("pages:remove", {
      projectId: project.id,
      pageId: gone.document.id,
    });
    expect(await exists(workspacePage(project.id, gone.document.id))).toBe(
      true,
    );

    expect(
      await invoke("library:purge", {
        items: [
          { kind: "page", projectId: project.id, pageId: gone.document.id },
        ],
      }),
    ).toEqual({ projects: 0, folders: 0, pages: 1 });

    const deleted: DeletedEntries = await invoke("library:deleted");
    expect(deleted.pages).toEqual([]);
    const pages = await invoke("pages:list", { projectId: project.id });
    expect(pages.map((page: { title: string }) => page.title)).toEqual([
      "Kept",
    ]);
    expect(await exists(workspacePage(project.id, gone.document.id))).toBe(
      false,
    );
    expect(await exists(workspacePage(project.id, kept.document.id))).toBe(
      true,
    );
    expect(await drafts.list({ resourceId: gone.document.id })).toEqual([]);
    expect(
      await exists(join(home, "local", "discarded-drafts", discarded.id)),
    ).toBe(false);
    await expect(
      invoke("library:restore", {
        kind: "page",
        projectId: project.id,
        pageId: gone.document.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await new ContentLibrary(home).verify();
  });

  it("deletes a folder with the folders and pages inside it", async () => {
    const project: ProjectSummary = await invoke("projects:create", {
      name: "Research",
    });
    const outer: FolderMetadata = await invoke("folders:create", {
      projectId: project.id,
      name: "Outer",
    });
    const inner: FolderMetadata = await invoke("folders:create", {
      projectId: project.id,
      parentId: outer.id,
      name: "Inner",
    });
    const deep: PageRecord = await invoke("pages:create", {
      projectId: project.id,
      parentId: inner.id,
      title: "Deep",
    });
    await invoke("pages:create", { projectId: project.id, title: "Outside" });
    await invoke("folders:remove", {
      projectId: project.id,
      folderId: outer.id,
    });

    expect(
      await invoke("library:purge", {
        items: [{ kind: "folder", projectId: project.id, folderId: outer.id }],
      }),
    ).toEqual({ projects: 0, folders: 2, pages: 1 });
    const folders = await invoke("folders:list", { projectId: project.id });
    expect(folders).toEqual([]);
    const remaining = await new AgentService({ root: home }).store.listPages(
      project.id,
    );
    expect(remaining.map((page) => page.title)).toEqual(["Outside"]);
    expect(await exists(workspacePage(project.id, deep.document.id))).toBe(
      false,
    );
  });

  it("empties the trash and refuses items that are not deleted", async () => {
    const kept: ProjectSummary = await invoke("projects:create", {
      name: "Kept",
    });
    const removed: ProjectSummary = await invoke("projects:create", {
      name: "Removed",
    });
    await invoke("pages:create", { projectId: removed.id, title: "Inside" });
    const folder: FolderMetadata = await invoke("folders:create", {
      projectId: kept.id,
      name: "Folder",
    });
    const loose: PageRecord = await invoke("pages:create", {
      projectId: kept.id,
      title: "Loose",
    });
    const live: PageRecord = await invoke("pages:create", {
      projectId: kept.id,
      title: "Live",
    });
    await expect(
      invoke("library:purge", {
        items: [
          { kind: "page", projectId: kept.id, pageId: live.document.id },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await invoke("projects:remove", { projectId: removed.id });
    await invoke("folders:remove", { projectId: kept.id, folderId: folder.id });
    await invoke("pages:remove", {
      projectId: kept.id,
      pageId: loose.document.id,
    });
    const before: DeletedEntries = await invoke("library:deleted");
    const items = [
      ...before.projects.map((item) => ({
        kind: "project",
        projectId: item.id,
      })),
      ...before.folders.map((item) => ({
        kind: "folder",
        projectId: item.projectId,
        folderId: item.id,
      })),
      ...before.pages.map((item) => ({
        kind: "page",
        projectId: item.projectId,
        pageId: item.id,
      })),
    ];
    expect(await invoke("library:purge", { items })).toEqual({
      projects: 1,
      folders: 1,
      pages: 2,
    });
    expect(await invoke("library:deleted")).toEqual({
      projects: [],
      folders: [],
      pages: [],
    });
    const projects: ProjectSummary[] = await invoke("projects:list", {
      includeArchived: true,
    });
    expect(projects.map((project) => project.name)).toEqual(["Kept"]);
    expect(await exists(join(home, "workspace", "projects", removed.id))).toBe(
      false,
    );
    const sidebar = await invoke("sidebar:get");
    expect(JSON.stringify(sidebar)).not.toContain(removed.id);
    expect(JSON.stringify(sidebar)).not.toContain(loose.document.id);
    await new ContentLibrary(home).verify();
  });

  it("lets compaction and cleanup reclaim what a deleted page held", async () => {
    const project: ProjectSummary = await invoke("projects:create", {
      name: "Space",
    });
    const page = await largePage(project.id, "Large");
    const drafts = new EditorDrafts(home);
    const draft = await drafts.save({
      kind: "page",
      clientId: "window",
      projectId: project.id,
      resourceId: page.document.id,
      content: {
        image: `data:image/png;base64,${randomBytes(50_000).toString("base64")}`,
      },
    });
    expect(draft.assets.length).toBe(1);
    await invoke("pages:remove", {
      projectId: project.id,
      pageId: page.document.id,
    });
    const maintenance = new LibraryMaintenance(home);
    await maintenance.compact();
    const before = await maintenance.storage();

    await invoke("library:purge", {
      items: [
        { kind: "page", projectId: project.id, pageId: page.document.id },
      ],
    });
    await maintenance.compact();
    const plan = await maintenance.prepareCleanup({ olderThanDays: 0 });
    expect(plan.files.map((file) => file.path)).toContain(
      `local/draft-assets/${draft.assets[0]}`,
    );
    await maintenance.cleanup(plan.id);
    const after = await maintenance.storage();

    // The page text (~200 KB stored), its image (100 KB) and the draft image (50 KB) are gone.
    expect(
      before.git.packedBytes - after.git.packedBytes,
    ).toBeGreaterThan(290_000);
    expect(
      before.categories.drafts.bytes - after.categories.drafts.bytes,
    ).toBeGreaterThan(50_000);
  });

  it("keeps an image another page still embeds", async () => {
    const project: ProjectSummary = await invoke("projects:create", {
      name: "Shared",
    });
    const src = `data:image/png;base64,${randomBytes(20_000).toString("base64")}`;
    const page = (id: string) =>
      invoke("pages:create", {
        projectId: project.id,
        document: {
          id,
          title: id,
          content: {
            type: "doc",
            content: [{ type: "image", attrs: { id: "image", src, alt: "" } }],
          },
        },
      }) as Promise<PageRecord>;
    const gone = await page("gone");
    const kept = await page("kept");
    await invoke("pages:remove", {
      projectId: project.id,
      pageId: gone.document.id,
    });
    await invoke("library:purge", {
      items: [
        { kind: "page", projectId: project.id, pageId: gone.document.id },
      ],
    });
    await new LibraryMaintenance(home).compact();
    const read: PageRecord = await invoke("pages:get", {
      projectId: project.id,
      pageId: kept.document.id,
    });
    expect(JSON.stringify(read.document)).toContain(src);
    await new ContentLibrary(home).verify();
  });

  it("releases archived history of a deleted project so compaction reclaims it", async () => {
    await rm(home, { recursive: true, force: true });
    home = await mkdtemp(join(tmpdir(), "showai-purge-archive-"));
    const projectId = randomUUID();
    const path = `projects/${projectId}/datasets/archive.json`;
    const bytes = Buffer.from(
      JSON.stringify({ archived: randomBytes(200_000).toString("base64") }),
    );
    // An older library whose saves were recorded as history before the archive froze.
    const donor = await mkdtemp(join(tmpdir(), "showai-purge-donor-"));
    const donorLibrary = new ContentLibrary(donor);
    await donorLibrary.initialize();
    await donorLibrary.writeFiles(new Map([[path, bytes]]), {
      actor: { kind: "human" },
      channel: "desktop",
    });
    const entry = await donorLibrary.entryAt((await donorLibrary.head())!);
    await rm(donor, { recursive: true, force: true });
    await new ContentLibrary(home).initialize();
    await new SqliteLibrary(home).commit(
      { ...entry, parents: [] },
      encodeFile(path, bytes),
      null,
      true,
    );
    await openLibrary(home);
    const workspaceFile = join(home, "workspace", path);
    await mkdir(dirname(workspaceFile), { recursive: true });
    await writeFile(workspaceFile, bytes);
    // The file left current content long ago; only the archived history holds it.
    await new ContentLibrary(home).writeFiles(new Map([[path, null]]), {
      actor: { kind: "human" },
      channel: "desktop",
    });
    const service = new AgentService({ root: home });
    const workbench = createWorkbench(service.store, service, {
      info: () => ({ home, mode: "desktop" }) as unknown as DesktopInfo,
      openDialog: async () => ({ canceled: true, filePaths: [] }),
      saveDialog: async () => ({ canceled: true }),
      invoke: async () => null,
    });
    invoke = (action, args = {}) => workbench(action, args);
    await service.store.createProject({ id: projectId, name: "Archived" });
    await invoke("projects:remove", { projectId });
    const database = join(home, "history", "content.sqlite");
    const archived = () => {
      const db = new DatabaseSync(database);
      try {
        return Number(
          db
            .prepare("SELECT COUNT(*) AS n FROM changes WHERE path=?")
            .get(path)!.n,
        );
      } finally {
        db.close();
      }
    };
    const maintenance = new LibraryMaintenance(home);
    await maintenance.compact();
    expect(archived()).toBe(1);
    const stored = async () =>
      (await new ContentLibrary(home).objectStatistics()).packedBytes;
    const before = await stored();

    await invoke("library:purge", { items: [{ kind: "project", projectId }] });
    await maintenance.compact();
    expect(archived()).toBe(0);
    expect(before - (await stored())).toBeGreaterThan(190_000);
    await new ContentLibrary(home).verify();
  });
});
