import { afterEach, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerPresentationTools } from "./presentation-tools";
import { parameterComponent } from "../test/parameter-component";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "./service";
import { syncManager } from "../sync/manager";

const connections: { client: Client; server: McpServer }[] = [];
const libraries: string[] = [];
afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
  for (const root of libraries.splice(0)) {
    await syncManager(root).stop();
    await rm(root, { recursive: true, force: true });
  }
});
async function connect(transport: "stdio" | "http" = "stdio") {
  const server = new McpServer({ name: "live-test", version: "1" });
  registerPresentationTools(server, {
    transport,
    hostDisplay: "mcp-app",
  });
  const client = new Client({ name: "reader-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right);
  await client.connect(left);
  connections.push({ client, server });
  return client;
}

it("keeps cached reader resource addresses readable alongside the new templates", async () => {
  const client = await connect();
  for (const uri of ["ui://showai/reader-v3.html", "ui://showai/reader-v4.html", "ui://showai/component-v1.html", "ui://showai/component-v2.html"]) {
    const result = await client.readResource({ uri });
    expect(result.contents[0].uri).toBe(uri);
    expect((result.contents[0] as { text: string }).text).toContain("ui/notifications/tool-result");
  }
});

it("keeps local images portable at creation and on a subsequent update", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-live-images-"));
  libraries.push(root);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=", "base64");
  const first = join(root, "first.png"), second = join(root, "second.png");
  await writeFile(first, bytes);
  await writeFile(second, bytes);
  const client = await connect();
  const shown = await client.callTool({ name: "show_component", arguments: { live: true, kind: "image", data: { src: pathToFileURL(first).href, alt: "First" } } });
  expect(shown.isError, JSON.stringify(shown.content)).not.toBe(true);
  const { live, blocks } = (shown.structuredContent as any).data;
  const initial = await client.callTool({ name: "show_component_read", arguments: { viewId: live.viewId, source: true } });
  expect((initial.structuredContent as any).data.artifact.document.content.content[0].attrs.src).toBe("data:image/png;base64," + bytes.toString("base64"));
  const updated = await client.callTool({ name: "show_component_update", arguments: { viewId: live.viewId, operationId: "image", baseRevision: 0, operations: [{ type: "block.attrs.set", blockId: blocks[0].id, attrs: { src: pathToFileURL(second).href, alt: "Second" } }] } });
  expect(updated.isError, JSON.stringify(updated.content)).not.toBe(true);
  const read = await client.callTool({ name: "show_component_read", arguments: { viewId: live.viewId, source: true } });
  expect((read.structuredContent as any).data.artifact.document.content.content[0].attrs).toMatchObject({ alt: "Second", src: "data:image/png;base64," + bytes.toString("base64") });
});

it("creates, updates, reads and completes a real temporary presentation through MCP", async () => {
  const client = await connect();
  const shown = await client.callTool({
    name: "show_component",
    arguments: {
      live: true,
      kind: "chart",
      data: { labels: ["A"], series: [{ name: "result", values: [1] }] },
    },
  });
  expect(shown.isError, JSON.stringify(shown.content)).not.toBe(true);
  const data = (shown.structuredContent as any).data;
  const viewId = data.live.viewId;
  const blockId = data.blocks[0].id;
  const update = {
    viewId,
    operationId: "batch",
    baseRevision: 0,
    operations: [
      {
        type: "component.props.set",
        blockId,
        props: {
          labels: ["A", "B"],
          series: [{ name: "result", values: [1, 2] }],
        },
      },
    ],
    complete: true,
  };
  const changed = await client.callTool({
    name: "show_component_update",
    arguments: update,
  });
  expect(changed.isError, JSON.stringify(changed.content)).not.toBe(true);
  expect((changed.structuredContent as any).data).toMatchObject({
    viewId,
    revision: 1,
    complete: true,
    savedToProject: false,
  });
  const again = await client.callTool({
    name: "show_component_update",
    arguments: update,
  });
  expect((again.structuredContent as any).data.revision).toBe(1);
  const read = await client.callTool({
    name: "show_component_read",
    arguments: { viewId, source: true },
  });
  expect(
    (read.structuredContent as any).data.artifact.document.content.content[0]
      .attrs,
  ).toMatchObject({ id: blockId, data: { labels: ["A", "B"] } });
  const unchanged = await client.callTool({
    name: "show_component_read",
    arguments: { viewId, sinceRevision: 1 },
  });
  expect((unchanged.structuredContent as any).data.changed).toBe(false);
  const other = await connect();
  expect(
    (
      await other.callTool({
        name: "show_component_read",
        arguments: { viewId },
      })
    ).isError,
  ).toBe(true);
  await client.callTool({
    name: "show_component_close",
    arguments: { viewId },
  });
  expect(
    (
      await client.callTool({
        name: "show_component_read",
        arguments: { viewId },
      })
    ).isError,
  ).toBe(true);
}, 60000);

it("keeps compiled custom components editable when saving the latest live result as a Page", async () => {
  const client = await connect();
  const component = parameterComponent("live-save-regions");
  const shown = await client.callTool({
    name: "show_component",
    arguments: {
      live: true,
      kind: "custom",
      data: {
        componentId: component.manifest.id,
        version: component.manifest.version,
        props: component.manifest.defaultData,
      },
      componentSources: [component],
    },
  });
  expect(shown.isError, JSON.stringify(shown.content)).not.toBe(true);
  const { live, blocks } = (shown.structuredContent as any).data;
  const invalid = await client.callTool({
    name: "show_component_update",
    arguments: {
      viewId: live.viewId,
      baseRevision: 0,
      operationId: "invalid",
      operations: [
        {
          type: "component.props.set",
          blockId: blocks[0].id,
          props: { slides: [] },
        },
      ],
    },
  });
  expect(invalid.isError).toBe(true);
  const changed = await client.callTool({
    name: "show_component_update",
    arguments: {
      viewId: live.viewId,
      baseRevision: 0,
      operationId: "valid",
      operations: [
        {
          type: "component.props.set",
          blockId: blocks[0].id,
          props: { title: "Updated source" },
        },
      ],
      complete: true,
    },
  });
  expect(changed.isError, JSON.stringify(changed.content)).not.toBe(true);
  const read = await client.callTool({
    name: "show_component_read",
    arguments: { viewId: live.viewId, source: true },
  });
  const { artifact } = (read.structuredContent as any).data;
  expect(artifact.componentSources[0].source).toBe(component.source);
  const root = await mkdtemp(join(tmpdir(), "showai-live-save-"));
  libraries.push(root);
  const service = new AgentService({ root });
  const project = await service.createProject("Live result");
  await service.saveComponent(project.id, artifact.componentSources[0]);
  const saved = await service.createPage(project.id, {
    document: artifact.document,
    components: artifact.components,
  });
  const reopened = await service.store.readPage(project.id, saved.document.id);
  expect(reopened.document.content.content![0].attrs!.data.props.title).toBe(
    "Updated source",
  );
  expect(reopened.document.content.content![0].attrs!.data.integrity).toBe(
    artifact.document.content.content[0].attrs.data.integrity,
  );
}, 60000);

it("retains the ordinary one-shot presentation contract", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "show_component",
    arguments: {
      kind: "text",
      data: { format: "markdown", content: "A complete answer" },
    },
  });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect((result.structuredContent as any).data).not.toHaveProperty("live");
  expect(
    (result.structuredContent as any).data.persistence.savedToProject,
  ).toBe(false);
});

it("reports unavailable transports and rejects incompatible live delivery before rendering", async () => {
  const remote = await connect("http");
  const capabilities = await remote.callTool({ name: "showai_capabilities", arguments: {} });
  expect((capabilities.structuredContent as any).data.presentation.liveUpdates).toMatchObject({ available: false, tools: [] });
  expect((await remote.listTools()).tools.map(tool => tool.name)).not.toContain("show_component_update");
  const args = { live: true, kind: "text", data: { content: "Complete content" } };
  expect((await remote.callTool({ name: "show_component", arguments: args })).isError).toBe(true);
  const local = await connect();
  const incompatible = await local.callTool({ name: "show_component", arguments: { ...args, delivery: "fragment-file" } });
  expect(incompatible.isError).toBe(true);
  expect((incompatible.structuredContent as any).error.message).toContain("MCP Apps");
});
