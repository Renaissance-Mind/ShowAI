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
import { parseArtifact } from "../portable/validation.mjs";
import { visitNodes } from "../surface/document.mjs";
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

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-external-datasets-"));
  outside = await mkdtemp(join(tmpdir(), "showai-external-files-"));
  await openLibrary(root);
  const service = new AgentService({ root });
  projectId = (await service.createProject("外部数据")).id;
  server = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "external-datasets-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
}, 120_000);
afterAll(async () => {
  await client?.close();
  await server?.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("a dataset reads and writes a CSV file outside the library", async () => {
  const csv = join(outside, "schedule.csv");
  await writeFile(
    csv,
    'id,title,date,done\r\nm1,体检,2026-10-23,false\r\nm2,"复盘, 周会",2026-10-24,false\r\n',
  );
  const linked = await ok("dataset_link", { name: "日程", path: csv });
  expect(linked).toMatchObject({ created: true, wroteFile: false });
  expect(linked.external).toMatchObject({ path: csv, format: "csv" });
  expect(linked.dataset.source).toEqual({
    kind: "file",
    format: "csv",
    name: "schedule.csv",
  });
  expect(linked.dataset.value.rows[1]).toEqual({
    id: "m2",
    title: "复盘, 周会",
    date: "2026-10-24",
    done: false,
  });
  const datasetId = linked.dataset.id;
  // The library keeps the description and source, not the data or the path.
  const stored = JSON.parse(await readFile(linked.path, "utf8"));
  expect(stored.value).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain(outside);

  const page = await ok("page_create", {
    title: "日程",
    blocks: [
      {
        kind: "database",
        data: {
          title: "日程",
          columns: [
            { id: "title", name: "事项", type: "text" },
            { id: "date", name: "日期", type: "date" },
            { id: "done", name: "完成", type: "checkbox" },
          ],
          rows: [],
          view: "table",
        },
      },
    ],
  });
  let read = await ok("page_read", {
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
              fields: { title: "title", date: "date", done: "done" },
            },
          ],
        },
      },
    ],
  });
  read = await ok("page_read", { pageId: page.document.id, rendered: false });
  expect(read.bindings[0]).toMatchObject({
    datasetId,
    source: { format: "csv", path: csv, available: true },
  });
  const rows = read.bindings[0].props.rows;
  expect(rows.map((row: { id: string }) => row.id)).toEqual([
    "row:m1",
    "row:m2",
  ]);

  // Editing the block writes the file, keeping its line endings and quoting.
  await ok("page_apply", {
    pageId: page.document.id,
    baseHash: read.hash,
    baseRevision: read.revision,
    operations: [
      {
        type: "component.props.set",
        blockId: block.attrs.id,
        props: {
          rows: rows.map((row: { id: string }) =>
            row.id === "row:m1" ? { ...row, done: true } : row,
          ),
        },
      },
    ],
  });
  expect(await readFile(csv, "utf8")).toBe(
    'id,title,date,done\r\nm1,体检,2026-10-23,true\r\nm2,"复盘, 周会",2026-10-24,false\r\n',
  );

  // A change made elsewhere is read next time and merges with a stale write.
  const before = await ok("dataset_read", { datasetId });
  await new Promise((done) => setTimeout(done, 20));
  await writeFile(
    csv,
    'id,title,date,done\r\nm1,体检,2026-10-23,true\r\nm2,"复盘, 周会",2026-10-24,false\r\nm3,出差,2026-10-29,false\r\n',
  );
  const after = await ok("dataset_read", { datasetId });
  expect(after.hash).not.toBe(before.hash);
  expect(after.dataset.value.rows).toHaveLength(3);
  await ok("dataset_apply", {
    datasetId,
    baseHash: before.hash,
    operations: [{ op: "set", path: "rows[id=m2].date", value: "2026-10-25" }],
  });
  expect((await readFile(csv, "utf8")).split("\r\n")).toEqual([
    "id,title,date,done",
    "m1,体检,2026-10-23,true",
    'm2,"复盘, 周会",2026-10-25,false',
    "m3,出差,2026-10-29,false",
    "",
  ]);
  const rejected = await call("dataset_apply", {
    datasetId,
    baseHash: (await ok("dataset_read", { datasetId })).hash,
    operations: [{ op: "set", path: "rows[id=m3].title", value: { x: 1 } }],
  });
  expect(rejected.error.code).toBe("INVALID_DATA");

  // An export asks before embedding the external data, then carries it.
  const out = join(outside, "exports", "schedule.html");
  const confirm = await call("page_export", {
    pageId: page.document.id,
    format: "html",
    out,
  });
  expect(confirm.ok).toBe(false);
  expect(confirm.error.code).toBe("CONFIRMATION_REQUIRED");
  const report = confirm.error.details.externalSnapshots;
  expect(report.datasets).toHaveLength(1);
  expect(report.datasets[0]).toMatchObject({
    datasetId,
    name: "日程",
    path: csv,
    available: true,
    blocks: [{ pageId: page.document.id, blockId: block.attrs.id }],
  });
  expect(report.datasets[0].snapshotBytes).toBeGreaterThan(100);
  expect(report.snapshotBytes).toBe(report.datasets[0].snapshotBytes);
  expect(await exists(out)).toBe(false);
  const exported = await ok("page_export", {
    pageId: page.document.id,
    format: "html",
    out,
    externalData: "embed",
  });
  expect(exported.externalSnapshots.snapshotBytes).toBe(report.snapshotBytes);
  const artifact = parseArtifact(
    JSON.parse(await readFile(out.replace(/\.html$/, ".showai.json"), "utf8")),
  );
  expect(widget(artifact.document, "database").attrs.data.rows).toHaveLength(3);

  // Another device has no link: the dataset reports it instead of failing everywhere.
  await writeFile(
    join(root, "local", "dataset-sources.json"),
    JSON.stringify({ format: "showai-dataset-sources", version: 1, links: {} }),
  );
  const unlinked = await call("dataset_read", { datasetId });
  expect(unlinked.error.code).toBe("SOURCE_UNAVAILABLE");
  expect(unlinked.error.details.source).toMatchObject({
    format: "csv",
    name: "schedule.csv",
  });
  const listed = await ok("dataset_list");
  expect(listed[0].source).toMatchObject({ available: false });
  read = await ok("page_read", { pageId: page.document.id, rendered: false });
  expect(read.bindings[0].source).toMatchObject({ available: false });
  const unavailable = await call("page_export", {
    pageId: page.document.id,
    format: "html",
    out: join(outside, "exports", "other.html"),
  });
  expect(unavailable.error.details.externalSnapshots.datasets[0]).toMatchObject(
    { available: false, snapshotBytes: 0 },
  );
  const json = join(outside, "wrong.json");
  await writeFile(json, "{}");
  expect(
    (await call("dataset_link", { datasetId, path: json })).error.message,
  ).toMatch(/reads a csv file/);
  await ok("dataset_link", { datasetId, path: csv });
  expect(
    (await ok("dataset_read", { datasetId })).dataset.value.rows,
  ).toHaveLength(3);

  // Linking a file inside the library is refused.
  const inside = await call("dataset_link", {
    name: "x",
    path: join(root, "x.json"),
  });
  expect(inside.error.code).toBe("INVALID_PATH");

  // Deleting the dataset keeps the file.
  const detach = await ok("page_read", {
    pageId: page.document.id,
    rendered: false,
  });
  await ok("page_apply", {
    pageId: page.document.id,
    baseHash: detach.hash,
    baseRevision: detach.revision,
    operations: [{ type: "component.binding.remove", blockId: block.attrs.id }],
  });
  await ok("dataset_delete", {
    datasetId,
    baseHash: (await ok("dataset_read", { datasetId })).hash,
  });
  expect(await exists(csv)).toBe(true);
  expect(
    JSON.parse(
      await readFile(join(root, "local", "dataset-sources.json"), "utf8"),
    ).links,
  ).toEqual({});
}, 240_000);

test("library data moves into a new JSON file and back", async () => {
  const created = await ok("dataset_create", {
    name: "指标",
    value: { title: "指标", items: [{ id: "a", value: 1 }] },
  });
  const datasetId = created.dataset.id;
  const path = join(outside, "metrics.json");
  await writeFile(path, "{}");
  // Both hold data: linking an existing file needs an explicit choice.
  const ambiguous = await call("dataset_link", { datasetId, path });
  expect(ambiguous.error.code).toBe("CONFLICT");
  // An existing file is never overwritten.
  const overwrite = await call("dataset_link", {
    datasetId,
    path,
    use: "dataset",
  });
  expect(overwrite.error.code).toBe("CONFLICT");
  await rm(path);
  const moved = await ok("dataset_link", { datasetId, path });
  expect(moved).toMatchObject({ created: false, wroteFile: true });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(
    created.dataset.value,
  );
  // The file's own layout is kept by later writes.
  await writeFile(
    path,
    '{\n    "title": "指标",\n    "items": [\n        {\n            "id": "a",\n            "value": 1\n        }\n    ]\n}\n',
  );
  const current = await ok("dataset_read", { datasetId });
  await ok("dataset_apply", {
    datasetId,
    baseHash: current.hash,
    operations: [{ op: "set", path: "items[id=a].value", value: 2 }],
    name: "指标（外部）",
  });
  expect(await readFile(path, "utf8")).toBe(
    '{\n    "title": "指标",\n    "items": [\n        {\n            "id": "a",\n            "value": 2\n        }\n    ]\n}\n',
  );
  const listed = (await ok("dataset_list")).find(
    (item: { id: string }) => item.id === datasetId,
  );
  expect(listed).toMatchObject({
    name: "指标（外部）",
    source: { format: "json", path, available: true },
  });

  // Copying back into the library stops using the file and keeps it.
  const embedded = await ok("dataset_link", { datasetId, path: null });
  expect(embedded.dataset.source).toBeUndefined();
  expect(embedded.dataset.value.items[0].value).toBe(2);
  await writeFile(path, '{"title":"changed later"}');
  expect(
    (await ok("dataset_read", { datasetId })).dataset.value.items[0].value,
  ).toBe(2);
  const capabilities = await ok("showai_capabilities");
  expect(capabilities.datasets.tools).toContain("dataset_link");
  expect(capabilities.datasets.externalFiles).toMatchObject({
    available: true,
    exportConfirmation: { parameter: "externalData", value: "embed" },
  });
}, 240_000);
