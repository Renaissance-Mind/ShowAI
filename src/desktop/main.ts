import { changedResources } from "../core/change-notification";
import { watchDatasetSources } from "../core/dataset-sources";
import { OwnWrites } from "../core/own-writes";
import { ModelResourceClient } from "../sync/model-resources";
import {
  configurePageThumbnails,
  invalidatePageThumbnails,
  pagePreviewStatus,
  preparePreviewWindows,
} from "./component-thumbnails";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  protocol,
  shell,
} from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, NativeImage } from "electron";
import { watchLibrary, type LibraryWatcher } from "../core/library-watcher";
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  rename,
  stat,
  access,
  constants as fsConstants,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import {
  captureConsole,
  createMainLog,
  readLogTail,
  redactLogText,
} from "./main-log";
import { redact } from "../core/redact";
import { atomicRename } from "../core/atomic-rename";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { localMediaResponse } from "../workbench/local-media";
import { LOCAL_MEDIA_SCHEME } from "../components/custom/local-media-link";
import { tabShortcut } from "../workbench/tab-shortcuts";
import { MenuCommandQueue } from "./menu-queue";
import { windowQuery, type WindowTarget } from "../workbench/window-target";
import { AgentService, errorResult } from "../agent/service";
import { MaintenanceScheduler } from "../core/maintenance-scheduler";
import { syncManager } from "../sync/manager";
import { deepLinkInvitation } from "../sync/server-url";
import { openLibrary } from "../core/open-library";
import { versionedLibrary } from "../core/library-runtime";
import type { LoadedPage } from "../studio/usePage";
import { BackgroundWorker } from "../core/background-worker";
import { registerRuntimeOnStartup } from "../agent/runtime";
import {
  publishInstance,
  type InstanceHandle,
} from "../core/instance-presence.mjs";
import { closeBlockers, describeBlocker } from "./close-report";
import { QuitRecord, type CloseTrigger } from "./quit-record";
import {
  DesktopPluginInstaller,
  desktopPluginActions,
  pluginInstallerAction,
} from "../plugin/desktop-install";
import { AgentHost, agentActions } from "../agent-host/host";
import {
  RemoteMacConnector,
  remoteDeviceActions,
} from "../agent-host/remote-connector";
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
  CloseBlocker,
  DesktopAppearance,
  DesktopChange,
  DesktopInfo,
  DesktopResponse,
  MenuCommand,
  UnsavedPage,
} from "./bridge";

const t = translator(desktopMessages);
const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "..");
const windows = new Set<BrowserWindow>();
const menuCommands = new MenuCommandQueue<BrowserWindow, MenuCommand>(
  (window, command) => {
    if (!window.isDestroyed())
      window.webContents.send("showai:menu-command", command);
  },
);
const windowAppearances = new WeakMap<BrowserWindow, DesktopAppearance>();
const appearanceIcons = new Map<DesktopAppearance, NativeImage>();
let store: FileStore;
let service: AgentService;
let agentHost: AgentHost;
let pluginInstaller: DesktopPluginInstaller;
let remoteConnector: RemoteMacConnector;
let watcher: LibraryWatcher | undefined;
let sources: ReturnType<typeof watchDatasetSources> | undefined;
let maintenance: MaintenanceScheduler | undefined;
let notification: ReturnType<typeof setTimeout> | undefined;
// A window already holds the record of its own save; skip that echo for it.
const ownWrites = new OwnWrites();
let pendingDeepLink = process.argv.find((argument) =>
  argument.startsWith("showai://"),
);
interface CloseReply {
  allow: boolean;
  pages: UnsavedPage[];
  blockers: CloseBlocker[];
  reason: string;
}
/** How a close request ended, with what held the window open. */
interface CloseOutcome {
  allow: boolean;
  windowId: number;
  title: string;
  blockers: CloseBlocker[];
  /** keep: the person kept editing; discard: closed despite the blockers. */
  decision?: "keep" | "discard";
}
/** A window that does not answer a close request in this time is reported as NO_REPLY. */
const CLOSE_REPLY_TIMEOUT_MS = 20000;
const closeRequests = new Map<
  number,
  {
    requestId: string;
    resolve: (reply: CloseReply | null) => void;
    timer: ReturnType<typeof setTimeout>;
    promise: Promise<CloseOutcome>;
  }
>();
let checkingQuit = false;
let allowedQuit = false;
let presence: InstanceHandle | undefined;

app.setName("ShowAI");
// Chromium reports this to the renderer as the system language.
const pinnedLocale = languageOverride();
if (pinnedLocale) app.commandLine.appendSwitch("lang", pinnedLocale);
if (process.env.SHOWAI_USER_DATA) {
  app.setPath("userData", resolve(process.env.SHOWAI_USER_DATA));
  // Isolated instances keep their log next to their own profile.
  app.setAppLogsPath(join(resolve(process.env.SHOWAI_USER_DATA), "logs"));
}
// Main process, Agent host and renderer failures, for problem reports.
const mainLog = createMainLog({
  directory: app.getPath("logs"),
  fallback: (message) => process.stderr.write(`${message}\n`),
});
captureConsole(mainLog);
process.on("uncaughtExceptionMonitor", (error) =>
  mainLog.write("error", "main", "Uncaught exception:", error),
);
process.on("unhandledRejection", (reason) =>
  console.error("Unhandled rejection:", reason),
);
mainLog.write(
  "info",
  "main",
  `ShowAI ${app.getVersion()} starting (${process.platform} ${process.arch}, Electron ${process.versions.electron})`,
);

/** Commit recorded at build time; development reads it from the checkout. */
const sourceCommit = (() => {
  try {
    const recorded = JSON.parse(
      readFileSync(join(directory, "build-info.json"), "utf8"),
    ) as { sourceCommit?: unknown };
    if (typeof recorded.sourceCommit === "string") return recorded.sourceCommit;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (app.isPackaged) return "unknown";
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
})();

// Scripts and Agents read why a quit was refused from <logs>/quit-blocked.json.
const quitRecord = new QuitRecord(
  mainLog.directory,
  () => ({
    pid: process.pid,
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    mode: "desktop",
    sourceCommit,
    home: store ? store.root : "",
    log: mainLog.path,
  }),
  (error) => mainLog.write("error", "main", "Quit record could not be written:", error),
);

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
    mode: "desktop",
    sourceCommit,
    arch: process.arch,
    osVersion: process.getSystemVersion(),
    versions: {
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    },
    cli: {
      command: process.execPath,
      args: [join(runtimePath(), "scripts", "cli.mjs")],
      env: { ELECTRON_RUN_AS_NODE: "1", SHOWAI_HOME: store.root },
    },
  };
}

/** Plain-text environment summary for problem reports; paths are redacted. */
function diagnostics(extra: string[] = []): string {
  const lines = [
    `ShowAI ${app.getVersion()} (${app.isPackaged ? "packaged" : "development"}, desktop)`,
    `Source commit: ${sourceCommit}`,
    `Platform: ${process.platform} ${process.getSystemVersion()} ${process.arch}`,
    `Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
    `Language: ${getLocale()}`,
    `Library: ${store ? store.root : "(not open)"}`,
    `Log: ${mainLog.path}`,
    `Page previews: ${JSON.stringify(pagePreviewStatus())}`,
    ...extra,
  ];
  return redactLogText(lines.join("\n"), homedir());
}

function broadcast(type: DesktopChange["type"], change?: DesktopChange): void {
  invalidatePageThumbnails({ type, home: store.root, ...change });
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
  const previewPaths = batch.filter((path) =>
    /^(projects|packages|assets|imports|publications)\//.test(
      relative(root, path).split(sep).join("/").replace(/^workspace\//, ""),
    ),
  );
  if (previewPaths.length)
    invalidatePageThumbnails(changedResources(root, previewPaths));
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
  await sources?.close();
  ownWrites.clear();
  store = new FileStore(home);
  await openLibrary(store.root);
  // Linked external files of datasets refresh the blocks bound to them.
  sources = watchDatasetSources(store.root, (datasets) =>
    broadcast("files", {
      type: "files",
      home: store.root,
      projectIds: [],
      pageIds: [],
      datasets,
    }),
  );
  service = new AgentService({ root: store.root });
  await registerRuntimeOnStartup(
    store.root,
    info().cli,
    app.isPackaged ? "packaged" : "development",
  );
  // Lets dev:status and Agents see every App serving this library.
  await presence?.remove();
  presence = await publishInstance(store.root, {
    mode: "desktop",
    channel: app.isPackaged ? "packaged" : "development",
    appVersion: app.getVersion(),
    sourceCommit,
    cli: info().cli,
    logs: mainLog.directory,
    userData: app.getPath("userData"),
    ...(process.env.SHOWAI_DEV_URL
      ? { developmentUrl: process.env.SHOWAI_DEV_URL }
      : {}),
  });
  maintenance = new MaintenanceScheduler(store.root).start();
  syncManager(store.root).start();
  watcher = watchLibrary(store.root, (path) =>
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
  );
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

class InvalidSettings extends Error {}
const settingsPath = () => join(app.getPath("userData"), "showai-settings.json");

async function readSettings(): Promise<DesktopSettings> {
  const path = settingsPath();
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let settings: { home?: unknown; locale?: unknown };
  try {
    settings = JSON.parse(contents);
  } catch (error) {
    throw new InvalidSettings(`ShowAI settings are not valid JSON: ${(error as Error).message}`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new InvalidSettings("ShowAI settings are not an object.");
  if (settings.home !== undefined && typeof settings.home !== "string")
    throw new InvalidSettings(
      "ShowAI settings contain an invalid home directory.",
    );
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

/** The window a menu item acts on; a new window when none is open. */
async function menuWindow(target?: unknown): Promise<BrowserWindow> {
  if (target instanceof BrowserWindow && windows.has(target)) return target;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused)) return focused;
  const first = [...windows].find((window) => !window.isDestroyed());
  if (first) return first;
  // The command waits in menuCommands until the new window's renderer listens.
  return createWindow();
}

function sendMenuCommand(command: MenuCommand) {
  return (_item: unknown, target: unknown) => {
    void menuWindow(target)
      .then((window) => {
        window.show();
        menuCommands.send(window, command);
      })
      .catch((error) => console.error("ShowAI menu command:", error));
  };
}

async function openLogFolder(): Promise<void> {
  await mkdir(mainLog.directory, { recursive: true });
  const error = await shell.openPath(mainLog.directory);
  if (error) throw new Error(error);
}

function buildApplicationMenu() {
  const darwin = process.platform === "darwin";
  const settings = {
    label: t("menu.settings"),
    accelerator: "CommandOrControl+,",
    click: sendMenuCommand("settings"),
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(darwin
        ? [
            {
              role: "appMenu" as const,
              submenu: [
                { role: "about" as const, label: t("menu.about") },
                { type: "separator" as const },
                settings,
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
        role: "fileMenu",
        label: t("menu.file"),
        submenu: [
          { label: t("menu.newProject"), click: sendMenuCommand("newProject") },
          {
            label: t("menu.newPage"),
            accelerator: "CommandOrControl+N",
            click: sendMenuCommand("newPage"),
          },
          {
            label: t("menu.newTab"),
            accelerator: "CommandOrControl+T",
            click: sendMenuCommand("newTab"),
          },
          {
            label: t("menu.newWindow"),
            accelerator: "CommandOrControl+Shift+N",
            click: () =>
              void createWindow().catch((error) =>
                dialog.showErrorBox(
                  t("openWindowFailed"),
                  errorResult(error).message,
                ),
              ),
          },
          { type: "separator" },
          { label: t("menu.import"), click: sendMenuCommand("import") },
          { label: t("menu.export"), click: sendMenuCommand("export") },
          ...(darwin
            ? []
            : [
                { type: "separator" as const },
                settings,
                { type: "separator" as const },
                { role: "quit" as const, label: t("menu.quit") },
              ]),
        ],
      },
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
          ...(app.isPackaged
            ? []
            : [
                {
                  role: "toggleDevTools" as const,
                  label: t("menu.toggleDevTools"),
                },
              ]),
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
      {
        role: "help",
        label: t("menu.help"),
        submenu: [
          { label: t("menu.docs"), click: sendMenuCommand("docs") },
          { label: t("menu.faq"), click: sendMenuCommand("faq") },
          { label: t("menu.shortcuts"), click: sendMenuCommand("shortcuts") },
          { type: "separator" },
          {
            label: t("menu.reportProblem"),
            click: sendMenuCommand("reportProblem"),
          },
          {
            label: t("menu.copyDiagnostics"),
            click: sendMenuCommand("copyDiagnostics"),
          },
          {
            label: t("menu.openLogFolder"),
            click: () =>
              void openLogFolder().catch((error) =>
                console.error("ShowAI log folder:", error),
              ),
          },
          ...(darwin
            ? []
            : [
                { type: "separator" as const },
                { label: t("menu.about"), click: sendMenuCommand("about") },
              ]),
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
      // Only a library that actually opens is remembered for the next launch.
      const previous = store.root;
      try {
        await useHome(home);
      } catch (error) {
        await useHome(previous);
        broadcast("home");
        throw error;
      }
      await saveSettings({ home });
      broadcast("home");
      return info();
    }
    case "media:reveal":
      // The action layer only passes paths it granted for the player.
      shell.showItemInFolder(String(args.path));
      return null;
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
  if (desktopPluginActions.has(action))
    return pluginInstallerAction(pluginInstaller, action, args);
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

const pagePreviewWorker = new BackgroundWorker(15000, {
  path: join(directory, "page-preview-worker.mjs"),
  data: {
    compilerEntry: app.isPackaged
      ? join(process.resourcesPath, "runtime/scripts/cli.mjs")
      : join(repository, "package.json"),
  },
});
app.on("will-quit", () => {
  void pagePreviewWorker.close();
});
configurePageThumbnails({
  authorize: trustedSender,
  home: () => store.root,
  candidates: async () => {
    const pages = await pagePreviewWorker.invoke<
      { projectId: string; pageId: string; hash: string; updatedAt: string }[]
    >(store.root, "pages:previewCandidates", {});
    const hidden = new Set(
      (await syncManager(store.root).configuration()).hiddenProjectIds ?? [],
    );
    return pages.filter((page) => !hidden.has(page.projectId));
  },
  identity: async ({ projectId, pageId }) => {
    const library = versionedLibrary(store.root);
    // Page hashes already cover page edits. Unrelated projects/pages must not
    // invalidate every cached thumbnail whenever an Agent writes to the library.
    const dependencies =
      library &&
      (await library.resourceRevisions([
        `projects/${projectId}/pages/${pageId}.json`,
        `projects/${projectId}/datasets`,
        `projects/${projectId}/packages`,
        `projects/${projectId}/assets`,
        "packages/components",
        "packages/published/components",
      ]));
    return {
      home: store.root,
      revision: dependencies ? JSON.stringify([...dependencies]) : null,
    };
  },
  load: async (_owner, args) =>
    pagePreviewWorker.invoke<LoadedPage>(store.root, "pages:preview", args),
});

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

const shortText = (value: unknown, limit: number) =>
  typeof value === "string" ? value.slice(0, limit) : "";

/** Page details reported by a renderer that could not save before closing. */
function unsavedPages(value: unknown): UnsavedPage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item): UnsavedPage[] => {
    if (!item || typeof item !== "object") return [];
    const page = item as Record<string, unknown>;
    const source =
      typeof page.source === "string" && page.source.length <= 64 * 1024 * 1024
        ? page.source
        : undefined;
    return [
      {
        projectId: shortText(page.projectId, 200),
        pageId: shortText(page.pageId, 200),
        title: shortText(page.title, 200),
        reason: shortText(page.reason, 1000),
        ...(source ? { source } : {}),
      },
    ];
  });
}

function safeFileName(title: string): string {
  return (
    title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 100) || "ShowAI"
  );
}

async function exportUnsavedPages(
  window: BrowserWindow,
  pages: UnsavedPage[],
): Promise<string | null> {
  const selection = await dialog.showOpenDialog(window, {
    title: t("close.exportTitle"),
    properties: ["openDirectory", "createDirectory"],
  });
  const folder = selection.filePaths[0];
  if (selection.canceled || !folder) return null;
  let written = 0;
  for (const page of pages) {
    if (!page.source) continue;
    const base = safeFileName(page.title);
    for (let index = 0; ; index++) {
      const path = join(
        folder,
        `${base}${index ? ` (${index + 1})` : ""}.showai.json`,
      );
      try {
        await writeFile(path, page.source, { encoding: "utf8", flag: "wx" });
        written++;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  }
  return t("close.exported", { count: written, path: folder });
}

/** The window's title as the person sees it ("Page — ShowAI"). */
function windowTitle(window: BrowserWindow): string {
  return window.isDestroyed() ? "" : window.getTitle() || "ShowAI";
}

/**
 * A refused close or quit may come from outside the App (Dock, AppleScript,
 * logout), so the window that explains it is restored and brought to the front.
 */
function revealWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (process.platform === "darwin") {
    app.show();
    app.focus({ steal: true });
  } else app.focus();
  window.show();
  window.moveTop();
  window.focus();
}

const blockerSources: Record<CloseBlocker["source"], Parameters<typeof t>[0]> = {
  pages: "close.source.pages",
  datasets: "close.source.datasets",
  assistant: "close.source.assistant",
  sidebar: "close.source.sidebar",
  workbench: "close.source.workbench",
  window: "close.source.window",
};

/** One dialog line: what holds the window open, and why. */
function blockerLine(blocker: CloseBlocker): string {
  const subject =
    blocker.source === "datasets" && (blocker.title || blocker.datasetId)
      ? t("close.subject.dataset", {
          title: blocker.title || blocker.datasetId!,
        })
      : blocker.title || blocker.pageId
        ? t("close.subject.page", { title: blocker.title || blocker.pageId! })
        : t(blockerSources[blocker.source]);
  const seconds = blocker.seconds ?? 0;
  const message =
    blocker.code === "LISTENER_TIMEOUT"
      ? t("close.code.LISTENER_TIMEOUT", { seconds })
      : blocker.code === "NO_REPLY"
        ? t("close.code.NO_REPLY", { seconds })
        : blocker.code === "LISTENER_FAILED"
          ? t("close.code.LISTENER_FAILED", {
              error: blocker.message || t("close.unknownReason"),
            })
          : blocker.message ||
            (blocker.code === "LISTENER_REFUSED"
              ? t("close.code.LISTENER_REFUSED")
              : t("close.unknownReason"));
  return `• ${subject} — ${message}`;
}

/** What the renderer said holds the window open; never an empty list. */
function replyBlockers(reply: CloseReply): CloseBlocker[] {
  if (reply.blockers.length) return reply.blockers;
  if (reply.pages.length)
    return reply.pages.map((page) => ({
      code: "PAGE_NOT_RETAINED",
      source: "pages",
      projectId: page.projectId,
      pageId: page.pageId,
      title: page.title,
      ...(page.reason ? { message: page.reason } : {}),
    }));
  return [
    {
      code: "LISTENER_REFUSED",
      source: "workbench",
      ...(reply.reason ? { message: reply.reason } : {}),
    },
  ];
}

/** Log lines name pages and datasets by id; titles stay in the dialog and the record. */
function loggedBlockers(blockers: CloseBlocker[]): string[] {
  return blockers.map((blocker) =>
    describeBlocker({ ...blocker, title: undefined }),
  );
}

/** Logs and records a refusal; `state` says whether the person is still deciding. */
function noteRefusal(
  window: BrowserWindow,
  trigger: CloseTrigger,
  blockers: CloseBlocker[],
  state: "awaiting-decision" | "kept-open",
): void {
  mainLog.write(
    "warn",
    "main",
    state === "awaiting-decision"
      ? `Close refused (${trigger}) for window ${window.id}; asking the person:`
      : `Window ${window.id} stays open (${trigger}): the person kept editing.`,
    loggedBlockers(blockers),
  );
  void quitRecord.set(window.id, {
    title: windowTitle(window),
    trigger,
    state,
    blockers,
  });
}

/** One step of an allowed quit; a step still running after 5 s is logged by name. */
async function shutdownStep(name: string, run: () => unknown): Promise<void> {
  const started = Date.now();
  if (!app.isPackaged && process.env.SHOWAI_DEV_URL)
    process.send?.({ type: "quit-progress", step: name });
  const slow = setTimeout(
    () =>
      mainLog.write(
        "warn",
        "main",
        `Quit is still waiting for ${name} after 5 s; it finishes its current work first.`,
      ),
    5000,
  );
  try {
    await run();
  } finally {
    clearTimeout(slow);
  }
  const elapsed = Date.now() - started;
  if (elapsed >= 1000)
    mainLog.write("info", "main", `Quit: ${name} stopped after ${elapsed} ms.`);
}

/** Explains why a window cannot close yet; never refuses silently. */
async function blockedClose(
  window: BrowserWindow,
  reply: CloseReply,
  blockers: CloseBlocker[],
  trigger: CloseTrigger,
): Promise<"retry" | "discard" | "keep"> {
  let notice = "";
  for (;;) {
    const pages = reply.pages;
    const exportable = pages.some((page) => page.source);
    const list = blockers.slice(0, 10).map(blockerLine);
    if (blockers.length > 10) list.push(`…`);
    const buttons = [
      t("close.retry"),
      ...(exportable ? [t("close.export")] : []),
      t("discardAndClose"),
      t("keepEditing"),
    ];
    const choice = await dialog.showMessageBox(window, {
      type: "warning",
      message: pages.length
        ? t("close.blockedTitle", { count: pages.length })
        : t("close.blockedReasonsTitle", { count: blockers.length }),
      detail: [
        t(trigger === "quit" ? "close.quitContext" : "close.windowContext", {
          window: windowTitle(window),
        }),
        list.join("\n"),
        ...(blockers.some((blocker) => blocker.pageId)
          ? [t("close.pageNotice")]
          : []),
        exportable ? t("close.blockedDetail") : t("close.blockedDetailPlain"),
        ...(notice ? [notice] : []),
      ].join("\n\n"),
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    // A window destroyed meanwhile has nothing left to keep open.
    if (window.isDestroyed()) return "discard";
    const label = buttons[choice.response];
    if (label === t("close.retry")) return "retry";
    if (label === t("discardAndClose")) return "discard";
    if (label === t("keepEditing")) return "keep";
    notice = (await exportUnsavedPages(window, pages)) ?? notice;
  }
}

function requestClose(
  window: BrowserWindow,
  trigger: CloseTrigger = "close",
): Promise<CloseOutcome> {
  const windowId = window.id;
  const requestedTitle = windowTitle(window);
  const outcome = (
    allow: boolean,
    blockers: CloseBlocker[] = [],
    decision?: CloseOutcome["decision"],
  ): CloseOutcome => {
    if (allow) void quitRecord.delete(windowId);
    return {
      allow,
      windowId,
      title: windowTitle(window) || requestedTitle,
      blockers,
      ...(decision ? { decision } : {}),
    };
  };
  if (window.isDestroyed()) return Promise.resolve(outcome(true));
  const pending = closeRequests.get(window.id);
  if (pending) return pending.promise;
  const requestId = randomUUID();
  let resolveResult!: (reply: CloseReply | null) => void;
  const received = new Promise<CloseReply | null>((resolve) => {
    resolveResult = resolve;
  });
  const timer = setTimeout(() => resolveResult(null), CLOSE_REPLY_TIMEOUT_MS);
  // A window that goes away settles its close request, even while a dialog is open.
  const closed = new Promise<CloseOutcome>((resolve) =>
    window.once("closed", () => resolve(outcome(true))),
  );
  const decided = received.then(async (reply): Promise<CloseOutcome> => {
    if (window.isDestroyed()) return outcome(true);
    if (reply?.allow) return outcome(true);
    const blockers: CloseBlocker[] = reply
      ? replyBlockers(reply)
      : [
          {
            code: "NO_REPLY",
            source: "window",
            seconds: CLOSE_REPLY_TIMEOUT_MS / 1000,
          },
        ];
    noteRefusal(window, trigger, blockers, "awaiting-decision");
    revealWindow(window);
    let decision: "retry" | "discard" | "keep";
    if (reply) decision = await blockedClose(window, reply, blockers, trigger);
    else {
      const choice = await dialog.showMessageBox(window, {
        type: "warning",
        message: t("unsavedMessage"),
        detail: [
          t(trigger === "quit" ? "close.quitContext" : "close.windowContext", {
            window: windowTitle(window),
          }),
          blockers.map(blockerLine).join("\n"),
          t("unsavedDetail"),
        ].join("\n\n"),
        buttons: [t("keepEditing"), t("discardAndClose")],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      decision = window.isDestroyed() || choice.response === 1 ? "discard" : "keep";
    }
    if (decision === "discard") {
      mainLog.write(
        "warn",
        "main",
        `Window ${windowId} closes (${trigger}) without the changes listed above: the person chose to discard them.`,
      );
      return outcome(true, blockers, "discard");
    }
    if (decision === "keep") {
      if (!window.isDestroyed())
        noteRefusal(window, trigger, blockers, "kept-open");
      return outcome(false, blockers, "keep");
    }
    clearTimeout(timer);
    closeRequests.delete(window.id);
    return requestClose(window, trigger);
  });
  const promise = Promise.race([decided, closed]).finally(() => {
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

/** Renderer crashes, failed loads and hangs get a way out instead of a blank window. */
function watchWindowHealth(window: BrowserWindow): void {
  let open = false;
  const offer = async (
    title: string,
    detail: string,
    details: string,
    waitable = false,
  ) => {
    if (open || window.isDestroyed()) return;
    open = true;
    try {
      for (;;) {
        const buttons = [
          t("action.reload"),
          t("action.closeWindow"),
          t("action.copyDetails"),
          ...(waitable ? [t("action.wait")] : []),
        ];
        const choice = await dialog.showMessageBox(window, {
          type: "error",
          message: title,
          detail,
          buttons,
          defaultId: 0,
          cancelId: waitable ? 3 : 1,
          noLink: true,
        });
        if (window.isDestroyed()) return;
        if (choice.response === 2) {
          clipboard.writeText(diagnostics(["", details]));
          continue;
        }
        if (choice.response === 0) window.webContents.reload();
        if (choice.response === 1) window.destroy();
        return;
      }
    } finally {
      open = false;
    }
  };
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("ShowAI renderer gone:", details);
    if (details.reason === "clean-exit") return;
    void offer(
      t("window.crashedTitle"),
      t("window.crashedDetail", { reason: details.reason }),
      `render-process-gone: ${details.reason} (exit ${details.exitCode})`,
    );
  });
  window.webContents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      // -3 is an aborted navigation, replaced by another load.
      if (!isMainFrame || code === -3) return;
      console.error("ShowAI window load failed:", code, description, url);
      void offer(
        t("window.loadFailedTitle"),
        t("window.loadFailedDetail", { reason: `${description} ${code}` }),
        `did-fail-load: ${code} ${description} ${url}`,
      );
    },
  );
  window.on("unresponsive", () => {
    console.error("ShowAI window unresponsive");
    void offer(
      t("window.unresponsiveTitle"),
      t("window.unresponsiveDetail"),
      "unresponsive",
      true,
    );
  });
}

async function createWindow(page?: WindowTarget): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: page && !page.restoreTabs ? 1120 : 1320,
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
  // A reload or navigation replaces the renderer's menu listener.
  window.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument)
      menuCommands.reset(window);
  });
  preparePreviewWindows(window);
  watchWindowHealth(window);
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
    void requestClose(window, "close").then((outcome) => {
      if (outcome.allow && !window.isDestroyed()) {
        window.destroy();
      }
    });
  });
  const windowId = window.id;
  window.on("closed", () => {
    closeRequests
      .get(windowId)
      ?.resolve({ allow: true, pages: [], blockers: [], reason: "" });
    windows.delete(window);
    void quitRecord.delete(windowId);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWorkbenchLocation(url)) {
      const params = new URL(url).searchParams;
      const projectId = params.get("project"),
        pageId = params.get("page"),
        folderId = params.get("folder"),
        blocks = params.get("blocks");
      void createWindow(
        projectId
          ? {
              projectId,
              pageId: pageId ?? undefined,
              folderId: folderId ?? undefined,
              blocks: blocks ?? undefined,
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

class DeepLinkPageMissing extends Error {
  constructor(
    message: string,
    readonly original: unknown,
  ) {
    super(message);
  }
}

/** A link that cannot open never quits the App; the main window explains why. */
async function handleDeepLink(source: string): Promise<void> {
  try {
    await openDeepLink(source);
    return;
  } catch (error) {
    console.error("ShowAI link failed:", source.split("?")[0], error);
    const window =
      [...windows].find((window) => !window.isDestroyed()) ??
      (await createWindow());
    window.show();
    window.focus();
    const missing =
      error instanceof DeepLinkPageMissing &&
      ["NOT_FOUND", "ENOENT", "INVALID_PATH"].includes(
        errorResult(error.original).code,
      );
    const malformed =
      !missing &&
      (error instanceof TypeError ||
        (error instanceof CoreError && error.code === "INVALID_PATH"));
    const buttons = [
      ...(missing ? [t("deepLink.openProjects")] : []),
      t("deepLink.copyLink"),
      t("action.close"),
    ];
    const choice = await dialog.showMessageBox(window, {
      type: "warning",
      message: missing
        ? t("deepLink.missingTitle")
        : malformed
          ? t("deepLink.malformedTitle")
          : t("deepLink.failedTitle"),
      detail: missing
        ? t("deepLink.missingDetail", {
            home: redactLogText(store.root, homedir()),
          })
        : malformed
          ? t("deepLink.malformedDetail")
          : errorResult(error).message,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    const label = buttons[choice.response];
    if (label === t("deepLink.copyLink")) clipboard.writeText(source);
    if (label === t("deepLink.openProjects") && !window.isDestroyed())
      menuCommands.send(window, "projects");
  }
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
    throw new CoreError("INVALID_PATH", t("deepLink.malformedDetail"));
  const project = assertId(parts[0]),
    page = assertId(parts[2]);
  // A copied ShowAI reference names the blocks to highlight.
  const blocks = (url.searchParams.get("blocks") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 100)
    .map(assertId);
  await store.readPage(project, page).catch((error) => {
    throw new DeepLinkPageMissing(errorResult(error).message, error);
  });
  await createWindow({
    projectId: project,
    pageId: page,
    ...(blocks.length ? { blocks: blocks.join(",") } : {}),
  });
}

class StartupCancelled extends Error {}

function quitNow(): void {
  allowedQuit = true;
  app.quit();
}

/** Damaged settings are moved aside so the next launch can start cleanly. */
async function startupSettings(): Promise<
  DesktopSettings & { damagedBackup?: string }
> {
  try {
    return await readSettings();
  } catch (error) {
    if (!(error instanceof InvalidSettings)) throw error;
    const backup = `${settingsPath()}.damaged-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    await rename(settingsPath(), backup);
    console.error("ShowAI settings were damaged and backed up:", backup, error);
    return { damagedBackup: backup };
  }
}

async function libraryProblem(
  home: string,
): Promise<"missing" | "notDirectory" | undefined> {
  try {
    if (!(await stat(home)).isDirectory()) return "notDirectory";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return "missing";
    throw error;
  }
  await access(home, fsConstants.R_OK | fsConstants.W_OK);
}

/**
 * Opens the remembered library. A missing one is never replaced by a new
 * empty library: the person decides to wait, choose another or use the default.
 */
async function openStartupLibrary(
  saved: string | undefined,
  damagedBackup?: string,
): Promise<void> {
  if (process.env.SHOWAI_HOME) return useHome(process.env.SHOWAI_HOME);
  const defaultHome = join(homedir(), ".showai");
  const shown = (path: string) => redactLogText(path, homedir());
  let home = saved;
  let prompt: { message: string; detail: string } | undefined = damagedBackup
    ? {
        message: t("settings.corruptTitle"),
        detail: t("settings.corruptDetail", { backup: shown(damagedBackup) }),
      }
    : undefined;
  for (;;) {
    if (!prompt && home) {
      const problem = await libraryProblem(home).catch((error) => {
        prompt = {
          message: t("library.unavailableTitle"),
          detail: t("library.unavailableDetail", {
            path: shown(home!),
            reason: errorResult(error).message,
          }),
        };
        return undefined;
      });
      if (problem === "missing")
        prompt = {
          message: t("library.missingTitle"),
          detail: t("library.missingDetail", { path: shown(home) }),
        };
      if (problem === "notDirectory")
        prompt = {
          message: t("library.missingTitle"),
          detail: t("library.notDirectory", { path: shown(home) }),
        };
    }
    if (!prompt) {
      try {
        await useHome(home);
        if (home !== saved || damagedBackup) await saveSettings({ home });
        return;
      } catch (error) {
        console.error("ShowAI library unavailable:", error);
        prompt = {
          message: t("library.unavailableTitle"),
          detail: t("library.unavailableDetail", {
            path: shown(home ?? defaultHome),
            reason: errorResult(error).message,
          }),
        };
      }
    }
    mainLog.write("warn", "main", `${prompt.message}: ${prompt.detail}`);
    const retry = !damagedBackup || home !== undefined;
    const buttons = [
      ...(retry ? [t("action.retry")] : []),
      t("library.choose"),
      t("library.useDefault", { path: shown(defaultHome) }),
      t("action.quit"),
    ];
    const choice = await dialog.showMessageBox({
      type: "warning",
      message: prompt.message,
      detail: prompt.detail,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    const label = buttons[choice.response];
    if (label === t("action.quit")) throw new StartupCancelled();
    if (label === t("library.choose")) {
      const selection = await dialog.showOpenDialog({
        title: t("library.chooseTitle"),
        defaultPath: home ? dirname(home) : homedir(),
        properties: ["openDirectory", "createDirectory"],
      });
      if (selection.canceled || !selection.filePaths[0]) continue;
      home = await realpath(selection.filePaths[0]);
    }
    if (label === t("library.useDefault", { path: shown(defaultHome) }))
      home = undefined;
    prompt = undefined;
  }
}

async function startupFailed(error: unknown): Promise<void> {
  console.error("ShowAI startup failed:", error);
  const message = errorResult(error).message;
  for (;;) {
    const buttons = [
      t("action.copyDiagnostics"),
      t("action.openLogFolder"),
      t("action.quit"),
    ];
    const choice = await dialog.showMessageBox({
      type: "error",
      message: t("startFailed"),
      detail: `${message}\n\n${t("startFailedDetail")}`,
      buttons,
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 0)
      clipboard.writeText(diagnostics(["", `Startup error: ${message}`]));
    else if (choice.response === 1)
      await openLogFolder().catch((reason) =>
        console.error("ShowAI log folder:", reason),
      );
    else break;
  }
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
          void handleDeepLink(message.url);
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
  // Granted local files (videos, audio, images) for the workbench player; streamed with ranges.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, stream: true },
    },
  ]);
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (!app.isReady()) pendingDeepLink = url;
    else void handleDeepLink(url);
  });
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((argument) => argument.startsWith("showai://"));
    if (link) void handleDeepLink(link);
    else {
      const window = [...windows][0];
      window?.show();
      window?.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      // Startup dialogs use the system language until the saved one is known.
      setLocale(
        pinnedLocale ?? resolveLocale(app.getPreferredSystemLanguages()),
      );
      const settings = await startupSettings();
      setLocale(
        pinnedLocale ??
          settings.locale ??
          resolveLocale(app.getPreferredSystemLanguages()),
      );
      await openStartupLibrary(settings.home, settings.damagedBackup);
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
      pluginInstaller = new DesktopPluginInstaller({
        root: join(app.getPath("userData"), "external-plugins"),
        pluginRoot: () =>
          process.env.SHOWAI_DEV_URL
            ? join(process.cwd(), "plugins/showai")
            : join(runtimePath(), "assets/agent-plugin"),
        dshBundleRoot: () =>
          process.env.SHOWAI_DEV_URL
            ? join(process.cwd(), "plugins/dsh-showai")
            : join(runtimePath(), "assets/dsh-plugin"),
        runtime: () => info(),
        channel: app.isPackaged ? "packaged" : "development",
      });
      remoteConnector = new RemoteMacConnector(agentHost, () => store.root);
      void remoteConnector
        .start()
        .catch((error) =>
          console.error("Remote Agent connector:", error.message),
        );
      if (app.isPackaged) app.setAsDefaultProtocolClient("showai");
      protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
        const token = new URL(request.url).pathname.slice(1);
        const result = await localMediaResponse(
          token,
          request.headers.get("range"),
          request.method === "HEAD",
        );
        return new Response(
          result.body
            ? (Readable.toWeb(result.body) as ReadableStream<Uint8Array>)
            : null,
          { status: result.status, headers: result.headers },
        );
      });
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
      ipcMain.handle("logs:path", (event) => {
        trustedSender(event);
        return mainLog.path;
      });
      ipcMain.handle("logs:open-folder", async (event) => {
        trustedSender(event);
        await openLogFolder();
      });
      ipcMain.handle("showai:diagnostics", (event) => {
        trustedSender(event);
        return diagnostics();
      });
      ipcMain.handle("logs:tail", (event, lines: unknown) => {
        trustedSender(event);
        const count =
          typeof lines === "number" && Number.isInteger(lines)
            ? Math.min(Math.max(lines, 1), 1000)
            : 200;
        return readLogTail(mainLog.directory, count, homedir());
      });
      ipcMain.handle(
        "showai:export-diagnostics",
        async (event, payload: unknown) => {
          const window = trustedSender(event);
          const text = (payload as { text?: unknown } | null)?.text;
          if (typeof text !== "string" || text.length > 4 * 1024 * 1024)
            throw new CoreError(
              "INVALID_DATA",
              "Diagnostics must be text of at most 4 MB.",
            );
          const stamp = new Date().toISOString().slice(0, 10);
          const selection = await dialog.showSaveDialog(window, {
            title: t("diagnostics.exportTitle"),
            defaultPath: join(
              app.getPath("downloads"),
              `showai-diagnostics-${stamp}.txt`,
            ),
            filters: [{ name: t("diagnostics.exportFilter"), extensions: ["txt"] }],
          });
          if (selection.canceled || !selection.filePath) return null;
          // The renderer already redacted it; the main process knows the home directory.
          await writeFile(
            selection.filePath,
            redact(text, { home: homedir(), library: store.root }),
            { encoding: "utf8", mode: 0o600 },
          );
          return { path: redactLogText(selection.filePath, homedir()) };
        },
      );
      const rendererReports = new Map<number, { minute: number; count: number }>();
      ipcMain.on("showai:renderer-error", (event, payload: unknown) => {
        let window: BrowserWindow;
        try {
          window = trustedSender(event);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        // A render loop must not fill the log; keep at most 30 reports a minute.
        const minute = Math.floor(Date.now() / 60000);
        const budget = rendererReports.get(window.id);
        const count = budget?.minute === minute ? budget.count + 1 : 1;
        rendererReports.set(window.id, { minute, count });
        if (count > 30) return;
        const report = payload as Record<string, unknown>;
        mainLog.write(
          "error",
          "renderer",
          `${shortText(report.kind, 40)}: ${shortText(report.message, 4000)}`,
          ...(typeof report.stack === "string"
            ? [`\n${shortText(report.stack, 8000)}`]
            : []),
        );
      });
      ipcMain.on("showai:menu-ready", (event) => {
        let window: BrowserWindow;
        try {
          window = trustedSender(event);
        } catch {
          return;
        }
        menuCommands.markReady(window);
      });
      ipcMain.on("showai:close-result", (event, payload: unknown) => {
        let window: BrowserWindow;
        try {
          window = trustedSender(event);
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const result = payload as {
          requestId?: unknown;
          allow?: unknown;
          pages?: unknown;
          blockers?: unknown;
          reason?: unknown;
        };
        const pending = closeRequests.get(window.id);
        if (
          pending &&
          pending.requestId === result.requestId &&
          typeof result.allow === "boolean"
        )
          pending.resolve({
            allow: result.allow,
            pages: unsavedPages(result.pages),
            blockers: closeBlockers(result.blockers),
            reason:
              typeof result.reason === "string"
                ? result.reason.slice(0, 2000)
                : "",
          });
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
              (!actions.has(action) &&
                !agentActions.has(action) &&
                !desktopPluginActions.has(action) &&
                !remoteDeviceActions.has(action))
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
      if (pendingDeepLink) await handleDeepLink(pendingDeepLink);
      else await createWindow({ restoreTabs: true });
      if (!app.isPackaged && process.env.SHOWAI_DEV_URL)
        process.send?.({ type: "ready", home: store.root });
      app.on("activate", () => {
        if (!windows.size) void createWindow();
      });
    })
    .catch(async (error) => {
      if (!(error instanceof StartupCancelled)) await startupFailed(error);
      quitNow();
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (allowedQuit) return;
    event.preventDefault();
    if (checkingQuit) {
      // Asked again while a dialog waits: show that dialog instead of hiding the request.
      mainLog.write(
        "info",
        "main",
        "Quit requested again while windows are still answering the previous request.",
      );
      for (const entry of quitRecord.windows()) {
        const waiting = BrowserWindow.fromId(entry.windowId);
        if (waiting && entry.state === "awaiting-decision") revealWindow(waiting);
      }
      return;
    }
    checkingQuit = true;
    const open = [...windows];
    mainLog.write(
      "info",
      "main",
      `Quit requested; asking ${open.length} window(s) to close.`,
    );
    void Promise.all(
      open.map((window) => requestClose(window, "quit")),
    ).then(async (outcomes) => {
      checkingQuit = false;
      const refused = outcomes.filter((outcome) => !outcome.allow);
      if (refused.length) {
        mainLog.write(
          "warn",
          "main",
          `Quit blocked: ${refused.length} of ${outcomes.length} window(s) stay open. Details: ${quitRecord.path}`,
          refused.map(
            (outcome) =>
              `window ${outcome.windowId} (${outcome.decision ?? "refused"}): ${loggedBlockers(outcome.blockers).join("; ")}`,
          ),
        );
        if (!app.isPackaged && process.env.SHOWAI_DEV_URL)
          process.send?.({
            type: "quit-blocked",
            at: new Date().toISOString(),
            record: quitRecord.path,
            windows: refused.map((outcome) => ({
              windowId: outcome.windowId,
              title: outcome.title,
              decision: outcome.decision ?? "refused",
              blockers: outcome.blockers,
            })),
          });
        return;
      }
      mainLog.write(
        "info",
        "main",
        `Quit allowed: ${outcomes.length} window(s) closed; stopping services.`,
      );
      allowedQuit = true;
      await quitRecord.clear();
      await presence?.remove();
      remoteConnector?.close();
      agentHost?.close();
      clearTimeout(notification);
      // Stopping waits for running work (maintenance, sync); a slow step is named.
      await shutdownStep("library watcher", () => watcher?.close());
      await shutdownStep("dataset sources", () => sources?.close());
      await shutdownStep("library maintenance", () => maintenance?.stop());
      if (store)
        await shutdownStep("project sync", () => syncManager(store.root).stop());
      for (const window of windows) if (!window.isDestroyed()) window.destroy();
      mainLog.write("info", "main", "Quit: services stopped.");
      app.quit();
    });
  });
}
