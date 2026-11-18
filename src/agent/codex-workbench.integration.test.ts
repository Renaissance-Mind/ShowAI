import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
import { codexWorkbenchUri } from "./codex-workbench-ui";
import type { ShowDocument } from "../types";

type SavedPage = { document: ShowDocument; hash: string; revision?: string };

it("opens both Codex workbench entries and saves into the MCP library", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-codex-workbench-"));
  const home = join(root, "library");
  const client = new Client({ name: "ShowAI workbench test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist-agent/cli.mjs"), "mcp", "--home", home],
    env: { SHOWAI_CODEX_WORKBENCH_PROFILE: join(root, "profile") },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "workbench_open")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchUri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    });
    expect(tools.find((tool) => tool.name === "workbench_open_page")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchUri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "thread" }] },
    });
    expect(tools.find((tool) => tool.name === "show_component")?._meta?.ui)
      .toEqual({ resourceUri: "ui://showai/component-v2.html" });

    const resource = await client.readResource({ uri: codexWorkbenchUri });
    expect(resource.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    expect(resource.contents[0]).toHaveProperty("text", expect.stringContaining("ui/update-model-context"));
    const open = async (name: string) => {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return new URL((result._meta!.showaiWorkbench as { url: string }).url);
    };
    const globalUrl = await open("workbench_open");
    const threadUrl = await open("workbench_open_page");
    expect(globalUrl.origin).toBe(threadUrl.origin);
    expect(globalUrl.searchParams.get("codexMode")).toBe("global");
    expect(threadUrl.searchParams.get("codexMode")).toBe("thread");
    expect(resource.contents[0]._meta).toMatchObject({
      ui: { csp: {
        connectDomains: [threadUrl.origin],
        resourceDomains: [threadUrl.origin, "blob:", "data:"],
        frameDomains: ["blob:", "data:"],
      } },
    });
    const denied = await fetch(threadUrl.origin);
    expect(denied.status).toBe(403);

    const origin = "https://web-sandbox.oaiusercontent.com";
    const allowed = await fetch(new URL("/api/invoke", threadUrl), {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Headers": "Authorization, Content-Type" },
    });
    expect(allowed.status).toBe(204);
    const forbidden = await fetch(threadUrl, { headers: { Origin: "https://outside.example" } });
    expect(forbidden.status).toBe(403);

    const bootstrap = await fetch(threadUrl, { headers: { Origin: origin } });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("access-control-allow-origin")).toBe(origin);
    expect(bootstrap.headers.get("x-frame-options")).toBeNull();
    expect(bootstrap.headers.get("content-security-policy")).toContain("frame-ancestors 'self' app:");
    const html = await bootstrap.text();
    const config = JSON.parse(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/.exec(html)![1]);
    expect(config.codexWorkbench.mode).toBe("thread");
    expect(html).toContain('type="module"');
    const unauthorized = await fetch(new URL("/api/invoke", threadUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "app:info", args: {} }),
    });
    expect(unauthorized.status).toBe(401);

    async function invoke<T>(action: string, args: object = {}) {
      const response = await fetch(new URL("/api/invoke", threadUrl), {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ action, args }),
      });
      const result = await response.json();
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      return result.data as T;
    }

    expect(await invoke("app:info")).toMatchObject({ home, mode: "browser" });
    await expect(readFile(join(home, "agent-runtime.json"))).rejects.toHaveProperty("code", "ENOENT");

    const project = await client.callTool({ name: "project_create", arguments: { name: "Codex Workbench" } });
    expect(project.isError, JSON.stringify(project.content)).not.toBe(true);
    const { id: projectId } = (project.structuredContent as { data: { id: string } }).data;
    const page = await invoke<SavedPage>("pages:create", { projectId, title: "Architecture" });
    const pageId = page.document.id;
    const saved = await invoke<SavedPage>("pages:save", {
      projectId,
      pageId,
      document: { ...page.document, title: "Edited in workbench" },
      baseHash: page.hash,
      baseRevision: page.revision,
    });
    expect(saved.hash).not.toBe(page.hash);
    const reference = await invoke("pages:reference", {
      projectId,
      pageId,
      target: { kind: "page", pageId },
      expectedHash: saved.hash,
    });
    expect(reference).toMatchObject({ type: "showai.reference", projectId, pageId, hash: saved.hash });
    const fromMcp = await client.callTool({
      name: "page_read",
      arguments: { projectId, pageId, response: "source" },
    });
    expect(fromMcp.isError, JSON.stringify(fromMcp.content)).not.toBe(true);
    expect(fromMcp.structuredContent).toMatchObject({
      data: { document: { id: pageId, title: "Edited in workbench" }, hash: saved.hash },
    });
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
