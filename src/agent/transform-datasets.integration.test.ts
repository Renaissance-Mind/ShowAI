import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { visitNodes } from "../surface/document.mjs";
import { xlsxWorkbook } from "../test/xlsx";
import type { ShowDocument } from "../core/model";

let root: string;
let outside: string;
let projectId: string;
let client: Client;
let server: ReturnType<typeof createMcpServer>;

async function call(name: string, args: Record<string, unknown> = {}) {
  const value = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
  return value.structuredContent as { ok: boolean; data: any; error?: any };
}
async function ok(name: string, args: Record<string, unknown> = {}) {
  const result = await call(name, args);
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.data;
}

/** A budget workbook whose table does not start at a fixed cell. */
const workbook = (march: number) =>
  xlsxWorkbook([
    { name: "封面", rows: [["2026 年部门预算"]] },
    {
      name: "预算",
      rows: [
        ["部门预算（单位：元）"],
        [],
        [null, "月份", "研发", "市场"],
        [null, "1月", 1200, 300],
        [null, "2月", 800, 500],
        [null, "3月", march, 450],
        [],
        [null, "备注", "含税"],
      ],
    },
  ]);

/** Chart data from three inputs: an Excel budget, a CSV of actuals and a project dataset of targets. */
const script = `function transform({ budget, actuals, targets }, h) {
  const sheet = h.sheet(budget, "预算");
  const header = h.find(sheet, "月份");
  const rows = h.table(sheet, { header: header.row });
  const spent = {};
  for (const row of actuals.rows) spent[row.month] = (spent[row.month] || 0) + row.amount;
  return {
    labels: rows.map((row) => row["月份"]),
    series: [
      { name: "预算", values: rows.map((row) => row["研发"] + row["市场"]) },
      { name: "实际", values: rows.map((row) => spent[row["月份"]] || 0) },
      { name: "目标", values: rows.map(() => targets.monthly) },
    ],
  };
}`;

let budgetPath: string;
let actualsPath: string;
let budgetId: string;
let actualsId: string;
let targetsId: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-transforms-"));
  outside = await mkdtemp(join(tmpdir(), "showai-transform-sources-"));
  await openLibrary(root);
  projectId = (await new AgentService({ root }).createProject("处理脚本")).id;
  server = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "transform-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
  budgetPath = join(outside, "budget.xlsx");
  actualsPath = join(outside, "actuals.csv");
  await writeFile(budgetPath, workbook(900));
  await writeFile(
    actualsPath,
    "id,month,amount\na1,1月,1000\na2,1月,200\na3,2月,1250\n",
  );
  budgetId = (
    await ok("dataset_write", {
      action: "link",
      name: "预算表",
      path: budgetPath,
    })
  ).dataset.id;
  actualsId = (
    await ok("dataset_write", {
      action: "link",
      name: "实际支出",
      path: actualsPath,
    })
  ).dataset.id;
  targetsId = (
    await ok("dataset_write", {
      action: "create",
      name: "目标",
      value: { monthly: 1300 },
    })
  ).dataset.id;
}, 120_000);
afterAll(async () => {
  await client.close();
  await server.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const inputs = () => ({
  budget: budgetId,
  actuals: actualsId,
  targets: targetsId,
});
const chart = {
  labels: ["1月", "2月", "3月"],
  series: [
    { name: "预算", values: [1500, 1300, 1350] },
    { name: "实际", values: [1200, 1250, 0] },
    { name: "目标", values: [1300, 1300, 1300] },
  ],
};

test("a dry run returns the output or the error without saving", async () => {
  const before = await ok("dataset_read", { action: "list" });
  expect(
    await ok("dataset_write", {
      action: "transform",
      dryRun: true,
      inputs: inputs(),
      script,
    }),
  ).toMatchObject({ dryRun: true, ok: true, value: chart });
  const failed = await ok("dataset_write", {
    action: "transform",
    dryRun: true,
    inputs: inputs(),
    script:
      "function transform({ budget }, h) {\n  return h.cell(h.sheet(budget, '利润'), 'A1');\n}",
  });
  expect(failed).toMatchObject({
    dryRun: true,
    ok: false,
    code: "TRANSFORM_FAILED",
    line: 2,
  });
  expect(failed.message).toContain('Sheet "利润" not found');
  expect(await ok("dataset_read", { action: "list" })).toHaveLength(
    before.length,
  );
}, 120_000);

test("a transform over a spreadsheet, a CSV file and project data feeds a chart", async () => {
  const created = await ok("dataset_write", {
    action: "transform",
    name: "月度对比",
    inputs: inputs(),
    script,
  });
  expect(created).toMatchObject({
    created: true,
    record: {
      status: "ok",
      editable: false,
      warnings: [],
      dataset: { value: chart, transform: { inputs: inputs() } },
    },
  });
  const datasetId = created.record.dataset.id;
  const read = await ok("dataset_read", { action: "read", datasetId });
  expect(read.transform).toMatchObject({
    scriptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    inputs: {
      budget: { datasetId: budgetId, status: "ok" },
      actuals: { datasetId: actualsId, status: "ok" },
      targets: { datasetId: targetsId, status: "ok" },
    },
  });
  expect(typeof read.transform.lastRunMs).toBe("number");
  const list = await ok("dataset_read", { action: "list" });
  expect(
    list.find((item: { id: string }) => item.id === datasetId),
  ).toMatchObject({
    status: "ok",
    editable: false,
    transform: { inputs: inputs() },
  });
  const write = await call("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: read.hash,
    operations: [{ op: "set", path: ["labels", 0], value: "一月" }],
  });
  expect(write.error).toMatchObject({
    code: "READ_ONLY",
    details: { warning: { code: "READ_ONLY" } },
  });

  const page = await ok("page_create", {
    title: "月度对比",
    blocks: [
      {
        kind: "chart",
        data: {
          title: "月度对比",
          type: "bar",
          labels: [],
          series: [],
          unit: "元",
        },
      },
    ],
  });
  const pageId = page.document.id;
  let found: any;
  const first = await ok("page_read", { pageId, rendered: false });
  visitNodes((first.document as ShowDocument).content, (node) => {
    if (node.type === "widget" && node.attrs?.kind === "chart") found = node;
  });
  await ok("page_apply", {
    pageId,
    baseHash: first.hash,
    baseRevision: first.revision,
    operations: [
      {
        type: "component.binding.set",
        blockId: found.attrs.id,
        binding: {
          dataset: datasetId,
          props: { local: ["title", "type", "unit"] },
        },
      },
    ],
  });
  const bound = await ok("page_read", { pageId, rendered: false });
  expect(bound.bindings[0]).toMatchObject({
    blockId: found.attrs.id,
    datasetId,
    status: "ok",
    // The chart's own settings stay editable next to the computed values.
    editable: { paths: ["title", "type", "unit"] },
    warnings: [],
    transform: {
      inputs: {
        budget: `${projectId}/${budgetId}`,
        actuals: `${projectId}/${actualsId}`,
        targets: `${projectId}/${targetsId}`,
      },
    },
    props: { title: "月度对比", type: "bar", unit: "元", ...chart },
  });
  // Bound blocks show the output read-only.
  const edit = await call("page_apply", {
    pageId,
    baseHash: bound.hash,
    baseRevision: bound.revision,
    ...(bound.datasetBases ? { datasetBases: bound.datasetBases } : {}),
    operations: [
      {
        type: "component.props.set",
        blockId: found.attrs.id,
        props: { labels: ["x", "y", "z"] },
      },
    ],
  });
  expect(edit.error.code).toBe("READ_ONLY");

  // Changing an input recomputes the output.
  await writeFile(budgetPath, workbook(1000));
  const updated = await ok("dataset_read", { action: "read", datasetId });
  expect(updated.dataset.value.series[0].values).toEqual([1500, 1300, 1450]);
  expect(updated.transform.ranAt).not.toBe(read.transform.ranAt);
}, 240_000);

test("a missing input file marks the output stale; a failing script keeps the last good output", async () => {
  const datasetId = (
    await ok("dataset_write", {
      action: "transform",
      name: "实际合计",
      inputs: { actuals: actualsId },
      script:
        "function transform({ actuals }) {\n  return { total: actuals.rows.reduce((sum, row) => sum + row.amount, 0) };\n}",
    })
  ).record.dataset.id;
  await rm(actualsPath);
  const stale = await ok("dataset_read", { action: "read", datasetId });
  expect(stale).toMatchObject({
    status: "stale",
    editable: false,
    dataset: { value: { total: 2450 } },
    transform: { inputs: { actuals: { status: "stale" } } },
  });
  expect(stale.warnings).toEqual([
    expect.objectContaining({ code: "SOURCE_MISSING", datasetId: actualsId }),
  ]);
  await writeFile(
    actualsPath,
    "id,month,amount\na1,1月,1000\na2,1月,200\na3,2月,1250\n",
  );
  const current = await ok("dataset_read", { action: "read", datasetId });
  expect(current).toMatchObject({ status: "ok", warnings: [] });

  const broken = await ok("dataset_write", {
    action: "transform",
    datasetId,
    baseHash: current.hash,
    script:
      "function transform({ actuals }) {\n  return actuals.rows[99].amount;\n}",
  });
  expect(broken.record).toMatchObject({
    status: "stale",
    dataset: { value: { total: 2450 } },
  });
  expect(broken.record.warnings[0]).toMatchObject({
    code: "TRANSFORM_FAILED",
    datasetId,
    stage: "transform",
    actions: ["ask-agent"],
  });
  expect(broken.record.warnings[0].message).toMatch(
    /TypeError: .*\(line 2\).*last successful run/,
  );
  const invalid = await ok("dataset_write", {
    action: "transform",
    datasetId,
    baseHash: broken.record.hash,
    script: "function transform() {\n  return { when: new Date(0) };\n}",
  });
  expect(invalid.record.warnings[0]).toMatchObject({ code: "OUTPUT_INVALID" });
  expect(invalid.record.dataset.value).toEqual({ total: 2450 });

  // Definitions are versioned with the project; deleting an input is refused while used.
  const refused = await call("dataset_delete", {
    datasetId: actualsId,
    baseHash: current.hash,
  });
  expect(refused.error).toMatchObject({
    code: "CONFLICT",
    details: {
      transforms: expect.arrayContaining([`${projectId}/${datasetId}`]),
    },
  });
}, 240_000);

test("cycles are refused", async () => {
  const first = await ok("dataset_write", {
    action: "transform",
    name: "一",
    inputs: { targets: targetsId },
    script: "function transform({ targets }) { return targets; }",
  });
  const second = await ok("dataset_write", {
    action: "transform",
    name: "二",
    inputs: { first: first.record.dataset.id },
    script: "function transform({ first }) { return first; }",
  });
  const cycle = await call("dataset_write", {
    action: "transform",
    datasetId: first.record.dataset.id,
    baseHash: first.record.hash,
    inputs: { second: second.record.dataset.id },
  });
  expect(cycle.error.code).toBe("INVALID_DATA");
  expect(cycle.error.message).toContain("cycle");
}, 120_000);
