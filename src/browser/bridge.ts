import SourceRuntimeWorker from "../surface/source-runtime-worker.ts?worker&inline";
import CubicInputWorker from "../surface/portable-cubic-input-worker.ts?worker&inline";
import { chooseLocalPath, type FileDialogOptions } from "./FileDialog";
import { browserSearch, browserUrl, codexWorkbench, openCodexWorkbenchLink, reportCodexWorkbenchReady, type CodexWorkbenchConnection } from "./codex-workbench";
import {
  LOCAL_FILE_TYPES,
  type LocalResourceKind,
} from "../document/local-files.mjs";
import type {
  CloseResult,
  CloseSource,
  DesktopChange,
  DesktopResponse,
} from "../host/protocol";
import type { WorkbenchRoute } from "../host/codex-workbench-transport";
import { closeReporter, type CloseListenerEntry } from "../desktop/close-report";
import type { LoadedPage } from "../studio/usePage";
import { translator } from "../i18n";
import messages from "../i18n/messages/files";
import shellMessages from "../i18n/messages/appShell";

const t = translator(messages);
const shell = translator(shellMessages);

export type ConnectionState = "connected" | "lost" | "restarted";
let connection: ConnectionState = "connected";
export function connectionState() {
  return connection;
}
function announce(state: ConnectionState) {
  if (state === connection) return;
  if (connection === "restarted") return;
  connection = state;
  window.dispatchEvent(new CustomEvent("showai:connection", { detail: state }));
}

export function pageToken(html: string): string | undefined {
  const config = /window\.__SHOWAI_LOCAL__=(\{[^<]*?\})\s*<\/script>/.exec(
    html,
  )?.[1];
  const token = config && (JSON.parse(config) as { token?: unknown }).token;
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token)
    ? token
    : undefined;
}
const failure = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

declare global {
  interface Window {
    __SHOWAI_LOCAL__?: {
      token: string;
      codexWorkbench?: CodexWorkbenchConnection;
      dshWorkbench?: { parentOrigin: string; session: boolean; instance: string };
      apiOrigin?: string;
      search?: string;
    };
  }
}

export function installBrowserBridge() {
  const config = window.__SHOWAI_LOCAL__;
  if (!config || window.showai) return;
  if (window.__SHOWAI_CODEX_HOST__)
    window.__SHOWAI_CODEX_HOST__.createWorker = (kind) =>
      kind === "source" ? new SourceRuntimeWorker() : new CubicInputWorker();
  const listeners = new Set<(change: DesktopChange) => void>();
  const closeListeners = new Set<CloseListenerEntry>();
  const reloadListeners = new Set<CloseListenerEntry>();
  const report = closeReporter();
  let dirty = false;
  const client = crypto.randomUUID();
  let renewing: Promise<boolean> | undefined;
  function renewToken() {
    const path = config!.apiOrigin ? `/${config!.search ?? ""}` : "/";
    renewing ??= fetch(browserUrl(path), { cache: "no-store" })
      .then(async (response) => {
        const token = response.ok ? pageToken(await response.text()) : undefined;
        if (!token || token === config!.token) return false;
        config!.token = token;
        return true;
      })
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  }
  async function request<T>(
    route: WorkbenchRoute,
    args: Record<string, unknown>,
    renewed = false,
  ): Promise<T> {
    const transport = window.__SHOWAI_CODEX_HOST__?.workbenchRequest;
    if (transport) {
      const result = await transport(route, args, client);
      if (!result.ok) throw result.error;
      return result.data as T;
    }
    let response: Response;
    try {
      response = await fetch(browserUrl(`/api/${route}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config!.token}`,
          "X-ShowAI-Client": client,
        },
        body: JSON.stringify(args),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      announce("lost");
      throw failure("SERVICE_UNREACHABLE", shell("connection.unreachable"));
    }
    if (response.status === 401) {
      if (!renewed && (await renewToken().catch(() => false)))
        return request<T>(route, args, true);
      announce("restarted");
      throw failure("SERVICE_RESTARTED", shell("connection.restarted"));
    }
    if (
      !response.ok &&
      response.headers.get("content-type")?.includes("application/json") !==
        true
    )
      throw Object.assign(
        new Error(t("requestFailed", { status: response.status })),
        { code: "HTTP_ERROR", status: response.status },
      );
    const result = (await response.json()) as DesktopResponse<T>;
    if (!result.ok) throw { ...result.error, status: response.status };
    return result.data;
  }
  async function openWindow<T>(
    action: string,
    args: Record<string, unknown>,
    prepare?: () => Promise<boolean>,
  ): Promise<T | null> {
    if (codexWorkbench()) {
      if (prepare && !(await prepare())) return null;
      const result = await request<T>("invoke", { action, args });
      await openCodexWorkbenchLink((result as { url: string }).url);
      return result;
    }
    const opened = window.open(
      "about:blank",
      "_blank",
      "popup,width=1120,height=880",
    );
    if (!opened)
      throw new Error(t("popupBlocked"));
    opened.opener = null;
    try {
      if (prepare && !(await prepare())) {
        opened.close();
        return null;
      }
      const result = await request<T>("invoke", { action, args });
      if (opened.closed) throw new Error(t("popupClosed"));
      opened.location.replace((result as { url: string }).url);
      return result;
    } catch (error) {
      opened.close();
      throw error;
    }
  }
  async function invoke<T>(
    action: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (action === "clipboard:write") {
      if (typeof args.text !== "string" || args.text.length > 2 * 1024 * 1024)
        throw new Error("Clipboard text must be at most 2 MB.");
      await navigator.clipboard.writeText(args.text);
      return null as T;
    }
    if (action === "app:openPageWindow" || action === "app:openWindow")
      return (await openWindow<T>(action, args)) as T;
    const dialogs: Record<string, FileDialogOptions> = {
      "dialog:openPage": {
        title: t("title.importPage"),
        kind: "file",
        extensions:
          action === "dialog:openPage"
            ? [
                ...new Set(
                  (
                    await request<{
                      importers: { id: string; extensions: string[] }[];
                    }>(
                      "invoke",
                      { action: "imports:importers", args: { projectId: args.projectId } },
                    )
                  ).importers
                    .filter(
                      (importer) =>
                        args.importer === undefined ||
                        importer.id === args.importer,
                    )
                    .flatMap((importer) =>
                      importer.extensions.map((extension) => extension.slice(1)),
                    ),
                ),
              ]
            : [],
      },
      "components:import": { title: t("title.componentSource"), kind: "directory" },
      "catalog:preparePublish": {
        title: t("title.publishPackage"),
        kind: "directory",
      },
      "export:site": { title: t("title.siteOutput"), kind: "directory" },
      "settings:chooseFolder": {
        title: t("title.dataDirectory"),
        kind: "directory",
        initialPath: typeof args.path === "string" ? args.path : undefined,
      },
      "settings:chooseHome": {
        title: t("title.dataDirectory"),
        kind: "directory",
      },
      "plugins:choosePath": {
        title: t("title.executableFile"),
        kind: "file",
        initialPath: typeof args.path === "string" ? args.path : undefined,
      },
      "remoteMcp:chooseExecutable": {
        title: t("title.executableFile"),
        kind: "file",
        initialPath: typeof args.path === "string" ? args.path : undefined,
      },
    };
    if (action === "export:page") {
      const page = await request<LoadedPage>("invoke", {
        action: "pages:get",
        args,
      });
      const name = (page.document.title.trim() || "ShowAI")
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .slice(0, 100);
      dialogs[action] = {
        title: t("title.exportPage"),
        kind: "save",
        defaultName: `${name}${args.format === "json" ? ".showai.json" : ".html"}`,
      };
    }
    if (action === "export:conversation")
      dialogs[action] = {
        title: t("title.exportConversation"),
        kind: "save",
        defaultName: `${String(args.title ?? "")
          .trim()
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .slice(0, 100) || "ShowAI"}.md`,
      };
    if (action === "datasets:chooseFile")
      dialogs[action] =
        args.mode === "save"
          ? {
              title: t("title.datasetSaveFile"),
              kind: "save",
              defaultName: `${String(args.name ?? "data")
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
                .slice(0, 100)}.json`,
              extensions: ["json", "csv", "tsv"],
            }
          : {
              title: t("title.datasetOpenFile"),
              kind: "file",
              extensions: ["json", "csv", "tsv", "xlsx"],
            };
    if (action === "media:chooseFile") {
      const kind = String(args.kind) as LocalResourceKind;
      dialogs[action] = {
        title: t(`title.resourceFile.${kind}`),
        kind: "file",
        extensions: Object.entries(LOCAL_FILE_TYPES)
          .filter(([, type]) => type.kind === kind)
          .map(([extension]) => extension.slice(1)),
      };
    }
    if (action === "settings:chooseHome") {
      const info = await request<{ home: string }>("invoke", {
        action: "app:info",
        args: {},
      });
      dialogs[action].initialPath = info.home;
    }
    if (dialogs[action]) {
      const path = await chooseLocalPath(dialogs[action], request);
      if (
        action === "plugins:choosePath" ||
        action === "remoteMcp:chooseExecutable"
      ) {
        return path as T;
      }
      if (!path) return null as T;
      args = { ...args, selectedPath: path };
    }
    return request<T>("invoke", { action, args });
  }
  const changes = window.__SHOWAI_CODEX_HOST__?.workbenchChanges;
  if (changes) {
    let after = -1;
    let disposed = false;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await changes(after, client);
        if (disposed) return;
        after = result.cursor;
        announce("connected");
        result.changes.forEach((change) => listeners.forEach((listener) => listener(change)));
      } catch {
        if (!disposed) announce("lost");
      } finally {
        if (!disposed) scheduled = setTimeout(poll, 1000);
      }
    };
    scheduled = setTimeout(poll, 500);
    window.addEventListener("pagehide", () => {
      disposed = true;
      clearTimeout(scheduled);
    }, { once: true });
  } else if (!browserSearch().has("componentPreview")) {
    const connect = () => {
      const events = new EventSource(
        browserUrl(`/api/events?token=${encodeURIComponent(config.token)}&client=${client}`),
      );
      events.onmessage = (event) => {
        const change = JSON.parse(event.data) as DesktopChange;
        for (const listener of listeners) listener(change);
      };
      events.onopen = () => {
        announce("connected");
        for (const listener of listeners)
          listener({ type: "files", home: "", all: true });
      };
      events.onerror = () => {
        announce("lost");
        if (events.readyState !== EventSource.CLOSED) return;
        setTimeout(() => {
          void request("invoke", { action: "app:info", args: {} }).then(
            () => connect(),
            (error: { code?: string }) => {
              if (error.code !== "SERVICE_RESTARTED") connect();
            },
          );
        }, 3000);
      };
    };
    connect();
  }
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const flush = () => {
    for (const entry of closeListeners) void entry.listener();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.showai = {
    async openWindow(args, prepare) {
      return (await openWindow("app:openWindow", args, prepare)) !== null;
    },
    invoke,
    async setLocale(locale) {
      await request("locale", { locale });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onBeforeClose(listener, source = "workbench") {
      const entry = { listener, source };
      closeListeners.add(entry);
      return () => {
        closeListeners.delete(entry);
      };
    },
    setDirty(value) {
      dirty = value;
    },
    ...(import.meta.env.DEV
      ? {
          onBeforeReload(
            listener: () => Promise<CloseResult>,
            source: CloseSource = "workbench",
          ) {
            const entry = { listener, source };
            reloadListeners.add(entry);
            return () => {
              reloadListeners.delete(entry);
            };
          },
          async prepareReload() {
            return (await report([...closeListeners, ...reloadListeners]))
              .allow;
          },
          prepareReloadReport() {
            return report([...closeListeners, ...reloadListeners]);
          },
        }
      : {}),
  };
  reportCodexWorkbenchReady();
}
