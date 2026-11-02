import { afterAll, beforeAll, expect, test } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { REMOTE_FETCH } from "../core/dataset-sources";
import { CAPACITY } from "../portable/capacity.mjs";
import { visitNodes } from "../surface/document.mjs";
import { xlsxWorkbook } from "../test/xlsx";
import { dataServer } from "../test/data-server";
import type { ShowDocument } from "../core/model";
import { parseArtifact } from "../portable/validation.mjs";

let root: string;
let outside: string;
let projectId: string;
const clients: Client[] = [];
const servers: ReturnType<typeof createMcpServer>[] = [];
let client: Client;

async function connect(
  options: Partial<Parameters<typeof createMcpServer>[0]> = {},
) {
  const server = createMcpServer({ root, projectId, ...options });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const connection = new Client({
    name: "external-sources-test",
    version: "1",
  });
  await server.connect(right);
  await connection.connect(left);
  servers.push(server);
  clients.push(connection);
  return connection;
}
async function call(
  name: string,
  args: Record<string, unknown> = {},
  via: Client = client,
) {
  const value = await via.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
  return value.structuredContent as { ok: boolean; data: any; error?: any };
}
async function ok(
  name: string,
  args: Record<string, unknown> = {},
  via: Client = client,
) {
  const result = await call(name, args, via);
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
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** A page with one database block bound to the rows of a dataset. */
async function boundPage(datasetId: string, title: string) {
  const page = await ok("page_create", {
    title,
    blocks: [
      {
        kind: "database",
        data: {
          title,
          columns: [{ id: "title", name: "事项", type: "text" }],
          rows: [],
          view: "table",
        },
      },
    ],
  });
  const read = await ok("page_read", {
    pageId: page.document.id,
    rendered: false,
  });
  const block = widget(read.document, "database");
  await ok("page_apply", {
    pageId: page.document.id,
    baseHash: read.hash,
    baseRevision: read.revision,
    operations: [
      {
        type: "component.binding.set",
        blockId: block.attrs.id,
        binding: {
          dataset: datasetId,
          collections: [
            {
              key: "row",
              into: "rows",
              from: "rows[*]",
              fields: { title: "title" },
            },
          ],
        },
      },
    ],
  });
  return { pageId: page.document.id as string, blockId: block.attrs.id };
}

/** Changes the title of the first mapped row through the bound block. */
async function editBlock(pageId: string, blockId: string) {
  const read = await ok("page_read", { pageId, rendered: false });
  const rows = read.bindings[0].props.rows;
  return call("page_apply", {
    pageId,
    baseHash: read.hash,
    baseRevision: read.revision,
    ...(read.datasetBases ? { datasetBases: read.datasetBases } : {}),
    operations: [
      {
        type: "component.props.set",
        blockId,
        props: {
          rows: rows.map((row: { title: string }, index: number) =>
            index === 0 ? { ...row, title: "改过" } : row,
          ),
        },
      },
    ],
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-external-sources-"));
  outside = await mkdtemp(join(tmpdir(), "showai-external-source-files-"));
  await openLibrary(root);
  const service = new AgentService({ root });
  projectId = (await service.createProject("外部来源")).id;
  client = await connect();
}, 120_000);
afterAll(async () => {
  for (const connection of clients) await connection.close();
  for (const server of servers) await server.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("a spreadsheet links with every sheet and is read-only", async () => {
  const path = join(outside, "budget.xlsx");
  const bytes = xlsxWorkbook([
    {
      name: "预算",
      rows: [
        ["id", "item", "amount"],
        ["b1", "差旅", 1200.5],
      ],
    },
    { name: "Notes", rows: [["含税"]] },
  ]);
  await writeFile(path, bytes);
  const linked = await ok("dataset_write", {
    action: "link",
    name: "预算",
    path,
  });
  expect(linked).toMatchObject({
    status: "ok",
    editable: false,
    warnings: [],
    dataset: {
      source: { kind: "file", format: "xlsx", name: "budget.xlsx" },
      value: {
        sheets: [
          {
            name: "预算",
            rows: [
              ["id", "item", "amount"],
              ["b1", "差旅", 1200.5],
            ],
          },
          { name: "Notes", rows: [["含税"]] },
        ],
      },
    },
  });
  const datasetId = linked.dataset.id;
  const write = await call("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: linked.hash,
    operations: [{ op: "set", path: ["sheets", 0, "name"], value: "x" }],
  });
  expect(write.error).toMatchObject({
    code: "READ_ONLY",
    details: { reason: "READ_ONLY", warning: { code: "READ_ONLY" } },
  });
  expect(await readFile(path)).toEqual(bytes);
  // Renaming changes only the library's description of the data.
  const renamed = await ok("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: linked.hash,
    operations: [],
    name: "预算表",
  });
  expect(renamed.record.dataset.name).toBe("预算表");
  // A dataset is never written into a new spreadsheet.
  const created = await ok("dataset_write", {
    action: "create",
    name: "清单",
    value: { rows: [{ id: "a" }] },
  });
  expect(created).toMatchObject({ status: "ok", editable: true });
  const target = join(outside, "new.xlsx");
  const refused = await call("dataset_write", {
    action: "link",
    datasetId: created.dataset.id,
    path: target,
    use: "dataset",
  });
  expect(refused.error.code).toBe("READ_ONLY");
  expect(await exists(target)).toBe(false);
  const csv = join(outside, "plain.csv");
  await writeFile(csv, "id,title\nr1,一\n");
  expect(
    await ok("dataset_write", { action: "link", name: "表", path: csv }),
  ).toMatchObject({ status: "ok", editable: true });
  const listed = await ok("dataset_read", { action: "list" });
  expect(
    Object.fromEntries(
      listed.map((item: { name: string; editable: unknown }) => [
        item.name,
        item.editable,
      ]),
    ),
  ).toMatchObject({ 预算表: false, 清单: true, 表: true });
}, 240_000);

test("online data refreshes, revalidates and falls back to its last value", async () => {
  let version = 1;
  let mode: "ok" | "error" | "slow" = "ok";
  const body = () =>
    JSON.stringify({
      rows: [
        { id: "m1", title: `第 ${version} 版` },
        { id: "m2", title: "复盘" },
      ],
    });
  const server = await dataServer((request, response) => {
    if (request.url === "/huge.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(Buffer.alloc(CAPACITY.datasetBytes + 1024, 0x20));
      return;
    }
    if (mode === "error") return void response.writeHead(503).end();
    if (mode === "slow") return void setTimeout(() => response.end("{}"), 3000);
    const etag = `"v${version}"`;
    if (request.headers["if-none-match"] === etag)
      return void response.writeHead(304, { etag }).end();
    response
      .writeHead(200, { "content-type": "application/json", etag })
      .end(body());
  });
  try {
    const url = `${server.origin}/data/okr.json`;
    const linked = await ok("dataset_write", {
      action: "link",
      name: "OKR",
      url,
    });
    expect(linked).toMatchObject({
      status: "ok",
      editable: false,
      remote: { url, format: "json" },
      dataset: {
        source: { kind: "url", format: "json", url, name: "okr.json" },
        value: { rows: [{ id: "m1", title: "第 1 版" }, { id: "m2" }] },
      },
    });
    const datasetId = linked.dataset.id;
    // The address is synchronized with the project; the data is not.
    const stored = JSON.parse(await readFile(linked.path, "utf8"));
    expect(stored.source.url).toBe(url);
    expect(stored.value).toBeUndefined();
    expect(server.requests).toHaveLength(1);

    // Within the refresh interval a read uses the last fetch.
    await ok("dataset_read", { action: "read", datasetId });
    expect(server.requests).toHaveLength(1);
    // An explicit refresh revalidates with the ETag.
    const same = await ok("dataset_read", {
      action: "read",
      datasetId,
      refresh: true,
    });
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1].headers["if-none-match"]).toBe('"v1"');
    expect(same.hash).toBe(linked.hash);
    version = 2;
    const changed = await ok("dataset_read", {
      action: "read",
      datasetId,
      refresh: true,
    });
    expect(changed.dataset.value.rows[0].title).toBe("第 2 版");
    expect(changed).toMatchObject({ status: "ok", warnings: [] });

    // Bound blocks show online data and refuse edits.
    const { pageId, blockId } = await boundPage(datasetId, "在线");
    let read = await ok("page_read", { pageId, rendered: false });
    expect(read.bindings[0]).toMatchObject({
      status: "ok",
      // Mapped fields of online data are read-only; the table's own parts are not.
      editable: { paths: ["*", "rows[*]", "!rows[id=row:*].title"] },
      warnings: [],
      source: { kind: "url", url, format: "json", available: true },
    });
    expect(read.datasetBases[datasetId]).toBe(changed.hash);
    expect((await editBlock(pageId, blockId)).error.code).toBe("READ_ONLY");

    // An unreachable source returns the last value read, marked stale.
    mode = "error";
    const stale = await ok("dataset_read", {
      action: "read",
      datasetId,
      refresh: true,
    });
    expect(stale).toMatchObject({
      status: "stale",
      editable: false,
      dataset: { value: { rows: [{ title: "第 2 版" }, {}] } },
      warnings: [
        {
          code: "SOURCE_UNREACHABLE",
          level: "warning",
          stage: "location",
          datasetId,
          actions: ["retry"],
        },
      ],
    });
    expect(stale.warnings[0].message).toMatch(/answered 503/);
    expect(stale.cachedAt).toBe(changed.remote.fetchedAt);
    const timeout = REMOTE_FETCH.timeoutMs;
    REMOTE_FETCH.timeoutMs = 300;
    mode = "slow";
    try {
      const slow = await ok("dataset_read", {
        action: "read",
        datasetId,
        refresh: true,
      });
      expect(slow.status).toBe("stale");
      expect(slow.warnings[0].message).toMatch(/no answer within 0.3 s/);
    } finally {
      REMOTE_FETCH.timeoutMs = timeout;
    }
    mode = "error";
    // Linking needs one successful fetch; nothing is created without it.
    const unreachable = await call("dataset_write", {
      action: "link",
      name: "按需刷新",
      url: `${server.origin}/manual`,
      format: "json",
      refreshSeconds: 0,
    });
    expect(unreachable.error).toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      details: { reason: "SOURCE_UNREACHABLE" },
    });
    // An interval of 0 fetches only on an explicit refresh.
    mode = "ok";
    const manual = await ok("dataset_write", {
      action: "link",
      name: "按需刷新",
      url: `${server.origin}/manual`,
      format: "json",
      refreshSeconds: 0,
    });
    expect(manual.dataset.source.refreshSeconds).toBe(0);
    const requests = server.requests.length;
    await ok("dataset_read", { action: "read", datasetId: manual.dataset.id });
    expect(server.requests).toHaveLength(requests);

    // Stale bindings show the last value but give no base for writes.
    mode = "error";
    await ok("dataset_read", { action: "read", datasetId, refresh: true });
    read = await ok("page_read", { pageId, rendered: false });
    expect(read.bindings[0]).toMatchObject({
      status: "stale",
      editable: { paths: ["*", "rows[*]", "!rows[id=row:*].title"] },
      source: { kind: "url", available: false },
      warnings: [{ code: "SOURCE_UNREACHABLE" }],
    });
    expect(read.bindings[0].props.rows[0].title).toBe("第 2 版");
    expect(read.datasetBases?.[datasetId]).toBeUndefined();

    // Responses beyond the dataset limit are cut off.
    const huge = await call("dataset_write", {
      action: "link",
      name: "太大",
      url: `${server.origin}/huge.json`,
    });
    expect(huge.error).toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      details: { reason: "TOO_LARGE" },
    });
    expect(
      (
        await call("dataset_write", {
          action: "link",
          name: "带密码",
          url: "https://user:secret@example.com/a.json",
        })
      ).error.code,
    ).toBe("INVALID_DATA");

    // Hosted connections link online data but not files.
    mode = "ok";
    const hosted = await connect({ presentation: { transport: "http" } });
    const remote = await ok(
      "dataset_write",
      { action: "link", name: "远程连接", url },
      hosted,
    );
    expect(remote.status).toBe("ok");
    const capabilities = await ok("showai_capabilities", {}, hosted);
    expect(capabilities.datasets.externalFiles.available).toBe(false);
    expect(capabilities.datasets.sources).toMatchObject({
      kinds: ["file", "url"],
      url: { available: true, readOnly: true },
      file: { available: false },
    });
    const filePath = await call(
      "dataset_write",
      { action: "link", name: "文件", path: join(outside, "x.json") },
      hosted,
    );
    expect(filePath.ok).toBe(false);
  } finally {
    await server.close();
  }
}, 240_000);

test("a linked file falls back to its last value, and reports empty without one", async () => {
  const csv = join(outside, "tasks.csv");
  await writeFile(csv, "id,title\nt1,写周报\nt2,订票\n");
  const linked = await ok("dataset_write", {
    action: "link",
    name: "任务",
    path: csv,
  });
  const datasetId = linked.dataset.id;
  const { pageId, blockId } = await boundPage(datasetId, "任务");

  await rm(csv);
  const stale = await ok("dataset_read", { action: "read", datasetId });
  expect(stale).toMatchObject({
    status: "stale",
    editable: false,
    hash: linked.hash,
    external: { path: csv, format: "csv" },
    warnings: [
      {
        code: "SOURCE_MISSING",
        level: "warning",
        stage: "location",
        actions: ["retry", "link-file"],
      },
    ],
  });
  expect(stale.dataset.value.rows).toHaveLength(2);
  // Writes never start from a stale value.
  const write = await call("dataset_write", {
    action: "apply",
    datasetId,
    baseHash: stale.hash,
    operations: [{ op: "set", path: "rows[id=t1].title", value: "x" }],
  });
  expect(write.error.code).toBe("SOURCE_UNAVAILABLE");
  expect((await editBlock(pageId, blockId)).error.code).toBe(
    "SOURCE_UNAVAILABLE",
  );
  expect(await exists(csv)).toBe(false);
  let read = await ok("page_read", { pageId, rendered: false });
  expect(read.bindings[0]).toMatchObject({
    status: "stale",
    // Mapped titles are read-only now; the table's own parts are not.
    editable: { paths: ["*", "rows[*]", "!rows[id=row:*].title"] },
    source: { kind: "file", path: csv, available: false },
    warnings: [{ code: "SOURCE_MISSING" }],
  });
  expect(read.bindings[0].error).toBeUndefined();
  expect(read.bindings[0].props.rows).toHaveLength(2);
  expect(
    (await ok("dataset_read", { action: "list" })).find(
      (item: { id: string }) => item.id === datasetId,
    ),
  ).toMatchObject({ status: "stale", source: { available: false } });

  // Content that no longer parses is reported as such.
  await writeFile(csv, 'id,title\nt1,"未闭合\n');
  expect(
    (await ok("dataset_read", { action: "read", datasetId })).warnings[0],
  ).toMatchObject({ code: "PARSE_FAILED", level: "error", stage: "format" });
  await writeFile(csv, "id,title\nt1,写周报\nt3,新任务\n");
  const restored = await ok("dataset_read", { action: "read", datasetId });
  expect(restored).toMatchObject({
    status: "ok",
    editable: true,
    warnings: [],
  });
  expect(restored.dataset.value.rows[1].id).toBe("t3");

  // A schema the file no longer satisfies: SHAPE_CHANGED.
  const json = join(outside, "shape.json");
  await writeFile(json, JSON.stringify({ rows: [] }));
  const shaped = await ok("dataset_write", {
    action: "link",
    name: "结构",
    path: json,
    schema: {
      type: "object",
      required: ["rows"],
      properties: { rows: { type: "array" } },
    },
  });
  await writeFile(json, JSON.stringify({ items: [] }));
  expect(
    (
      await ok("dataset_read", {
        action: "read",
        datasetId: shaped.dataset.id,
      })
    ).warnings[0],
  ).toMatchObject({ code: "SHAPE_CHANGED", stage: "format" });

  // Without a value read on this device the dataset is empty.
  await rm(csv);
  await rm(
    join(root, "local", "dataset-cache", projectId, `${datasetId}.json`),
  );
  const missing = await call("dataset_read", { action: "read", datasetId });
  expect(missing.error).toMatchObject({
    code: "SOURCE_UNAVAILABLE",
    details: { reason: "SOURCE_MISSING" },
  });
  read = await ok("page_read", { pageId, rendered: false });
  expect(read.bindings[0]).toMatchObject({
    status: "empty",
    editable: false,
    source: { available: false, path: csv },
    warnings: [{ code: "SOURCE_MISSING", level: "error" }],
  });
  expect(read.bindings[0].error).toMatch(/cannot be read/);
  // An export says why the block has no data, naming the file but not its path.
  const out = join(outside, "exports", "empty.html");
  await ok("page_export", { pageId, format: "html", out, externalData: "embed" });
  const artifact = parseArtifact(
    JSON.parse(await readFile(out.replace(/\.html$/, ".showai.json"), "utf8")),
  );
  expect(widget(artifact.document, "database").attrs.data.$dataState).toEqual({
    status: "empty",
    dataset: "任务",
    file: "tasks.csv",
  });
  for (const file of [out, out.replace(/\.html$/, ".showai.json")])
    expect(await readFile(file, "utf8")).not.toContain(outside);
  const listed = (await ok("dataset_read", { action: "list" })).find(
    (item: { id: string }) => item.id === datasetId,
  );
  expect(listed).toMatchObject({
    status: "empty",
    editable: false,
    source: { available: false },
  });
  // A dataset whose source is gone can still be deleted by its listed hash.
  const detached = await ok("page_read", { pageId, rendered: false });
  await ok("page_apply", {
    pageId,
    baseHash: detached.hash,
    baseRevision: detached.revision,
    operations: [{ type: "component.binding.remove", blockId, keep: "local" }],
  });
  await ok("dataset_delete", { datasetId, baseHash: listed.hash });
}, 240_000);
