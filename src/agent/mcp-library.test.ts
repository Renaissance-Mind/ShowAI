import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLibraryMcpServer } from "./mcp-library";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { listBuiltinComponents } from "../core/catalog";
import { AgentService } from "./service";

let root: string;
const connections: {
  client: Client;
  server: ReturnType<typeof createMcpServer>;
}[] = [];
async function connect(server: ReturnType<typeof createMcpServer>) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-library-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
  connections.push({ client, server });
  return client;
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const value = await client.callTool({ name, arguments: args });
  expect(value.isError, JSON.stringify(value.content)).not.toBe(true);
  return (value.structuredContent as any).data;
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-mcp-library-"));
  await openLibrary(root);
});
afterAll(async () => {
  for (const c of connections) {
    await c.client.close();
    await c.server.close();
  }
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

test("library discovery is read-only; parallel project calls retain explicit identity", async () => {
  const c = await connect(createLibraryMcpServer({ root }));
  expect((await call(c, "showai_capabilities")).agentProtocol).toBe(
    "showai-mcp-v1",
  );
  expect((await call(c, "project_context")).scope).toBe("library");
  const guide = await call(c, "guide", { topic: "authoring" });
  expect(guide.commands).toBeUndefined();
  expect(guide.tools).toContain("page_save");
  expect(await call(c, "projects_list")).toEqual([]);
  const paths = [join(root, "host-a"), join(root, "host-b")];
  await Promise.all(paths.map((p) => mkdir(p)));
  const projects = await Promise.all(
    paths.map((sourceDirectory) =>
      call(c, "project_resolve", { sourceDirectory }),
    ),
  );
  const ids = projects.map((p) => p.project.id);
  expect(new Set(ids).size).toBe(2);
  const pages = await Promise.all(
    ids.map((projectId, i) =>
      call(c, "page_create", { projectId, title: `Project ${i}` }),
    ),
  );
  for (let i = 0; i < 2; i++) {
    expect(
      (await call(c, "pages_list", { projectId: ids[i] })).map(
        (p: any) => p.id,
      ),
    ).toEqual([pages[i].document.id]);
  }
  expect(
    (await c.callTool({ name: "pages_list", arguments: {} })).isError,
  ).toBe(true);
  const bound = await connect(createMcpServer({ root, projectId: ids[0] }));
  expect(
    (
      await bound.callTool({
        name: "pages_list",
        arguments: { projectId: ids[1] },
      })
    ).isError,
  ).toBe(true);
  expect((await call(bound, "pages_list")).length).toBe(1);
  const read = await call(c, "page_read", {
    projectId: ids[0],
    pageId: pages[0].document.id,
    rendered: false,
  });
  const document = { ...read.document, title: "Changed through MCP" };
  const saved = await call(c, "page_save", {
    projectId: ids[0],
    pageId: document.id,
    document,
    baseHash: read.hash,
    baseRevision: read.revision,
  });
  expect(saved.document.title).toBe(document.title);
  const stale = await c.callTool({
    name: "page_save",
    arguments: {
      projectId: ids[0],
      pageId: document.id,
      document: { ...document, title: "Stale" },
      baseHash: read.hash,
      baseRevision: read.revision,
    },
  });
  expect(stale.isError).toBe(true);
  expect((stale.structuredContent as any).error.code).toBe("CONFLICT");
  expect(
    (
      await call(c, "page_read", {
        projectId: ids[0],
        pageId: document.id,
        rendered: false,
      })
    ).hash,
  ).toBe(saved.hash);
});

test("saved-page presentation keeps full source, selects preview and never mutates source", async () => {
  const output = join(root, "host-output");
  const c = await connect(
    createLibraryMcpServer({ root, presentationDirectory: output }),
  );
  const p = await call(c, "project_create", { name: "Presentation checks" }),
    projectId = p.id;
  const page = await call(c, "page_create", {
    projectId,
    title: "Complete source",
  });
  const d = page.document;
  d.surfaceViews = {};
  d.layout = {};
  delete d.views;
  d.content.content = [
    {
      type: "widget",
      attrs: {
        id: "visible",
        kind: "text",
        data: { content: "Visible section", format: "markdown" },
      },
    },
    {
      type: "widget",
      attrs: {
        id: "remaining",
        kind: "text",
        data: { content: "Other section retained", format: "markdown" },
      },
    },
  ];
  const saved = await call(c, "page_save", {
    projectId,
    pageId: d.id,
    document: d,
    baseHash: page.hash,
    baseRevision: page.revision,
  });
  const result = await c.callTool({
    name: "page_present",
    arguments: { projectId, pageId: d.id, blockIds: ["visible"] },
  });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const shown = (result.structuredContent as any).data;
  expect(shown.delivery.html.startsWith(output)).toBe(true);
  expect(shown.delivery.inline.startsWith(output)).toBe(true);
  expect(shown.hash).toBe(saved.hash);
  expect(shown.display.blockIds).toEqual(["visible"]);
  expect(shown.persistence.savedToProject).toBe(true);
  expect(shown.synchronization.state).toBe("not_checked");
  const source = JSON.parse(await readFile(shown.delivery.source, "utf8"));
  expect(source.document.content.content.map((n: any) => n.attrs.id)).toEqual([
    "visible",
    "remaining",
  ]);
  expect((result._meta as any).showai.inline).toContain(
    "data-showai-inline-root",
  );
  expect(
    (await call(c, "page_read", { projectId, pageId: d.id, rendered: false }))
      .hash,
  ).toBe(saved.hash);
  expect(await readdir(join(root, "local", "presentation-builds"))).toEqual([]);
  const missing = await c.callTool({
    name: "page_present",
    arguments: { projectId, pageId: d.id, blockIds: ["missing"] },
  });
  expect(missing.isError).toBe(true);
  expect(await readdir(join(root, "local", "presentation-builds"))).toEqual([]);
});

test("catalog discovery returns all compact entries, with optional pagination beyond 50", async () => {
  const client = await connect(createLibraryMcpServer({ root }));
  const project = await call(client, "project_create", {
    name: "Catalog discovery",
  });
  const expected = listBuiltinComponents()
    .map((item) => item.kind)
    .sort();
  expect(expected.length).toBeGreaterThan(50);
  for (const name of ["catalog_list", "public_catalog_list"]) {
    const args =
      name === "catalog_list"
        ? { kind: "component", scope: "builtin", projectId: project.id }
        : { kind: "component" };
    const all = await call(client, name, args);
    expect(all.items.map((item: any) => item.id).sort()).toEqual(expected);
    expect(all.total).toBe(expected.length);
    expect(all.nextCursor).toBeNull();
    for (const item of all.items) {
      expect(typeof item.name).toBe("string");
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.scenarios.length).toBeGreaterThan(0);
      expect(Object.keys(item).sort()).toEqual(
        [
          "kind",
          "id",
          "name",
          "description",
          "scenarios",
          "scope",
          "version",
        ].sort(),
      );
    }
    const first = await call(client, name, { ...args, limit: 50 });
    const second = await call(client, name, {
      ...args,
      limit: 50,
      cursor: first.nextCursor,
    });
    expect(
      [...first.items, ...second.items].map((item: any) => item.id).sort(),
    ).toEqual(expected);
    expect(second.nextCursor).toBeNull();
    const filtered = await call(client, name, { ...args, query: "chart" });
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.length).toBeLessThan(all.items.length);
    expect(filtered.total).toBe(filtered.items.length);
    expect(filtered.nextCursor).toBeNull();
  }
  const details = await call(client, "catalog_describe", {
    projectId: project.id,
    id: "chart",
    scope: "builtin",
    view: "schema",
  });
  expect(details.schema.properties.series).toBeDefined();
});

test("default component discovery combines built-ins and only the selected project", async () => {
  const client = await connect(createLibraryMcpServer({ root }));
  const project = await call(client, "project_create", {
    name: "Selected catalog",
  });
  const other = await call(client, "project_create", { name: "Other catalog" });
  const { source } = await call(client, "catalog_describe", {
    projectId: project.id,
    id: "text",
    scope: "builtin",
    view: "source",
    file: "*",
  });
  const own = await call(client, "component_save", {
    projectId: project.id,
    source: { ...source, manifest: { ...source.manifest, version: "9.0.0" } },
  });
  const shared = await call(client, "component_save", {
    projectId: other.id,
    source: {
      ...source,
      manifest: { ...source.manifest, id: "shared-catalog-note" },
    },
  });
  await new AgentService({ root }).promote(other.id, shared.ref, "global");
  const args = { projectId: project.id, kind: "component" };
  const listing = await call(client, "catalog_list", args);
  expect(listing.total).toBe(listBuiltinComponents().length + 1);
  expect(listing.nextCursor).toBeNull();
  expect(listing.items.filter((item: any) => item.scope === "project")).toEqual(
    [
      expect.objectContaining({
        id: "text",
        version: "9.0.0",
        integrity: own.integrity,
      }),
    ],
  );
  expect(listing.items.filter((item: any) => item.id === "text")).toHaveLength(
    2,
  );
  expect(
    listing.items.every((item: any) =>
      ["builtin", "project"].includes(item.scope),
    ),
  ).toBe(true);
  expect(
    (
      await call(client, "catalog_list", {
        ...args,
        query: "shared-catalog-note",
      })
    ).items,
  ).toEqual([]);
  const first = await call(client, "catalog_list", { ...args, limit: 50 });
  const service = new AgentService({ root });
  const cliPage = await service.catalogList({
    projectId: project.id,
    kind: "component",
    limit: 50,
  });
  expect(cliPage.next).not.toContain("--scope all");
  const last = await call(client, "catalog_list", {
    ...args,
    limit: 50,
    cursor: first.nextCursor,
  });
  expect([...first.items, ...last.items]).toEqual(listing.items);
  const explicit = await call(client, "catalog_list", {
    ...args,
    scope: "all",
  });
  expect(explicit.items).toContainEqual(
    expect.objectContaining({ id: "shared-catalog-note", scope: "global" }),
  );
  expect(
    explicit.items.filter((item: any) => item.scope === "project"),
  ).toHaveLength(1);
  expect(
    (
      await new AgentService({ root }).catalogList({ kind: "component" })
    ).items.every((item) => item.scope === "builtin"),
  ).toBe(true);
  const detail = await call(client, "catalog_describe", {
    projectId: project.id,
    id: "text",
    scope: "project",
    version: own.version,
    integrity: own.integrity,
  });
  expect(detail.integrity).toBe(own.integrity);
});
