import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

it("opens Qoder workbench entries and saves a large page through its MCP transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-qoder-workbench-"));
  const home = join(root, "library");
  const client = new Client({ name: "qoder-workbench-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist-agent/cli.mjs"), "mcp", "--home", home],
    env: { SHOWAI_QODER_WORKBENCH: "1" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const [name, type] of [
      ["workbench_open_global", "global"],
      ["workbench_open_page", "thread"],
    ]) {
      expect(tools.find((tool) => tool.name === name)?._meta).toMatchObject({
        "qoder/ui": { entrypoints: [{ type }] },
        ui: { visibility: ["app"] },
      });
    }
    expect(tools.find((tool) => tool.name === "card_open")).toBeDefined();
    const cardUri = (tools.find((tool) => tool.name === "card_present")?._meta?.ui as
      { resourceUri?: string } | undefined)?.resourceUri;
    expect(cardUri).toBeTruthy();
    const cardResource = await client.readResource({ uri: cardUri! });
    expect(cardResource.contents[0]._meta).toMatchObject({
      "qoder/ui": { availableDisplayModes: ["inline"], preferredDisplayMode: "inline" },
    });
    const resource = await client.readResource({ uri: "ui://showai/workbench-v3.html" });
    expect(resource.contents[0]._meta).toMatchObject({
      "qoder/ui": { preferredDisplayMode: "fullscreen" },
    });
    expect(resource.contents[0]._meta?.ui).not.toHaveProperty("csp");

    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return result;
    }
    async function appData(name: string, args: Record<string, unknown>) {
      return (await call(name, args))._meta!.showaiWorkbenchData;
    }
    const open = await call("workbench_open_global", {});
    expect((open._meta!.showaiWorkbench as { bundle: { entry: string } }).bundle.entry)
      .toBe("qoder-workbench.js");
    const project = (await call("project_create", { name: "Qoder workbench" })).structuredContent as {
      data: { id: string };
    };
    const projectId = project.data.id;
    const created = (await call("page_create", {
      projectId,
      title: "Large page",
      blocks: [{ kind: "text", data: { format: "markdown", content: "Before" } }],
    })).structuredContent as { data: { document: any; hash: string; revision: string } };
    const page = created.data;
    const pageId = page.document.id;
    expect((await call("card_present", { projectId, pageId })).structuredContent)
      .toMatchObject({ data: { projectId, pageId, title: "Large page" } });
    await call("card_open", { projectId, pageId });

    const text = "Qoder 片段 ".repeat(90_000);
    page.document.content.content[0].content[0].content[0].text = text;
    const input = JSON.stringify({
      route: "invoke",
      client: "qoder-test",
      args: {
        action: "pages:save",
        args: { projectId, pageId, document: page.document, baseHash: page.hash, baseRevision: page.revision },
      },
    });
    expect(Buffer.byteLength(input)).toBeGreaterThan(1024 * 1024);
    const id = await appData("workbench_upload_begin", { length: input.length });
    for (let offset = 0; offset < input.length; offset += 100_000)
      await appData("workbench_upload_chunk", { id, offset, text: input.slice(offset, offset + 100_000) });
    const saved = await appData("workbench_upload_finish", { id });
    expect(await appData("workbench_upload_finish", { id })).toEqual(saved);
    const pointer = (saved as { qoderTransfer: { id: string; length: number } }).qoderTransfer;
    if (!pointer) throw new Error("Expected a transferred response: " + JSON.stringify(saved).slice(0, 500));
    let response = "";
    while (response.length < pointer.length)
      response += await appData("workbench_response_chunk", { id: pointer.id, offset: response.length });
    expect(JSON.parse(response)).toMatchObject({ ok: true, data: { document: { id: pageId } } });
    expect(await appData("workbench_response_release", { id: pointer.id })).toBe(true);
    const released = await client.callTool({
      name: "workbench_response_chunk",
      arguments: { id: pointer.id, offset: 0 },
    });
    expect(released.isError).toBe(true);
    const read = await call("page_read", { projectId, pageId, detail: "full", response: "source", rendered: false });
    expect(JSON.stringify(read.structuredContent)).toContain(text);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
