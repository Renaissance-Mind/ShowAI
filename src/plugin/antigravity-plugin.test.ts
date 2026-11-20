import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";

interface HookModule {
  handleHookEvent(
    payload: Record<string, unknown>,
    env?: Record<string, string | undefined>,
  ): Promise<{
    injectSteps?: { systemMessage?: { systemMessage?: string } }[];
  }>;
  isOfflineBundledFragment(html: string): boolean;
  wrapForAntigravityEmbed(html: string, options?: { title?: string }): string;
}

interface SidecarModule {
  startAntigravitySidecar(options: {
    port?: number;
    token?: string;
    env?: Record<string, string | undefined>;
    backend?: {
      ensure(): Promise<{ url: URL; home: string }>;
      stop(): Promise<void>;
      status(): { running: boolean; url: string | null; home: string | null };
    };
  }): Promise<{
    port: number;
    url: string;
    close(): Promise<void>;
  }>;
}

const {
  handleHookEvent,
  isOfflineBundledFragment,
  wrapForAntigravityEmbed,
} = (await import(
  pathToFileURL(
    resolve("plugins/showai/host-adapters/antigravity/hooks/preview-hook.mjs"),
  ).href
)) as HookModule;

const { startAntigravitySidecar } = (await import(
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

describe("Antigravity preview hook", () => {
  test("wraps bundled inline fragments with Antigravity theme sync and stages via PostToolUse + PreInvocation", async () => {
    const root = await makeTempDir("showai-ag-hook-");
    const home = join(root, "home");
    const previewDir = join(home, "local/agent-previews/abc");
    const artifactDir = join(root, "artifacts");
    const transcriptPath = join(root, "transcript.jsonl");
    await mkdir(previewDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });

    const inlineFile = join(previewDir, "page.inline.html");
    const fragment =
      '<section id="showai-1" data-showai-inline-root><p>Hello ShowAI</p></section>';
    await writeFile(inlineFile, fragment, "utf8");

    const toolOutput = {
      ok: true,
      data: {
        title: "架构演进报告",
        projectId: "proj-1",
        pageId: "page-2",
        openUrl: "showai://project/proj-1/page/page-2",
        display: { reader: "bundled" },
        delivery: {
          mode: "fragment-file",
          inline: inlineFile,
          html: join(previewDir, "page.html"),
        },
      },
    };
    await writeFile(
      transcriptPath,
      JSON.stringify({
        type: "GENERIC",
        content: [{ type: "text", text: JSON.stringify(toolOutput) }],
      }) + "\n",
      "utf8",
    );

    const postResult = await handleHookEvent(
      {
        hookEventName: "PostToolUse",
        artifactDirectoryPath: artifactDir,
        transcriptPath,
        toolCall: {
          id: "call_1",
          name: "mcp_showai_page_present",
          args: { projectId: "proj-1", pageId: "page-2" },
        },
      },
      { SHOWAI_HOME: home },
    );
    expect(postResult).toEqual({});

    const preResult = await handleHookEvent({
      hookEventName: "PreInvocation",
      artifactDirectoryPath: artifactDir,
    });
    const injected =
      preResult.injectSteps?.[0]?.systemMessage?.systemMessage ?? "";
    expect(injected).toContain("<agent-embed src=\"file://");
    expect(injected).toContain(
      "[在 ShowAI 工作台打开《架构演进报告》](sidecar://showai/workbench/?project=proj-1&page=page-2)",
    );
    expect(injected).toContain("Do NOT run `cp` or `write_file`");

    const match = /showai-preview-[0-9a-f]+\.html/.exec(injected);
    expect(match).toBeTruthy();
    const stagedHtml = await readFile(join(artifactDir, match![0]), "utf8");
    expect(stagedHtml).toMatch(/^<!DOCTYPE html>/);
    expect(stagedHtml).toContain("Hello ShowAI");
    expect(stagedHtml).toContain('addEventListener("themechange"');

    // Second PreInvocation is a no-op because the pending file was consumed.
    const secondPre = await handleHookEvent({
      hookEventName: "PreInvocation",
      artifactDirectoryPath: artifactDir,
    });
    expect(secondPre).toEqual({});
  });

  test("rejects CDN fragments, errored tool calls, and files outside preview roots", async () => {
    const root = await makeTempDir("showai-ag-hook-guard-");
    const home = join(root, "home");
    const previewDir = join(home, "local/agent-previews/cdn");
    const artifactDir = join(root, "artifacts");
    const outsideFile = join(root, "secret.inline.html");
    await mkdir(previewDir, { recursive: true });
    await mkdir(artifactDir, { recursive: true });

    const cdnHtml =
      '<section data-showai-inline-root></section><script src="https://cdn.example.com/reader.js"></script>';
    expect(isOfflineBundledFragment(cdnHtml)).toBe(false);
    const cdnFile = join(previewDir, "cdn.inline.html");
    await writeFile(cdnFile, cdnHtml, "utf8");
    await writeFile(outsideFile, "<section>outside</section>", "utf8");

    const transcriptOutside = join(root, "outside.jsonl");
    await writeFile(
      transcriptOutside,
      JSON.stringify({
        content: JSON.stringify({
          data: {
            display: { reader: "bundled" },
            delivery: { inline: outsideFile },
          },
        }),
      }) + "\n",
    );

    await handleHookEvent(
      {
        hookEventName: "PostToolUse",
        artifactDirectoryPath: artifactDir,
        transcriptPath: transcriptOutside,
        toolCall: { name: "show_component", args: {} },
      },
      { SHOWAI_HOME: home },
    );
    expect(
      await handleHookEvent({
        hookEventName: "PreInvocation",
        artifactDirectoryPath: artifactDir,
      }),
    ).toEqual({});

    // Verify fallback scan skips CDN fragments too.
    await handleHookEvent(
      {
        hookEventName: "PostToolUse",
        artifactDirectoryPath: artifactDir,
        toolCall: { name: "show_component", args: {} },
      },
      { SHOWAI_HOME: home },
    );
    expect(
      await handleHookEvent({
        hookEventName: "PreInvocation",
        artifactDirectoryPath: artifactDir,
      }),
    ).toEqual({});
  });

  test("wrapForAntigravityEmbed preserves full HTML documents while adding theme sync", () => {
    const wrapped = wrapForAntigravityEmbed(
      "<!DOCTYPE html><html><body><div data-showai-inline-root></div></body></html>",
    );
    expect(wrapped).toContain('addEventListener("themechange"');
    expect(wrapped.match(/<!DOCTYPE html>/gi)?.length).toBe(1);
  });
});

describe("Antigravity sidecar workbench proxy", () => {
  test("injects preload + bridge scripts, relaxes frame-ancestors, proxies API/SSE, and enforces sidecar token", async () => {
    const upstream = createServer((req, res) => {
      if (req.url?.startsWith("/api/events")) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        res.write("data: {\"type\":\"ready\"}\n\n");
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
              echo: JSON.parse(body),
            }),
          );
        });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
      });
      res.end(
        '<!doctype html><html><head><title>ShowAI</title><script>window.__SHOWAI_LOCAL__={"token":"abc"}</script></head><body><div id="root"></div></body></html>',
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
      expect(rootRes.headers.get("content-security-policy")).toContain(
        "frame-ancestors *",
      );
      const html = await rootRes.text();
      expect(html).toContain(
        '<head><script src="/preload.js"></script><script src="/_antigravity/bridge.js"></script>',
      );
      expect(html).toContain("window.__SHOWAI_LOCAL__");

      const bridgeRes = await fetch(`${sidecar.url}/_antigravity/bridge.js`);
      expect(bridgeRes.status).toBe(200);
      const bridgeJs = await bridgeRes.text();
      expect(bridgeJs).toContain("__SHOWAI_ANTIGRAVITY_HOST__");
      expect(bridgeJs).toContain("addArtifactComment");
      expect(bridgeJs).toContain("/api/invoke");

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
        },
        body: JSON.stringify({ action: "projects:list", args: {} }),
      });
      expect(await apiRes.json()).toEqual({
        ok: true,
        auth: "Bearer test-token",
        echo: { action: "projects:list", args: {} },
      });

      const sseRes = await fetch(`${sidecar.url}/api/events`);
      expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
      expect(await sseRes.text()).toContain('"type":"ready"');

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
        hooks: 1,
        mcpServers: 1,
        sidecars: 1,
        skills: 6,
      },
      findings: [],
    });
  });
});
