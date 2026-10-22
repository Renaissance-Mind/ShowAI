import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { createWorkbench } from "./actions";
import type { DeletedEntries } from "../core/deleted-entries";
import type { DesktopInfo } from "../desktop/bridge";
import type { FolderMetadata, PageSummary, ProjectSummary } from "../core/model";

let home: string;
let invoke: (action: string, args?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-deleted-items-"));
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

describe("deleted items", () => {
  it("lists archived projects, folders and pages and restores each one", async () => {
    const kept = await invoke("projects:create", { name: "Kept" });
    const removed = await invoke("projects:create", { name: "Removed" });
    const folder: FolderMetadata = await invoke("folders:create", {
      projectId: kept.id,
      name: "Folder",
    });
    const inside = await invoke("pages:create", {
      projectId: kept.id,
      parentId: folder.id,
      title: "Inside",
    });
    const loose = await invoke("pages:create", {
      projectId: kept.id,
      title: "Loose",
    });
    await invoke("projects:remove", { projectId: removed.id });
    await invoke("folders:remove", { projectId: kept.id, folderId: folder.id });
    await invoke("pages:remove", {
      projectId: kept.id,
      pageId: loose.document.id,
    });

    const deleted: DeletedEntries = await invoke("library:deleted");
    expect(deleted.projects.map((item) => item.name)).toEqual(["Removed"]);
    expect(deleted.folders.map((item) => item.name)).toEqual(["Folder"]);
    // The page inside the deleted folder returns with the folder.
    expect(deleted.pages.map((item) => item.title)).toEqual(["Loose"]);

    await invoke("library:restore", { kind: "project", projectId: removed.id });
    await invoke("library:restore", {
      kind: "folder",
      projectId: kept.id,
      folderId: folder.id,
    });
    await invoke("library:restore", {
      kind: "page",
      projectId: kept.id,
      pageId: loose.document.id,
    });

    const projects: ProjectSummary[] = await invoke("projects:list");
    expect(projects.map((item) => item.name).sort()).toEqual(["Kept", "Removed"]);
    const pages: PageSummary[] = await invoke("pages:list", {
      projectId: kept.id,
    });
    expect(pages.map((item) => item.id).sort()).toEqual(
      [inside.document.id, loose.document.id].sort(),
    );
    expect(await invoke("library:deleted")).toEqual({
      projects: [],
      folders: [],
      pages: [],
    });
  });
});
