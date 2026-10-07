import { chooseLocalPath, type FileDialogOptions } from "./FileDialog";
import type { DesktopChange, DesktopResponse } from "../desktop/bridge";
import type { LoadedPage } from "../studio/usePage";

declare global {
  interface Window {
    __SHOWAI_LOCAL__?: { token: string };
  }
}

export function installBrowserBridge() {
  const config = window.__SHOWAI_LOCAL__;
  if (!config || window.showai) return;
  const listeners = new Set<(change: DesktopChange) => void>();
  const closeListeners = new Set<() => Promise<boolean>>();
  let dirty = false;
  async function request<T>(
    route: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`/api/${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config!.token}`,
      },
      body: JSON.stringify(args),
    });
    if (
      !response.ok &&
      response.headers.get("content-type")?.includes("application/json") !==
        true
    )
      throw new Error(
        `本地服务请求失败（${response.status}），请确认 ShowAI 服务仍在运行。`,
      );
    const result = (await response.json()) as DesktopResponse<T>;
    if (!result.ok) throw result.error;
    return result.data;
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
    // Open synchronously to preserve the browser's user-gesture permission.
    const pageWindow =
      action === "app:openPageWindow"
        ? window.open("about:blank", "_blank")
        : null;
    if (pageWindow) pageWindow.opener = null;
    const dialogs: Record<string, FileDialogOptions> = {
      "dialog:openPage": {
        title: "导入 ShowAI 页面",
        kind: "file",
        extensions: ["json", "html", "htm", "md", "markdown", "txt"],
      },
      "components:import": { title: "选择组件源码目录", kind: "directory" },
      "catalog:preparePublish": {
        title: "选择发布包保存位置",
        kind: "directory",
      },
      "export:site": { title: "选择网站输出目录", kind: "directory" },
      "settings:chooseHome": {
        title: "选择 ShowAI 数据目录",
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
        title: "导出页面",
        kind: "save",
        defaultName: `${name}${args.format === "json" ? ".showai.json" : ".html"}`,
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
      if (!path) return null as T;
      args = { ...args, selectedPath: path };
    }
    try {
      const result = await request<T>("invoke", { action, args });
      if (action === "app:openPageWindow") {
        const url = (result as { url: string }).url;
        if (pageWindow) pageWindow.location.replace(url);
        else window.location.assign(url);
      }
      return result;
    } catch (error) {
      pageWindow?.close();
      throw error;
    }
  }
  // Thumbnail frames only read their component; a persistent connection per
  // frame would exhaust the browser's connections to this loopback host.
  if (!new URLSearchParams(location.search).has("componentPreview")) {
    const events = new EventSource(
      `/api/events?token=${encodeURIComponent(config.token)}`,
    );
    events.onmessage = (event) => {
      const change = JSON.parse(event.data) as DesktopChange;
      for (const listener of listeners) listener(change);
    };
    // Reconnects trigger a refresh even if changes happened while the connection was lost.
    events.onopen = () => {
      for (const listener of listeners)
        listener({ type: "files", home: "", all: true });
    };
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
    invoke,
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
}
