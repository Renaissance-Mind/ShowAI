import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { createLibraryMcpServer } from "./mcp-library";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { componentWidgetData, saveComponent } from "../core/catalog";
import { visitNodes } from "../surface/document.mjs";
import type { ShowDocument } from "../core/model";

/**
 * Agent-facing input and output paths found in real use: upgrading a
 * component revision in place, large inputs from files, reads and diffs to
 * files, record-level diffs, earlier tool shapes and dataset baselines.
 */

let root: string;
let files: string;
let projectId: string;
const open: { client: Client; server: { close(): Promise<void> } }[] = [];

async function connect(
  server: ReturnType<typeof createMcpServer>,
  name = "agent-io-test",
) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name, version: "1" });
  await server.connect(right);
  await client.connect(left);
  open.push({ client, server });
  return client;
}
const local = () => connect(createMcpServer({ root, projectId }));
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const value = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
  return value as {
    isError?: boolean;
    content: { type: string; text?: string; data?: string }[];
    structuredContent: { ok: boolean; data: any; error?: any; migration?: any };
  };
}
async function ok(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await call(client, name, args);
  expect(result.structuredContent.ok, JSON.stringify(result.content)).toBe(
    true,
  );
  return result.structuredContent.data;
}
async function failed(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await call(client, name, args);
  expect(result.isError, JSON.stringify(result.content)).toBe(true);
  return result.structuredContent.error;
}
function custom(document: ShowDocument) {
  let found: any;
  visitNodes(document.content, (node) => {
    if (!found && node.type === "widget" && node.attrs?.kind === "custom")
      found = node;
  });
  return found;
}

const icon = `data:image/png;base64,${"iVBORw0KGgo".repeat(400)}`;
const item = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    icon: { type: "string" },
  },
};
const schema = (
  extra: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "object",
  additionalProperties: false,
  required: ["items", ...required],
  properties: {
    title: { type: "string" },
    items: { type: "array", items: item },
    ...extra,
  },
});
const props = {
  title: "Board",
  items: [
    { id: "a", title: "Alpha", icon },
    { id: "b", title: "Beta", icon },
  ],
};
const revision = (
  version: string,
  propsSchema: Record<string, unknown>,
  defaultData: Record<string, unknown> = { items: [] },
) =>
  saveComponent(
    root,
    {
      manifest: {
        id: "ref-board",
        name: "Ref board",
        version,
        description: "Items with icons",
        entry: "index.tsx",
        scenarios: ["Revision upgrade test"],
        defaultData,
        examples: [],
      },
      schema: propsSchema as never,
      source:
        'import React from "react";export default function Board({data}){return <ul>{data.items.map(i=><li key={i.id}>{i.title}</li>)}</ul>}',
    },
    projectId,
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-agent-io-"));
  files = `${root}-files`;
  await mkdir(files, { recursive: true });
  await openLibrary(root);
  projectId = (await new AgentService({ root }).createProject("Agent IO")).id;
}, 120_000);
afterAll(async () => {
  for (const item of open) {
    await item.client.close();
    await item.server.close();
  }
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(files, { recursive: true, force: true });
});

test("component.ref.set upgrades blocks in place, checks props and follows datasets", async () => {
  const v1 = await revision("1.0.0", schema());
  const v2 = await revision("2.0.0", schema({ note: { type: "string" } }));
  const v3 = await revision(
    "3.0.0",
    schema({ owner: { type: "string" } }, ["owner"]),
    { items: [], owner: "me" },
  );
  const client = await local();
  const page = await ok(client, "page_create", {
    title: "Upgrade",
    blocks: [{ kind: "custom", data: componentWidgetData(v1, props) }],
  });
  const block = custom(page.document);
  const upgraded = await ok(client, "page_apply", {
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [
      {
        type: "component.ref.set",
        blockId: block.attrs.id,
        version: v2.version,
        integrity: v2.integrity,
      },
    ],
    response: "source",
  });
  const after = custom(upgraded.document);
  expect(after.attrs.id).toBe(block.attrs.id);
  expect(after.attrs.data).toMatchObject({
    componentId: "ref-board",
    version: "2.0.0",
    integrity: v2.integrity,
    props,
  });

  // An incompatible revision names the field and saves nothing.
  const rejected = await failed(client, "page_apply", {
    pageId: page.document.id,
    baseHash: upgraded.hash,
    baseRevision: upgraded.revision,
    operations: [
      {
        type: "component.ref.set",
        blockId: block.attrs.id,
        version: v3.version,
        integrity: v3.integrity,
      },
    ],
  });
  expect(rejected.code).toBe("INVALID_DATA");
  expect(rejected.details.blocks[0]).toMatchObject({
    blockId: block.attrs.id,
    version: "3.0.0",
    issues: [{ path: "/owner", kind: "schema" }],
  });
  expect(
    (
      await ok(client, "page_read", {
        pageId: page.document.id,
        response: "receipt",
      })
    ).hash,
  ).toBe(upgraded.hash);
  const wrong = await failed(client, "page_apply", {
    pageId: page.document.id,
    baseHash: upgraded.hash,
    baseRevision: upgraded.revision,
    operations: [
      {
        type: "component.ref.set",
        blockId: block.attrs.id,
        version: "2.0.0",
        integrity: "sha256-not-this-one",
      },
    ],
  });
  expect(wrong.message).toContain("component.ref.set");

  // References are grouped per page for batch upgrades.
  const refs = await ok(client, "catalog_references", {
    kind: "component",
    id: "ref-board",
    version: "2.0.0",
  });
  expect(refs.pages).toEqual([
    expect.objectContaining({
      pageId: page.document.id,
      blockIds: [block.attrs.id],
    }),
  ]);
  expect(refs.next).toContain("component.ref.set");

  // A props dataset derived from the old revision follows the block.
  const shared = await ok(client, "dataset_write", {
    action: "create",
    name: "Items",
    fromBlock: {
      pageId: page.document.id,
      blockId: block.attrs.id,
      baseHash: upgraded.hash,
      local: ["title"],
    },
  });
  expect(Object.keys(shared.dataset.schema.properties)).toEqual([
    "items",
    "note",
  ]);
  const v4 = await revision(
    "4.0.0",
    schema({ note: { type: "string" }, tags: { type: "array" } }),
  );
  // A second page shows the same data through another block.
  const other = await ok(client, "page_create", {
    title: "Mirror",
    blocks: [{ kind: "custom", data: componentWidgetData(v2, { items: [] }) }],
  });
  const mirror = custom(other.document);
  await ok(client, "page_apply", {
    pageId: other.document.id,
    baseHash: other.hash,
    baseRevision: other.revision,
    operations: [
      {
        type: "component.binding.set",
        blockId: mirror.attrs.id,
        binding: { dataset: shared.dataset.id, props: { local: ["title"] } },
      },
    ],
  });
  const bound = await ok(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
    response: "source",
  });
  expect(bound.datasetBases).toEqual({ [shared.dataset.id]: shared.hash });
  const moved = await ok(client, "page_apply", {
    pageId: page.document.id,
    baseHash: bound.hash,
    baseRevision: bound.revision,
    operations: [
      {
        type: "component.ref.set",
        blockId: block.attrs.id,
        version: v4.version,
        integrity: v4.integrity,
      },
    ],
    response: "receipt",
  });
  expect(moved.datasetSchemas).toEqual([
    {
      datasetId: shared.dataset.id,
      schema: "updated",
      from: "ref-board@2.0.0",
      to: "ref-board@4.0.0",
    },
  ]);
  expect(moved.warnings).toEqual([
    expect.objectContaining({
      code: "DATASET_SHARED",
      datasetId: shared.dataset.id,
      references: [
        expect.objectContaining({
          pageId: other.document.id,
          blockIds: [mirror.attrs.id],
        }),
      ],
    }),
  ]);
  const dataset = await ok(client, "dataset_read", {
    action: "read",
    datasetId: shared.dataset.id,
  });
  expect(Object.keys(dataset.dataset.schema.properties)).toEqual([
    "items",
    "note",
    "tags",
  ]);
  // Bound blocks are checked with the props resolved from their dataset.
  const boundRejected = await failed(client, "page_apply", {
    pageId: page.document.id,
    baseHash: moved.hash,
    baseRevision: moved.revision,
    operations: [
      {
        type: "component.ref.set",
        blockId: block.attrs.id,
        version: v3.version,
        integrity: v3.integrity,
      },
    ],
  });
  expect(boundRejected.message).toContain("resolved from its dataset");
  expect(boundRejected.details.blocks[0].bound).toBe(true);
});

test("large inputs come from local JSON files with precise errors", async () => {
  const client = await local();
  const page = await ok(client, "page_create", { title: "Files" });
  const operations = join(files, "operations.json");
  await writeFile(
    operations,
    JSON.stringify([
      {
        type: "component.insert",
        kind: "text",
        data: { format: "markdown", content: "From a file" },
      },
    ]),
  );
  const applied = await ok(client, "page_apply", {
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operationsFile: operations,
    response: "source",
  });
  expect(JSON.stringify(applied.document)).toContain("From a file");

  const broken = join(files, "broken.json");
  await writeFile(broken, '[\n  {"type": "page.set",\n  "fields": }\n]');
  const syntax = await failed(client, "page_apply", {
    pageId: page.document.id,
    baseHash: applied.hash,
    operationsFile: broken,
  });
  expect(syntax.code).toBe("INVALID_DATA");
  expect(syntax.message).toContain(broken);
  expect(syntax.details).toMatchObject({ line: 3, column: 13 });
  expect(
    (
      await failed(client, "page_apply", {
        pageId: page.document.id,
        baseHash: applied.hash,
        operationsFile: "relative/operations.json",
      })
    ).code,
  ).toBe("INVALID_PATH");
  expect(
    (
      await failed(client, "page_apply", {
        pageId: page.document.id,
        baseHash: applied.hash,
        operations: [],
        operationsFile: operations,
      })
    ).message,
  ).toContain("not both");
  const notList = join(files, "object.json");
  await writeFile(notList, '{"operations": []}');
  expect(
    (
      await failed(client, "page_apply", {
        pageId: page.document.id,
        baseHash: applied.hash,
        operationsFile: notList,
      })
    ).message,
  ).toContain("must be an array");

  // Dataset values and operations.
  const value = join(files, "value.json");
  await writeFile(
    value,
    JSON.stringify({ rows: [{ id: "r1", title: "One" }] }),
  );
  const created = await ok(client, "dataset_write", {
    action: "create",
    name: "From file",
    valueFile: value,
  });
  expect(created.dataset.value.rows[0].title).toBe("One");
  const ops = join(files, "dataset-ops.json");
  await writeFile(
    ops,
    JSON.stringify([{ op: "set", path: "rows[id=r1].title", value: "Uno" }]),
  );
  const changed = await ok(client, "dataset_write", {
    action: "apply",
    datasetId: created.dataset.id,
    baseHash: created.hash,
    operationsFile: ops,
  });
  expect(changed.record.dataset.value.rows[0].title).toBe("Uno");
});

test("component_save reads a package directory with the same contract", async () => {
  const client = await local();
  const directory = join(files, "legacy-package");
  await mkdir(directory, { recursive: true });
  const manifest = {
    id: "dir-note",
    name: "Directory note",
    version: "1.0.0",
    description: "A note",
    entry: "index.tsx",
    scenarios: ["Directory import"],
    defaultData: { text: "Hi" },
    examples: [{ name: "Hi", data: { text: "Hi" } }],
  };
  await writeFile(
    join(directory, "manifest.json"),
    '{\n  "id": "dir-note",\n  oops\n}',
  );
  await writeFile(
    join(directory, "props.schema.json"),
    JSON.stringify({
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: { text: { type: "string" } },
    }),
  );
  await writeFile(
    join(directory, "index.tsx"),
    'import React from "react";export default function Note({data}){return <p>{data.text}</p>}',
  );
  const syntax = await failed(client, "component_save", { directory });
  expect(syntax.message).toContain("manifest.json");
  expect(syntax.details).toMatchObject({ line: 3, column: 3 });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  const undocumented = await failed(client, "component_save", { directory });
  expect(undocumented.message).toContain("manifest.documentation");
  expect(undocumented.message).toContain("legacy:true");
  const saved = await ok(client, "component_save", { directory, legacy: true });
  expect(saved).toMatchObject({ id: "dir-note", version: "1.0.0" });
  // The package round-trips through a folder for editing.
  const exported = join(files, "exported-package");
  const written = await ok(client, "catalog_describe", {
    id: "dir-note",
    scope: "project",
    view: "source",
    out: exported,
  });
  expect(written.out).toMatchObject({ path: exported, files: 3 });
  expect(written.source).toBeUndefined();
  const copy = JSON.parse(
    await readFile(join(exported, "manifest.json"), "utf8"),
  );
  await writeFile(
    join(exported, "manifest.json"),
    JSON.stringify({ ...copy, version: "1.1.0" }),
  );
  expect(
    await ok(client, "component_save", { directory: exported, legacy: true }),
  ).toMatchObject({ id: "dir-note", version: "1.1.0" });
  expect(
    (
      await failed(client, "catalog_describe", {
        id: "dir-note",
        scope: "project",
        out: exported,
      })
    ).message,
  ).toContain("not empty");
  // Earlier shape: component_import is translated and says so.
  const imported = await call(client, "component_import", { directory });
  expect(imported.structuredContent.ok).toBe(true);
  expect(imported.structuredContent.migration).toMatchObject({
    from: { tool: "component_import" },
    use: { tool: "component_save", arguments: { directory, legacy: true } },
  });
});

test("page_read and page_diff write to files and diff records by id", async () => {
  const v1 = await revision("5.0.0", schema());
  const client = await local();
  const page = await ok(client, "page_create", {
    title: "Diff",
    blocks: [{ kind: "custom", data: componentWidgetData(v1, props) }],
  });
  const block = custom(page.document);
  const out = join(files, "page-source.json");
  const read = await call(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
    response: "source",
    out,
  });
  const text = read.content.map((part) => part.text ?? "").join("");
  expect(text.length).toBeLessThan(2000);
  expect(read.structuredContent.data).toMatchObject({
    pageId: page.document.id,
    hash: page.hash,
    revision: page.revision,
    out: { path: out, bytes: expect.any(Number), sha256: expect.any(String) },
  });
  expect(read.structuredContent.data.document).toBeUndefined();
  expect(JSON.parse(await readFile(out, "utf8")).document.id).toBe(
    page.document.id,
  );
  expect(
    (await failed(client, "page_read", { pageId: page.document.id, out }))
      .message,
  ).toContain("already exists");

  const edited = await ok(client, "page_apply", {
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [
      {
        type: "component.props.set",
        blockId: block.attrs.id,
        props: {
          items: [
            { id: "b", title: "Beta", icon },
            { id: "a", title: "Alpha 2", icon },
            { id: "c", title: "Gamma", icon },
          ],
        },
      },
    ],
    response: "receipt",
  });
  const diff = await ok(client, "page_diff", {
    pageId: page.document.id,
    sinceHash: page.hash,
  });
  expect(diff.summary).toMatchObject({
    blocks: { changed: 1 },
    recordChanges: { set: 1, insert: 1, move: 1, remove: 0 },
  });
  const title = diff.changes.find((change: any) => change.op === "set");
  expect(title).toEqual({
    type: "block.changed",
    blockId: block.attrs.id,
    op: "set",
    path: "attrs.data.props.items[id=a].title",
    before: "Alpha",
    after: "Alpha 2",
  });
  const inserted = diff.changes.find((change: any) => change.op === "insert");
  expect(inserted.after.icon).toMatchObject({
    $omitted: "data-uri",
    mime: "image/png",
  });
  expect(JSON.stringify(diff).length).toBeLessThan(6000);
  // Paging keeps the remaining entries.
  const first = await ok(client, "page_diff", {
    pageId: page.document.id,
    sinceHash: page.hash,
    limit: 1,
  });
  expect(first.changes).toHaveLength(1);
  expect(first.nextOffset).toBe(1);
  const rest = await ok(client, "page_diff", {
    pageId: page.document.id,
    sinceHash: page.hash,
    offset: first.nextOffset,
  });
  expect(rest.changes).toHaveLength(diff.changes.length - 1);
  expect(rest.nextOffset).toBeNull();
  const diffOut = join(files, "page-diff.json");
  const written = await ok(client, "page_diff", {
    pageId: page.document.id,
    sinceHash: page.hash,
    out: diffOut,
  });
  expect(written.changes).toBeUndefined();
  expect(written.out.path).toBe(diffOut);
  const full = JSON.parse(await readFile(diffOut, "utf8"));
  expect(
    full.changes.find((change: any) => change.op === "insert").after.icon,
  ).toBe(icon);
  expect(edited.hash).toBe(diff.currentHash);
});

test("earlier tool shapes are translated; argument errors are structured", async () => {
  const client = await connect(createLibraryMcpServer({ root }));
  const created = await call(client, "dataset_create", {
    projectId,
    name: "Old shape",
    value: { n: 1 },
  });
  expect(created.structuredContent.ok).toBe(true);
  expect(created.structuredContent.migration).toMatchObject({
    from: { tool: "dataset_create" },
    use: {
      tool: "dataset_write",
      arguments: { action: "create", name: "Old shape" },
    },
  });
  const datasetId = created.structuredContent.data.dataset.id;
  const read = await call(client, "dataset_read", { projectId, datasetId });
  expect(read.structuredContent.ok).toBe(true);
  expect(read.structuredContent.migration.changes).toEqual([
    "dataset_read needs action; this call is action read",
  ]);
  const listed = await call(client, "dataset_list", { projectId });
  expect(listed.structuredContent.migration.use.arguments.action).toBe("list");

  const unknown = await failed(client, "page_reed", { projectId, pageId: "x" });
  expect(unknown.code).toBe("UNKNOWN_TOOL");
  expect(unknown.similar).toContain("page_read");
  const stale = await failed(client, "page_read", {
    projectId,
    pageId: "x",
    tilePixels: 1,
  });
  expect(stale).toMatchObject({
    code: "INVALID_ARGUMENTS",
    unexpected: ["tilePixels"],
  });
  expect(stale.expected.required).toContain("pageId");
  const guide = await ok(client, "guide", { topic: "migrations" });
  expect(
    guide.input.changes.some(
      (change: any) => change.before === "dataset_create",
    ),
  ).toBe(true);
});

test("hosted connections reject device paths explicitly", async () => {
  const hosted = createMcpServer({
    root,
    projectId,
    presentation: {
      transport: "http",
      privateProjects: true,
      storePresentation: async () => ({}) as never,
    },
  });
  const client = await connect(hosted);
  const tools = (await client.listTools()).tools;
  const apply = tools.find((tool) => tool.name === "page_apply")!;
  expect(Object.keys(apply.inputSchema.properties ?? {})).not.toContain(
    "operationsFile",
  );
  expect(apply.inputSchema.required).toContain("operations");
  const error = await failed(client, "page_apply", {
    pageId: "p",
    baseHash: "h",
    operationsFile: "/tmp/operations.json",
  });
  expect(error.code).toBe("INVALID_ARGUMENTS");
  expect(error.message).toContain("hosted connection");
  const read = await failed(client, "page_read", {
    pageId: "p",
    out: "/tmp/x",
  });
  expect(read.message).toContain("hosted connection");
});

test("a write from another connection names the datasetBases to pass", async () => {
  const v1 = await revision("6.0.0", schema());
  const reader = await local();
  const page = await ok(reader, "page_create", {
    title: "Bases",
    blocks: [{ kind: "custom", data: componentWidgetData(v1, props) }],
  });
  const block = custom(page.document);
  const shared = await ok(reader, "dataset_write", {
    action: "create",
    name: "Bases",
    fromBlock: {
      pageId: page.document.id,
      blockId: block.attrs.id,
      baseHash: page.hash,
      local: ["title"],
    },
  });
  const read = await ok(reader, "page_read", {
    pageId: page.document.id,
    rendered: false,
    response: "receipt",
  });
  expect(read.datasetBases).toEqual({ [shared.dataset.id]: shared.hash });
  // A fresh connection of the same client has not read the dataset.
  const writer = await connect(createMcpServer({ root, projectId }));
  const operation = {
    type: "component.props.set",
    blockId: block.attrs.id,
    props: { items: [{ id: "a", title: "Changed" }] },
  };
  const missing = await failed(writer, "page_apply", {
    pageId: page.document.id,
    baseHash: read.hash,
    baseRevision: read.revision,
    operations: [operation],
  });
  expect(missing.code).toBe("MISSING_BASELINE");
  expect(missing.details.datasetBases).toEqual({
    [shared.dataset.id]: "HASH_FROM_YOUR_READ",
  });
  expect(missing.nextStep).toContain("datasetBases");
  const written = await ok(writer, "page_apply", {
    pageId: page.document.id,
    baseHash: read.hash,
    baseRevision: read.revision,
    operations: [operation],
    datasetBases: read.datasetBases,
    response: "receipt",
  });
  expect(written.hash).toBeDefined();
});

test("bound data changes are compared by dataset_read sinceHash", async () => {
  const v1 = await revision("7.0.0", schema());
  const client = await local();
  const page = await ok(client, "page_create", {
    title: "Bound diff",
    blocks: [{ kind: "custom", data: componentWidgetData(v1, props) }],
  });
  const block = custom(page.document);
  const shared = await ok(client, "dataset_write", {
    action: "create",
    name: "Bound diff",
    fromBlock: {
      pageId: page.document.id,
      blockId: block.attrs.id,
      baseHash: page.hash,
      local: ["title"],
    },
  });
  const read = await ok(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
    response: "receipt",
  });
  const sinceHash = read.datasetBases[shared.dataset.id];
  // A read written to a file still names the datasets it saw.
  const filed = await ok(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
    out: join(files, "bound-page.json"),
  });
  expect(filed.datasetBases).toEqual(read.datasetBases);
  expect(filed.document).toBeUndefined();
  await ok(client, "dataset_write", {
    action: "apply",
    datasetId: shared.dataset.id,
    baseHash: sinceHash,
    operations: [
      { op: "set", path: "items[id=b].title", value: "Beta 2" },
      { op: "remove", path: "items[id=a]" },
    ],
  });
  // The page itself did not change; page_diff points at the datasets.
  const diff = await ok(client, "page_diff", {
    pageId: page.document.id,
    sinceHash: read.hash,
  });
  expect(diff.changes).toEqual([]);
  expect(diff.boundDatasets).toEqual([
    { datasetId: shared.dataset.id, blockIds: [block.attrs.id] },
  ]);
  const changes = await ok(client, "dataset_read", {
    action: "read",
    datasetId: shared.dataset.id,
    sinceHash,
  });
  expect(changes.dataset.value).toBeUndefined();
  expect(changes.summary.recordChanges).toEqual({
    set: 1,
    insert: 0,
    remove: 1,
    move: 0,
  });
  expect(changes.changes).toEqual(
    expect.arrayContaining([
      {
        op: "set",
        path: "items[id=b].title",
        before: "Beta",
        after: "Beta 2",
      },
      expect.objectContaining({
        op: "remove",
        path: "items[id=a]",
        before: expect.objectContaining({
          icon: expect.objectContaining({ $omitted: "data-uri" }),
        }),
      }),
    ]),
  );
  const out = join(files, "dataset-diff.json");
  const written = await ok(client, "dataset_read", {
    action: "read",
    datasetId: shared.dataset.id,
    sinceHash,
    out,
  });
  expect(written.out.path).toBe(out);
  expect(written.changes).toBeUndefined();
  const file = JSON.parse(await readFile(out, "utf8"));
  expect(
    file.changes.find((change: any) => change.op === "remove").before.icon,
  ).toBe(icon);
  expect(
    (
      await failed(client, "dataset_read", {
        action: "read",
        datasetId: shared.dataset.id,
        sinceHash: "0".repeat(64),
      })
    ).code,
  ).toBe("MISSING_BASELINE");
});
