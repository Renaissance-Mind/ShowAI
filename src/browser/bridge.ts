import { chooseLocalPath, type FileDialogOptions } from "./FileDialog";
import {
  closeAllowed,
  type CloseResult,
  type DesktopChange,
  type DesktopResponse,
} from "../desktop/bridge";
import type { LoadedPage } from "../studio/usePage";
import { translator } from "../i18n";
import messages from "../i18n/messages/files";
import shellMessages from "../i18n/messages/appShell";

const t = translator(messages);
const shell = translator(shellMessages);

export type ConnectionState = "connected" | "lost" | "restarted";
let connection: ConnectionState = "connected";
/** The local service connection, shown by the workbench banner. */
export function connectionState() {
  return connection;
}
function announce(state: ConnectionState) {
  if (state === connection) return;
  // A new access token only comes with a page refresh; reconnecting can't recover it.
  if (connection === "restarted") return;
  connection = state;
  window.dispatchEvent(new CustomEvent("showai:connection", { detail: state }));
}
const failure = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

declare global {
  interface Window {
    __SHOWAI_LOCAL__?: { token: string };
  }
}

export function installBrowserBridge() {
  const config = window.__SHOWAI_LOCAL__;
  if (!config || window.showai) return;
  const listeners = new Set<(change: DesktopChange) => void>();
  const closeListeners = new Set<() => Promise<CloseResult>>();
  const reloadListeners = new Set<() => Promise<boolean>>();
  let dirty = false;
  // Lets the server skip echoing this tab's own saves back to it.
  const client = crypto.randomUUID();
  async function request<T>(
    route: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config!.token}`,
          "X-ShowAI-Client": client,
        },
        body: JSON.stringify(args),
      });
    } catch (error) {
      // fetch rejects with a TypeError when the loopback service is gone.
      if (!(error instanceof TypeError)) throw error;
      announce("lost");
      throw failure("SERVICE_UNREACHABLE", shell("connection.unreachable"));
    }
    if (response.status === 401) {
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
    // Keep the structured error (code, errno, path…) and add the HTTP status.
    if (!result.ok) throw { ...result.error, status: response.status };
    return result.data;
  }
  async function openWindow<T>(
    action: string,
    args: Record<string, unknown>,
    prepare?: () => Promise<boolean>,
  ): Promise<T | null> {
    // Reserve the window during the click, before saving or validating the target.
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
        extensions: ["json", "html", "htm", "md", "markdown", "txt"],
      },
      "components:import": { title: t("title.componentSource"), kind: "directory" },
      "catalog:preparePublish": {
        title: t("title.publishPackage"),
        kind: "directory",
      },
      "export:site": { title: t("title.siteOutput"), kind: "directory" },
      "settings:chooseHome": {
        title: t("title.dataDirectory"),
        kind: "directory",
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
              extensions: ["json", "csv", "tsv"],
            };
    if (action === "settings:chooseHome") {
      const info = await request<{ home: string }>("invoke", {
        action: "app:info",
        args: {},
      });
      dialogs[action].initialPath = info.home;
    }
    if (dialogs[action]) {
      const path = await chooseLocalPath(dialogs[action], request);
      if (!path) return null as T;
      args = { ...args, selectedPath: path };
    }
    return request<T>("invoke", { action, args });
  }
  // Thumbnail frames only read their component; a persistent connection per
  // frame would exhaust the browser's connections to this loopback host.
  if (!new URLSearchParams(location.search).has("componentPreview")) {
    const connect = () => {
      const events = new EventSource(
        `/api/events?token=${encodeURIComponent(config.token)}&client=${client}`,
      );
      events.onmessage = (event) => {
        const change = JSON.parse(event.data) as DesktopChange;
        for (const listener of listeners) listener(change);
      };
      // Reconnects trigger a refresh even if changes happened while the connection was lost.
      events.onopen = () => {
        announce("connected");
        for (const listener of listeners)
          listener({ type: "files", home: "", all: true });
      };
      events.onerror = () => {
        announce("lost");
        // The browser retries by itself unless the service refused the stream.
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
    for (const listener of closeListeners) void listener();
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
    onBeforeClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    setDirty(value) {
      dirty = value;
    },
    ...(import.meta.env.DEV
      ? {
          onBeforeReload(listener: () => Promise<boolean>) {
            reloadListeners.add(listener);
            return () => {
              reloadListeners.delete(listener);
            };
          },
          async prepareReload() {
            return (
              await Promise.all(
                [...closeListeners, ...reloadListeners].map((listener) =>
                  listener(),
                ),
              )
            ).every(closeAllowed);
          },
        }
      : {}),
  };
}
