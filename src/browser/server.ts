import { CAPACITY, formatBytes } from "../portable/capacity.mjs";
import { changedResources } from "../core/change-notification";
import { watchDatasetSources } from "../core/dataset-sources";
import { datasetDependents } from "../core/dataset-dependents";
import { OwnWrites } from "../core/own-writes";
import { ModelResourceClient } from "../sync/model-resources";
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
import { arch, homedir } from "node:os";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { watchLibrary } from "../core/library-watcher";
import { version } from "../../package.json";
import { AgentService, errorResult } from "../agent/service";
import { AgentHost, agentActions } from "../agent-host/host";
import {
  RemoteMacConnector,
  remoteDeviceActions,
} from "../agent-host/remote-connector";
import { MaintenanceScheduler } from "../core/maintenance-scheduler";
import { syncManager } from "../sync/manager";
import { openLibrary } from "../core/open-library";
import { registerRuntimeOnStartup } from "../agent/runtime";
import {
  publishInstance,
  type InstanceHandle,
} from "../core/instance-presence.mjs";
import {
  DesktopPluginInstaller,
  desktopPluginActions,
  pluginInstallerAction,
} from "../plugin/desktop-install";
import { CoreError, FileStore, assertId } from "../core/store";
import { setLocale, type Locale } from "../i18n";
import { recordAppLanguage } from "../core/app-language";
import {
  createWorkbench,
  workbenchActions,
  projectId,
  required,
  text,
} from "../workbench/actions";
import type { DesktopChange, DesktopInfo, DesktopResponse } from "../host/protocol";
import { workbenchChunkBytes, type WorkbenchRoute } from "../host/codex-workbench-transport";
import { openLocalPath, systemVersion } from "../host/local-system";
import { openNativeOsDialog } from "./native-file-dialog";
import { localMediaResponse } from "../workbench/local-media";
import { windowQuery } from "../workbench/window-target";

export interface BrowserServerOptions {
  home?: string;
  port?: number;
  webRoot: string;
  cliEntry: string;
  settingsPath: string;
  registerAgentRuntime?: boolean;
  codexWorkbench?: { key: string };
  antigravityWorkbench?: { key: string };
  dshWorkbench?: { key: string; parentOrigin: string };
  additionalActions?: ReadonlySet<string>;
  agentWorkspaceRoot?: string;
  disableNativeDialogs?: boolean;
  interceptInvoke?: (
    action: string,
    args: Record<string, unknown>,
    next: () => Promise<unknown>,
  ) => Promise<unknown>;
  development?: { origin: string; token: string; sourceCommit?: string };
}

const codexSandboxDomains = [
  "web-sandbox.oaiusercontent.com",
  "staging-web-sandbox.oaiusercontent.com",
];

function allowsCodexOrigin(value: string): boolean {
  if (value === "app://-") return true;
  const url = URL.parse(value);
  if (url?.protocol === "codex-sandbox:") {
    return value === `codex-sandbox://${url.hostname}` &&
      codexSandboxDomains.some((domain) =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      );
  }
  return url?.origin === value && url.protocol === "https:" &&
    (url.hostname === "chatgpt.com" ||
      url.hostname.endsWith(".chatgpt.com") ||
      url.hostname.endsWith(".oaiusercontent.com"));
}

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
  const dsh = options.dshWorkbench;
  const embedding = dsh ?? options.codexWorkbench;
  if (dsh) {
    const parent = URL.parse(dsh.parentOrigin);
    const localWeb = !!parent && parent.origin === dsh.parentOrigin &&
      ["http:", "https:"].includes(parent.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(parent.hostname);
    if (options.codexWorkbench || options.antigravityWorkbench || (!localWeb && dsh.parentOrigin !== "dsh-app://app"))
      throw new Error("The Harness workbench requires a local Harness origin.");
  }
  const workbenchParameter = dsh ? "dshWorkbench" : "codexWorkbench";
  const antigravityEmbedding = options.antigravityWorkbench;
  const embeddedHost = !!(embedding || antigravityEmbedding);
  if (
    (embedding && (!fixedHome || options.development || !/^[0-9a-f]{64}$/.test(embedding.key))) ||
    (antigravityEmbedding &&
      (!fixedHome || options.development || !/^[0-9a-f]{64}$/.test(antigravityEmbedding.key)))
  )
    throw new Error("The embedded workbench requires a fixed library and a private key.");
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
  let workbenchLocale: Locale | undefined;
  const token = options.development?.token ?? randomBytes(32).toString("hex");
  const webRoot = await realpath(options.webRoot);
  const sourceCommit =
    /<meta name="showai-source" content="([^"]+)"/.exec(
      await readFile(join(webRoot, "index.html"), "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      ),
    )?.[1] ??
    options.development?.sourceCommit ??
    "unknown";
  const osVersion = await systemVersion();
  const clients = new Map<ServerResponse, string>();
  const agTabs = new Map<
    string,
    { response: ServerResponse; projectId: string; pageId: string; visible: boolean }
  >();
  const ownWrites = new OwnWrites();
  const clientId = (value: unknown) =>
    typeof value === "string" && /^[\w-]{1,100}$/.test(value) ? value : "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const pendingRequests = new Set<Promise<void>>(),
    pendingChanges = new Set<Promise<void>>();
  let watcher!: ReturnType<typeof watchLibrary>;
  let sources: ReturnType<typeof watchDatasetSources> | undefined;
  let maintenance: MaintenanceScheduler | undefined;
  let origin = options.development?.origin ?? "";
  const info = (): DesktopInfo => ({
    home: store.root,
    version,
    platform: process.platform,
    packaged: !options.development,
    mode: "browser",
    sourceCommit,
    arch: arch(),
    osVersion,
    versions: { node: process.versions.node },
    cli: {
      command: process.execPath,
      args: [resolve(options.cliEntry)],
      env: {
        SHOWAI_HOME: store.root,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      },
    },
  });
  type ChangeForClient = (id: string) => DesktopChange | undefined;
  const workbenchChanges: ChangeForClient[] = [];
  let workbenchCursor = 0;
  function dispatchChanges(changeForClient: ChangeForClient) {
    for (const [client, id] of clients) {
      const update = changeForClient(id);
      if (update) client.write(`data: ${JSON.stringify(update)}\n\n`);
    }
    if (options.codexWorkbench) {
      workbenchChanges.push(changeForClient);
      if (workbenchChanges.length > 160) workbenchChanges.shift();
      workbenchCursor++;
    }
  }
  const notify = (type: "home" | "files", change?: DesktopChange) => {
    const update = { type, home: store.root, ...change } as DesktopChange;
    dispatchChanges(() => update);
  };
  async function deliverFiles(root: string, batch: string[]) {
    if (closed) return;
    const echoes = await ownWrites.echoes(batch);
    if (root !== store.root) return;
    const change = changedResources(root, batch);
    const dependents = change.datasets?.length
      ? await datasetDependents(store, change.datasets)
      : [];
    dispatchChanges((id) => {
      const own = id ? echoes.get(id) : undefined;
      const visible = own ? batch.filter((path) => !own.has(path)) : batch;
      if (!visible.length && !dependents.length) return undefined;
      const resources = changedResources(root, visible);
      return {
        ...resources,
        ...(dependents.length
          ? { datasets: [...new Set([...(resources.datasets ?? []), ...dependents])] }
          : {}),
        type: "files",
        home: root,
      };
    });
    if (!embeddedHost && !closed && (change.projectIds?.length || change.catalog || change.all))
      syncManager(root).wake(
        change.catalog || change.all ? undefined : change.projectIds,
        !!(change.catalog || change.all),
      );
  }
  let presence: InstanceHandle | undefined;
  async function announce() {
    await presence?.remove();
    presence = await publishInstance(store.root, {
      mode: "browser",
      channel: options.development ? "development" : "packaged",
      appVersion: version,
      sourceCommit,
      cli: info().cli,
      ...(origin ? { url: origin + "/" } : {}),
      ...(options.development
        ? { developmentUrl: options.development.origin }
        : {}),
    });
  }
  async function useHome(home: string) {
    if (!embeddedHost) await syncManager(store.root).stop();
    await maintenance?.stop();
    store = new FileStore(home);
    ownWrites.clear();
    await openLibrary(store.root);
    if (workbenchLocale) await recordAppLanguage(store.root, workbenchLocale);
    await sources?.close();
    sources = watchDatasetSources(store.root, (datasets) =>
      notify("files", {
        type: "files",
        home: store.root,
        projectIds: [],
        pageIds: [],
        datasets,
      }),
    );
    service = new AgentService({ root: store.root });
    if (!embeddedHost && options.registerAgentRuntime !== false)
      await registerRuntimeOnStartup(
        store.root,
        info().cli,
        options.development ? "development" : "packaged",
      );
    if (!embeddedHost) {
      await announce();
      maintenance = new MaintenanceScheduler(store.root).start();
      syncManager(store.root).start();
    }
    watcher = watchLibrary(store.root, (path) =>
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
              "history",
              "local",
              "cache",
              "index.sqlite",
              "index.sqlite-wal",
              "index.sqlite-shm",
            ].includes(part) || part.endsWith(".tmp"),
        ),
    );
    const paths = new Set<string>();
    watcher.on("all", (_event, path) => {
      paths.add(path);
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        const batch = [...paths];
        paths.clear();
        const operation = deliverFiles(store.root, batch)
          .catch((error) => console.error("ShowAI file watcher:", error))
          .finally(() => pendingChanges.delete(operation));
        pendingChanges.add(operation);
      }, 180);
    });
    watcher.on("error", (error) =>
      console.error("ShowAI file watcher:", error),
    );
    await new Promise<void>((done) => watcher.once("ready", done));
  }
  await useHome(store.root);
  const agentHost = new AgentHost({
    resources: new ModelResourceClient(() => store.root),
    root: join(dirname(options.settingsPath), "agent-host"),
    workspaceRoot:
      options.agentWorkspaceRoot ??
      (process.env.SHOWAI_AGENT_WORKSPACES || undefined),
    library: () => store,
    cli: () => info().cli,
    pluginRoot: () =>
      options.development
        ? join(process.cwd(), "plugins/showai")
        : resolve(dirname(options.cliEntry), "../assets/agent-plugin"),
  });
  const assets = (name: string, source: string) =>
    options.development
      ? join(process.cwd(), "plugins", source)
      : resolve(dirname(options.cliEntry), "../assets", name);
  const pluginInstaller = new DesktopPluginInstaller({
    root: join(dirname(options.settingsPath), "external-plugins"),
    pluginRoot: () => assets("agent-plugin", "showai"),
    dshBundleRoot: () => assets("dsh-plugin", "dsh-showai"),
    kimiBundleRoot: () => assets("kimi-plugin", "showai-kimi"),
    runtime: () => info(),
    channel: options.development ? "development" : "packaged",
  });
  const remoteConnector = embeddedHost ? undefined : new RemoteMacConnector(agentHost, () => store.root);
  void remoteConnector
    ?.start()
    .catch((error) => console.error("Remote Agent connector:", error.message));
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
    if (embeddedHost) {
      if (action === "sync:wake") return { scheduled: false };
      if (desktopPluginActions.has(action) || remoteDeviceActions.has(action))
        throw new CoreError("INVALID_DATA", "Manage plugins and remote devices in the ShowAI app.");
    }
    if (action === "appUpdate:state")
      return {
        supported: false,
        unavailableReason: "browser",
        automatic: false,
        phase: "idle",
        currentVersion: version,
      };
    if (desktopPluginActions.has(action))
      return pluginInstallerAction(pluginInstaller, action, args);
    if (action === "agent:remoteDevice") return remoteConnector?.status();
    if (action === "agent:approveRemoteClient")
      return remoteConnector?.approveClient(
        String(args.id),
        args.approve === true,
      );
    if (action === "agent:shareDevice")
      return remoteConnector?.save(
        args.settings as Parameters<RemoteMacConnector["save"]>[0],
      );
    if (agentActions.has(action)) return agentHost.action(action, args);
    maintenance?.markActivity();
    return createWorkbench(store, service, {
      preferencesChanged: () =>
        notify("files", {
          type: "files",
          home: store.root,
          projectIds: [],
          pageIds: [],
          projects: true,
        }),
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
          case "settings:chooseFolder":
            return selectedPath(args, true);
          case "settings:chooseHome": {
            if (fixedHome)
              throw new CoreError(
                "INVALID_DATA",
                "--home or SHOWAI_HOME fixes this launch's storage directory. Change it before the next launch.",
              );
            const home = await selectedPath(args, true);
            await new FileStore(home).listProjects();
            await watcher.close();
            clearTimeout(timer);
            const previous = store.root;
            try {
              await useHome(home);
            } catch (error) {
              await useHome(previous);
              notify("home");
              throw error;
            }
            await mkdir(dirname(options.settingsPath), { recursive: true });
            const temporary = `${options.settingsPath}.${randomUUID()}.tmp`;
            await writeFile(temporary, JSON.stringify({ home }) + "\n", {
              flag: "wx",
              mode: 0o600,
            });
            await rename(temporary, options.settingsPath);
            notify("home");
            return info();
          }
          case "export:printable": {
            const id = randomUUID();
            printables.set(id, String(args.html));
            setTimeout(() => printables.delete(id), 120000).unref();
            return { url: `/api/print/${id}` };
          }
          case "media:reveal":
            await openLocalPath(String(args.path), true);
            return null;
          case "app:openPageWindow":
          case "app:openWindow": {
            return {
              url: `${origin}/?${workbenchParams(args)}`,
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
  function workbenchParams(target: Parameters<typeof windowQuery>[0]) {
    const params = new URLSearchParams(windowQuery(target));
    if (embedding) params.set(workbenchParameter, embedding.key);
    return params;
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
        { id: "home", name: "Home", path: homedir() },
        { id: "library", name: "Library", path: store.root },
        ...(hasDownloads
          ? [{ id: "downloads", name: "Downloads", path: downloads }]
          : []),
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
  const printables = new Map<string, string>();
  const server = createServer((request, response) => {
    if (closed) {
      response.writeHead(503);
      response.end("ShowAI is shutting down.");
      return;
    }
    const operation = handleRequest()
      .catch((error) => {
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
      })
      .finally(() => pendingRequests.delete(operation));
    pendingRequests.add(operation);
    async function handleRequest() {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      response.setHeader("Referrer-Policy", "no-referrer");
      const requestOrigin = request.headers.origin;
      const codexOrigin = requestOrigin && options.codexWorkbench && allowsCodexOrigin(requestOrigin);
      const agPreflight =
        requestOrigin &&
        antigravityEmbedding &&
        request.method === "OPTIONS" &&
        request.headers["access-control-request-private-network"] === "true";
      if (
        request.headers.host !== new URL(origin).host ||
        (requestOrigin && requestOrigin !== origin && !codexOrigin && !agPreflight)
      ) {
        response.writeHead(403);
        response.end("Forbidden origin");
        return;
      }
      if (codexOrigin || agPreflight) {
        response.setHeader("Access-Control-Allow-Origin", requestOrigin);
        response.setHeader("Vary", "Origin");
        if (request.method === "OPTIONS") {
          response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST");
          response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-ShowAI-Client");
          if (request.headers["access-control-request-private-network"] === "true")
            response.setHeader("Access-Control-Allow-Private-Network", "true");
          response.writeHead(204);
          response.end();
          return;
        }
      }
      const url = new URL(request.url ?? "/", origin);
      const printable = /^\/api\/print\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (printable && request.method === "GET") {
        const html = printables.get(printable[1]);
        printables.delete(printable[1]);
        if (html === undefined) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' data: blob:; frame-src 'self' about: data: blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        );
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }
      const media = /^\/api\/media\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (media && (request.method === "GET" || request.method === "HEAD")) {
        const result = await localMediaResponse(
          media[1],
          request.headers.range,
          request.method === "HEAD",
        );
        response.writeHead(result.status, result.headers);
        if (result.body)
          result.body.on("error", () => response.destroy()).pipe(response);
        else response.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const supplied =
          url.pathname === "/api/events" ||
          url.pathname === "/api/antigravity-tab-events"
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
          clients.set(response, clientId(url.searchParams.get("client")));
          request.on("close", () => clients.delete(response));
          return;
        }
        if (
          antigravityEmbedding &&
          url.pathname === "/api/antigravity-tab-events" &&
          request.method === "GET"
        ) {
          const tabId = (url.searchParams.get("tabId") ?? "").slice(0, 80);
          const tabProjectId = (url.searchParams.get("project") ?? "").slice(0, 128);
          const tabPageId = (url.searchParams.get("page") ?? "").slice(0, 128);
          if (!tabId || !tabProjectId || !tabPageId) {
            response.writeHead(400);
            response.end();
            return;
          }
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
          });
          response.write(": connected\n\n");
          const entry = {
            response,
            projectId: tabProjectId,
            pageId: tabPageId,
            visible: url.searchParams.get("visible") !== "0",
          };
          agTabs.set(tabId, entry);
          request.on("close", () => {
            if (agTabs.get(tabId) === entry) agTabs.delete(tabId);
          });
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
          if (bytes > CAPACITY.authoringRequestBytes) {
            response.writeHead(413);
            response.end(
              `Browser authoring input is ${formatBytes(bytes)}; limit is ${formatBytes(CAPACITY.authoringRequestBytes)}.`,
            );
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new CoreError("INVALID_DATA", "Arguments must be an object.");
        let data: unknown;
        if (url.pathname === "/api/dialog/list") data = await dialogList(input);
        else if (url.pathname === "/api/dialog/native") {
          const mode =
            input.mode === "directory" ||
            input.mode === "openFile" ||
            input.mode === "saveFile"
              ? input.mode
              : "openFile";
          data = await openNativeOsDialog({
            mode,
            title: typeof input.title === "string" ? input.title : undefined,
            defaultPath:
              typeof input.defaultPath === "string"
                ? input.defaultPath
                : undefined,
            defaultName:
              typeof input.defaultName === "string"
                ? input.defaultName
                : undefined,
            extensions: Array.isArray(input.extensions)
              ? input.extensions.filter(
                  (item: unknown): item is string => typeof item === "string",
                )
              : undefined,
            disabled: options.disableNativeDialogs,
          });
        } else if (url.pathname === "/api/dialog/mkdir") {
          const parent = await realpath(required(input, "path"));
          const name = required(input, "name");
          if (name === "." || name === ".." || /[/\\\x00]/.test(name))
            throw new CoreError("INVALID_PATH", "Invalid folder name.");
          const path = join(parent, name);
          await mkdir(path);
          data = { path };
        } else if (url.pathname === "/api/locale") {
          if (input.locale !== "zh-CN" && input.locale !== "en")
            throw new CoreError("INVALID_DATA", "Unknown language.");
          setLocale(input.locale);
          workbenchLocale = input.locale;
          if (!embeddedHost) await recordAppLanguage(store.root, input.locale);
          data = null;
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
            (!workbenchActions.has(action) &&
              !agentActions.has(action) &&
              !desktopPluginActions.has(action) &&
              !remoteDeviceActions.has(action) &&
              action !== "appUpdate:state" &&
              !options.additionalActions?.has(action)) ||
            !args ||
            typeof args !== "object" ||
            Array.isArray(args)
          )
            throw new CoreError(
              "INVALID_DATA",
              "Unknown action or invalid arguments.",
            );
          data = options.interceptInvoke
            ? await options.interceptInvoke(action, args, () =>
                invoke(action, args),
              )
            : await invoke(action, args);
          const saved = (data as { path?: unknown } | null)?.path;
          const origin = clientId(request.headers["x-showai-client"]);
          if (action === "pages:save" && origin && typeof saved === "string")
            await ownWrites.record(origin, saved);
        } else if (
          antigravityEmbedding &&
          url.pathname === "/api/antigravity-tab-visibility"
        ) {
          const tabId =
            typeof input.tabId === "string" ? input.tabId.slice(0, 80) : "";
          const entry = tabId ? agTabs.get(tabId) : undefined;
          if (entry) {
            entry.visible = Boolean(input.visible);
            if (typeof input.projectId === "string" && input.projectId)
              entry.projectId = input.projectId.slice(0, 128);
            if (typeof input.pageId === "string" && input.pageId)
              entry.pageId = input.pageId.slice(0, 128);
          }
          data = { ok: true };
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
        const embedded = embedding &&
          (url.searchParams.get(workbenchParameter) === embedding.key ||
            (preview && request.headers["sec-fetch-site"] === "same-origin"));
        const agEmbedded = antigravityEmbedding &&
          (url.searchParams.get("agWorkbench") === antigravityEmbedding.key ||
            (preview && request.headers["sec-fetch-site"] === "same-origin"));
        if ((embedding && !embedded) || (antigravityEmbedding && !agEmbedded)) {
          response.writeHead(403);
          response.end("Forbidden workbench request");
          return;
        }
        if (embedded || agEmbedded) response.removeHeader("X-Frame-Options");
        else if (preview) response.setHeader("X-Frame-Options", "SAMEORIGIN");
        if (agEmbedded) response.removeHeader("Referrer-Policy");
        const ancestors = agEmbedded
          ? "*"
          : embedded && dsh ? `'self' ${dsh.parentOrigin}`
          : embedded
            ? "'self' app: https://chatgpt.com https://*.chatgpt.com https://*.oaiusercontent.com"
            : preview ? "'self'" : "'none'";
        const config = JSON.stringify({
          token,
          ...(codexOrigin && embedded ? { apiOrigin: origin, search: url.search } : {}),
          ...(embedded && dsh && !preview ? {
            dshWorkbench: {
              parentOrigin: dsh.parentOrigin,
              session: url.searchParams.get("dshSession") === "1",
              instance: url.searchParams.get("dshInstance")?.slice(0, 320) || "global",
            },
          } : {}),
          ...(embedded && options.codexWorkbench && !preview
            ? {
                codexWorkbench: {
                  key: embedding.key,
                  instance: /^[0-9a-f]{32}$/.test(url.searchParams.get("codexInstance") ?? "")
                    ? url.searchParams.get("codexInstance")
                    : randomBytes(16).toString("hex"),
                  mode: url.searchParams.get("codexMode") === "thread" ? "thread" : "global",
                },
              }
            : {}),
        }).replace(/</g, "\\u003c");
        const agBridge =
          agEmbedded && !preview
            ? `<script>(() => {
  const params = new URLSearchParams(location.search);
  const initialTheme = params.get("theme");
  if (initialTheme === "dark" || initialTheme === "light") {
    document.documentElement.style.colorScheme = initialTheme;
    document.documentElement.dataset.theme = initialTheme;
  }
  let seq = 0,
    notifiedReady = false,
    parentVisible = window.parent === window,
    viewportVisible = typeof IntersectionObserver !== "function";
  const pending = new Map();
  const wantsPage = params.has("page");
  function checkReady() {
    if (notifiedReady) return;
    const readyEl = wantsPage
      ? document.querySelector(".studio-page-title-input, .page-surface, .board-surface")
      : document.querySelector(".studio-main");
    if (!readyEl) return;
    notifiedReady = true;
    requestAnimationFrame(() => {
      window.parent.postMessage({ type: "showai:ag-page-ready" }, "*");
    });
  }
  const mo = new MutationObserver(() => {
    checkReady();
    if (notifiedReady) mo.disconnect();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  let syncVisibility = () => {};
  if (typeof IntersectionObserver === "function") {
    const attachProbe = () => {
      const root = document.body || document.documentElement;
      if (!root) return;
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText =
        "position:fixed;left:25%;top:25%;width:50%;height:50%;pointer-events:none;z-index:2147483647";
      root.appendChild(probe);
      const onIntersect = (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        const next =
          e.isIntersecting &&
          e.intersectionRect.width > 20 &&
          e.intersectionRect.height > 20 &&
          (typeof e.isVisible !== "boolean" || e.isVisible);
        if (next !== viewportVisible) {
          viewportVisible = next;
          syncVisibility();
        }
      };
      let io;
      try {
        io = new IntersectionObserver(onIntersect, {
          threshold: [0, 0.05, 0.5],
          trackVisibility: true,
          delay: 120,
        });
      } catch {
        io = new IntersectionObserver(onIntersect, { threshold: [0, 0.05, 0.5] });
      }
      io.observe(probe);
    };
    if (document.body) attachProbe();
    else document.addEventListener("DOMContentLoaded", attachProbe, { once: true });
  }
  const initialProject = params.get("project") || "";
  const initialPage = params.get("page") || "";
  const localToken = window.__SHOWAI_LOCAL__?.token || "";
  if (initialProject && initialPage && localToken) {
    const tabId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const isVisible = () =>
      parentVisible &&
      viewportVisible &&
      document.visibilityState === "visible" &&
      window.innerWidth > 40 &&
      window.innerHeight > 40;
    let lastVisible = isVisible();
    const sseParams = new URLSearchParams({
      token: localToken,
      tabId,
      project: initialProject,
      page: initialPage,
      visible: lastVisible ? "1" : "0",
    });
    const tabEvents = new EventSource("/api/antigravity-tab-events?" + sseParams.toString());
    tabEvents.onmessage = (ev) => {
      try {
        const detail = JSON.parse(ev.data);
        if (detail?.pageId) {
          window.dispatchEvent(new CustomEvent("showai:open-page", { detail }));
        }
      } catch {}
    };
    syncVisibility = (force) => {
      const next = typeof force === "boolean" ? force : isVisible();
      if (next === lastVisible && typeof force !== "boolean") return;
      lastVisible = next;
      fetch("/api/antigravity-tab-visibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + localToken,
        },
        body: JSON.stringify({ tabId, visible: next }),
        keepalive: next === false,
      }).catch(() => {});
    };
    tabEvents.onopen = () => syncVisibility(isVisible());
    document.addEventListener("visibilitychange", () => syncVisibility());
    window.addEventListener("resize", () => syncVisibility());
    window.addEventListener("focus", () => syncVisibility());
    window.addEventListener("pagehide", () => {
      syncVisibility(false);
      tabEvents.close();
    });
  }
  window.__SHOWAI_ANTIGRAVITY_HOST__ = {
    canReference() { return window.parent !== window; },
    attachReference(reference, text, components) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Reference timed out")); }, 8000);
        pending.set(id, { resolve, reject, timer });
        window.parent.postMessage({ type: "showai:ag-file-reference", id, reference, text, components }, "*");
      });
    },
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    const msg = event.data;
    if (msg.type === "showai:ag-file-reference-ack" && pending.has(msg.id)) {
      const w = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(w.timer);
      msg.error ? w.reject(new Error(msg.error)) : w.resolve();
    } else if (msg.type === "showai:ag-host-theme" && (msg.theme === "dark" || msg.theme === "light")) {
      document.documentElement.style.colorScheme = msg.theme;
      document.documentElement.dataset.theme = msg.theme;
    } else if (msg.type === "showai:ag-host-visibility" && typeof msg.visible === "boolean") {
      parentVisible = msg.visible;
      syncVisibility();
    } else if (msg.type === "showai:ag-open-page" && msg.detail?.pageId) {
      window.dispatchEvent(new CustomEvent("showai:open-page", { detail: msg.detail }));
    }
  });
})();</script>`
            : "";
        const index = await readFile(join(webRoot, "index.html"), "utf8");
        const document = codexOrigin && embedded
          ? index.replaceAll('"./assets/', `"${origin}/assets/`)
          : index;
        const html = document.replace(
          "<head>",
          `<head><script>window.__SHOWAI_LOCAL__=${config}</script>${agBridge}`,
        );
        const scriptBlob = agEmbedded ? " blob:" : "";
        response.setHeader(
          "Content-Security-Policy",
          `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${scriptBlob}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self'; frame-src 'self' about: data: blob:; frame-ancestors ${ancestors}; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'self'${scriptBlob}`,
        );
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : html);
        return;
      }
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
    for (const client of clients.keys()) client.write(": heartbeat\n\n");
    for (const tab of agTabs.values()) tab.response.write(": heartbeat\n\n");
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
    await sources?.close();
    await presence?.remove();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  function close() {
    if (closePromise) return closePromise;
    closed = true;
    return (closePromise = (async () => {
      clearInterval(heartbeat);
      clearTimeout(timer);
      await Promise.all(pendingRequests);
      await watcher.close();
      await sources?.close();
      await Promise.all(pendingChanges);
      await remoteConnector?.close();
      agentHost.close();
      if (!embeddedHost) await syncManager(store.root).stop();
      await maintenance?.stop();
      await presence?.remove();
      for (const client of clients.keys()) client.end();
      for (const tab of agTabs.values()) tab.response.end();
      agTabs.clear();
      await new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      });
    })());
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local server address.");
  if (!origin) {
    origin = `http://127.0.0.1:${address.port}`;
    if (!embeddedHost) await announce();
  }
  return {
    url: origin + "/",
    localUrl: `http://127.0.0.1:${address.port}`,
    home: store.root,
    close,
    connectedClients: () => clients.size,
    navigateAntigravityTab(target: {
      projectId: string;
      pageId: string;
      blockId?: string;
    }) {
      let delivered = false;
      for (const tab of agTabs.values()) {
        if (
          tab.visible &&
          tab.projectId === target.projectId &&
          tab.pageId === target.pageId
        ) {
          tab.response.write(`data: ${JSON.stringify(target)}\n\n`);
          delivered = true;
        }
      }
      return delivered;
    },
    workbench: {
      async request(route: WorkbenchRoute, args: Record<string, unknown>, client: string) {
        const response = await fetch(`${origin}/api/${route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-ShowAI-Client": client,
          },
          body: JSON.stringify(args),
        });
        if (!response.headers.get("content-type")?.includes("application/json"))
          throw new CoreError("INVALID_DATA", `ShowAI workbench returned HTTP ${response.status}.`);
        return await response.json() as DesktopResponse<unknown>;
      },
      changes(after: number, client: string) {
        const oldest = workbenchCursor - workbenchChanges.length;
        const changes: DesktopChange[] = after < oldest || after > workbenchCursor
          ? [{ type: "files", home: store.root, all: true }]
          : workbenchChanges.slice(after - oldest).flatMap((changeForClient) =>
              changeForClient(client) ?? [],
            );
        return { cursor: workbenchCursor, changes };
      },
      async media(grant: string, offset: number) {
        const response = await fetch(`${origin}/api/media/${grant}`, {
          headers: { Range: `bytes=${offset}-${offset + workbenchChunkBytes - 1}` },
        });
        const range = /^bytes \d+-\d+\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
        if (response.status !== 206 || !range) {
          await response.body?.cancel();
          throw new CoreError("NOT_FOUND", "The local media chunk is unavailable.");
        }
        return {
          base64: Buffer.from(await response.arrayBuffer()).toString("base64"),
          mime: response.headers.get("content-type") ?? "application/octet-stream",
          size: Number(range[1]),
        };
      },
    },
  };
}
