import { contextBridge, ipcRenderer } from "electron";
import type { TabCommand } from "../workbench/tab-shortcuts";
import {
  closeAllowed,
  type CloseResult,
  type DesktopChange,
  type DesktopResponse,
  type DesktopWindowState,
  type MenuCommand,
  type ShowAIBridge,
  type UnsavedPage,
} from "./bridge";

if (process.isMainFrame) {
  const closeListeners = new Set<() => Promise<CloseResult>>();
  const reloadListeners = new Set<() => Promise<boolean>>();
  ipcRenderer.on("showai:before-close", async (_event, requestId: string) => {
    let allow = false;
    const pages: UnsavedPage[] = [];
    let reason = "";
    try {
      const results = await Promise.all(
        [...closeListeners].map((listener) => listener()),
      );
      allow = results.every(closeAllowed);
      for (const result of results)
        if (typeof result === "object") pages.push(...(result.pages ?? []));
    } catch (error) {
      allow = false;
      reason = error instanceof Error ? error.message : String(error);
    }
    ipcRenderer.send("showai:close-result", { requestId, allow, pages, reason });
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
    pageThumbnails: true,
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
    onBeforeClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
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
      return () => ipcRenderer.removeListener("showai:menu-command", receive);
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
    onRefreshPage(listener) {
      const receive = () => listener();
      ipcRenderer.on("showai:refresh-page", receive);
      return () => ipcRenderer.removeListener("showai:refresh-page", receive);
    },
    ...(process.env.SHOWAI_DEV_URL
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
  contextBridge.exposeInMainWorld("showai", bridge);
}
