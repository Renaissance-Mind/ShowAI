import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, open, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "./open-library";
import { FileStore } from "./store";
import { DatasetStore } from "./datasets";
import { resolveDocumentDatasets } from "./dataset-resolution";
import {
  assertPackagingConfirmed,
  exportPackagingPlan,
  syncPackagingPlan,
  type PackagingPlan,
} from "./packaging";
import {
  bundlePath,
  collectBundles,
  storeBundle,
  storedBundles,
} from "./dataset-bundles";
import { logicalPath } from "./library-runtime";
import { withChangeContext } from "./history-context";
import { AgentService } from "../agent/service";
import { syncManager } from "../sync/manager";
import { localFileRef } from "../portable/local-files.mjs";
import { CAPACITY } from "../portable/capacity.mjs";

let root: string;
let outside: string;
let store: FileStore;
let service: AgentService;
let projectId: string;

const MiB = 1024 * 1024;
const asAgent = <T>(action: () => Promise<T>) =>
  withChangeContext(
    {
      actor: { kind: "agent", harness: "codex", sessionId: "packaging-test" },
      channel: "cli",
      message: "Packaging test",
    },
    action,
  );

/** A file of the given size without writing its bytes (sparse). */
async function sizedFile(path: string, bytes: number) {
  const file = await open(path, "w");
  await file.truncate(bytes);
  await file.close();
}

/** The export plan of a stored page, as the exporter builds it. */
async function planOf(
  pageId: string,
  options: {
    format?: "html" | "inline" | "site" | "json";
    decisions?: Record<string, any>;
    previous?: Record<string, any>;
  } = {},
): Promise<PackagingPlan> {
  const record = await store.readPage(projectId, pageId, { checkpoint: false });
  const resolved = await resolveDocumentDatasets(
    store,
    projectId,
    record.document,
  );
  return exportPackagingPlan(store, {
    projectId,
    pages: [
      {
        pageId,
        document: record.document,
        bindings: resolved.bindings,
        shown: resolved.document,
      },
    ],
    format: options.format ?? "html",
    ...(options.decisions ? { decisions: options.decisions } : {}),
    ...(options.previous ? { previous: options.previous } : {}),
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-packaging-plan-"));
  outside = await mkdtemp(join(tmpdir(), "showai-packaging-plan-files-"));
  await openLibrary(root);
  store = new FileStore(root);
  service = new AgentService({ root });
  projectId = (await service.createProject("打包规划")).id;
}, 120_000);
afterAll(async () => {
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("a transform of a transform of a file counts as data from this device", async () => {
  const csv = join(outside, "rows.csv");
  await writeFile(csv, "id,value\na,1\nb,2\n");
  const datasets = new DatasetStore(store);
  const file = await asAgent(() =>
    datasets.link(projectId, { name: "原始", path: csv }),
  );
  const library = await asAgent(() =>
    datasets.create(projectId, { name: "系数", value: { factor: 3 } }),
  );
  const first = await asAgent(() =>
    datasets.defineTransform(projectId, {
      name: "第一步",
      inputs: { rows: file.dataset.id, k: library.dataset.id },
      script:
        "function transform({ rows, k }) { return { total: rows.rows.reduce((s, r) => s + r.value, 0) * k.factor }; }",
    }),
  );
  const second = await asAgent(() =>
    datasets.defineTransform(projectId, {
      name: "第二步",
      inputs: { step: first.record!.dataset.id },
      script: "function transform({ step }) { return { labels: ['合计'], series: [{ name: '合计', values: [step.total] }] }; }",
    }),
  );
  const page = await asAgent(() =>
    service.createPage(projectId, {
      title: "两级处理",
      blocks: [
        {
          kind: "chart",
          data: {
            title: "合计",
            type: "bar",
            unit: "",
            $binding: {
              dataset: second.record!.dataset.id,
              props: { local: ["title", "type", "unit"] },
            },
          },
        },
      ],
    }),
  );
  const plan = await planOf(page.document.id);
  expect(plan.confirm).toBe(true);
  expect(plan.items).toEqual([
    expect.objectContaining({
      kind: "transform-output",
      name: "第二步",
      local: true,
      choice: "result",
      inputs: [
        expect.objectContaining({
          name: "step",
          kind: "transform",
          available: true,
        }),
      ],
    }),
  ]);
  expect(plan.bytes).toBe(plan.items[0].bytes);
  // A transform of library data only stays ordinary data.
  const plain = await asAgent(() =>
    datasets.defineTransform(projectId, {
      name: "库内处理",
      inputs: { k: library.dataset.id },
      script: "function transform({ k }) { return { labels: [], series: [] }; }",
    }),
  );
  const other = await asAgent(() =>
    service.createPage(projectId, {
      title: "库内",
      blocks: [
        {
          kind: "chart",
          data: {
            title: "",
            type: "bar",
            unit: "",
            $binding: {
              dataset: plain.record!.dataset.id,
              props: { local: ["title", "type", "unit"] },
            },
          },
        },
      ],
    }),
  );
  const ordinary = await planOf(other.document.id);
  expect(ordinary.items[0]).toMatchObject({ local: false });
  expect(ordinary.confirm).toBe(false);
}, 120_000);

test("defaults carry what fits each item and the total; previous choices and decisions apply", async () => {
  const names = ["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4", "big.mp4"];
  for (const name of names.slice(0, 5)) await sizedFile(join(outside, name), 60 * MiB);
  await sizedFile(join(outside, "big.mp4"), CAPACITY.packageItemBytes + 1);
  const page = await asAgent(() =>
    service.createPage(projectId, {
      title: "大文件",
      blocks: names.map((name) => ({
        kind: "video",
        data: { src: localFileRef(join(outside, name)) },
      })),
    }),
  );
  const plan = await planOf(page.document.id);
  const byName = Object.fromEntries(plan.items.map((item) => [item.name, item]));
  // An exported page embeds files up to its resource budget (128 MiB).
  expect(names.map((name) => byName[name].defaultChoice)).toEqual([
    "embed",
    "embed",
    "skip",
    "skip",
    "skip",
    "skip",
  ]);
  expect(byName["big.mp4"]).toMatchObject({
    tooLarge: true,
    choices: ["skip"],
    bytes: CAPACITY.packageItemBytes + 1,
  });
  expect(plan.bytes).toBe(120 * MiB);
  expect(plan.remainingBytes).toBe(136 * MiB);
  expect(plan.overLimit).toBe(false);
  // Synchronization carries copies while one item and the total fit.
  const sync = await syncPackagingPlan(store, projectId);
  expect(
    names.map(
      (name) => sync.items.find((item) => item.name === name)!.defaultChoice,
    ),
  ).toEqual(["bundle", "bundle", "bundle", "bundle", "skip", "skip"]);
  expect(sync.items.find((item) => item.name === "原始")).toMatchObject({
    kind: "file-dataset",
    choice: "bundle",
    path: join(outside, "rows.csv"),
  });
  // A previous choice that still applies replaces the default.
  const previous = await planOf(page.document.id, {
    previous: { [byName["a.mp4"].id]: "skip", [byName["big.mp4"].id]: "embed" },
  });
  expect(previous.items.find((item) => item.name === "a.mp4")!.choice).toBe(
    "skip",
  );
  expect(previous.items.find((item) => item.name === "big.mp4")!.choice).toBe(
    "skip",
  );
  // Decisions are checked against each item's choices.
  await expect(
    planOf(page.document.id, { decisions: { [byName["big.mp4"].id]: "embed" } }),
  ).rejects.toMatchObject({ code: "INVALID_DATA" });
  await expect(
    planOf(page.document.id, { decisions: { "dataset:x/y": "skip" } }),
  ).rejects.toMatchObject({ code: "INVALID_DATA" });
  // Carrying all five goes over the total: the export is refused with the plan.
  const over = await planOf(page.document.id, {
    decisions: Object.fromEntries(
      names.slice(0, 5).map((name) => [byName[name].id, "embed"]),
    ),
  });
  expect(over.overLimit).toBe(true);
  expect(over.remainingBytes).toBe(-44 * MiB);
  expect(() => assertPackagingConfirmed(over, true)).toThrow(
    expect.objectContaining({
      code: "INVALID_DATA",
      details: { packaging: over },
    }),
  );
  expect(() => assertPackagingConfirmed(plan, false)).toThrow(
    expect.objectContaining({ code: "CONFIRMATION_REQUIRED" }),
  );
  expect(() => assertPackagingConfirmed(plan, true)).not.toThrow();
}, 120_000);

test("synchronized copies stay out of history and unreferenced ones are collected", async () => {
  const hash = await storeBundle(root, Buffer.from("orphan copy"));
  const path = bundlePath(root, hash);
  expect(logicalPath(root, path)).toBeUndefined();
  expect(
    logicalPath(root, join(root, "local", "dataset-cache", "p", "d.json")),
  ).toBeUndefined();
  expect(
    logicalPath(root, join(store.projectPath(projectId), "packaging.json")),
  ).toBe(`projects/${projectId}/packaging.json`);
  // A fresh copy survives the grace period; an old one is removed.
  expect(await collectBundles(store)).toEqual([]);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(path, old, old);
  expect(await collectBundles(store)).toEqual([hash]);
  expect((await storedBundles(root)).map((item) => item.hash)).not.toContain(
    hash,
  );
}, 120_000);
