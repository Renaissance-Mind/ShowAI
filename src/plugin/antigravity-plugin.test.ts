import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import {
  antigravityCardUri,
  antigravityFileUri,
  antigravityWorkbenchConnection,
  buildAntigravitySidecarUrl,
  writeAntigravityNavTarget,
} from "../agent/antigravity-workbench";
import { createLibraryMcpServer } from "../agent/mcp-library";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";

interface SidecarModule {
  isAllowedSidecarOrigin(
    origin: string,
    sidecarPort: number,
    options?: { pathname?: string; authenticated?: boolean },
  ): boolean;
  startAntigravitySidecar(options: {
    port?: number;
    token?: string;
    env?: Record<string, string | undefined>;
    backend?: {
      ensure(): Promise<{ url: URL; home: string; webRoot?: string | null }>;
      stop(): Promise<void>;
      status(): { running: boolean; url: string | null; home: string | null };
    };
  }): Promise<{
    port: number;
    url: string;
    close(): Promise<void>;
  }>;
}

const { isAllowedSidecarOrigin, startAntigravitySidecar } = (await import(
  pathToFileURL(
    resolve(
      "plugins/showai/host-adapters/antigravity/sidecars/workbench/main.mjs",
    ),
  ).href
)) as SidecarModule;

const execute = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Antigravity page cards and live workbench navigation", () => {
  test("card_present, card_navigate, workbench_open_destination, and sidecar nav-events SSE coordinate end-to-end", async () => {
    const home = await makeTempDir("showai-ag-cards-");
    await openLibrary(home);
    const service = new AgentService({ root: home });
    const workbench = antigravityWorkbenchConnection(service, async (key) => ({
      url: "http://127.0.0.1:43210/",
      localUrl: `http://127.0.0.1:43210/?agWorkbench=${key}`,
      close: async () => {},
    }));
    const server = createLibraryMcpServer({
      root: home,
      icons: workbench.icons,
    });
    workbench.configure(server);
    const [left, right] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "antigravity-card-test", version: "1" });
    await server.connect(right);
    await client.connect(left);

    const upstream = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head></head><body>studio</body></html>");
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const addr = upstream.address();
    const upstreamPort = typeof addr === "object" && addr ? addr.port : 0;
    const upstreamUrl = new URL(`http://127.0.0.1:${upstreamPort}/`);

    const sidecar = await startAntigravitySidecar({
      port: 0,
      token: "nav-token",
      env: { ...process.env, SHOWAI_HOME: home },
      backend: {
        ensure: async () => ({ url: upstreamUrl, home }),
        stop: async () => {},
        status: () => ({ running: true, url: upstreamUrl.href, home }),
      },
    });

    try {
      const toolList = await client.listTools();
      const cardPresentMeta = toolList.tools.find(
        (item) => item.name === "card_present",
      )?._meta as { ui?: { resourceUri?: string; visibility?: string[] } } | undefined;
      expect(cardPresentMeta?.ui?.resourceUri).toBe(antigravityCardUri);
      expect(cardPresentMeta?.ui?.visibility).toEqual(["model", "app"]);
      const openDestMeta = toolList.tools.find(
        (item) => item.name === "workbench_open_destination",
      )?._meta as { ui?: { visibility?: string[] } } | undefined;
      expect(openDestMeta?.ui?.visibility).toEqual(["app"]);
      const openFileMeta = toolList.tools.find(
        (item) => item.name === "workbench_open_file",
      )?._meta as Record<string, any> | undefined;
      expect(openFileMeta?.ui?.resourceUri).toBe(antigravityFileUri);
      expect(openFileMeta?.["com.google.antigravity/ui"]?.entrypoints).toEqual([
        { type: "file", title: "ShowAI", extensions: [".showai-ref"] },
      ]);

      const fileViewerRes = await client.readResource({ uri: antigravityFileUri });
      const fvContent = fileViewerRes.contents[0];
      expect((fvContent?._meta as any)?.ui?.csp?.frameDomains).toEqual([
        "http://127.0.0.1:43210",
      ]);

      const resource = await client.readResource({ uri: antigravityCardUri });
      expect(resource.contents).toHaveLength(1);
      const cardContent = resource.contents[0];
      expect(cardContent?.mimeType).toBe("text/html;profile=mcp-app");
      const htmlText = cardContent && "text" in cardContent ? cardContent.text : "";
      expect(htmlText).toContain("showai-page-card");
      expect(htmlText).toContain("workbench_open_destination");

      const createdProject = await client.callTool({
        name: "project_create",
        arguments: { name: "Antigravity 卡片测试" },
      });
      const projectId = (createdProject.structuredContent as any).data.id as string;

      const pageOne = await client.callTool({
        name: "page_create",
        arguments: {
          projectId,
          title: "系统架构总览",
        },
      });
      const pageOneCreated = (pageOne.structuredContent as any).data;
      const pageOneId = pageOneCreated.document.id as string;
      const savedPageOne = await client.callTool({
        name: "page_apply",
        arguments: {
          projectId,
          pageId: pageOneId,
          baseHash: pageOneCreated.hash,
          baseRevision: pageOneCreated.revision,
          operations: [
            {
              type: "block.insert",
              node: {
                type: "heading",
                attrs: { id: "blk-hero", level: 2 },
                content: [{ type: "text", text: "核心模块" }],
              },
            },
          ],
        },
      });
      expect(savedPageOne.isError, JSON.stringify(savedPageOne.content)).not.toBe(true);

      const pageTwo = await client.callTool({
        name: "page_create",
        arguments: {
          projectId,
          title: "数据流设计",
        },
      });
      const pageTwoId = (pageTwo.structuredContent as any).data.document.id as string;

      // Single card presentation
      const singleCard = await client.callTool({
        name: "card_present",
        arguments: {
          projectId,
          pageId: pageOneId,
          blockId: "blk-hero",
          description: "新增核心模块章节与导航结构。",
        },
      });
      expect(singleCard.isError).not.toBe(true);
      expect((singleCard.structuredContent as any).data).toMatchObject({
        projectId,
        pageId: pageOneId,
        blockId: "blk-hero",
        title: "系统架构总览",
        description: "新增核心模块章节与导航结构。",
      });
      expect((singleCard._meta as any).showaiPageCard).toMatchObject({
        projectId,
        pageId: pageOneId,
        blockId: "blk-hero",
      });

      // Multi-card group presentation
      const groupCards = await client.callTool({
        name: "card_present",
        arguments: {
          projectId,
          pageId: pageOneId,
          additionalTargets: [{ projectId, pageId: pageTwoId }],
          adjustSpacing: true,
        },
      });
      expect(groupCards.isError).not.toBe(true);
      expect((groupCards.structuredContent as any).data.adjustSpacing).toBe(true);
      expect((groupCards.structuredContent as any).data.cards).toHaveLength(2);
      expect((groupCards._meta as any).showaiCardGroup.cards).toHaveLength(2);

      // Before any visible sidecar SSE client connects, workbench_open_destination returns queued + .showai-ref fileUri for toggle-aux-pane
      const closedPaneOpen = await client.callTool({
        name: "workbench_open_destination",
        arguments: {
          projectId,
          pageId: pageOneId,
          blockId: "blk-hero",
          destination: "workbench",
        },
      });
      const closedData = (closedPaneOpen._meta as any).showaiWorkbenchData;
      expect(closedData).toMatchObject({
        status: "queued",
        sidecarUrl: buildAntigravitySidecarUrl({
          projectId,
          pageId: pageOneId,
          blockId: "blk-hero",
        }),
      });
      expect(closedData.fileUri).toMatch(/^file:\/\/.*\.showai-ref$/);
      expect(closedData.launchUrl).toContain("http://127.0.0.1:43210/?agWorkbench=");
      const refSource = await import("node:fs/promises").then((fs) =>
        fs.readFile(fileURLToPath(closedData.fileUri), "utf8"),
      );
      const resolvedRef = await client.callTool({
        name: "workbench_resolve_reference",
        arguments: { source: refSource },
      });
      expect((resolvedRef._meta as any).showaiWorkbenchData).toMatchObject({
        projectId,
        pageId: pageOneId,
        blockId: "blk-hero",
      });

      // Connect SSE client initially hidden (collapsed side pane): status stays queued so card still pops open side panel!
      const abort = new AbortController();
      const sseRes = await fetch(
        `${sidecar.url}/_antigravity/nav-events?token=nav-token&clientId=c1&visible=0`,
        { signal: abort.signal },
      );
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
      const reader = sseRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const nextNavPayload = async () => {
        while (true) {
          const match = /data:\s*(\{[^\n]+\})\n\n/.exec(buffer);
          if (match) {
            buffer = buffer.slice(match.index + match[0].length);
            return JSON.parse(match[1]);
          }
          const { value, done } = await reader.read();
          if (done) throw new Error("SSE stream closed early");
          buffer += decoder.decode(value, { stream: true });
        }
      };

      const initialDelivered = await nextNavPayload();
      expect(initialDelivered).toMatchObject({
        projectId,
        pageId: pageOneId,
        blockId: "blk-hero",
      });

      // While clientId=c1 has visible=0, card_navigate still reports queued (no false-positive from hidden background iframe!)
      const whileHidden = await client.callTool({
        name: "card_navigate",
        arguments: { projectId, pageId: pageOneId },
      });
      expect((whileHidden.structuredContent as any).data.status).toBe("queued");
      expect(await nextNavPayload()).toMatchObject({
        projectId,
        pageId: pageOneId,
      });

      // Mark sidecar client visible -> now workbench_open_destination reports accepted!
      const visRes = await fetch(
        `${sidecar.url}/_antigravity/client-visibility?token=nav-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: "c1", visible: true }),
        },
      );
      expect(visRes.status).toBe(200);

      // Now that SSE client is active, workbench_open_destination returns accepted and streams live
      const liveJump = await client.callTool({
        name: "workbench_open_destination",
        arguments: {
          projectId,
          pageId: pageTwoId,
          destination: "workbench",
        },
      });
      expect(liveJump.isError).not.toBe(true);
      expect((liveJump._meta as any).showaiWorkbenchData).toMatchObject({
        status: "accepted",
      });
      const secondDelivered = await nextNavPayload();
      expect(secondDelivered).toMatchObject({
        projectId,
        pageId: pageTwoId,
      });

      // Direct helper check as well
      const helperResult = await writeAntigravityNavTarget(home, {
        projectId,
        pageId: pageOneId,
      });
      expect(helperResult.status).toBe("accepted");

      // Archived (deleted) pages are rejected by card_present and card_navigate
      const recTwo = await service.store.readPage(projectId, pageTwoId);
      await service.store.savePage(
        projectId,
        pageTwoId,
        { ...recTwo.document, archived: true },
        recTwo.hash,
        recTwo.revision,
      );
      const deletedCard = await client.callTool({
        name: "card_present",
        arguments: { projectId, pageId: pageTwoId },
      });
      expect(deletedCard.isError).toBe(true);
      expect((deletedCard.structuredContent as any).error.code).toBe("NOT_FOUND");
      const deletedNav = await client.callTool({
        name: "card_navigate",
        arguments: { projectId, pageId: pageTwoId },
      });
      expect(deletedNav.isError).toBe(true);
      expect((deletedNav.structuredContent as any).error.code).toBe("NOT_FOUND");

      abort.abort();
      await reader.cancel().catch(() => {});
    } finally {
      await sidecar.close();
      await new Promise<void>((done) => upstream.close(() => done()));
      await client.close();
      await server.close();
      await syncManager(home).stop();
    }
  });
});

describe("Antigravity sidecar workbench proxy", () => {
  test("allows plugin://showai--workbench-<port> and loopback origins while blocking foreign origins", async () => {
    let upstreamHits = 0;
    const upstream = createServer((req, res) => {
      upstreamHits++;
      const expectedOrigin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden origin");
        return;
      }
      if (req.url === "/assets/index.js") {
        res.writeHead(200, {
          "Content-Type": "text/javascript",
          "X-Frame-Options": "DENY",
        });
        res.end("export const ok = true;");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
      });
      res.end("<!doctype html><html><head></head><body>ok</body></html>");
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const upstreamAddress = upstream.address();
    const upstreamPort =
      typeof upstreamAddress === "object" && upstreamAddress
        ? upstreamAddress.port
        : 0;
    const upstreamUrl = new URL(`http://127.0.0.1:${upstreamPort}/`);

    const sidecar = await startAntigravitySidecar({
      port: 0,
      token: "origin-test-token",
      backend: {
        ensure: async () => ({ url: upstreamUrl, home: "/tmp/showai-origin" }),
        stop: async () => {},
        status: () => ({
          running: true,
          url: upstreamUrl.href,
          home: "/tmp/showai-origin",
        }),
      },
    });

    try {
      // Antigravity's sidecar gateway listens on its own loopback port (e.g. sidecar.port + 3)
      // and loads the webview from plugin://showai--workbench-<gatewayPort>.
      const gatewayPort = (sidecar.port % 60000) + 3;
      const gatewayPluginOrigin = `plugin://showai--workbench-${gatewayPort}`;
      const gatewayLoopbackOrigin = `http://127.0.0.1:${gatewayPort}`;

      expect(isAllowedSidecarOrigin(gatewayPluginOrigin, sidecar.port)).toBe(true);
      expect(
        isAllowedSidecarOrigin(`http://127.0.0.1:${sidecar.port}`, sidecar.port),
      ).toBe(true);
      expect(
        isAllowedSidecarOrigin(gatewayLoopbackOrigin, sidecar.port, {
          pathname: "/assets/index.js",
        }),
      ).toBe(true);
      expect(
        isAllowedSidecarOrigin(gatewayLoopbackOrigin, sidecar.port, {
          pathname: "/",
          authenticated: false,
        }),
      ).toBe(false);
      expect(
        isAllowedSidecarOrigin(gatewayLoopbackOrigin, sidecar.port, {
          pathname: "/",
          authenticated: true,
        }),
      ).toBe(true);
      expect(
        isAllowedSidecarOrigin(`plugin://other--workbench-${gatewayPort}`, sidecar.port),
      ).toBe(false);
      expect(
        isAllowedSidecarOrigin("plugin://showai--workbench-70000", sidecar.port),
      ).toBe(false);
      expect(isAllowedSidecarOrigin("https://evil.example", sidecar.port)).toBe(false);

      // Module asset request with Antigravity desktop plugin:// gateway origin succeeds and strips X-Frame-Options.
      const assetRes = await fetch(`${sidecar.url}/assets/index.js`, {
        headers: { Origin: gatewayPluginOrigin },
      });
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("access-control-allow-origin")).toBe(gatewayPluginOrigin);
      expect(assetRes.headers.get("access-control-allow-credentials")).toBe("true");
      expect(assetRes.headers.get("x-frame-options")).toBeNull();
      expect(await assetRes.text()).toContain("export const ok = true;");

      // Asset request via loopback HTTP gateway port succeeds, while unauthenticated root HTML read from another port is blocked.
      const gwAssetRes = await fetch(`${sidecar.url}/assets/index.js`, {
        headers: { Origin: gatewayLoopbackOrigin },
      });
      expect(gwAssetRes.status).toBe(200);

      const unauthRoot = await fetch(`${sidecar.url}/`, {
        headers: { Origin: gatewayLoopbackOrigin },
      });
      expect(unauthRoot.status).toBe(403);

      const authRoot = await fetch(`${sidecar.url}/`, {
        headers: {
          Origin: gatewayLoopbackOrigin,
          "X-Sidecar-Token": "origin-test-token",
        },
      });
      expect(authRoot.status).toBe(200);

      // Preflight OPTIONS from plugin:// gateway origin succeeds.
      const preflight = await fetch(`${sidecar.url}/api/invoke`, {
        method: "OPTIONS",
        headers: { Origin: gatewayPluginOrigin },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(gatewayPluginOrigin);

      // Foreign origins are rejected with 403 before reaching upstream.
      const hitsBeforeReject = upstreamHits;
      for (const badOrigin of [
        "https://evil.example",
        `plugin://other--workbench-${sidecar.port}`,
        `plugin://other--workbench-${gatewayPort}`,
        "plugin://showai--workbench-70000",
      ]) {
        const blocked = await fetch(`${sidecar.url}/assets/index.js`, {
          headers: { Origin: badOrigin },
        });
        expect(blocked.status, badOrigin).toBe(403);
        expect(await blocked.text()).toBe("Forbidden origin");
      }
      expect(upstreamHits).toBe(hitsBeforeReject);
    } finally {
      await sidecar.close();
      await new Promise<void>((done) => upstream.close(() => done()));
    }
  });

  test("injects preload + bridge scripts, adapts CSP for plugin:// + blob workers, proxies API/SSE, and enforces sidecar token", async () => {
    const upstream = createServer((req, res) => {
      if (req.url?.startsWith("/api/events")) {
        const reqUrl = new URL(req.url, "http://127.0.0.1");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write(
          `data: ${JSON.stringify({ type: "ready", token: reqUrl.searchParams.get("token") })}\n\n`,
        );
        res.end();
        return;
      }
      if (req.url === "/api/invoke" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              auth: req.headers.authorization,
              leakedSidecarToken: req.headers["x-sidecar-token"] ?? null,
              echo: JSON.parse(body),
            }),
          );
        });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
      });
      res.end(
        '<!doctype html><html><head><title>ShowAI</title><script>window.__SHOWAI_LOCAL__={"token":"abc"}</script><script type="module" crossorigin src="./assets/index.js"></script><link rel="modulepreload" crossorigin href="./assets/vendor.js"><link rel="stylesheet" crossorigin href="./assets/index.css"></head><body><div id="root"></div></body></html>',
      );
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const upstreamAddress = upstream.address();
    const upstreamPort =
      typeof upstreamAddress === "object" && upstreamAddress
        ? upstreamAddress.port
        : 0;
    const upstreamUrl = new URL(`http://127.0.0.1:${upstreamPort}/`);

    const sidecar = await startAntigravitySidecar({
      port: 0,
      token: "secret-sidecar-token",
      backend: {
        ensure: async () => ({ url: upstreamUrl, home: "/tmp/showai-test" }),
        stop: async () => {},
        status: () => ({
          running: true,
          url: upstreamUrl.href,
          home: "/tmp/showai-test",
        }),
      },
    });

    try {
      const rootRes = await fetch(`${sidecar.url}/?project=p1&page=pg1`);
      expect(rootRes.status).toBe(200);
      const csp = rootRes.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("frame-ancestors *");
      expect(csp).toContain("default-src 'self' plugin:");
      expect(csp).toContain("script-src 'self' plugin: 'unsafe-inline' blob:");
      expect(csp).toContain("worker-src 'self' plugin: blob:");
      expect(csp).toContain("connect-src 'self' plugin: data: blob:");
      expect(rootRes.headers.get("referrer-policy")).toBeNull();
      const html = await rootRes.text();
      expect(html).toContain(
        '<script src="/preload.js"></script><script src="/_antigravity/bridge.js"></script>',
      );
      expect(html).not.toContain("crossorigin");
      expect(html).toContain("window.__SHOWAI_LOCAL__");

      const bridgeRes = await fetch(`${sidecar.url}/_antigravity/bridge.js`);
      expect(bridgeRes.status).toBe(200);
      const bridgeJs = await bridgeRes.text();
      expect(bridgeJs).toContain("__SHOWAI_ANTIGRAVITY_HOST__");
      expect(bridgeJs).toContain("addArtifactComment");
      expect(bridgeJs).toContain("X-Sidecar-Token");
      expect(bridgeJs).toContain("showai_token");

      const healthRes = await fetch(`${sidecar.url}/_antigravity/health`);
      expect(await healthRes.json()).toMatchObject({
        ok: true,
        backend: { running: true },
      });

      const apiRes = await fetch(`${sidecar.url}/api/invoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
          "X-Sidecar-Token": "secret-sidecar-token",
        },
        body: JSON.stringify({ action: "projects:list", args: {} }),
      });
      expect(await apiRes.json()).toEqual({
        ok: true,
        auth: "Bearer test-token",
        leakedSidecarToken: null,
        echo: { action: "projects:list", args: {} },
      });

      const sseRes = await fetch(
        `${sidecar.url}/api/events?showai_token=real-showai-tok&token=secret-sidecar-token`,
      );
      expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
      expect(await sseRes.text()).toContain('"token":"real-showai-tok"');

      // Sidecar agent API requires valid token.
      const unauth = await fetch(`${sidecar.url}/_sidecar/send-message`, {
        method: "POST",
        body: "{}",
      });
      expect(unauth.status).toBe(401);
    } finally {
      await sidecar.close();
      await new Promise<void>((done) => upstream.close(() => done()));
    }
  });

  test("renders theme-aware status page when backend fails to start", async () => {
    const sidecar = await startAntigravitySidecar({
      port: 0,
      token: "tok",
      backend: {
        ensure: async () => {
          throw new Error("runtime missing");
        },
        stop: async () => {},
        status: () => ({ running: false, url: null, home: null }),
      },
    });
    try {
      const res = await fetch(`${sidecar.url}/`);
      expect(res.status).toBe(503);
      const html = await res.text();
      expect(html).toContain("无法启动 ShowAI 工作台");
      expect(html).toContain("runtime missing");
      expect(html).toContain("/_antigravity/restart");
    } finally {
      await sidecar.close();
    }
  });

  test("compiles multi-chunk ESM workbench entry into a classic IIFE script for plugin:// scheme compatibility", async () => {
    const webRoot = await makeTempDir("showai-ag-webroot-");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(
      join(webRoot, "assets/lazy.js"),
      "export const studioLabel = 'ShowAI Studio Ready';\n",
      "utf8",
    );
    await writeFile(
      join(webRoot, "assets/index-test.js"),
      `import { studioLabel } from "./lazy.js";
const assetBase = new URL("./style.css", import.meta.url).href;
window.__MOUNTED__ = { studioLabel, assetBase, env: import.meta.env };
`,
      "utf8",
    );
    const indexHtml =
      '<!doctype html><html><head><script type="module" crossorigin src="./assets/index-test.js"></script><link rel="modulepreload" crossorigin href="./assets/lazy.js"><link rel="stylesheet" crossorigin href="./assets/style.css"></head><body><div id="root"></div></body></html>';
    await writeFile(join(webRoot, "index.html"), indexHtml, "utf8");

    const upstream = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const addr = upstream.address();
    const upstreamPort = typeof addr === "object" && addr ? addr.port : 0;
    const upstreamUrl = new URL(`http://127.0.0.1:${upstreamPort}/`);

    const sidecar = await startAntigravitySidecar({
      port: 0,
      token: "iife-token",
      backend: {
        ensure: async () => ({ url: upstreamUrl, home: "/tmp/showai-iife", webRoot }),
        stop: async () => {},
        status: () => ({ running: true, url: upstreamUrl.href, home: "/tmp/showai-iife" }),
      },
    });

    try {
      const rootRes = await fetch(`${sidecar.url}/`);
      expect(rootRes.status).toBe(200);
      const html = await rootRes.text();
      expect(html).not.toContain('type="module"');
      expect(html).not.toContain('rel="modulepreload"');
      expect(html).toContain('<link rel="stylesheet" href="./assets/style.css">');
      const bundleMatch = /<script defer src="(\/_antigravity\/workbench\.js\?v=[0-9a-f]+)"><\/script>/.exec(
        html,
      );
      expect(bundleMatch).toBeTruthy();

      const bundleRes = await fetch(`${sidecar.url}${bundleMatch![1]}`);
      expect(bundleRes.status).toBe(200);
      expect(bundleRes.headers.get("content-type")).toContain("application/javascript");
      const bundleJs = await bundleRes.text();
      expect(bundleJs).toContain("ShowAI Studio Ready");
      expect(bundleJs).toContain("__SHOWAI_ASSET_URL__");
      expect(bundleJs).not.toMatch(/\bimport\s*\{/);
    } finally {
      await sidecar.close();
      await new Promise<void>((done) => upstream.close(() => done()));
    }
  });
});

describe("Antigravity committed package validation", () => {
  test("plugins/showai-antigravity passes agy plugin validate --strict when agy is available", async () => {
    let stdout: string;
    try {
      stdout = (
        await execute("agy", [
          "plugin",
          "validate",
          resolve("plugins/showai-antigravity"),
          "--strict",
          "--json",
        ])
      ).stdout;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({
      name: "showai",
      agentPluginsSpec: false,
      components: {
        hooks: 0,
        mcpServers: 1,
        sidecars: 1,
        skills: 6,
      },
      findings: [],
    });
  });

  test("mcp/launch.mjs pins runtime cwd to home so in-place plugin reinstall does not break process.cwd()", async () => {
    const root = await makeTempDir("showai-ag-cwd-");
    const home = join(root, "home");
    const pluginDir = join(root, "plugin");
    const runtimeEntry = join(root, "fake-cli.mjs");
    await mkdir(home, { recursive: true });
    await cp(resolve("plugins/showai-antigravity"), pluginDir, {
      recursive: true,
    });

    await writeFile(
      runtimeEntry,
      `import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "runtime" && args[1] === "info") {
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      version: "0.12.0",
      home: process.env.SHOWAI_HOME,
      capabilities: {
        agentOperations: { protocol: "showai-mcp-v1", toolSurface: "showai-mcp-tools-v2" },
        templateWorkflow: { protocol: "showai-template-workflow-v3" },
        componentParameters: { protocol: "showai-component-parameters-v1" },
      },
    },
  }) + "\\n");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: msg.id, cwd: realpathSync(process.cwd()) }) + "\\n");
}
`,
      "utf8",
    );

    await writeFile(
      join(home, "agent-runtime.json"),
      JSON.stringify({
        format: "showai-agent-runtime",
        protocol: 1,
        version: "0.12.0",
        home,
        launch: {
          command: process.execPath,
          args: [runtimeEntry],
          env: { SHOWAI_HOME: home },
        },
        channel: "packaged",
      }),
      "utf8",
    );

    const child = spawn(process.execPath, [join(pluginDir, "mcp/launch.mjs")], {
      cwd: pluginDir,
      env: { ...process.env, SHOWAI_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const lines = createInterface({ input: child.stdout });
    const iterator = lines[Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      expect(JSON.parse(first.value as string)).toEqual({ ready: true });

      // Simulate Antigravity replacing ~/.gemini/config/plugins/showai in place while MCP stays open.
      await rm(pluginDir, { recursive: true, force: true });

      child.stdin.write(JSON.stringify({ id: 1 }) + "\n");
      const reply = JSON.parse((await iterator.next()).value as string);
      expect(reply.id).toBe(1);
      expect(reply.cwd).toContain("home");
    } finally {
      child.kill("SIGTERM");
    }
  });
});
