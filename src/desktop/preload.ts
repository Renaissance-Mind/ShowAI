import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopChange,
  DesktopResponse,
  DesktopWindowState,
  ShowAIBridge,
} from "./bridge";

if (process.isMainFrame) {
  const closeListeners = new Set<() => Promise<boolean>>();
  ipcRenderer.on("showai:before-close", async (_event, requestId: string) => {
    let allow = false;
    try {
      allow = (
        await Promise.all([...closeListeners].map((listener) => listener()))
      ).every(Boolean);
    } catch {
      allow = false;
    }
    ipcRenderer.send("showai:close-result", { requestId, allow });
  });
  const bridge: ShowAIBridge = {
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
        action === "components:thumbnail" ||
        action === "components:thumbnailCancel" ||
        action === "components:previewData"
          ? await ipcRenderer.invoke(
              action === "components:thumbnail"
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
    onRefreshPage(listener) {
      const receive = () => listener();
      ipcRenderer.on("showai:refresh-page", receive);
      return () => ipcRenderer.removeListener("showai:refresh-page", receive);
    },
    ...(process.env.SHOWAI_DEV_URL
      ? {
          async prepareReload() {
            return (
              await Promise.all(
                [...closeListeners].map((listener) => listener()),
              )
            ).every(Boolean);
          },
        }
      : {}),
  };
  contextBridge.exposeInMainWorld("showai", bridge);
}
