import { changedResources } from "../core/change-notification";
import { OwnWrites } from "../core/own-writes";
import { ModelResourceClient } from "../sync/model-resources";
import "./component-thumbnails";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, NativeImage } from "electron";
import { watch, type FSWatcher } from "chokidar";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { atomicRename } from "../core/atomic-rename";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tabShortcut } from "../workbench/tab-shortcuts";
import { windowQuery, type WindowTarget } from "../workbench/window-target";
import { AgentService, errorResult } from "../agent/service";
import { MaintenanceScheduler } from "../core/maintenance-scheduler";
import { syncManager } from "../sync/manager";
import { deepLinkInvitation } from "../sync/server-url";
import { openLibrary } from "../core/open-library";
import { registerRuntime } from "../agent/runtime";
import { AgentHost, agentActions } from "../agent-host/host";
import { RemoteMacConnector } from "../agent-host/remote-connector";
import { assertId, CoreError, FileStore } from "../core/store";
import {
  createWorkbench,
  workbenchActions as actions,
  projectId,
  text,
} from "../workbench/actions";
import {
  getLocale,
  isLanguagePreference,
  languageOverride,
  resolveLocale,
  setLocale,
  translator,
  type Locale,
} from "../i18n";
import desktopMessages from "../i18n/messages/desktop";
import type {
  DesktopAppearance,
  DesktopChange,
  DesktopInfo,
  DesktopResponse,
} from "./bridge";

const t = translator(desktopMessages);
const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "..");
const windows = new Set<BrowserWindow>();
const windowAppearances = new WeakMap<BrowserWindow, DesktopAppearance>();
const appearanceIcons = new Map<DesktopAppearance, NativeImage>();
let store: FileStore;
let service: AgentService;
let agentHost: AgentHost;
let remoteConnector: RemoteMacConnector;
let watcher: FSWatcher | undefined;
let maintenance: MaintenanceScheduler | undefined;
let notification: ReturnType<typeof setTimeout> | undefined;
// A window already holds the record of its own save; skip that echo for it.
const ownWrites = new OwnWrites();
let pendingDeepLink = process.argv.find((argument) =>
  argument.startsWith("showai://"),
);
const closeRequests = new Map<
  number,
  {
    requestId: string;
    resolve: (allow: boolean | null) => void;
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<boolean>;
  }
>();
let checkingQuit = false;
let allowedQuit = false;

app.setName("ShowAI");
// Chromium reports this to the renderer as the system language.
const pinnedLocale = languageOverride();
if (pinnedLocale) app.commandLine.appendSwitch("lang", pinnedLocale);
if (process.env.SHOWAI_USER_DATA)
  app.setPath("userData", resolve(process.env.SHOWAI_USER_DATA));

function iconForAppearance(appearance: DesktopAppearance): NativeImage {
  const cached = appearanceIcons.get(appearance);
  if (cached) return cached;
  const root = process.env.SHOWAI_DEV_URL ? process.cwd() : repository;
  const path = join(
    root,
    "src/desktop/assets",
    appearance === "dark" ? "icon-light.png" : "icon.png",
  );
  const icon = nativeImage.createFromPath(path);
  if (icon.isEmpty()) throw new Error(`Cannot load application icon: ${path}`);
  appearanceIcons.set(appearance, icon);
  return icon;
}

function applyWindowAppearance(
  window: BrowserWindow,
  appearance: DesktopAppearance,
): void {
  windowAppearances.set(window, appearance);
  const icon = iconForAppearance(appearance);
  if (process.platform !== "darwin") window.setIcon(icon);
  if (window.isFocused() || !BrowserWindow.getFocusedWindow())
    app.dock?.setIcon(icon);
}

function runtimePath(): string {
  if (!app.isPackaged && process.env.SHOWAI_DEV_RUNTIME)
    return resolve(process.env.SHOWAI_DEV_RUNTIME);
  return app.isPackaged
    ? join(process.resourcesPath, "runtime")
    : join(repository, "dist-runtime");
}

function info(): DesktopInfo {
  return {
    home: store.root,
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
    cli: {
      command: process.execPath,
      args: [join(runtimePath(), "scripts", "cli.mjs")],
      env: { ELECTRON_RUN_AS_NODE: "1", SHOWAI_HOME: store.root },
    },
  };
}

function broadcast(type: DesktopChange["type"], change?: DesktopChange): void {
  for (const window of windows)
    if (!window.isDestroyed())
      window.webContents.send("showai:changed", {
        type,
        home: store.root,
        ...change,
      } satisfies DesktopChange);
}

async function deliverFiles(root: string, batch: string[]): Promise<void> {
  const echoes = await ownWrites.echoes(batch);
  if (root !== store.root) return;
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    const own = echoes.get(String(window.webContents.id));
    const visible = own ? batch.filter((path) => !own.has(path)) : batch;
    if (visible.length)
      window.webContents.send("showai:changed", {
        ...changedResources(root, visible),
        type: "files",
        home: root,
      } satisfies DesktopChange);
  }
  const change = changedResources(root, batch);
  if (change.projectIds?.length || change.catalog || change.all)
    syncManager(root).wake(
      change.catalog || change.all ? undefined : change.projectIds,
      !!(change.catalog || change.all),
    );
}

async function useHome(home?: string): Promise<void> {
  if (store) await syncManager(store.root).stop();
  await maintenance?.stop();
  await watcher?.close();
  ownWrites.clear();
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
      relative(store.root, path)
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
  });
  const paths = new Set<string>();
  watcher.on("all", (_event, path) => {
    paths.add(path);
    if (notification) return;
    notification = setTimeout(() => {
      notification = undefined;
      const batch = [...paths];
      paths.clear();
      void deliverFiles(store.root, batch).catch((error) =>
        console.error("ShowAI file watcher:", error),
      );
    }, 180);
  });
  watcher.on("error", (error) => console.error("ShowAI file watcher:", error));
}

interface DesktopSettings {
  home?: string;
  /** Last workbench language, so native menus match it before a window loads. */
  locale?: Locale;
}

async function readSettings(): Promise<DesktopSettings> {
  const path = join(app.getPath("userData"), "showai-settings.json");
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const settings = JSON.parse(contents) as { home?: unknown; locale?: unknown };
  if (settings.home !== undefined && typeof settings.home !== "string")
    throw new Error("ShowAI settings contain an invalid home directory.");
  return {
    home: settings.home,
    // An unknown saved language falls back to the system language.
    locale:
      isLanguagePreference(settings.locale) && settings.locale !== "system"
        ? settings.locale
        : undefined,
  };
}

async function saveSettings(update: DesktopSettings): Promise<void> {
  const path = join(app.getPath("userData"), "showai-settings.json");
  const settings = { ...(await readSettings()), ...update };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  await atomicRename(temporary, path);
}

function buildApplicationMenu() {
  const darwin = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(darwin
        ? [
            {
              role: "appMenu" as const,
              submenu: [
                { role: "about" as const, label: t("menu.about") },
                { type: "separator" as const },
                {
                  role: "services" as const,
                  label: t("menu.services"),
                },
                { type: "separator" as const },
                { role: "hide" as const, label: t("menu.hide") },
                { role: "hideOthers" as const, label: t("menu.hideOthers") },
                { role: "unhide" as const, label: t("menu.showAll") },
                { type: "separator" as const },
                { role: "quit" as const, label: t("menu.quit") },
              ],
            },
          ]
        : []),
      {
        role: "editMenu",
        label: t("menu.edit"),
        submenu: [
          { role: "undo", label: t("menu.undo") },
          { role: "redo", label: t("menu.redo") },
          { type: "separator" },
          { role: "cut", label: t("menu.cut") },
          { role: "copy", label: t("menu.copy") },
          { role: "paste", label: t("menu.paste") },
          ...(darwin
            ? [
                {
                  role: "pasteAndMatchStyle" as const,
                  label: t("menu.pasteAndMatchStyle"),
                },
              ]
            : []),
          { role: "delete", label: t("menu.delete") },
          { role: "selectAll", label: t("menu.selectAll") },
        ],
      },
      {
        role: "viewMenu",
        label: t("menu.view"),
        submenu: [
          {
            label: t("menu.refreshPage"),
            accelerator: "CommandOrControl+R",
            click: (_item, window) => {
              if (window instanceof BrowserWindow && windows.has(window))
                window.webContents.send("showai:refresh-page");
            },
          },
          { role: "toggleDevTools", label: t("menu.toggleDevTools") },
          { type: "separator" },
          { role: "resetZoom", label: t("menu.resetZoom") },
          { role: "zoomIn", label: t("menu.zoomIn") },
          { role: "zoomOut", label: t("menu.zoomOut") },
          { type: "separator" },
          { role: "togglefullscreen", label: t("menu.toggleFullScreen") },
        ],
      },
      {
        role: "windowMenu",
        label: t("menu.window"),
        submenu: [
          { role: "minimize", label: t("menu.minimize") },
          { role: "zoom", label: t("menu.zoom") },
          ...(darwin
            ? [
                { type: "separator" as const },
                { role: "front" as const, label: t("menu.front") },
              ]
            : [{ role: "close" as const, label: t("menu.close") }]),
        ],
      },
    ]),
  );
}

async function nativeAction(
  action: string,
  args: Record<string, unknown>,
  window: BrowserWindow,
): Promise<unknown> {
  switch (action) {
    case "fs:reveal": {
      const id = projectId(args),
        page = text(args, "pageId", true);
      await store.listPages(id);
      if (page) {
        const record = await store.readPage(id, assertId(page), {
          checkpoint: false,
        });
        shell.showItemInFolder(record.path);
      } else {
        const error = await shell.openPath(store.projectPath(id));
        if (error) throw new Error(error);
      }
      return null;
    }
    case "settings:chooseHome": {
      if (process.env.SHOWAI_HOME)
        throw new CoreError(
          "INVALID_DATA",
          "SHOWAI_HOME fixes this launch's storage directory. Change it before the next launch.",
        );
      const selection = await dialog.showOpenDialog(window, {
        title: t("chooseDataDirectory"),
        defaultPath: store.root,
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      const home = await realpath(selection.filePaths[0]);
      await new FileStore(home).listProjects();
      await saveSettings({ home });
      await useHome(home);
      broadcast("home");
      return info();
    }
    case "clipboard:write": {
      if (typeof args.text !== "string" || args.text.length > 2 * 1024 * 1024)
        throw new CoreError(
          "INVALID_DATA",
          "Clipboard text must be at most 2 MB.",
        );
      clipboard.writeText(args.text);
      return null;
    }
    case "app:openPageWindow":
    case "app:openWindow": {
      await createWindow(args);
      return null;
    }
    default:
      throw new CoreError("INVALID_DATA", `Unknown native action: ${action}`);
  }
}
async function handle(
  action: string,
  args: Record<string, unknown>,
  window: BrowserWindow,
): Promise<unknown> {
  maintenance?.markActivity();
  if (action === "agent:remoteDevice") return remoteConnector.status();
  if (action === "agent:approveRemoteClient")
    return remoteConnector.approveClient(
      String(args.id),
      args.approve === true,
    );
  if (action === "agent:shareDevice")
    return remoteConnector.save(
      args.settings as Parameters<RemoteMacConnector["save"]>[0],
    );
  if (agentActions.has(action)) return agentHost!.action(action, args);
  const result = await createWorkbench(store, service, {
    preferencesChanged: () =>
      broadcast("files", {
        type: "files",
        home: store.root,
        projectIds: [],
        pageIds: [],
        projects: true,
      }),
    info,
    openDialog: (options) =>
      dialog.showOpenDialog(window, options as Electron.OpenDialogOptions),
    saveDialog: (options) => dialog.showSaveDialog(window, options),
    invoke: (action, args) => nativeAction(action, args, window),
  })(action, args);
  const saved = (result as { path?: unknown } | null)?.path;
  if (action === "pages:save" && typeof saved === "string")
    await ownWrites.record(String(window.webContents.id), saved);
  return result;
}

function isWorkbenchLocation(source: string): boolean {
  if (!URL.canParse(source)) return false;
  const location = new URL(source);
  if (process.env.SHOWAI_DEV_URL) {
    const entry = new URL(process.env.SHOWAI_DEV_URL);
    return (
      location.origin === entry.origin && location.pathname === entry.pathname
    );
  }
  return (
    location.protocol === "file:" &&
    (!location.host || location.host === "localhost") &&
    fileURLToPath(location) === join(directory, "index.html")
  );
}

function trustedSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    !windows.has(window) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new CoreError(
      "INVALID_PATH",
      "Desktop actions are only available to the ShowAI application frame.",
    );
  if (!isWorkbenchLocation(event.senderFrame.url))
    throw new CoreError("INVALID_PATH", "Untrusted application location.");
  return window;
}

function requestClose(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(true);
  const pending = closeRequests.get(window.id);
  if (pending) return pending.promise;
  const requestId = randomUUID();
  let resolveResult!: (allow: boolean | null) => void;
  const received = new Promise<boolean | null>((resolve) => {
    resolveResult = resolve;
  });
  const timer = setTimeout(() => resolveResult(null), 20000);
  const promise = received
    .then(async (allow) => {
      if (allow !== null || window.isDestroyed()) return allow ?? true;
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        message: t("unsavedMessage"),
        detail: t("unsavedDetail"),
        buttons: [t("keepEditing"), t("discardAndClose")],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return choice.response === 1;
    })
    .finally(() => {
      clearTimeout(timer);
      if (closeRequests.get(window.id)?.requestId === requestId)
        closeRequests.delete(window.id);
    });
  closeRequests.set(window.id, {
    requestId,
    resolve: resolveResult,
    timer,
    promise,
  });
  window.webContents.send("showai:before-close", requestId);
  return promise;
}

async function createWindow(page?: WindowTarget): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: page ? 1120 : 1320,
    height: 880,
    minWidth: 760,
    minHeight: 560,
    title: "ShowAI",
    backgroundColor: "#f8f8f6",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 16, y: 12 } : undefined,
    webPreferences: {
      preload: join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  windows.add(window);
  applyWindowAppearance(
    window,
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  );
  window.on("focus", () => {
    app.dock?.setIcon(iconForAppearance(windowAppearances.get(window)!));
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const command = tabShortcut({
      key: input.key,
      metaKey: input.meta,
      ctrlKey: input.control,
      shiftKey: input.shift,
      altKey: input.alt,
    });
    if (!command) return;
    event.preventDefault();
    if (!input.isAutoRepeat)
      window.webContents.send("showai:tab-command", command);
  });
  const sendWindowState = () => {
    window.webContents.send("showai:window-state-changed", {
      fullScreen: window.isFullScreen(),
    });
  };
  window.on("enter-full-screen", sendWindowState);
  window.on("leave-full-screen", sendWindowState);
  window.on("close", (event) => {
    if (allowedQuit) return;
    event.preventDefault();
    void requestClose(window).then((allow) => {
      if (allow && !window.isDestroyed()) {
        window.destroy();
      }
    });
  });
  window.on("closed", () => {
    closeRequests.get(window.id)?.resolve(true);
    windows.delete(window);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWorkbenchLocation(url)) {
      const params = new URL(url).searchParams;
      const projectId = params.get("project"),
        pageId = params.get("page"),
        folderId = params.get("folder");
      void createWindow(
        projectId
          ? {
              projectId,
              pageId: pageId ?? undefined,
              folderId: folderId ?? undefined,
            }
          : undefined,
      ).catch((error) =>
        dialog.showErrorBox(t("openPageFailed"), errorResult(error).message),
      );
      return { action: "deny" };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-navigate", (event) => {
    if (isWorkbenchLocation(event.url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(event.url)) void shell.openExternal(event.url);
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && !event.url.startsWith("about:"))
      event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  const query = windowQuery(page);
  if (process.env.SHOWAI_DEV_URL) {
    const url = new URL(process.env.SHOWAI_DEV_URL);
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
    await window.loadURL(url.href);
  } else await window.loadFile(join(directory, "index.html"), { query });
  return window;
}

async function openDeepLink(source: string): Promise<void> {
  const url = new URL(source);
  if (url.protocol === "showai:" && url.hostname === "login") {
    // The browser returns the login completion code to the window polling for it.
    if (!store) throw new CoreError("NOT_FOUND", t("login.libraryClosed"));
    syncManager(store.root).deliverLoginCompletion(
      url.searchParams.get("flow") ?? "",
      url.searchParams.get("code") ?? "",
    );
    const window = [...windows][0];
    window?.show();
    window?.focus();
    return;
  }
  if (url.protocol === "showai:" && url.hostname === "join") {
    const link = deepLinkInvitation(source);
    await createWindow({ invite: link.toString() });
    return;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "showai:" ||
    url.hostname !== "project" ||
    parts.length !== 3 ||
    parts[1] !== "page"
  )
    throw new CoreError(
      "INVALID_PATH",
      "Expected showai://project/PROJECT/page/PAGE.",
    );
  const project = assertId(parts[0]),
    page = assertId(parts[2]);
  await store.readPage(project, page);
  await createWindow({ projectId: project, pageId: page });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  if (!app.isPackaged && process.env.SHOWAI_DEV_URL)
    process.on("message", (message) => {
      if (message === "showai:development-quit") app.quit();
      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        message.type === "showai:development-focus"
      ) {
        if ("url" in message && typeof message.url === "string")
          void openDeepLink(message.url).catch((error) =>
            dialog.showErrorBox(
              t("openPageFailed"),
              errorResult(error).message,
            ),
          );
        else {
          const window = [...windows][0];
          if (window) {
            window.restore();
            window.show();
            window.focus();
          } else
            void createWindow().catch((error) =>
              dialog.showErrorBox(
                t("openWindowFailed"),
                errorResult(error).message,
              ),
            );
        }
      }
    });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!app.isReady()) pendingDeepLink = url;
    else
      void openDeepLink(url).catch((error) =>
        dialog.showErrorBox(t("openPageFailed"), errorResult(error).message),
      );
  });
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((argument) => argument.startsWith("showai://"));
    if (link)
      void openDeepLink(link).catch((error) =>
        dialog.showErrorBox(t("openPageFailed"), errorResult(error).message),
      );
    else {
      const window = [...windows][0];
      window?.show();
      window?.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const settings = await readSettings();
      setLocale(
        pinnedLocale ??
          settings.locale ??
          resolveLocale(app.getPreferredSystemLanguages()),
      );
      await useHome(process.env.SHOWAI_HOME ?? settings.home);
      process.env.SHOWAI_VIEWER ??= join(
        runtimePath(),
        "assets",
        "viewer.html",
      );
      if (app.isPackaged) {
        process.env.SHOWAI_INDEX_WORKER = join(
          runtimePath(),
          "scripts",
          "index-worker.mjs",
        );
        process.env.SHOWAI_RUNTIME_ENTRY = join(
          runtimePath(),
          "scripts",
          "cli.mjs",
        );
        process.env.ESBUILD_BINARY_PATH ??= join(
          runtimePath(),
          "node_modules",
          "@esbuild",
          `${process.platform}-${process.arch}`,
          process.platform === "win32" ? "esbuild.exe" : "bin/esbuild",
        );
      }
      agentHost = new AgentHost({
        resources: new ModelResourceClient(() => store.root),
        root: join(app.getPath("userData"), "agent-host"),
        // Isolated development instances keep Agent work files in their task directory.
        workspaceRoot:
          process.env.SHOWAI_AGENT_WORKSPACES ||
          join(app.getPath("documents"), "ShowAI", "Agent Workspaces"),
        library: () => store,
        cli: () => info().cli,
        pluginRoot: () =>
          process.env.SHOWAI_DEV_URL
            ? join(process.cwd(), "plugins/showai")
            : join(runtimePath(), "assets/agent-plugin"),
        openUrl: (url) => shell.openExternal(url),
      });
      remoteConnector = new RemoteMacConnector(agentHost, () => store.root);
      void remoteConnector
        .start()
        .catch((error) =>
          console.error("Remote Agent connector:", error.message),
        );
      if (app.isPackaged) app.setAsDefaultProtocolClient("showai");
      buildApplicationMenu();
      ipcMain.handle("showai:set-locale", async (event, locale: unknown) => {
        trustedSender(event);
        if (locale !== "zh-CN" && locale !== "en")
          throw new CoreError("INVALID_DATA", "Unknown language.");
        if (locale === getLocale()) return;
        setLocale(locale);
        buildApplicationMenu();
        await saveSettings({ locale });
      });
      ipcMain.handle("showai:window-state", (event) => ({
        fullScreen: trustedSender(event).isFullScreen(),
      }));
      ipcMain.handle("showai:set-appearance", (event, appearance: unknown) => {
        const window = trustedSender(event);
        if (appearance !== "light" && appearance !== "dark")
          throw new CoreError("INVALID_DATA", "Unknown appearance.");
        applyWindowAppearance(window, appearance);
      });
      ipcMain.on("showai:close-result", (event, payload: unknown) => {
        let window: BrowserWindow;
        try {
          window = trustedSender(event);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const result = payload as { requestId?: unknown; allow?: unknown };
        const pending = closeRequests.get(window.id);
        if (
          pending &&
          pending.requestId === result.requestId &&
          typeof result.allow === "boolean"
        )
          pending.resolve(result.allow);
      });
      ipcMain.handle(
        "showai:invoke",
        async (
          event,
          action: unknown,
          args: unknown,
        ): Promise<DesktopResponse> => {
          try {
            const window = trustedSender(event);
            if (
              typeof action !== "string" ||
              (!actions.has(action) && !agentActions.has(action))
            )
              throw new CoreError("INVALID_DATA", "Unknown desktop action.");
            if (!args || typeof args !== "object" || Array.isArray(args))
              throw new CoreError(
                "INVALID_DATA",
                "Desktop arguments must be an object.",
              );
            return {
              ok: true,
              data: await handle(
                action,
                args as Record<string, unknown>,
                window,
              ),
            };
          } catch (error) {
            return { ok: false, error: errorResult(error) };
          }
        },
      );
      if (pendingDeepLink) await openDeepLink(pendingDeepLink);
      else await createWindow();
      if (!app.isPackaged && process.env.SHOWAI_DEV_URL)
        process.send?.({ type: "ready", home: store.root });
      app.on("activate", () => {
        if (!windows.size) void createWindow();
      });
    })
    .catch((error) => {
      dialog.showErrorBox(t("startFailed"), errorResult(error).message);
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (allowedQuit) return;
    event.preventDefault();
    if (checkingQuit) return;
    checkingQuit = true;
    void Promise.all([...windows].map(requestClose)).then(async (results) => {
      checkingQuit = false;
      if (!results.every(Boolean)) {
        if (!app.isPackaged && process.env.SHOWAI_DEV_URL)
          process.send?.({ type: "quit-blocked" });
        return;
      }
      allowedQuit = true;
      remoteConnector?.close();
      agentHost?.close();
      clearTimeout(notification);
      await watcher?.close();
      await maintenance?.stop();
      await syncManager(store.root).stop();
      for (const window of windows) if (!window.isDestroyed()) window.destroy();
      app.quit();
    });
  });
}
