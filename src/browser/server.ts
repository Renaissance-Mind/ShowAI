import { changedResources } from "../core/change-notification";
import { createServer, type ServerResponse } from "node:http";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
  rename,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { watch } from "chokidar";
import { version } from "../../package.json";
import { AgentService, errorResult } from "../agent/service";
import { AgentHost, agentActions } from "../agent-host/host";
import { MaintenanceScheduler } from "../core/maintenance-scheduler";
import { syncManager } from "../sync/manager";
import { openLibrary } from "../core/open-library";
import { registerRuntime } from "../agent/runtime";
import { CoreError, FileStore, assertId } from "../core/store";
import {
  createWorkbench,
  workbenchActions,
  projectId,
  required,
  text,
} from "../workbench/actions";
import type { DesktopChange, DesktopInfo } from "../desktop/bridge";
import { openLocalPath } from "./system";
import { windowQuery } from "../workbench/window-target";

export interface BrowserServerOptions {
  home?: string;
  port?: number;
  webRoot: string;
  cliEntry: string;
  settingsPath: string;
  /** Only the source development launcher supplies this loopback frontend. */
  development?: { origin: string; token: string };
}

/** Loopback-only host for the exact same workbench actions used by Electron. */
export async function startBrowserServer(options: BrowserServerOptions) {
  if (options.development) {
    const frontend = new URL(options.development.origin);
    if (
      frontend.protocol !== "http:" ||
      frontend.hostname !== "127.0.0.1" ||
      frontend.origin !== options.development.origin ||
      !/^[a-f0-9]{64}$/.test(options.development.token)
    )
      throw new Error(
        "Development requires a loopback origin and a random access token.",
      );
  }
  const fixedHome = options.home ?? process.env.SHOWAI_HOME;
  let savedHome: string | undefined;
  if (!fixedHome) {
    const source = await readFile(options.settingsPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (source) {
      const saved = JSON.parse(source);
      if (typeof saved.home !== "string")
        throw new Error("Invalid ShowAI browser settings.");
      savedHome = saved.home;
    }
  }
  let store = new FileStore(fixedHome ?? savedHome);
  let service = new AgentService({ root: store.root });
  const token = options.development?.token ?? randomBytes(32).toString("hex");
  const webRoot = await realpath(options.webRoot);
  const clients = new Set<ServerResponse>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher!: ReturnType<typeof watch>;
  let maintenance: MaintenanceScheduler | undefined;
  let origin = options.development?.origin ?? "";
  const info = (): DesktopInfo => ({
    home: store.root,
    version,
    platform: process.platform,
    packaged: !options.development,
    mode: "browser",
    cli: {
      command: process.execPath,
      args: [resolve(options.cliEntry)],
      env: { SHOWAI_HOME: store.root },
    },
  });
  const notify = (type: "home" | "files", change?: DesktopChange) => {
    for (const client of clients)
      client.write(
        `data: ${JSON.stringify({ type, home: store.root, ...change })}\n\n`,
      );
  };
  async function useHome(home: string) {
    await syncManager(store.root).stop();
    await maintenance?.stop();
    store = new FileStore(home);
    await openLibrary(store.root);
    service = new AgentService({ root: store.root });
    await registerRuntime(store.root, info().cli);
    maintenance = new MaintenanceScheduler(store.root).start();
    syncManager(store.root).start();
    watcher = watch(store.root, {
      ignoreInitial: true,
      depth: 9,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
      ignored: (path) =>
        path
          .slice(store.root.length)
          .split(sep)
          .some(
            (part) =>
              [
                "snapshots",
                "exports",
                ".locks",
                "tmp",
                "node_modules",
                "repository.git",
                "local",
                "cache",
                "index.sqlite",
                "index.sqlite-wal",
                "index.sqlite-shm",
              ].includes(part) || part.endsWith(".tmp"),
          ),
    });
    const paths = new Set<string>();
    watcher.on("all", (_event, path) => {
      paths.add(path);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const change = changedResources(store.root, paths);
        notify("files", change);
        if (change.projectIds?.length || change.catalog || change.all)
          syncManager(store.root).wake(
            change.catalog || change.all ? undefined : change.projectIds,
            !!(change.catalog || change.all),
          );
        paths.clear();
      }, 180);
    });
    watcher.on("error", (error) =>
      console.error("ShowAI file watcher:", error),
    );
    await new Promise<void>((done) => watcher.once("ready", done));
  }
  await useHome(store.root);
  const agentHost = new AgentHost({
    root: join(dirname(options.settingsPath), "agent-host"),
    library: () => store,
    cli: () => info().cli,
    pluginRoot: () => options.development
      ? join(process.cwd(), "plugins/showai")
      : resolve(dirname(options.cliEntry), "../assets/agent-plugin"),
  });
  async function selectedPath(
    args: Record<string, unknown>,
    directory: boolean,
  ) {
    const path = required(args, "selectedPath");
    if (!isAbsolute(path))
      throw new CoreError("INVALID_PATH", "Choose an absolute local path.");
    const resolved = await realpath(path);
    const metadata = await stat(resolved);
    if (directory ? !metadata.isDirectory() : !metadata.isFile())
      throw new CoreError(
        "INVALID_PATH",
        directory ? "Choose a directory." : "Choose a file.",
      );
    return resolved;
  }
  async function invoke(action: string, args: Record<string, unknown>) {
    if (agentActions.has(action)) return agentHost.action(action, args);
    maintenance?.markActivity();
    return createWorkbench(store, service, {
      info,
      openDialog: async (dialog) => ({
        canceled: false,
        filePaths: [
          await selectedPath(args, dialog.properties.includes("openDirectory")),
        ],
      }),
      saveDialog: async () => {
        const path = required(args, "selectedPath");
        if (!isAbsolute(path))
          throw new CoreError(
            "INVALID_PATH",
            "Choose an absolute output path.",
          );
        const parent = await realpath(dirname(path));
        if (!(await stat(parent)).isDirectory())
          throw new CoreError("INVALID_PATH", "Choose an output directory.");
        return {
          canceled: false,
          filePath: join(parent, path.split(sep).at(-1)!),
        };
      },
      invoke: async (action, args) => {
        switch (action) {
          case "fs:reveal": {
            const id = projectId(args),
              page = text(args, "pageId", true);
            await store.listPages(id);
            const path = page
              ? (
                  await store.readPage(id, assertId(page), {
                    checkpoint: false,
                  })
                ).path
              : store.projectPath(id);
            await openLocalPath(path, !!page);
            return null;
          }
          case "settings:chooseHome": {
            if (fixedHome)
              throw new CoreError(
                "INVALID_DATA",
                "--home or SHOWAI_HOME fixes this launch's storage directory. Change it before the next launch.",
              );
            const home = await selectedPath(args, true);
            await new FileStore(home).listProjects();
            await mkdir(dirname(options.settingsPath), { recursive: true });
            const temporary = `${options.settingsPath}.${randomUUID()}.tmp`;
            await writeFile(temporary, JSON.stringify({ home }) + "\n", {
              flag: "wx",
              mode: 0o600,
            });
            await rename(temporary, options.settingsPath);
            await watcher.close();
            clearTimeout(timer);
            await useHome(home);
            notify("home");
            return info();
          }
          case "app:openPageWindow":
          case "app:openWindow": {
            return {
              url: `${origin}/?${new URLSearchParams(windowQuery(args))}`,
            };
          }
          default:
            throw new CoreError(
              "INVALID_DATA",
              `Unknown host action: ${action}`,
            );
        }
      },
    })(action, args);
  }
  async function dialogList(args: Record<string, unknown>) {
    const path = await realpath(text(args, "path", true) ?? homedir());
    const entries = await readdir(path, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map(async (entry) => {
          const entryPath = join(path, entry.name);
          let directory = entry.isDirectory();
          if (entry.isSymbolicLink()) {
            const metadata = await stat(entryPath).catch(
              (error: NodeJS.ErrnoException) => {
                if (["ENOENT", "ELOOP"].includes(error.code ?? "")) return null;
                throw error;
              },
            );
            if (!metadata) return null;
            directory = metadata.isDirectory();
          }
          return { name: entry.name, path: entryPath, directory };
        }),
    );
    const downloads = join(homedir(), "Downloads");
    const hasDownloads = await access(downloads).then(
      () => true,
      () => false,
    );
    return {
      path,
      parent: dirname(path),
      separator: sep,
      shortcuts: [
        { name: "个人目录", path: homedir() },
        { name: "内容库", path: store.root },
        ...(hasDownloads ? [{ name: "下载", path: downloads }] : []),
      ],
      entries: items
        .filter((item) => item !== null)
        .sort(
          (a, b) =>
            Number(b.directory) - Number(a.directory) ||
            a.name.localeCompare(b.name),
        ),
    };
  }
  let closed = false;
  const server = createServer((request, response) => {
    void handleRequest().catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const result = errorResult(error);
      const status =
        error instanceof SyntaxError
          ? 400
          : ({
              INVALID_DATA: 400,
              INVALID_PATH: 400,
              NOT_FOUND: 404,
              CONFLICT: 409,
            }[result.code] ?? 500);
      response.writeHead(status, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ ok: false, error: result }));
    });
    async function handleRequest() {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "no-referrer");
      // Reject DNS rebinding and cross-origin websites before touching local files.
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin)
      ) {
        response.writeHead(403);
        response.end("Forbidden origin");
        return;
      }
      const url = new URL(request.url ?? "/", origin);
      if (url.pathname.startsWith("/api/")) {
        const supplied =
          url.pathname === "/api/events"
            ? url.searchParams.get("token")
            : request.headers.authorization?.replace(/^Bearer /, "");
        if (
          !supplied ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        ) {
          response.writeHead(401);
          response.end("Unauthorized");
          return;
        }
        if (url.pathname === "/api/events" && request.method === "GET") {
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
          });
          response.write(
            `data: ${JSON.stringify({ type: "files", home: store.root })}\n\n`,
          );
          clients.add(response);
          request.on("close", () => clients.delete(response));
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405);
          response.end();
          return;
        }
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          response.writeHead(415);
          response.end();
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 24 * 1024 * 1024) {
            response.writeHead(413);
            response.end("Request exceeds 24 MB");
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new CoreError("INVALID_DATA", "Arguments must be an object.");
        let data: unknown;
        if (url.pathname === "/api/dialog/list") data = await dialogList(input);
        else if (url.pathname === "/api/dialog/mkdir") {
          const parent = await realpath(required(input, "path"));
          const name = required(input, "name");
          if (name === "." || name === ".." || /[/\\\x00]/.test(name))
            throw new CoreError("INVALID_PATH", "Invalid folder name.");
          const path = join(parent, name);
          await mkdir(path);
          data = { path };
        } else if (url.pathname === "/api/shutdown") {
          data = null;
          response.once("finish", () => {
            void close().catch((error) =>
              console.error("ShowAI shutdown:", error),
            );
          });
        } else if (url.pathname === "/api/invoke") {
          const { action, args } = input;
          if (
            typeof action !== "string" ||
            (!workbenchActions.has(action) && !agentActions.has(action)) ||
            !args ||
            typeof args !== "object" ||
            Array.isArray(args)
          )
            throw new CoreError(
              "INVALID_DATA",
              "Unknown action or invalid arguments.",
            );
          data = await invoke(action, args);
        } else {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, data }));
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      if (url.pathname === "/") {
        const preview = url.searchParams.has("componentPreview");
        if (preview) response.setHeader("X-Frame-Options", "SAMEORIGIN");
        const config = JSON.stringify({ token }).replace(/</g, "\\u003c");
        const html = (
          await readFile(join(webRoot, "index.html"), "utf8")
        ).replace(
          "<head>",
          `<head><script>window.__SHOWAI_LOCAL__=${config}</script>`,
        );
        response.setHeader(
          "Content-Security-Policy",
          `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; frame-src 'self' about: data: blob:; frame-ancestors ${preview ? "'self'" : "'none'"}; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'`,
        );
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : html);
        return;
      }
      // Only distribution assets are served; the content library is never a static root.
      if (
        !/^\/(?:assets\/[^/]+|showai-icon\.svg|favicon\.ico)$/.test(
          url.pathname,
        )
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      const path = await realpath(join(webRoot, url.pathname.slice(1))).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      if (!path || !path.startsWith(webRoot + sep)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const mime: Record<string, string> = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".png": "image/png",
        ".woff2": "font/woff2",
      };
      response.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      });
      response.end(
        request.method === "HEAD" ? undefined : await readFile(path),
      );
    }
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
  }, 15000);
  heartbeat.unref();
  try {
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", done);
    });
  } catch (error) {
    clearInterval(heartbeat);
    await watcher.close();
    throw error;
  }
  async function close() {
    agentHost.close();
    await syncManager(store.root).stop();
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(timer);
    await watcher.close();
    await maintenance?.stop();
    for (const client of clients) client.end();
    await new Promise<void>((done, reject) => {
      server.close((error) => (error ? reject(error) : done()));
      server.closeAllConnections();
    });
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local server address.");
  origin ||= `http://127.0.0.1:${address.port}`;
  return {
    url: origin + "/",
    home: store.root,
    close,
  };
}
