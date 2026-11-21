#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIND_HOST = "127.0.0.1";
const BRIDGE_JS = readFileSync(join(__dirname, "bridge.js"), "utf8");
const PLUGIN_ORIGIN_RE = /^plugin:\/\/showai--workbench(?:-(\d{1,5}))?$/;
const LOOPBACK_ORIGIN_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d{1,5})$/;

function loadPreloadJs() {
  const candidates = [];
  if (typeof import.meta.resolve === "function") {
    try {
      candidates.push(fileURLToPath(import.meta.resolve("sidecar_sdk/preload.js")));
    } catch {
      // Fall through to well-known Antigravity SDK paths.
    }
  }
  const home = homedir();
  candidates.push(
    join(home, ".gemini/antigravity/lib/node_modules/sidecar_sdk/preload.js"),
    join(home, ".gemini/config/node_modules/sidecar_sdk/preload.js"),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  return "window.sidecar = window.sidecar || { ui: {}, agent: {}, getWorkspaceUris: async () => [], onWorkspaceChange: () => () => {} };\n";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderStatusHtml(title, detail, canRetry = true) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ShowAI</title>
<script src="/preload.js"></script>
<style>
body {
  margin: 0;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--background, #fafafa);
  color: var(--foreground, #1f2937);
}
.card {
  max-width: 520px;
  margin: 24px auto;
  padding: 20px;
  border-radius: 12px;
  background: var(--card, #ffffff);
  border: 1px solid var(--border, #e5e7eb);
}
h1 { font-size: 16px; margin: 0 0 8px; }
p { font-size: 13px; line-height: 1.6; color: var(--muted-foreground, #6b7280); margin: 0 0 14px; white-space: pre-wrap; word-break: break-word; }
button {
  appearance: none;
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: var(--primary, #06a5fa);
  color: var(--primary-foreground, #ffffff);
}
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(detail)}</p>
  ${canRetry ? '<button id="retry" type="button">重新连接 ShowAI</button>' : ""}
</div>
<script>
const retry = document.getElementById("retry");
if (retry) {
  retry.addEventListener("click", async () => {
    retry.disabled = true;
    retry.textContent = "正在连接…";
    try {
      await (window.sidecar?.fetch ? window.sidecar.fetch("/_antigravity/restart", { method: "POST", body: "{}" }) : fetch("/_antigravity/restart", { method: "POST" }));
    } catch {}
    window.location.reload();
  });
}
</script>
</body>
</html>
`;
}

function validateToken(expected, req, url) {
  if (!expected) return true;
  const provided =
    (typeof req.headers["x-sidecar-token"] === "string"
      ? req.headers["x-sidecar-token"]
      : "") ||
    url.searchParams.get("token") ||
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function runAgentApi(args, { projectId, env = process.env } = {}) {
  const nextEnv = { ...env };
  if (projectId) nextEnv.ANTIGRAVITY_PROJECT_ID = projectId;
  const exe = nextEnv.ANTIGRAVITY_AGENTAPI_EXE;
  const file = exe || "agentapi";
  const execArgs = exe ? ["agentapi", ...args] : args;
  const out = execFileSync(file, execArgs, { encoding: "utf8", env: nextEnv });
  return out.trim() ? JSON.parse(out) : {};
}

async function resolveRuntimeLaunch(env = process.env) {
  const home = resolve(env.SHOWAI_HOME || join(homedir(), ".showai"));
  const configPath = env.SHOWAI_RUNTIME_CONFIG || join(home, "agent-runtime.json");
  const raw = await readFile(configPath, "utf8").catch((error) => {
    throw new Error(
      `未找到 ShowAI 运行时登记文件（${configPath}）：${error.message}。请先打开 ShowAI App 并在「设置 → 插件」更新 Antigravity 插件。`,
    );
  });
  const config = JSON.parse(raw);
  if (
    config?.format !== "showai-agent-runtime" ||
    config.protocol !== 1 ||
    !isAbsolute(config.launch?.command ?? "") ||
    !Array.isArray(config.launch?.args) ||
    !config.launch.args.length
  ) {
    throw new Error(`ShowAI 运行时配置格式无效：${configPath}`);
  }
  const cliEntry = resolve(config.launch.args[0]);
  return {
    home,
    cliEntry,
    command: config.launch.command,
    args: [
      ...config.launch.args,
      "serve",
      "--home",
      home,
      "--port",
      "0",
      "--no-open",
      "--json",
    ],
    env: {
      ...env,
      ...config.launch.env,
      SHOWAI_HOME: home,
    },
  };
}

function resolveWebRoot(cliEntry) {
  if (!cliEntry) return null;
  for (const rel of ["../web", "../dist"]) {
    const candidate = resolve(dirname(cliEntry), rel);
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return null;
}

async function loadEsbuild(cliEntry) {
  const roots = [cliEntry ? dirname(cliEntry) : null, __dirname].filter(Boolean);
  for (const start of roots) {
    let cur = start;
    while (true) {
      const candidate = join(cur, "node_modules/esbuild/lib/main.js");
      if (existsSync(candidate)) {
        return import(pathToFileURL(candidate).href);
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return import("esbuild");
}

function createClassicBundleCompiler(env = process.env) {
  let cachedKey = "";
  let cachedPromise = null;

  async function compile(webRoot, entryRelativePath) {
    const entryPath = resolve(webRoot, entryRelativePath);
    if (!entryPath.startsWith(resolve(webRoot) + "/") && entryPath !== resolve(webRoot)) {
      throw new Error("Invalid workbench entry path.");
    }
    const info = await stat(entryPath);
    const cacheKey = `${entryPath}:${info.size}:${Math.trunc(info.mtimeMs)}`;
    if (cachedKey === cacheKey && cachedPromise) return cachedPromise;

    const task = (async () => {
      const digest = createHash("sha256").update(cacheKey).digest("hex").slice(0, 16);
      const dataDir = env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
      const diskCache = dataDir
        ? join(dataDir, `workbench-iife-${digest}.js`)
        : null;
      if (diskCache && existsSync(diskCache)) {
        const bytes = await readFile(diskCache);
        return { digest, bytes };
      }
      const esbuild = await loadEsbuild(webRoot);
      const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        format: "iife",
        minify: true,
        write: false,
        target: "es2022",
        logLevel: "error",
        define: {
          "import.meta.url": "window.__SHOWAI_ASSET_URL__",
          "import.meta.resolve": "undefined",
          "import.meta.env": "{}",
        },
      });
      const bytes = Buffer.from(result.outputFiles[0].contents);
      if (diskCache) {
        await mkdir(dirname(diskCache), { recursive: true }).catch(() => {});
        await writeFile(diskCache, bytes).catch(() => {});
      }
      return { digest, bytes };
    })();

    cachedKey = cacheKey;
    cachedPromise = task.catch((err) => {
      if (cachedPromise === task) {
        cachedKey = "";
        cachedPromise = null;
      }
      throw err;
    });
    return cachedPromise;
  }

  return { compile };
}

function createBackendManager(env = process.env) {
  let active = null;
  let starting = null;

  async function stop() {
    const current = active;
    active = null;
    if (current?.child && !current.child.killed) {
      current.child.kill("SIGTERM");
    }
  }

  async function start() {
    const spec = await resolveRuntimeLaunch(env);
    await mkdir(spec.home, { recursive: true }).catch(() => {});
    return new Promise((done, fail) => {
      const child = spawn(spec.command, spec.args, {
        cwd: spec.home,
        env: spec.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;
      let stderr = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        fail(
          new Error(`ShowAI 工作台服务启动超时。${stderr.trim().slice(-600)}`),
        );
      }, 30000);

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > 8192) stderr = stderr.slice(-4096);
      });

      createInterface({ input: child.stdout }).on("line", (line) => {
        if (settled || !line.trim().startsWith("{")) return;
        try {
          const parsed = JSON.parse(line);
          if (parsed?.ok && typeof parsed.data?.url === "string") {
            settled = true;
            clearTimeout(timer);
            const url = new URL(parsed.data.url);
            active = {
              child,
              url,
              home: parsed.data.home ?? spec.home,
              webRoot: resolveWebRoot(spec.cliEntry),
            };
            done(active);
          } else if (parsed?.ok === false) {
            settled = true;
            clearTimeout(timer);
            child.kill("SIGTERM");
            fail(
              new Error(parsed.error?.message || "ShowAI 工作台启动失败。"),
            );
          }
        } catch {
          // Ignore non-JSON log lines on stdout.
        }
      });

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fail(error);
      });

      child.once("exit", (code, signal) => {
        if (active?.child === child) active = null;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fail(
          new Error(
            `ShowAI 工作台进程意外退出（${signal || `code ${code}`}）：${stderr.trim().slice(-600)}`,
          ),
        );
      });
    });
  }

  async function ensure() {
    if (active) return active;
    if (!starting) {
      starting = start().finally(() => {
        starting = null;
      });
    }
    return starting;
  }

  return {
    ensure,
    stop,
    status: () => ({
      running: Boolean(active),
      url: active?.url.href ?? null,
      home: active?.home ?? null,
    }),
  };
}

export function rewriteCspForSidecar(csp) {
  if (typeof csp !== "string" || !csp.trim()) return csp;
  return csp
    .split(";")
    .map((raw) => {
      const directive = raw.trim();
      if (!directive) return "";
      if (/^frame-ancestors\b/i.test(directive)) return "frame-ancestors *";
      let next = directive;
      if (/(?:^|\s)'self'(?=\s|$)/.test(next) && !/(?:^|\s)plugin:(?=\s|$)/.test(next)) {
        next = next.replace(/'self'/, "'self' plugin:");
      }
      if (/^(?:script-src|worker-src)\b/i.test(next) && !/(?:^|\s)blob:(?=\s|$)/.test(next)) {
        next += " blob:";
      }
      if (/^connect-src\b/i.test(next)) {
        if (!/(?:^|\s)data:(?=\s|$)/.test(next)) next += " data:";
        if (!/(?:^|\s)blob:(?=\s|$)/.test(next)) next += " blob:";
      }
      return next;
    })
    .filter(Boolean)
    .join("; ");
}

export function isAllowedSidecarOrigin(origin, sidecarPort, options = {}) {
  if (typeof origin !== "string" || !origin.trim()) return false;
  if (!Number.isInteger(sidecarPort) || sidecarPort <= 0) return false;
  const trimmed = origin.trim();
  const pluginMatch = PLUGIN_ORIGIN_RE.exec(trimmed);
  if (pluginMatch) {
    if (!pluginMatch[1]) return true;
    const p = Number(pluginMatch[1]);
    return Number.isInteger(p) && p >= 1 && p <= 65535;
  }
  if (
    trimmed === `http://127.0.0.1:${sidecarPort}` ||
    trimmed === `http://localhost:${sidecarPort}`
  ) {
    return true;
  }
  const loopbackMatch = LOOPBACK_ORIGIN_RE.exec(trimmed);
  if (loopbackMatch) {
    const p = Number(loopbackMatch[1]);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return false;
    const pathname = options.pathname ?? "/";
    const isRootDocument = pathname === "/" || pathname === "/index.html";
    return isRootDocument ? Boolean(options.authenticated) : true;
  }
  return false;
}

function injectSidecarScripts(html, classicBundleSrc = null) {
  let cleaned = html
    .replace(
      /(<link\b[^>]*\brel="stylesheet"[^>]*?)\s+crossorigin(?:="[^"]*")?/gi,
      "$1",
    );
  if (classicBundleSrc) {
    cleaned = cleaned
      .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\s*/gi, "")
      .replace(
        /<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/assets\/[^"]+"[^>]*>\s*<\/script>/i,
        `<script defer src="${classicBundleSrc}"></script>`,
      );
  } else {
    cleaned = cleaned
      .replace(
        /(<link\b[^>]*\brel="modulepreload"[^>]*?)\s+crossorigin(?:="[^"]*")?/gi,
        "$1",
      )
      .replace(
        /(<script\b[^>]*\btype="module"[^>]*?)\s+crossorigin(?:="[^"]*")?/gi,
        "$1",
      );
  }
  const scripts =
    '<style id="showai-ag-host-style">html,body,#root{height:100%;width:100%;}</style>' +
    '<script src="/preload.js"></script><script src="/_antigravity/bridge.js"></script>';
  if (cleaned.includes("<head>")) {
    return cleaned.replace("<head>", `<head>${scripts}`);
  }
  return `${scripts}${cleaned}`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function createNavigationCoordinator(env = process.env) {
  const home = resolve(env.SHOWAI_HOME || join(homedir(), ".showai"));
  const navPath = join(home, "local", "antigravity-workbench-nav.json");
  const statePath = join(home, "local", "antigravity-workbench-state.json");
  const clients = new Map();
  let lastDeliveredId = null;
  let pollTimer = null;
  let heartbeatTimer = null;
  let closed = false;

  function countVisibleClients() {
    let n = 0;
    for (const meta of clients.values()) {
      if (meta.visible) n++;
    }
    return n;
  }

  async function writeState() {
    try {
      await mkdir(dirname(statePath), { recursive: true });
      const temp = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(
        temp,
        JSON.stringify({
          openClients: clients.size,
          visibleClients: countVisibleClients(),
          updatedAt: Date.now(),
        }) + "\n",
        "utf8",
      );
      await rename(temp, statePath);
    } catch {
      // Ignore transient filesystem errors.
    }
  }

  async function checkNav() {
    if (closed || !clients.size) return;
    try {
      const raw = await readFile(navPath, "utf8");
      const nav = JSON.parse(raw);
      if (
        !nav ||
        typeof nav.id !== "string" ||
        nav.id === lastDeliveredId ||
        typeof nav.pageId !== "string" ||
        typeof nav.requestedAt !== "number" ||
        Date.now() - nav.requestedAt > 60_000
      ) {
        return;
      }
      lastDeliveredId = nav.id;
      if (countVisibleClients() > 0) {
        await rm(navPath, { force: true }).catch(() => {});
      }
      const payload = `data: ${JSON.stringify(nav)}\n\n`;
      for (const client of clients.keys()) {
        client.write(payload);
      }
    } catch {
      // No pending navigation file yet.
    }
  }

  function startTimers() {
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        void checkNav();
      }, 250);
      pollTimer.unref?.();
    }
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        for (const client of clients.keys()) client.write(": ping\n\n");
        void writeState();
      }, 5000);
      heartbeatTimer.unref?.();
    }
  }

  function stopTimersIfIdle() {
    if (clients.size > 0) return;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function subscribe(req, res, reqUrl, corsHeaders) {
    res.writeHead(200, {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();
    res.write(": connected\n\n");
    const clientId = reqUrl.searchParams.get("clientId") || randomUUID();
    const visibleParam = reqUrl.searchParams.get("visible");
    const visible = visibleParam === null ? true : visibleParam === "1";
    clients.set(res, { clientId, visible });
    startTimers();
    void writeState();
    void checkNav();
    req.on("close", () => {
      clients.delete(res);
      stopTimersIfIdle();
      void writeState();
    });
  }

  function updateVisibility(clientId, visible) {
    if (typeof clientId !== "string" || !clientId) return;
    let changed = false;
    for (const meta of clients.values()) {
      if (meta.clientId === clientId && meta.visible !== !!visible) {
        meta.visible = !!visible;
        changed = true;
      }
    }
    if (changed) {
      void writeState();
      if (visible) void checkNav();
    }
  }

  async function close() {
    closed = true;
    for (const client of clients.keys()) {
      client.end();
    }
    clients.clear();
    stopTimersIfIdle();
    await writeState();
  }

  return { subscribe, updateVisibility, close };
}

export async function startAntigravitySidecar(options = {}) {
  const env = { ...process.env, ...options.env };
  const port =
    options.port !== undefined
      ? options.port
      : Number.parseInt(env.ANTIGRAVITY_SIDECAR_WEB_PORT || "0", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Missing or invalid ANTIGRAVITY_SIDECAR_WEB_PORT.");
  }
  const token = options.token ?? env.ANTIGRAVITY_SIDECAR_UI_TOKEN ?? "";
  const preloadJs = loadPreloadJs();
  const backend = options.backend ?? createBackendManager(env);
  const classicBundler = createClassicBundleCompiler(env);
  const navCoordinator = createNavigationCoordinator(env);
  let lastClassicBundle = null;
  let actualPort = port;

  const server = createServer(async (req, res) => {
    const reqUrl = new URL(
      req.url || "/",
      `http://${BIND_HOST}:${actualPort || 80}`,
    );
    const pathname = reqUrl.pathname;
    const requestOrigin =
      typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
    const hasValidSidecarToken = Boolean(token) && validateToken(token, req, reqUrl);

    if (
      requestOrigin &&
      !isAllowedSidecarOrigin(requestOrigin, actualPort, {
        pathname,
        authenticated: hasValidSidecarToken,
      })
    ) {
      console.warn(
        `[showai-workbench-sidecar] rejected origin "${requestOrigin}" on ${req.method} ${pathname} (sidecar port ${actualPort})`,
      );
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden origin");
      return;
    }

    const corsHeaders = requestOrigin
      ? {
          "access-control-allow-origin": requestOrigin,
          "access-control-allow-credentials": "true",
          vary: "Origin",
        }
      : {};

    if (requestOrigin && req.method === "OPTIONS") {
      res.writeHead(204, {
        ...corsHeaders,
        "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
        "access-control-allow-headers":
          "Authorization, Content-Type, X-ShowAI-Client, X-Sidecar-Token",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/preload.js") {
      res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/javascript; charset=utf-8",
      });
      res.end(preloadJs);
      return;
    }
    if (req.method === "GET" && pathname === "/_antigravity/bridge.js") {
      res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/javascript; charset=utf-8",
      });
      res.end(BRIDGE_JS);
      return;
    }
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      pathname === "/_antigravity/workbench.js"
    ) {
      try {
        if (!lastClassicBundle) {
          const upstream = await backend.ensure();
          if (!upstream.webRoot) {
            res.writeHead(404, { ...corsHeaders, "Content-Type": "text/plain" });
            res.end("Not found");
            return;
          }
          const indexHtml = await readFile(join(upstream.webRoot, "index.html"), "utf8");
          const match = indexHtml.match(
            /<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/(assets\/[^"]+)"/i,
          );
          if (!match) {
            res.writeHead(404, { ...corsHeaders, "Content-Type": "text/plain" });
            res.end("Entry not found");
            return;
          }
          lastClassicBundle = await classicBundler.compile(upstream.webRoot, match[1]);
        }
        res.writeHead(200, {
          ...corsHeaders,
          "Cache-Control": "private, max-age=3600",
          "Content-Type": "application/javascript; charset=utf-8",
          "Content-Length": lastClassicBundle.bytes.length,
        });
        res.end(req.method === "HEAD" ? undefined : lastClassicBundle.bytes);
      } catch (error) {
        console.error(
          `[showai-workbench-sidecar] failed to build classic bundle: ${error.message}`,
        );
        res.writeHead(500, { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message);
      }
      return;
    }
    if (req.method === "GET" && pathname === "/_antigravity/health") {
      res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ ok: true, backend: backend.status() }));
      return;
    }
    if (req.method === "GET" && pathname === "/_antigravity/nav-events") {
      navCoordinator.subscribe(req, res, reqUrl, corsHeaders);
      return;
    }
    if (req.method === "POST" && pathname === "/_antigravity/client-visibility") {
      if (!validateToken(token, req, reqUrl)) {
        res.writeHead(401, {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const body = await readJsonBody(req).catch(() => ({}));
      navCoordinator.updateVisibility(body?.clientId, body?.visible);
      res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && pathname === "/_antigravity/restart") {
      if (!validateToken(token, req, reqUrl)) {
        res.writeHead(401, {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      await backend.stop();
      res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname.startsWith("/_sidecar/")) {
      if (req.method !== "POST") {
        res.writeHead(405, {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: "Method Not Allowed" }));
        return;
      }
      if (!validateToken(token, req, reqUrl)) {
        res.writeHead(401, {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      try {
        const data = await readJsonBody(req);
        let result;
        if (pathname === "/_sidecar/send-message") {
          const args = ["send-message"];
          if (data.title) args.push("--title", String(data.title));
          args.push(
            String(data.conversationId || ""),
            String(data.message || ""),
          );
          result = runAgentApi(args, { projectId: data.projectId, env });
        } else if (pathname === "/_sidecar/new-conversation") {
          const model = data.model || "flash";
          result = runAgentApi(
            [
              "new-conversation",
              "--model",
              String(model),
              String(data.message || ""),
            ],
            { projectId: data.projectId, env },
          );
        } else if (pathname === "/_sidecar/get-conversation-metadata") {
          result = runAgentApi(
            ["get-conversation-metadata", String(data.conversationId || "")],
            { env },
          );
        } else {
          res.writeHead(404, {
            ...corsHeaders,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        res.writeHead(200, {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, {
          ...corsHeaders,
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    let upstream;
    try {
      upstream = await backend.ensure();
    } catch (error) {
      console.error(
        `[showai-workbench-sidecar] backend failed to start: ${error.message}`,
      );
      if (pathname === "/" || pathname === "/index.html") {
        res.writeHead(503, {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(renderStatusHtml("无法启动 ShowAI 工作台", error.message));
      } else {
        res.writeHead(503, {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: { code: "BACKEND_UNAVAILABLE", message: error.message },
          }),
        );
      }
      return;
    }

    const forwardHeaders = { ...req.headers, host: upstream.url.host };
    delete forwardHeaders["accept-encoding"];
    delete forwardHeaders["x-sidecar-token"];
    if (requestOrigin) {
      forwardHeaders.origin = upstream.url.origin;
    }
    if (typeof forwardHeaders.referer === "string") {
      delete forwardHeaders.referer;
    }

    let upstreamPath = req.url || "/";
    if (pathname === "/api/events" && reqUrl.searchParams.has("showai_token")) {
      const rewritten = new URL(reqUrl.href);
      rewritten.searchParams.set(
        "token",
        rewritten.searchParams.get("showai_token") || "",
      );
      rewritten.searchParams.delete("showai_token");
      upstreamPath = rewritten.pathname + rewritten.search;
    }

    const proxyReq = httpRequest(
      {
        hostname: upstream.url.hostname,
        port: upstream.url.port,
        path: upstreamPath,
        method: req.method,
        headers: forwardHeaders,
      },
      (proxyRes) => {
        const contentType = String(proxyRes.headers["content-type"] || "");
        const isRootHtml =
          (pathname === "/" || pathname === "/index.html") &&
          contentType.includes("text/html") &&
          (req.method === "GET" || req.method === "HEAD");

        if (isRootHtml) {
          const chunks = [];
          proxyRes.on("data", (chunk) => chunks.push(chunk));
          proxyRes.on("end", async () => {
            const rawHtml = Buffer.concat(chunks).toString("utf8");
            let classicBundleSrc = null;
            if (upstream.webRoot) {
              const entryMatch = rawHtml.match(
                /<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/(assets\/[^"]+)"/i,
              );
              if (entryMatch) {
                try {
                  lastClassicBundle = await classicBundler.compile(
                    upstream.webRoot,
                    entryMatch[1],
                  );
                  classicBundleSrc = `/_antigravity/workbench.js?v=${lastClassicBundle.digest}`;
                } catch (error) {
                  console.error(
                    `[showai-workbench-sidecar] classic bundle fallback failed: ${error.message}`,
                  );
                }
              }
            }
            const injected = injectSidecarScripts(rawHtml, classicBundleSrc);
            const headers = { ...proxyRes.headers, ...corsHeaders };
            delete headers["content-length"];
            delete headers["transfer-encoding"];
            delete headers["connection"];
            delete headers["x-frame-options"];
            delete headers["referrer-policy"];
            if (headers["content-security-policy"]) {
              headers["content-security-policy"] = rewriteCspForSidecar(
                headers["content-security-policy"],
              );
            }
            res.writeHead(proxyRes.statusCode || 200, {
              ...headers,
              "content-length": Buffer.byteLength(injected),
            });
            res.end(req.method === "HEAD" ? undefined : injected);
          });
          return;
        }

        const headers = { ...proxyRes.headers, ...corsHeaders };
        delete headers["x-frame-options"];
        delete headers["referrer-policy"];
        if (headers["content-security-policy"]) {
          headers["content-security-policy"] = rewriteCspForSidecar(
            headers["content-security-policy"],
          );
        }
        res.writeHead(proxyRes.statusCode || 200, headers);
        if (contentType.includes("text/event-stream")) {
          res.flushHeaders?.();
        }
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (error) => {
      console.error(
        `[showai-workbench-sidecar] proxy error on ${req.method} ${pathname}: ${error.message}`,
      );
      if (res.headersSent) {
        res.end();
        return;
      }
      if (pathname === "/" || pathname === "/index.html") {
        res.writeHead(502, {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
        });
        res.end(renderStatusHtml("与 ShowAI 工作台连接中断", error.message));
      } else {
        res.writeHead(502, {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            ok: false,
            error: { code: "PROXY_ERROR", message: error.message },
          }),
        );
      }
    });

    res.on("close", () => {
      if (!res.writableEnded && !proxyReq.destroyed) proxyReq.destroy();
    });

    if (req.method === "GET" || req.method === "HEAD") {
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  });

  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, BIND_HOST, done);
  });

  const address = server.address();
  actualPort = typeof address === "object" && address ? address.port : port;

  const close = async () => {
    await navCoordinator.close();
    await backend.stop();
    await new Promise((done) => {
      server.close(() => done());
      server.closeAllConnections?.();
    });
  };

  return {
    port: actualPort,
    url: `http://${BIND_HOST}:${actualPort}`,
    close,
    backend,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const instance = await startAntigravitySidecar();
  console.log(
    `[showai-workbench-sidecar] listening on ${BIND_HOST}:${instance.port}`,
  );
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await instance.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
