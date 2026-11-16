import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import {
  request as proxyRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { startBrowserServer } from "../browser/server";
import { AgentService } from "../agent/service";
import { uiFeatures, uiScene } from "./registry";
import { remoteConnectionFixture } from "./fixtures/remote-connection";
import labMessages from "../i18n/messages/uiLab";
import { messages } from "./messages";
import type { LabSession, SceneFixture } from "./types";
import { runUiScenes } from "./runner";
import { sourceIdentity } from "./source";
import { redactTrace as redact } from "./trace";

export interface UiLabOptions {
  repository: string;
  state: string;
  output: string;
  port?: number;
  baseline?: string;
  idleSessionMs?: number;
  onShutdown?: () => Promise<void>;
}
type Session = {
  client: LabSession;
  service: AgentService;
  backend: Awaited<ReturnType<typeof startBrowserServer>>;
  fixture: SceneFixture;
  trace: Array<Record<string, unknown>>;
  directory: string;
  lastConnectedAt: number;
};

export async function startUiLab(options: UiLabOptions) {
  const repository = resolve(options.repository),
    state = resolve(options.state),
    output = resolve(options.output);
  await mkdir(state, { recursive: true });
  await mkdir(output, { recursive: true });
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
  const backendSource = sourceIdentity(repository);
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
  const sessions = new Map<string, Session>(),
    byToken = new Map<string, Session>();
  const empty: SceneFixture = {
    actions: new Set(),
    invoke: async () => {
      throw new Error("No fixture handler.");
    },
    event: async () => {
      throw new Error("No fixture events.");
    },
    inspect: () => ({}),
    close: () => {},
  };
  let origin = "",
    closing = false;
  let running = false;
  async function createSession(input: Record<string, unknown>) {
    await collectIdle();
    if (sessions.size >= 12)
      throw new Error(
        "Close or reset an existing scene before opening another session.",
      );
    const locale = input.locale === "en" ? "en" : "zh-CN",
      theme = input.theme === "dark" ? "dark" : "light";
    const feature = String(input.feature ?? "remote-connection"),
      sceneId = String(input.scene ?? "overview"),
      scene = uiScene(feature, sceneId, locale);
    const id = randomUUID(),
      token = randomBytes(32).toString("hex"),
      directory = join(state, "sessions", id),
      home = join(directory, "library");
    await mkdir(join(directory, "profile"), { recursive: true });
    const service = new AgentService({ root: home }),
      t = messages(labMessages, locale);
    const projects = [
      await service.createProject(t("research")),
      await service.createProject(t("project")),
    ];
    await service.store.arrangeProject(
      projects[0].id,
      "projects",
      projects[1].id,
      "before",
    );
    const fixture =
      scene.fixture === "remote-connection"
        ? remoteConnectionFixture(
            projects.map((project) => ({ id: project.id, name: project.name })),
            input.mode !== "test",
          )
        : empty;
    const trace: Session["trace"] = [];
    const extra = new Set([...fixture.actions, "appUpdate:state"]);
    const backend = await startBrowserServer({
      home,
      port: 0,
      webRoot: join(repository, "dist"),
      cliEntry: join(repository, "dist-runtime/scripts/cli.mjs"),
      settingsPath: join(directory, "profile/settings.json"),
      agentWorkspaceRoot: join(directory, "agent-workspaces"),
      registerAgentRuntime: false,
      additionalActions: extra,
      development: { origin, token, sourceCommit },
      interceptInvoke: async (action, args, next) => {
        const mocked =
          fixture.actions.has(action) ||
          action.startsWith("plugins:") ||
          action === "appUpdate:state";
        if (action !== "remoteMcp:status" && action !== "remoteMcp:requests")
          trace.push({
            action,
            args: redact(args),
            source: mocked ? "fixture" : "application",
            at: new Date().toISOString(),
          });
        if (fixture.actions.has(action)) return fixture.invoke(action, args);
        if (action === "plugins:status") return [];
        if (action === "plugins:runtime")
          return { state: "not_registered", expected: { home }, home };
        if (
          action.startsWith("plugins:") ||
          /^(fs:reveal|media:reveal|settings:chooseHome|agent:scan|agent:run|agent:authorize|sync:login|sync:configure|app:openWindow|app:openPageWindow)$/.test(
            action,
          )
        )
          throw new Error(t("unavailable"));
        if (action === "appUpdate:state")
          return {
            supported: false,
            automatic: false,
            currentVersion: "0.12.0",
            phase: "idle",
          };
        const result = await next();
        return action === "app:info"
          ? { ...(result as object), mode: "desktop", sourceCommit }
          : result;
      },
    });
    const client: LabSession = {
      id,
      token,
      feature,
      scene: sceneId,
      home,
      locale,
      theme,
      mode: input.mode === "test" ? "test" : "manual",
      appUrl: `${origin}/app?uiLabSession=${id}`,
    };
    const session = {
      client,
      service,
      backend,
      fixture,
      trace,
      directory,
      lastConnectedAt: Date.now(),
    };
    sessions.set(id, session);
    byToken.set(token, session);
    await writeFile(
      join(directory, "session.json"),
      JSON.stringify(
        {
          ...client,
          token: "[redacted]",
          sourceCommit,
          simulatedService: scene.fixture !== "none",
        },
        null,
        2,
      ),
    );
    return client;
  }
  async function deleteSession(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    byToken.delete(session.client.token);
    session.fixture.close();
    await session.backend.close();
    await writeFile(
      join(session.directory, "trace.json"),
      JSON.stringify(session.trace, null, 2),
    );
    for (const child of ["library", "profile", "agent-workspaces"])
      await rm(join(session.directory, child), {
        recursive: true,
        force: true,
      });
  }
  const idleSessionMs = options.idleSessionMs ?? 30000;
  let collecting: Promise<void> | undefined;
  function collectIdle(): Promise<void> {
    if (collecting) return collecting;
    collecting = (async () => {
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (session.backend.connectedClients()) session.lastConnectedAt = now;
        else if (
          session.client.mode === "manual" &&
          now - session.lastConnectedAt > idleSessionMs
        )
          await deleteSession(id);
      }
    })().finally(() => {
      collecting = undefined;
    });
    return collecting;
  }
  const collector = setInterval(
    () => {
      void collectIdle().catch((error) =>
        console.error("UI Lab session cleanup:", error),
      );
    },
    Math.max(25, Math.min(idleSessionMs / 2, 5000)),
  );
  collector.unref();
  const respond = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(value));
  };
  async function body(request: IncomingMessage) {
    let bytes = "";
    for await (const chunk of request) {
      bytes += chunk;
      if (bytes.length > 1024 * 1024)
        throw new Error("UI Lab request too large.");
    }
    const value = bytes ? JSON.parse(bytes) : {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("UI Lab input must be an object.");
    return value as Record<string, unknown>;
  }
  const vite = await createViteServer({
    configFile: false,
    root: repository,
    cacheDir: join(state, "vite-cache"),
    plugins: [
      react(),
      {
        name: "showai-ui-lab",
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            const url = new URL(
                request.url ?? "/",
                origin || "http://127.0.0.1",
              ),
              method = request.method ?? "GET";
            try {
              if (
                (origin && request.headers.host !== new URL(origin).host) ||
                (origin &&
                  request.headers.origin &&
                  request.headers.origin !== origin)
              ) {
                respond(response, { error: "Origin not allowed." }, 403);
                return;
              }
              if (url.pathname.startsWith("/api/")) {
                const token =
                    url.searchParams.get("token") ??
                    request.headers.authorization?.replace(/^Bearer /, ""),
                  session = token && byToken.get(token);
                if (!session) {
                  respond(response, { error: "Unknown scene session." }, 401);
                  return;
                }
                const backend = new URL(session.backend.localUrl);
                const proxy = proxyRequest(
                  {
                    hostname: "127.0.0.1",
                    port: backend.port,
                    path: url.pathname + url.search,
                    method,
                    headers: { ...request.headers, host: new URL(origin).host },
                  },
                  (incoming) => {
                    response.writeHead(
                      incoming.statusCode ?? 502,
                      incoming.headers,
                    );
                    incoming.pipe(response);
                  },
                );
                proxy.once("error", (error) => {
                  if (!response.headersSent)
                    respond(response, { error: error.message }, 502);
                  else response.destroy(error);
                });
                request.pipe(proxy);
                response.once("close", () => proxy.destroy());
                return;
              }
              if (
                url.pathname === "/__ui-lab/api/shutdown" &&
                method === "POST"
              ) {
                const input = await body(request);
                if (input.pid !== process.pid) {
                  respond(
                    response,
                    { error: "Server identity does not match." },
                    403,
                  );
                  return;
                }
                response.once("finish", () => {
                  void (options.onShutdown ?? close)().catch((error) =>
                    console.error("UI Lab shutdown:", error),
                  );
                });
                respond(response, { closing: true });
                return;
              }
              if (url.pathname === "/__ui-lab/api/status") {
                respond(response, {
                  ready: !closing,
                  pid: process.pid,
                  root: repository,
                  branch,
                  mode: "ui-lab",
                  state,
                  output,
                  origin,
                  background: true,
                  sourceCommit,
                  backendSource,
                  sessions: [...sessions.values()].map((session) => ({
                    id: session.client.id,
                    home: session.client.home,
                    mode: session.client.mode,
                    connectedClients: session.backend.connectedClients(),
                  })),
                });
                return;
              }
              if (url.pathname === "/__ui-lab/api/catalog") {
                respond(response, {
                  features: uiFeatures().map((feature) => ({
                    id: feature.id,
                    title: feature.title,
                    events: feature.events,
                    scenes: feature.scenes.map(
                      ({ id, title, description, fixture, steps }) => ({
                        id,
                        title,
                        description,
                        fixture,
                        steps: steps.map(({ id, title }) => ({ id, title })),
                      }),
                    ),
                  })),
                  sourceCommit,
                  backendSource,
                });
                return;
              }
              if (
                url.pathname === "/__ui-lab/api/sessions" &&
                method === "POST"
              ) {
                respond(response, await createSession(await body(request)));
                return;
              }
              if (url.pathname === "/__ui-lab/api/runs" && method === "POST") {
                if (running) {
                  respond(
                    response,
                    { error: "A UI run is already active." },
                    409,
                  );
                  return;
                }
                const input = await body(request);
                running = true;
                try {
                  const result = await runUiScenes({
                    origin,
                    output,
                    repository,
                    feature: String(input.feature ?? "remote-connection"),
                    scenes: input.scene ? [String(input.scene)] : undefined,
                    theme: input.theme === "dark" ? "dark" : "light",
                    width: Number(input.width ?? 1440),
                    height: Number(input.height ?? 1000),
                    scale: 2,
                    baseline: options.baseline,
                  });
                  respond(response, { id: result.id, passed: result.passed });
                } finally {
                  running = false;
                }
                return;
              }
              const target =
                /^\/__ui-lab\/api\/sessions\/([0-9a-f-]+)(?:\/(events|inspect|clipboard))?$/.exec(
                  url.pathname,
                );
              if (target) {
                const session = sessions.get(target[1]);
                if (
                  !session ||
                  request.headers.authorization !==
                    `Bearer ${session.client.token}`
                ) {
                  respond(response, { error: "Unknown scene session." }, 401);
                  return;
                }
                if (method === "DELETE" && !target[2]) {
                  await deleteSession(target[1]);
                  respond(response, { closed: true });
                  return;
                }
                if (target[2] === "inspect" && method === "GET") {
                  respond(response, {
                    ...session.fixture.inspect(),
                    application: {
                      projects: await session.service.listProjects(),
                    },
                    trace: session.trace,
                    isolatedHome: session.client.home,
                  });
                  return;
                }
                const input = await body(request);
                if (target[2] === "events" && method === "POST") {
                  await session.fixture.event(
                    String(input.name),
                    (input.input as Record<string, unknown>) ?? {},
                  );
                  session.trace.push({
                    event: input.name,
                    input: redact(input.input),
                  });
                  respond(response, { ok: true });
                  return;
                }
                if (target[2] === "clipboard" && method === "POST") {
                  session.trace.push({
                    action: "clipboard:write",
                    source: "fixture",
                    length: String(input.text ?? "").length,
                  });
                  respond(response, { ok: true });
                  return;
                }
                respond(response, { error: "Method not allowed." }, 405);
                return;
              }
              if (url.pathname === "/" || url.pathname === "/__ui-lab/") {
                const html = await server.transformIndexHtml(
                  url.pathname,
                  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShowAI UI Lab</title><div id="root"></div><script type="module" src="/src/ui-lab/lab-main.tsx"></script></html>',
                );
                response.writeHead(200, {
                  "content-type": "text/html; charset=utf-8",
                });
                response.end(html);
                return;
              }
              if (url.pathname === "/app") {
                const session = sessions.get(
                  url.searchParams.get("uiLabSession") ?? "",
                );
                if (!session) {
                  respond(
                    response,
                    { error: "Create a scene session first." },
                    404,
                  );
                  return;
                }
                let html = await readFile(
                  join(repository, "index.html"),
                  "utf8",
                );
                const config = JSON.stringify(session.client).replace(
                  /</g,
                  "\\u003c",
                );
                html = html.replace(
                  "<head>",
                  `<head><script>window.__SHOWAI_LOCAL__={token:${JSON.stringify(session.client.token)}};window.__SHOWAI_UI_LAB__=${config};</script>`,
                );
                html = html.replace(
                  /<html([^>]*)>/,
                  `<html$1 data-showai-locale="${session.client.locale}">`,
                );
                response.writeHead(200, {
                  "content-type": "text/html; charset=utf-8",
                  "cache-control": "no-store",
                });
                response.end(
                  await server.transformIndexHtml(url.pathname, html),
                );
                return;
              }
              if (url.pathname === "/__ui-lab/api/results") {
                const directories = await readdir(output, {
                  withFileTypes: true,
                });
                const reports = [];
                for (const directory of directories.filter((item) =>
                  item.isDirectory(),
                )) {
                  const report = await readFile(
                    join(output, directory.name, "report.json"),
                    "utf8",
                  ).then(JSON.parse, (error: NodeJS.ErrnoException) => {
                    if (error.code === "ENOENT") return undefined;
                    throw error;
                  });
                  if (report?.finishedAt)
                    reports.push({ ...report, id: directory.name });
                }
                respond(response, { reports: reports.slice(-20).reverse() });
                return;
              }
              if (url.pathname.startsWith("/__ui-lab/results/")) {
                const path = resolve(
                    output,
                    decodeURIComponent(
                      url.pathname.slice("/__ui-lab/results/".length),
                    ),
                  ),
                  local = relative(output, path);
                if (!local || local.startsWith(".." + sep) || local === "..") {
                  respond(response, { error: "Invalid result path." }, 403);
                  return;
                }
                const file = (await stat(path)).isDirectory()
                  ? join(path, "index.html")
                  : path;
                const canonical = await realpath(file),
                  root = await realpath(output),
                  localFile = relative(root, canonical);
                if (localFile.startsWith(".." + sep) || localFile === "..") {
                  respond(response, { error: "Invalid result path." }, 403);
                  return;
                }
                const mime = file.endsWith(".png")
                  ? "image/png"
                  : file.endsWith(".json")
                    ? "application/json"
                    : file.endsWith(".txt")
                      ? "text/plain; charset=utf-8"
                      : "text/html; charset=utf-8";
                response.writeHead(200, { "content-type": mime });
                response.end(await readFile(file));
                return;
              }
              next();
            } catch (error) {
              respond(
                response,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
                400,
              );
            }
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: options.port ?? 0,
      strictPort: true,
      fs: { allow: [repository] },
    },
  });
  await vite.listen();
  const address = vite.httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("UI Lab has no listening address.");
  origin = `http://127.0.0.1:${address.port}`;
  await writeFile(
    join(state, "server.json"),
    JSON.stringify(
      {
        pid: process.pid,
        origin,
        state,
        output,
        sourceCommit,
        backendSource,
        startedAt: new Date().toISOString(),
        background: true,
      },
      null,
      2,
    ),
  );
  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(collector);
    await collecting;
    for (const id of sessions.keys()) await deleteSession(id);
    await vite.close();
    await writeFile(
      join(state, "closed.json"),
      JSON.stringify({
        pid: process.pid,
        closedAt: new Date().toISOString(),
      }),
    );
  }
  return { url: origin + "/__ui-lab/", origin, output, close };
}
