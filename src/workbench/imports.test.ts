import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { createWorkbench } from "./actions";
import { notionZip } from "../core/importers/test-fixtures";
import type { DesktopInfo } from "../desktop/bridge";

let home: string;
let input: string;
let invoke: (action: string, args?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-workbench-import-"));
  input = await mkdtemp(join(tmpdir(), "showai-workbench-import-input-"));
  await openLibrary(home);
  const service = new AgentService({ root: home });
  const workbench = createWorkbench(service.store, service, {
    info: () => ({ home, mode: "desktop" }) as unknown as DesktopInfo,
    openDialog: async () => ({
      canceled: false,
      filePaths: [join(input, "Export.zip")],
    }),
    saveDialog: async () => ({ canceled: true }),
    invoke: async () => null,
  });
  invoke = (action, args = {}) => workbench(action, args);
});
afterEach(async () => {
  await syncManager(home).stop();
  await rm(home, { recursive: true, force: true });
  await rm(input, { recursive: true, force: true });
});

it("the workbench plans, runs, opens and undoes an import as one request each", async () => {
  await writeFile(join(input, "Export.zip"), notionZip());
  const project = await invoke("projects:create", { name: "Imports" });
  const importers = await invoke("imports:importers", {
    projectId: project.id,
  });
  expect(importers.importers.map((item: { id: string }) => item.id)).toEqual([
    "notion",
    "word",
    "markdown",
  ]);
  const chosen = await invoke("dialog:openPage", { projectId: project.id });
  const plan = await invoke("imports:plan", {
    projectId: project.id,
    parentId: null,
    ...chosen,
  });
  expect(plan.counts.pages).toBe(5);
  expect(await invoke("pages:list", { projectId: project.id })).toEqual([]);
  // The request's own operation id must not make every page a replay of the first.
  const report = await invoke("imports:run", {
    projectId: project.id,
    parentId: null,
    token: plan.token,
    runId: "run-1",
    importer: plan.importer.id,
  });
  expect(report.problems).toEqual([]);
  expect(await invoke("imports:progress", { runId: "run-1" })).toBeNull();
  for (const page of report.pages) {
    const loaded = await invoke("pages:get", {
      projectId: project.id,
      pageId: page.pageId,
    });
    expect(loaded.document.title).toBe(page.title);
  }
  await expect(
    invoke("imports:run", {
      projectId: project.id,
      parentId: null,
      token: plan.token,
      runId: "run-2",
    }),
  ).rejects.toThrow(/expired/);
  for (const folderId of report.undo.folders)
    await invoke("folders:remove", { projectId: project.id, folderId });
  await expect(
    invoke("pages:get", { projectId: project.id, pageId: report.openPageId }),
  ).rejects.toThrow(/deleted/);
});
