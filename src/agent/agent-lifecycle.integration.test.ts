import { afterAll, beforeAll, expect, test } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { AgentService } from "./service";
import { componentWidgetData, getComponent } from "../core/catalog";
import { visitNodes } from "../document/document.mjs";
import type { ShowDocument } from "../core/model";

let home: string, projectId: string, service: AgentService;
let bundleDirectory: string;
const clients: Client[] = [];
const repository = resolve(import.meta.dirname, "../..");

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-agent-lifecycle-"));
  service = new AgentService({ root: home });
  projectId = (await service.createProject("Lifecycle")).id;
  // The real CLI entry runs as its own process, as Agents call it.
  await mkdir(join(repository, "node_modules/.cache"), { recursive: true });
  bundleDirectory = await mkdtemp(
    join(repository, "node_modules/.cache/showai-lifecycle-"),
  );
  await build({
    entryPoints: [join(repository, "src/agent/cli.ts")],
    outfile: join(bundleDirectory, "cli.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["esbuild"],
    plugins: [rawSourcePlugin],
    banner: {
      js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
    },
  });
  await copyFile(
    join(repository, "dist-agent/index-worker.mjs"),
    join(bundleDirectory, "index-worker.mjs"),
  );
}, 60000);
afterAll(async () => {
  for (const client of clients) await client.close();
  await rm(home, { recursive: true, force: true });
  await rm(bundleDirectory, { recursive: true, force: true });
});

async function connect() {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "lifecycle", version: "1" });
  await Promise.all([
    createMcpServer({ root: home, projectId }).connect(right),
    client.connect(left),
  ]);
  clients.push(client);
  return async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    const value = JSON.parse(result.content[0].text);
    return result.isError ? value : value.data;
  };
}
async function cli(...args: string[]): Promise<Record<string, any>> {
  const output = await promisify(execFile)(
    process.execPath,
    [
      join(bundleDirectory, "cli.mjs"),
      ...args,
      "--home",
      home,
      "--project",
      projectId,
      "--json",
    ],
    { env: { ...process.env, SHOWAI_HOME: home } },
  ).catch((error) => {
    throw new Error(`CLI ${args.join(" ")} failed: ${error.stdout || error.message}`);
  });
  return JSON.parse(output.stdout).data;
}
const ids = (document: ShowDocument) => {
  const found: string[] = [];
  visitNodes(document.content, (node: { attrs?: { id?: string } }) => {
    if (node.attrs?.id) found.push(node.attrs.id);
  });
  return found;
};
const text = (document: ShowDocument) => JSON.stringify(document.content);

test("agents delete, list, restore, pin and duplicate pages through MCP and the CLI", async () => {
  const call = await connect();
  const page = await service.createPage(projectId, {
    title: "Field notes",
    blocks: [
      { kind: "text", data: { format: "markdown", content: "Lifecycle body" } },
    ],
  });
  const pageId = page.document.id;

  const deleted = await call("organization_update", {
    action: "update_page",
    pageId,
    archived: true,
  });
  expect(deleted).toMatchObject({ pageId, archived: true, pinned: false });
  expect(deleted.document).toBeUndefined();
  const listing = await call("organization_read", { action: "deleted" });
  expect(listing.pages.map((item: { id: string }) => item.id)).toEqual([
    pageId,
  ]);
  expect(
    (await call("pages_list", { includeArchived: false })).map(
      (item: { id: string }) => item.id,
    ),
  ).not.toContain(pageId);

  const restored = await call("organization_update", {
    action: "update_page",
    pageId,
    archived: false,
  });
  expect(restored.archived).toBe(false);
  expect((await call("organization_read", { action: "deleted" })).pages).toEqual(
    [],
  );

  const pinned = await call("organization_update", {
    action: "update_page",
    pageId,
    pinned: true,
    baseHash: restored.hash,
    baseRevision: restored.revision,
  });
  expect(pinned).toMatchObject({ pinned: true, archived: false });
  const stale = await call("organization_update", {
    action: "update_page",
    pageId,
    pinned: false,
    baseHash: restored.hash,
    baseRevision: restored.revision,
  });
  expect(stale.ok).toBe(false);
  expect(stale.error.code).toBe("CONFLICT");

  const copy = await call("organization_update", {
    action: "duplicate_page",
    pageId,
  });
  expect(copy.pageId).not.toBe(pageId);
  expect(copy.title).toContain("Field notes");
  expect(copy.title).not.toBe("Field notes");
  const original = await service.store.readPage(projectId, pageId);
  const duplicate = await service.store.readPage(projectId, copy.pageId);
  expect(text(duplicate.document)).toContain("Lifecycle body");
  expect(ids(duplicate.document).filter((id) => ids(original.document).includes(id))).toEqual([]);

  // The CLI mirrors every operation.
  expect(await cli("pages", "delete", copy.pageId)).toMatchObject({
    pageId: copy.pageId,
    archived: true,
  });
  expect(
    (await cli("pages", "deleted")).pages.map((item: { id: string }) => item.id),
  ).toEqual([copy.pageId]);
  expect(await cli("pages", "restore", copy.pageId)).toMatchObject({
    archived: false,
  });
  expect(await cli("pages", "unpin", pageId)).toMatchObject({ pinned: false });
  expect(await cli("pages", "pin", pageId)).toMatchObject({ pinned: true });
  const named = await cli("pages", "duplicate", pageId, "--title", "Second copy");
  expect(named.title).toBe("Second copy");
  expect((await service.listPages(projectId)).map((item) => item.title)).toEqual(
    expect.arrayContaining(["Field notes", copy.title, "Second copy"]),
  );
}, 120000);

test("page_apply and page_save reply with receipts unless the document is requested", async () => {
  const call = await connect();
  const page = await service.createPage(projectId, {
    title: "Receipts",
    blocks: [{ kind: "text", data: { format: "markdown", content: "One" } }],
  });
  const applied = await call("page_apply", {
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [
      {
        type: "component.insert",
        kind: "text",
        data: { format: "markdown", content: "Two" },
      },
    ],
  });
  expect(applied).toMatchObject({
    pageId: page.document.id,
    response: "receipt",
    changedBlocks: { removed: [], changed: [] },
  });
  expect(applied.document).toBeUndefined();
  // Layout and views follow inserted blocks; that is not a page-level change.
  expect(applied.changedBlocks.page).toBeUndefined();
  expect(applied.revision).toEqual(expect.any(String));
  const [added] = applied.changedBlocks.added;
  const current = await service.store.readPage(projectId, page.document.id);
  expect(ids(current.document)).toContain(added);
  expect(current.hash).toBe(applied.hash);

  const saved = await call("page_save", {
    pageId: page.document.id,
    document: { ...current.document, title: "Receipts renamed" },
    baseHash: current.hash,
    baseRevision: current.revision,
  });
  expect(saved).toMatchObject({
    title: "Receipts renamed",
    response: "receipt",
    changedBlocks: { added: [], removed: [], changed: [], page: true },
  });
  expect(saved.document).toBeUndefined();

  const source = await call("page_apply", {
    pageId: page.document.id,
    baseHash: saved.hash,
    baseRevision: saved.revision,
    operations: [{ type: "block.remove", blockId: added }],
    response: "source",
  });
  expect(ids(source.document)).not.toContain(added);
  expect(source.changedBlocks.removed).toContain(added);
}, 120000);

test("a default read of a large page returns an outline window and names what it left out", async () => {
  const created = await service.createPage(projectId, { title: "Large" });
  const document = structuredClone(created.document) as ShowDocument;
  const blocks = Array.from({ length: 1200 }, (_, index) => ({
    type: "paragraph",
    attrs: { id: randomUUID() },
    content: [
      { type: "text", text: `Paragraph ${index} ${"filler text ".repeat(20)}` },
    ],
  }));
  document.content.content = blocks;
  // Views are rebuilt from the new blocks when the page is saved.
  document.surfaceViews = {};
  const large = await service.savePage(
    projectId,
    created.document.id,
    document,
    created.hash,
    undefined,
    undefined,
    created.revision,
  );
  type Read = Record<string, any>;
  const first: Read = await service.readPage(projectId, large.document.id, {});
  expect(first).toMatchObject({
    format: "outline",
    blockCount: 1200,
    offset: 0,
    nextOffset: 100,
    hash: large.hash,
    omitted: { fields: ["document", "markdown", "computed"] },
  });
  expect("document" in first).toBe(false);
  expect(first.outline.filter((item: Read) => item.depth === 1)).toHaveLength(100);
  expect(first.omitted?.next).toContain("blockIds");
  const last: Read = await service.readPage(projectId, large.document.id, {
    offset: 1150,
    limit: 100,
  });
  expect(last.nextOffset).toBeUndefined();
  expect(last.outline.filter((item: Read) => item.depth === 1)).toHaveLength(50);
  expect(last.omitted).toBeDefined();
  const full: Read = await service.readPage(projectId, large.document.id, {
    detail: "full",
  });
  expect(full.document.content.content).toHaveLength(1200);
  const picked: Read = await service.readPage(projectId, large.document.id, {
    blockIds: [blocks[7].attrs.id],
  });
  expect(picked.omitted).toBeUndefined();
  expect(JSON.stringify(picked)).toContain("Paragraph 7 ");
}, 120000);

test("components and templates are removed only when nothing uses them", async () => {
  const call = await connect();
  const source = (version: string) => ({
    manifest: {
      id: "tally",
      name: "Tally",
      version,
      entry: "index.tsx",
      description: "A counted value",
      scenarios: ["Show a count"],
      defaultData: { value: 1 },
      examples: [{ name: "One", data: { value: 1 } }],
    },
    schema: {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    },
    source:
      "export default function Tally({data}) { return <p>{data.value}</p>; }\n",
  });
  await service.saveComponent(projectId, source("1.0.0") as never);
  await service.saveComponent(projectId, source("1.1.0") as never);
  const v1 = await getComponent(home, "tally", "1.0.0", projectId);
  const page = await service.createPage(projectId, {
    title: "Uses tally",
    blocks: [{ kind: "custom", data: componentWidgetData(v1, { value: 3 }) }],
  });
  const blockId = page.document.content.content!.find(
    (node) => node.type === "widget",
  )!.attrs!.id as string;
  const template = await service.saveTemplate(projectId, page.document.id, {
    id: "tally-report",
    name: "Tally report",
    description: "A page around one tally",
    version: "1.0.0",
  });

  const refused = await call("catalog_version", {
    action: "remove",
    kind: "component",
    id: "tally",
    version: "1.0.0",
  });
  expect(refused.ok).toBe(false);
  expect(refused.error.code).toBe("IN_USE");
  expect(refused.error.details.uses.pages).toEqual([
    expect.objectContaining({
      projectId,
      pageId: page.document.id,
      title: "Uses tally",
      blockIds: [blockId],
    }),
  ]);
  expect(refused.error.details.uses.packages).toEqual([
    expect.objectContaining({ kind: "template", id: "tally-report" }),
  ]);
  expect(refused.error.nextStep).toContain("component.ref.set");

  // An unused revision goes at once and leaves the used one in place.
  expect(
    await call("catalog_version", {
      action: "remove",
      kind: "component",
      id: "tally",
      version: "1.1.0",
    }),
  ).toMatchObject({
    removed: [{ kind: "component", id: "tally", version: "1.1.0", scope: "project" }],
  });
  const versions = (
    await call("catalog_list", { kind: "component", versions: "all", query: "tally" })
  ).items
    .filter((item: { id: string }) => item.id === "tally")
    .map((item: { version: string }) => item.version);
  expect(versions).toEqual(["1.0.0"]);

  expect(
    await call("catalog_version", {
      action: "remove",
      kind: "template",
      id: "tally-report",
    }),
  ).toMatchObject({
    removed: [
      expect.objectContaining({ id: "tally-report", integrity: template.integrity }),
    ],
  });

  // A deleted page still counts: restoring it would bring the use back.
  await service.updatePage(projectId, page.document.id, { archived: true });
  const archived = await call("catalog_version", {
    action: "remove",
    kind: "component",
    id: "tally",
  });
  expect(archived.error.details.uses.pages[0]).toMatchObject({ archived: true });
  expect(archived.error.details.uses.packages).toEqual([]);

  const current = await service.store.readPage(projectId, page.document.id);
  await service.applyPage(projectId, page.document.id, {
    baseHash: current.hash,
    baseRevision: current.revision,
    operations: [{ type: "block.remove", blockId }],
  });
  expect(
    await cli("catalog", "remove", "tally", "--kind", "component"),
  ).toMatchObject({
    removed: [{ id: "tally", version: "1.0.0", integrity: v1.integrity }],
  });
  const folder = join(
    home,
    "workspace",
    "projects",
    projectId,
    "packages",
    "components",
    "tally",
  );
  const remaining = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  expect(remaining.filter((entry) => entry.isFile())).toEqual([]);
  expect(
    (await call("catalog_list", { kind: "component", query: "tally" })).items,
  ).toEqual([]);

  const builtin = await call("catalog_version", {
    action: "remove",
    kind: "component",
    id: "chart",
  });
  expect(builtin.error).toMatchObject({ code: "INVALID_DATA" });
  expect(builtin.error.message).toContain("Built-in");
  const shared = await call("catalog_version", {
    action: "remove",
    kind: "component",
    id: "tally",
    scope: "global",
  });
  expect(shared.error.code).toBe("INVALID_PATH");
  const missing = await call("catalog_version", {
    action: "remove",
    kind: "component",
    id: "tally",
  });
  expect(missing.error.code).toBe("NOT_FOUND");
}, 180000);
