import { contextBridge, ipcRenderer } from "electron";
import type { TabCommand } from "../workbench/tab-shortcuts";
import {
  type AppUpdateState,
  type CloseResult,
  type CloseSource,
  type DesktopChange,
  type DesktopResponse,
  type DesktopWindowState,
  type MenuCommand,
  type ShowAIBridge,
} from "./bridge";
import { closeReporter, type CloseListenerEntry } from "./close-report";

if (process.isMainFrame) {
  const thumbnailListeners = new Set<
    (reference: { projectId: string; pageId: string; theme: string }) => void
  >();
  ipcRenderer.on("showai:page-thumbnail-updated", (_event, reference) => {
    for (const listener of thumbnailListeners) listener(reference);
  });
  const closeListeners = new Set<CloseListenerEntry>();
  const reloadListeners = new Set<CloseListenerEntry>();
  // Each listener answers with its own reason; a slow one is named, not waited on forever.
  const report = closeReporter();
  ipcRenderer.on("showai:before-close", async (_event, requestId: string) => {
    const result = await report([...closeListeners]);
    ipcRenderer.send("showai:close-result", { requestId, ...result });
  });
  // Uncaught renderer failures reach the main-process log for problem reports.
  const forward = (kind: string, value: unknown, fallback: string) => {
    const error = value instanceof Error ? value : undefined;
    ipcRenderer.send("showai:renderer-error", {
      kind,
      message: (error?.message ?? (fallback || String(value))).slice(0, 4000),
      stack: error?.stack?.slice(0, 8000),
      location: location.pathname.split("/").pop(),
    });
  };
  window.addEventListener("error", (event) =>
    forward(
      "error",
      event.error,
      `${event.message} (${String(event.filename).split("/").pop()}:${event.lineno}:${event.colno})`,
    ),
  );
  window.addEventListener("unhandledrejection", (event) =>
    forward("unhandledrejection", event.reason, ""),
  );
  const bridge: ShowAIBridge = {
    ...(new URLSearchParams(location.search).get("thumbnailCapture") === "1"
      ? {
          onPreviewCapture(listener: (action: "load" | "clear") => void) {
            const receive = (
              _event: Electron.IpcRendererEvent,
              action: "load" | "clear",
            ) => listener(action);
            ipcRenderer.on("showai:preview-control", receive);
            return () =>
              ipcRenderer.removeListener("showai:preview-control", receive);
          },
          previewReady(id: string, error?: string) {
            ipcRenderer.send("showai:preview-ready", { id, error });
          },
        }
      : {}),
    pageThumbnails: true,
    onPageThumbnail(listener) {
      thumbnailListeners.add(listener);
      return () => {
        thumbnailListeners.delete(listener);
      };
    },
    setAppearance(appearance) {
      return ipcRenderer.invoke("showai:set-appearance", appearance);
    },
    setLocale(locale) {
      return ipcRenderer.invoke("showai:set-locale", locale);
    },
    getWindowState() {
      return ipcRenderer.invoke("showai:window-state");
    },
    onWindowStateChange(listener) {
      const receive = (
        _event: Electron.IpcRendererEvent,
        state: DesktopWindowState,
      ) => listener(state);
      ipcRenderer.on("showai:window-state-changed", receive);
      return () =>
        ipcRenderer.removeListener("showai:window-state-changed", receive);
    },
    async invoke<T>(
      action: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      const result = (
        action === "pages:thumbnail" ||
        action === "pages:thumbnailActivity" ||
        action === "pages:thumbnailCancel" ||
        action === "pages:previewData" ||
        action === "components:thumbnail" ||
        action === "components:thumbnailCancel" ||
        action === "components:previewData"
          ? await ipcRenderer.invoke(
              action.startsWith("pages:")
                ? action === "pages:thumbnailActivity"
                  ? "showai:pages:thumbnail-activity"
                  : action === "pages:thumbnailCancel"
                    ? "showai:thumbnail-cancel"
                    : action === "pages:previewData"
                      ? "showai:previewData"
                      : "showai:pages:thumbnail"
                : action === "components:thumbnail"
                  ? "showai:thumbnail"
                  : action === "components:thumbnailCancel"
                    ? "showai:thumbnail-cancel"
                    : "showai:previewData",
              args,
            )
          : await ipcRenderer.invoke("showai:invoke", action, args)
      ) as DesktopResponse<T>;
      if (!result.ok) throw result.error;
      return result.data;
    },
    onChange(listener) {
      const receive = (
        _event: Electron.IpcRendererEvent,
        change: DesktopChange,
      ) => listener(change);
      ipcRenderer.on("showai:changed", receive);
      return () => ipcRenderer.removeListener("showai:changed", receive);
    },
    onBeforeClose(listener, source = "workbench") {
      const entry = { listener, source };
      closeListeners.add(entry);
      return () => {
        closeListeners.delete(entry);
      };
    },
    onTabCommand(listener) {
      const receive = (
        _event: Electron.IpcRendererEvent,
        command: TabCommand,
      ) => listener(command);
      ipcRenderer.on("showai:tab-command", receive);
      return () => ipcRenderer.removeListener("showai:tab-command", receive);
    },
    onMenuCommand(listener) {
      const receive = (
        _event: Electron.IpcRendererEvent,
        command: MenuCommand,
      ) => listener(command);
      ipcRenderer.on("showai:menu-command", receive);
      // Commands chosen while this window was starting are delivered now.
      ipcRenderer.send("showai:menu-ready");
      return () => ipcRenderer.removeListener("showai:menu-command", receive);
    },
    onAppUpdate(listener) {
      const receive = (
        _event: Electron.IpcRendererEvent,
        state: AppUpdateState,
      ) => listener(state);
      ipcRenderer.on("showai:app-update", receive);
      return () => ipcRenderer.removeListener("showai:app-update", receive);
    },
    logPath() {
      return ipcRenderer.invoke("logs:path");
    },
    openLogFolder() {
      return ipcRenderer.invoke("logs:open-folder");
    },
    diagnostics() {
      return ipcRenderer.invoke("showai:diagnostics");
    },
    logTail(lines?: number) {
      return ipcRenderer.invoke("logs:tail", lines);
    },
    exportDiagnostics(text: string) {
      return ipcRenderer.invoke("showai:export-diagnostics", { text });
    },
    onRefreshPage(listener) {
      const receive = () => listener();
      ipcRenderer.on("showai:refresh-page", receive);
      return () => ipcRenderer.removeListener("showai:refresh-page", receive);
    },
    ...(process.env.SHOWAI_DEV_URL
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
  contextBridge.exposeInMainWorld("showai", bridge);
}
