import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { DatasetStore } from "../core/datasets";
import type { PackagingPlan } from "../core/packaging";
import { createWorkbench } from "./actions";
import type { DesktopInfo } from "../host/protocol";
import {
  PACKAGING_EVENT,
  datasetPackagingItem,
  requestPackaging,
  type PackagingRequest,
} from "../datasets/packaging-request";
import { warningEntries } from "../datasets/warning-entries";
import { datasetWarning } from "../datasets/warnings.mjs";
import { PackagingDialog } from "../studio/PackagingDialog";
import { setLocale } from "../i18n";

let home: string;
let files: string;
let service: AgentService;
let invoke: (action: string, args?: Record<string, unknown>) => Promise<any>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-sync-packaging-"));
  files = await mkdtemp(join(tmpdir(), "showai-sync-packaging-files-"));
  await openLibrary(home);
  service = new AgentService({ root: home });
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
  await rm(files, { recursive: true, force: true });
});

async function linkedDataset() {
  const project = await service.store.createProject({ name: "预算" });
  const csv = join(files, "budget.csv");
  await writeFile(csv, "id,amount\na,1\nb,2\n");
  const record = await invoke("datasets:link", {
    projectId: project.id,
    name: "预算表",
    path: csv,
  });
  return { projectId: project.id, datasetId: record.dataset.id as string, csv };
}

describe("a linked file's synchronization choice", () => {
  it("is one item of the project's packaging plan, with its size and the limits", async () => {
    const { projectId, datasetId } = await linkedDataset();
    const plan: PackagingPlan = await invoke("packaging:sync", { projectId });
    const item = plan.items.find(
      (entry) => entry.id === datasetPackagingItem(projectId, datasetId),
    );
    expect(item).toMatchObject({
      kind: "file-dataset",
      datasetId,
      bytes: 18,
      choice: "bundle",
      choices: ["bundle", "skip"],
    });
    expect(plan.limits.itemBytes).toBe(64 * 1024 * 1024);
    expect(plan.limits.totalBytes).toBe(256 * 1024 * 1024);
    expect(plan.bytes).toBe(18);
  });

  it("toggles source.bundle.sync through the action layer the dataset dialog uses", async () => {
    const { projectId, datasetId } = await linkedDataset();
    const itemId = datasetPackagingItem(projectId, datasetId);
    const off: PackagingPlan = await invoke("packaging:sync", {
      projectId,
      packaging: { [itemId]: "skip" },
    });
    expect(off.items.find((item) => item.id === itemId)?.choice).toBe("skip");
    expect(off.bytes).toBe(0);
    const datasets = new DatasetStore(service.store);
    const bundle = async () => {
      const source = (await datasets.definition(projectId, datasetId)).source;
      return source?.kind === "file" ? source.bundle : undefined;
    };
    expect(await bundle()).toEqual({ sync: false });
    const on: PackagingPlan = await invoke("packaging:sync", {
      projectId,
      packaging: { [itemId]: "bundle" },
    });
    expect(on.items.find((item) => item.id === itemId)?.choice).toBe("bundle");
    expect(await bundle()).toMatchObject({ sync: true, bytes: 18 });
  });

  it("offers only leaving a file out when this device cannot read it", async () => {
    const { projectId, datasetId, csv } = await linkedDataset();
    const itemId = datasetPackagingItem(projectId, datasetId);
    await invoke("packaging:sync", {
      projectId,
      packaging: { [itemId]: "skip" },
    });
    await rm(csv);
    const plan: PackagingPlan = await invoke("packaging:sync", { projectId });
    expect(plan.items.find((item) => item.id === itemId)).toMatchObject({
      available: false,
      choices: ["skip"],
    });
    await expect(
      invoke("packaging:sync", {
        projectId,
        packaging: { [itemId]: "bundle" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
  });
});

describe("the packaging action of a bound block", () => {
  const original = (globalThis as { window?: unknown }).window;
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = new EventTarget();
  });
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it("goes to the workbench when it takes the request, else stays with the block", () => {
    expect(requestPackaging("p1", "d1")).toBe(false);
    const received: PackagingRequest[] = [];
    const take = (event: Event) => {
      received.push((event as CustomEvent<PackagingRequest>).detail);
      event.preventDefault();
    };
    window.addEventListener(PACKAGING_EVENT, take);
    expect(requestPackaging("p1", "d1")).toBe(true);
    window.removeEventListener(PACKAGING_EVENT, take);
    expect(received).toEqual([
      { projectId: "p1", datasetId: "d1", itemId: "dataset:p1/d1" },
    ]);
  });

  it("is offered for the block's own linked file only", () => {
    const t = (key: string) => key;
    const entries = warningEntries(
      {
        datasetId: "budget",
        name: "预算",
        names: { actuals: "实际" },
        status: "stale",
        warnings: [
          datasetWarning("TOO_LARGE", "budget", "budget.csv is too large"),
          datasetWarning("TOO_LARGE", "actuals", "actuals.csv is too large"),
        ],
        datasetEditable: false,
        blockEditable: false,
        pageEditable: true,
        issues: [],
        available: { packaging: true },
      },
      t,
    );
    expect(
      entries.map((entry) => [entry.datasetId, entry.actions]),
    ).toEqual([
      ["budget", ["packaging"]],
      ["actuals", []],
    ]);
    const unavailable = warningEntries(
      {
        datasetId: "budget",
        names: {},
        status: "stale",
        warnings: [datasetWarning("TOO_LARGE", "budget", "too large")],
        datasetEditable: false,
        blockEditable: false,
        pageEditable: true,
        issues: [],
        available: { packaging: false },
      },
      t,
    );
    expect(unavailable[0].actions).toEqual([]);
  });
});

describe("the packaging list", () => {
  it("marks the item it was opened for", async () => {
    setLocale("zh-CN");
    const { projectId, datasetId } = await linkedDataset();
    const plan: PackagingPlan = await invoke("packaging:sync", { projectId });
    const html = renderToStaticMarkup(
      createElement(PackagingDialog, {
        plan,
        purpose: "sync",
        focus: datasetPackagingItem(projectId, datasetId),
        onDecide: () => {},
      }),
    );
    expect(html).toMatch(/<li class="is-focused">[\s\S]*预算表/);
  });
});
