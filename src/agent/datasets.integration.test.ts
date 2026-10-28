import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { componentWidgetData, saveComponent } from "../core/catalog";
import { parseArtifact } from "../portable/validation.mjs";
import { visitNodes } from "../surface/document.mjs";
import type { ShowDocument } from "../core/model";

let root: string;
let projectId: string;
let client: Client;
let server: ReturnType<typeof createMcpServer>;

const task = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    done: { type: "boolean" },
    due: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  },
};
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["areas", "objectives"],
  properties: {
    title: { type: "string" },
    areas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name"],
        properties: { id: { type: "string" }, name: { type: "string" } },
      },
    },
    objectives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "area", "title", "status"],
        properties: {
          id: { type: "string" },
          area: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
          due: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          keyResults: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "title", "status"],
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                status: { type: "string" },
                due: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                tasks: { type: "array", items: task },
              },
            },
          },
        },
      },
    },
  },
};
const plan = {
  title: "全景",
  areas: [{ id: "work", name: "工作" }],
  objectives: [
    {
      id: "o1",
      area: "work",
      title: "发布",
      status: "doing",
      keyResults: [
        {
          id: "k1",
          title: "文档",
          status: "todo",
          due: "2026-10-28",
          tasks: [
            { id: "t1", title: "写指南", due: "2026-10-22" },
            { id: "t2", title: "审稿" },
          ],
        },
      ],
    },
  ],
};
const columns = [
  { id: "title", name: "事项", type: "text" },
  { id: "cat", name: "类别", type: "select", options: ["工作"] },
  { id: "project", name: "项目", type: "text" },
  {
    id: "kind",
    name: "类型",
    type: "select",
    options: ["截止", "会议", "固定日程", "提醒"],
  },
  { id: "date", name: "截止日期", type: "date" },
  { id: "prep", name: "开始准备", type: "date" },
  { id: "done", name: "完成", type: "checkbox" },
  { id: "source", name: "来源与说明", type: "text" },
];
const binding = (dataset: string) => ({
  dataset,
  collections: [
    {
      key: "task",
      into: "rows",
      from: "objectives[*].keyResults[*].tasks[*]",
      where: { field: "due", exists: true },
      fields: {
        title: "title",
        date: { from: "due", empty: "remove" },
        done: "done",
      },
      derived: {
        project: "../../title",
        cat: { lookup: "areas", by: "../../area", field: "name" },
        source: { template: "全景 · {../title}" },
      },
      defaults: { kind: "截止" },
    },
    {
      key: "kr",
      into: "rows",
      from: "objectives[*].keyResults[*]",
      where: { field: "due", exists: true },
      fields: {
        title: "title",
        date: { from: "due", empty: "remove" },
        done: {
          from: "status",
          map: { true: "done", false: "todo" },
          otherwise: false,
        },
      },
      derived: { project: "../title", source: { value: "全景 · 关键目标" } },
      defaults: { kind: "截止" },
    },
  ],
});

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
function widget(document: ShowDocument, kind: string) {
  let found: any;
  visitNodes(document.content, (node) => {
    if (!found && node.type === "widget" && node.attrs?.kind === kind)
      found = node;
  });
  return found;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-datasets-"));
  await openLibrary(root);
  const service = new AgentService({ root });
  projectId = (await service.createProject("个人管理台")).id;
  server = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "datasets-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
}, 120_000);
afterAll(async () => {
  await client?.close();
  await server?.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

test("two pages share one dataset; both write, merge and conflict at the field", async () => {
  const component = await saveComponent(
    root,
    {
      manifest: {
        id: "plan-board",
        name: "Plan board",
        version: "1.0.0",
        description: "Areas, objectives, key results and tasks",
        entry: "index.tsx",
        scenarios: ["Shared data test"],
        defaultData: plan,
        examples: [{ name: "Plan", data: plan }],
      },
      schema,
      source:
        'import React from "react";export default function Board({data}){return <ul>{data.objectives.map(o=><li key={o.id}>{o.title} {o.due}</li>)}</ul>}',
    },
    projectId,
  );
  const overview = await ok("page_create", {
    title: "全景",
    blocks: [{ kind: "custom", data: componentWidgetData(component, plan) }],
  });
  const schedule = await ok("page_create", {
    title: "DDL 与日程",
    blocks: [
      {
        kind: "database",
        data: {
          title: "日程",
          columns,
          rows: [
            {
              id: "m1",
              title: "体检",
              kind: "固定日程",
              date: "2026-10-23",
              done: false,
            },
          ],
          view: "calendar",
        },
      },
    ],
  });
  const board = widget(overview.document, "custom");

  // Share the board's data; the page keeps only the binding and its title.
  const shared = await ok("dataset_write", {
    action: "create",
    name: "OKR",
    fromBlock: {
      pageId: overview.document.id,
      blockId: board.attrs.id,
      baseHash: overview.hash,
      local: ["title"],
    },
  });
  expect(shared.dataset.value.objectives[0].id).toBe("o1");
  expect(shared.dataset.schema.required).toEqual(["areas", "objectives"]);
  const datasetId = shared.dataset.id;
  let overviewRead = await ok("page_read", {
    pageId: overview.document.id,
    rendered: false,
  });
  expect(widget(overviewRead.document, "custom").attrs.data.props).toEqual({
    title: "全景",
  });
  expect(overviewRead.bindings[0]).toMatchObject({ datasetId, name: "OKR" });
  expect(overviewRead.bindings[0].props.objectives).toHaveLength(1);

  // Map dated records of every level into the schedule database.
  let scheduleRead = await ok("page_read", {
    pageId: schedule.document.id,
    rendered: false,
  });
  const database = widget(scheduleRead.document, "database");
  await ok("page_apply", {
    pageId: schedule.document.id,
    baseHash: scheduleRead.hash,
    baseRevision: scheduleRead.revision,
    operations: [
      {
        type: "component.binding.set",
        blockId: database.attrs.id,
        binding: binding(datasetId),
      },
    ],
  });
  scheduleRead = await ok("page_read", {
    pageId: schedule.document.id,
    rendered: false,
  });
  const rows = scheduleRead.bindings[0].props.rows;
  const sourceRead = await ok("page_read", {
    pageId: schedule.document.id,
    rendered: false,
    response: "source",
  });
  expect(sourceRead.bindings[0]).toMatchObject({
    datasetId,
    mapped: { rows: 2 },
    sources: { "task:t1": "objectives[id=o1].keyResults[id=k1].tasks[id=t1]" },
  });
  expect(rows.map((row: { id: string }) => row.id)).toEqual([
    "m1",
    "task:t1",
    "kr:k1",
  ]);
  expect(rows[1]).toMatchObject({
    title: "写指南",
    date: "2026-10-22",
    project: "发布",
    cat: "工作",
    source: "全景 · 文档",
    kind: "截止",
  });

  // Writing a mapped row in the schedule changes the shared record, not the overview page.
  const overviewHash = overviewRead.hash;
  await ok("page_apply", {
    pageId: schedule.document.id,
    baseHash: scheduleRead.hash,
    baseRevision: scheduleRead.revision,
    operations: [
      {
        type: "component.props.set",
        blockId: database.attrs.id,
        props: {
          rows: rows.map((row: Record<string, unknown>) =>
            row.id === "task:t1"
              ? { ...row, date: "2026-10-24", done: true, prep: "2026-10-20" }
              : row.id === "kr:k1"
                ? { ...row, done: true }
                : row,
          ),
        },
      },
    ],
  });
  overviewRead = await ok("page_read", {
    pageId: overview.document.id,
    rendered: false,
  });
  expect(overviewRead.hash).toBe(overviewHash);
  const objective = overviewRead.bindings[0].props.objectives[0];
  expect(objective.keyResults[0].status).toBe("done");
  expect(objective.keyResults[0].tasks[0]).toEqual({
    id: "t1",
    title: "写指南",
    due: "2026-10-24",
    done: true,
  });
  scheduleRead = await ok("page_read", {
    pageId: schedule.document.id,
    rendered: false,
  });
  const stored = widget(scheduleRead.document, "database").attrs.data;
  expect(stored.rows).toEqual([
    {
      id: "m1",
      title: "体检",
      kind: "固定日程",
      date: "2026-10-23",
      done: false,
    },
  ]);
  expect(stored.$binding.overlay).toEqual({
    "task:t1": { prep: "2026-10-20" },
  });

  // Removing a mapped row in the schedule is refused, not silently dropped.
  const refused = await call("page_apply", {
    pageId: schedule.document.id,
    baseHash: scheduleRead.hash,
    baseRevision: scheduleRead.revision,
    operations: [
      {
        type: "component.props.set",
        blockId: database.attrs.id,
        props: { rows: [stored.rows[0]] },
      },
    ],
  });
  expect(refused.ok).toBe(false);
  expect(refused.error.details.rejected).toEqual(
    expect.arrayContaining([{ id: "task:t1", reason: "removed" }]),
  );

  // Two writers from the same read: different fields merge, the same field conflicts.
  const read = await ok("dataset_read", { action: "read", datasetId });
  const path = (id: string, field: string) =>
    `objectives[id=o1].keyResults[id=k1].tasks[id=${id}].${field}`;
  await ok("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: read.hash,
    operations: [{ op: "set", path: path("t2", "due"), value: "2026-10-26" }],
  });
  await ok("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: read.hash,
    operations: [{ op: "set", path: path("t1", "title"), value: "写使用指南" }],
  });
  const conflict = await call("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: read.hash,
    operations: [{ op: "set", path: path("t2", "due"), value: "2026-10-30" }],
  });
  expect(conflict.ok).toBe(false);
  expect(conflict.error.code).toBe("CONFLICT");
  expect(conflict.error.details.conflicts[0]).toMatchObject({
    base: undefined,
    mine: "2026-10-30",
    theirs: "2026-10-26",
  });
  const merged = await ok("dataset_read", {
    action: "read",
    datasetId,
    path: "objectives[id=o1].keyResults[id=k1].tasks",
  });
  expect(merged.value).toEqual([
    { id: "t1", title: "写使用指南", due: "2026-10-24", done: true },
    { id: "t2", title: "审稿", due: "2026-10-26" },
  ]);

  // An export carries a snapshot of the shared data.
  const out = join(root, "exports-test", "schedule.html");
  await ok("page_export", {
    pageId: schedule.document.id,
    format: "html",
    out,
  });
  const artifact = parseArtifact(
    JSON.parse(await readFile(out.replace(/\.html$/, ".showai.json"), "utf8")),
  );
  const exported = widget(artifact.document, "database").attrs.data;
  expect(exported.$binding).toBeUndefined();
  expect(exported.rows.map((row: { id: string }) => row.id)).toEqual([
    "m1",
    "task:t1",
    "task:t2",
    "kr:k1",
  ]);

  // Deleting a used dataset is refused; detaching keeps a copy.
  const removal = await call("dataset_delete", {
    datasetId,
    baseHash: merged.hash,
  });
  expect(removal.ok).toBe(false);
  expect(removal.error.details.references).toHaveLength(2);
  overviewRead = await ok("page_read", {
    pageId: overview.document.id,
    rendered: false,
  });
  await ok("page_apply", {
    pageId: overview.document.id,
    baseHash: overviewRead.hash,
    baseRevision: overviewRead.revision,
    operations: [{ type: "component.binding.remove", blockId: board.attrs.id }],
  });
  overviewRead = await ok("page_read", {
    pageId: overview.document.id,
    rendered: false,
  });
  const detached = widget(overviewRead.document, "custom").attrs.data;
  expect(detached.$binding).toBeUndefined();
  expect(detached.props.title).toBe("全景");
  expect(detached.props.objectives[0].keyResults[0].tasks[1].due).toBe(
    "2026-10-26",
  );

  // An incomplete binding is rejected when the page is saved.
  scheduleRead = await ok("page_read", {
    pageId: schedule.document.id,
    rendered: false,
  });
  const invalid = await call("page_apply", {
    pageId: schedule.document.id,
    baseHash: scheduleRead.hash,
    baseRevision: scheduleRead.revision,
    operations: [
      {
        type: "block.attrs.set",
        blockId: database.attrs.id,
        attrs: {
          data: {
            ...stored,
            $binding: {
              dataset: datasetId,
              collections: [{ key: "x", into: "rows", from: "objectives" }],
            },
          },
        },
      },
    ],
  });
  expect(invalid.ok).toBe(false);
  expect(invalid.error.message).toMatch(/\[\*\]/);

  const capabilities = await ok("showai_capabilities");
  expect(capabilities.datasets).toMatchObject({
    protocol: "showai-datasets-v1",
    available: true,
  });
  const guide = await ok("guide", { topic: "datasets" });
  expect(guide.tools).toContain("dataset_write");
}, 240_000);

test("sharing a database without a local list keeps its views with the block", async () => {
  const views = [
    { id: "all", name: "全部", type: "table" },
    { id: "status", name: "按状态", type: "board", groupBy: "status" },
  ];
  const page = await ok("page_create", {
    title: "论文",
    blocks: [
      {
        kind: "database",
        data: {
          title: "论文",
          columns: [
            { id: "name", name: "论文", type: "text" },
            {
              id: "status",
              name: "状态",
              type: "select",
              options: ["待读", "已读"],
            },
          ],
          rows: [{ id: "p1", name: "BERT", status: "已读" }],
          views,
        },
      },
    ],
  });
  const block = widget(page.document, "database");
  const shared = await ok("dataset_write", {
    action: "create",
    name: "论文记录",
    fromBlock: {
      pageId: page.document.id,
      blockId: block.attrs.id,
      baseHash: page.hash,
    },
  });
  expect(Object.keys(shared.dataset.value).sort()).toEqual(["columns", "rows"]);
  const read = await ok("page_read", {
    pageId: page.document.id,
    rendered: false,
  });
  const data = widget(read.document, "database").attrs.data;
  expect(data.views).toEqual(views);
  expect(data.$binding.props.local).toEqual([
    "title",
    "view",
    "groupBy",
    "calendar",
    "views",
  ]);
}, 120_000);

test("a database bound with props keeps only its local settings, inserted or bound later", async () => {
  const local = ["title", "view", "groupBy", "calendar", "views"];
  const created = await ok("dataset_write", {
    action: "create",
    name: "日程",
    value: {
      columns: [
        { id: "name", name: "名称", type: "text" },
        { id: "due", name: "截止", type: "date" },
      ],
      rows: [{ id: "r1", name: "A", due: "2026-11-01" }],
    },
  });
  expect(created.hash).toEqual(expect.any(String));
  const datasetId = created.dataset.id;
  const page = await ok("page_create", {
    title: "日程视图",
    blocks: [
      {
        kind: "database",
        data: {
          title: "旧",
          columns: [{ id: "x", name: "X", type: "text" }],
          rows: [{ id: "q", x: "own" }],
        },
      },
    ],
  });
  const blockId = widget(page.document, "database").attrs.id;
  const bound = await ok("page_apply", {
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [
      {
        type: "component.binding.set",
        blockId,
        binding: { dataset: datasetId, props: { local } },
      },
    ],
  });
  // binding.set drops the block's own columns and rows.
  expect(widget(bound.document, "database").attrs.data).toEqual({
    title: "旧",
    $binding: { dataset: datasetId, props: { local } },
  });
  const calendar = {
    type: "component.props.set",
    blockId,
    props: { view: "calendar", calendar: { dateColumn: "due" } },
  };
  // Creating the dataset is not a read: even local-only props need its hash.
  const missing = await call("page_apply", {
    pageId: page.document.id,
    baseHash: bound.hash,
    baseRevision: bound.revision,
    operations: [calendar],
  });
  expect(missing.error.code).toBe("MISSING_BASELINE");
  const local1 = await ok("page_apply", {
    pageId: page.document.id,
    baseHash: bound.hash,
    baseRevision: bound.revision,
    datasetBases: { [datasetId]: created.hash },
    operations: [calendar],
  });
  const inserted = await ok("page_apply", {
    pageId: page.document.id,
    baseHash: local1.hash,
    baseRevision: local1.revision,
    operations: [
      {
        type: "component.insert",
        kind: "database",
        data: {
          title: "直接插入",
          view: "calendar",
          calendar: { dateColumn: "due" },
          $binding: { dataset: datasetId, props: { local } },
        },
      },
    ],
  });
  const stale = await call("page_apply", {
    pageId: page.document.id,
    baseHash: inserted.hash,
    baseRevision: inserted.revision,
    operations: [
      {
        type: "component.insert",
        kind: "database",
        data: {
          title: "带副本",
          columns: [{ id: "z", name: "Z", type: "text" }],
          $binding: { dataset: datasetId, props: { local } },
        },
      },
    ],
  });
  expect(stale.error.code).toBe("INVALID_DATA");
  const read = await ok("page_read", {
    pageId: page.document.id,
    rendered: false,
  });
  // A key outside local goes to the dataset; rebinding makes it block-only.
  const rebound = await ok("page_apply", {
    pageId: page.document.id,
    baseHash: read.hash,
    baseRevision: read.revision,
    operations: [
      {
        type: "component.props.set",
        blockId,
        props: { description: "共享说明" },
      },
      {
        type: "component.binding.set",
        blockId,
        binding: { dataset: datasetId, props: { local: ["title"] } },
      },
    ],
  });
  expect(widget(rebound.document, "database").attrs.data).toEqual({
    title: "旧",
    $binding: { dataset: datasetId, props: { local: ["title"] } },
  });
  const value = await ok("dataset_read", { action: "read", datasetId });
  expect(value.dataset.value.description).toBe("共享说明");
  expect(read.bindings).toHaveLength(2);
  for (const binding of read.bindings) {
    expect(binding.issues).toEqual([]);
    expect(binding.props.calendar).toEqual({ dateColumn: "due" });
    expect(binding.props.columns.map((column: any) => column.id)).toEqual([
      "name",
      "due",
    ]);
  }
}, 120_000);
