import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";
import { codexWorkbenchUri, codexWorkbenchThreadUri } from "./codex-workbench-ui";
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
    expect(tools.find((tool) => tool.name === "workbench_open_global")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchUri, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "global" }] },
    });
    expect(tools.find((tool) => tool.name === "workbench_open")?._meta).toEqual({
      ui: { resourceUri: "ui://showai/workbench.html", visibility: ["app"] },
    });
    expect(tools.find((tool) => tool.name === "workbench_open_page")?._meta).toMatchObject({
      ui: { resourceUri: codexWorkbenchThreadUri, visibility: ["app"] },
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
    const globalUrl = await open("workbench_open_global");
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

    const origin = "codex-sandbox://web-sandbox.oaiusercontent.com";
    const allowed = await fetch(new URL("/api/invoke", threadUrl), {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Headers": "Authorization, Content-Type" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    for (const forbiddenOrigin of [
      "https://outside.example",
      "codex-sandbox://web-sandbox.oaiusercontent.com.outside.example",
      "codex-sandbox://web-sandbox.oaiusercontent.com:8080",
      "null",
    ]) {
      const forbidden = await fetch(threadUrl, { headers: { Origin: forbiddenOrigin } });
      expect(forbidden.status).toBe(403);
    }

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

it("preserves the shared Board version and a conflicting draft when a Codex pane reconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-codex-workbench-recovery-"));
  const home = join(root, "library");
  const origin = "https://web-sandbox.oaiusercontent.com";
  const connections = new Set<Client>();
  const events = new AbortController();

  async function open(tool: string, profile: string) {
    const client = new Client({ name: "ShowAI workbench recovery test", version: "1" });
    connections.add(client);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "dist-agent/cli.mjs"), "mcp", "--home", home],
      env: { SHOWAI_CODEX_WORKBENCH_PROFILE: join(root, profile) },
      stderr: "pipe",
    }));
    const launch = await client.callTool({ name: tool, arguments: {} });
    expect(launch.isError, JSON.stringify(launch.content)).not.toBe(true);
    const url = new URL((launch._meta!.showaiWorkbench as { url: string }).url);
    const bootstrap = await fetch(url, { headers: { Origin: origin } });
    expect(bootstrap.status).toBe(200);
    const html = await bootstrap.text();
    const { token } = JSON.parse(/window\.__SHOWAI_LOCAL__=(\{[^<]+\})<\/script>/.exec(html)![1]);

    async function request(action: string, args: object) {
      return fetch(new URL("/api/invoke", url), {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, args }),
      });
    }

    async function invoke<T>(action: string, args: object) {
      const result = await (await request(action, args)).json();
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
      return result.data as T;
    }

    return { client, url, token, request, invoke };
  }

  try {
    const global = await open("workbench_open_global", "global-profile");
    const thread = await open("workbench_open_page", "thread-profile");
    expect(global.url.origin).not.toBe(thread.url.origin);
    const project = await global.invoke<{ id: string }>("projects:create", { name: "Concurrent workbench edits" });
    const projectId = project.id;
    const board = await global.invoke<SavedPage>("pages:create", { projectId, title: "Board baseline", kind: "board" });
    const pageId = board.document.id;
    const scope = { projectId, pageId };
    expect((await thread.invoke<SavedPage>("pages:get", scope)).hash).toBe(board.hash);
    const local = { ...board.document, title: "Thread draft" };
    const draft = await thread.invoke<{ id: string }>("drafts:save", {
      input: {
        kind: "page",
        clientId: "thread-editor",
        projectId,
        resourceId: pageId,
        baseRevision: board.revision,
        baseContent: board.document,
        content: local,
        sequence: 1,
      },
    });

    const url = new URL("/api/events", thread.url);
    url.searchParams.set("token", thread.token);
    url.searchParams.set("client", "thread-editor");
    const response = await fetch(url, {
      headers: { Origin: origin },
      signal: AbortSignal.any([events.signal, AbortSignal.timeout(7000)]),
    });
    expect(response.status).toBe(200);
    const stream = response.body!.getReader();
    const decoder = new TextDecoder();
    let pending = decoder.decode((await stream.read()).value, { stream: true });
    expect(pending).toContain('"type":"files"');

    const written = await global.invoke<SavedPage>("pages:save", {
      ...scope,
      document: { ...board.document, title: "Global saved" },
      baseHash: board.hash,
      baseRevision: board.revision,
    });
    let sawBoardChange = false;
    while (!sawBoardChange) {
      const event = await stream.read();
      if (event.done) throw new Error("Workbench change stream ended before the Board update.");
      pending += decoder.decode(event.value, { stream: true });
      const messages = pending.split("\n\n");
      pending = messages.pop()!;
      sawBoardChange = messages.some(message => {
        if (!message.startsWith("data: ")) return false;
        const update = JSON.parse(message.slice("data: ".length));
        return update.home === home && update.pageIds?.includes(pageId);
      });
    }
    await stream.cancel();

    const stale = await thread.request("pages:save", {
      ...scope,
      document: local,
      baseHash: board.hash,
      baseRevision: board.revision,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    await thread.client.close();
    connections.delete(thread.client);
    await expect(fetch(thread.url)).rejects.toThrow();
    const reopened = await open("workbench_open_page", "thread-profile");
    const resource = await reopened.client.readResource({ uri: codexWorkbenchThreadUri });
    const refresh = await reopened.client.callTool({
      name: "workbench_refresh",
      arguments: { mode: "thread" },
    });
    expect(refresh.isError, JSON.stringify(refresh.content)).not.toBe(true);
    const freshUrl = new URL((refresh._meta!.showaiWorkbench as { url: string }).url);
    expect(freshUrl.origin).toBe(reopened.url.origin);
    expect(freshUrl.origin).not.toBe(thread.url.origin);
    expect(freshUrl.searchParams.get("codexMode")).toBe("thread");
    expect(resource.contents[0]).toHaveProperty(
      "text",
      expect.stringContaining(`const workbenchOrigin = ${JSON.stringify(freshUrl.origin)}`),
    );
    expect(resource.contents[0]).not.toHaveProperty(
      "text",
      expect.stringContaining(freshUrl.searchParams.get("codexWorkbench")!),
    );
    const current = await reopened.invoke<SavedPage>("pages:get", scope);
    expect(current).toMatchObject({ hash: written.hash, revision: written.revision, document: { title: "Global saved" } });
    expect(await reopened.invoke("drafts:read", { id: draft.id })).toMatchObject({
      record: { projectId, resourceId: pageId, baseRevision: board.revision },
      content: { title: "Thread draft" },
      baseContent: { title: "Board baseline" },
    });
    const preview = await reopened.invoke<{
      conflicts: unknown[];
      document: ShowDocument;
      currentRevision: string;
    }>("page:mergePreview", {
      ...scope,
      baseRevision: board.revision,
      document: { ...board.document, icon: "🧭" },
    });
    expect(preview.conflicts).toEqual([]);
    expect(preview.document).toMatchObject({ title: "Global saved", icon: "🧭" });
    const merged = await reopened.invoke<SavedPage>("page:mergeSave", {
      ...scope,
      baseRevision: board.revision,
      currentRevision: preview.currentRevision,
      document: preview.document,
    });
    const fromMcp = await global.client.callTool({
      name: "page_read",
      arguments: { ...scope, response: "source" },
    });
    expect(fromMcp.isError, JSON.stringify(fromMcp.content)).not.toBe(true);
    expect(fromMcp.structuredContent).toMatchObject({
      data: { hash: merged.hash, document: { id: pageId, title: "Global saved", icon: "🧭" } },
    });
  } finally {
    events.abort();
    await Promise.all([...connections].map(client => client.close()));
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
