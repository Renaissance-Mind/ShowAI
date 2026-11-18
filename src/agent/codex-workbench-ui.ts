import messages from "../i18n/messages/codex-workbench";

export type CodexWorkbenchMode = "global" | "thread";
export const codexWorkbenchUri = "ui://showai/workbench-v2.html";
export const codexWorkbenchThreadUri = "ui://showai/workbench-thread-v2.html";

export function codexWorkbenchHtml(origin: string, mode?: CodexWorkbenchMode) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; font: 14px system-ui }
body { margin: 0 }
#showai-launch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px }
#showai-launch[hidden], #showai-launch button[hidden] { display: none }
</style></head><body>
<div id="showai-launch" role="status"><span id="showai-message"></span><button id="showai-retry" hidden></button><button id="showai-external" hidden></button></div>
<div id="root" hidden></div>
<script>
(() => {
  const translations = ${JSON.stringify(messages.catalogs)};
  const workbenchOrigin = ${JSON.stringify(origin)};
  let mode = ${JSON.stringify(mode) ?? "null"};
  const status = document.getElementById("showai-launch");
  const message = document.getElementById("showai-message");
  const retry = document.getElementById("showai-retry");
  const external = document.getElementById("showai-external");
  const root = document.getElementById("root");
  const pending = new Map();
  let locale = navigator.language.startsWith("zh") ? "zh-CN" : "en";
  let context = {};
  let capabilities = {};
  let launch, launchUrl, launchTimer, initialized = false, loading = false;
  let ready = false, refreshing = false, sequence = 0;
  const instance = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const t = key => translations[locale][key];

  function show(key, details) {
    message.textContent = details ? t(key) + " · " + details : t(key);
    retry.textContent = t("retry");
    retry.hidden = key !== "failed" || !!window.showai || (!launch && !capabilities.serverTools);
    external.textContent = t("openInBrowser");
    external.hidden = key !== "failed" || !launchUrl;
    status.hidden = false;
  }

  function request(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(t("timedOut")));
      }, 8000);
      pending.set(id, { resolve, reject, timeout });
      parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  function configure(host) {
    context = host || {};
    if (typeof context.locale === "string")
      locale = context.locale.startsWith("zh") ? "zh-CN" : "en";
    document.documentElement.lang = locale;
    if (context.theme === "dark" || context.theme === "light")
      document.documentElement.style.colorScheme = context.theme;
  }

  function currentUrl() {
    const url = new URL(launch);
    const path = context["openai/deepLink"]?.url;
    if (typeof path === "string" && path.startsWith("/")) {
      const target = new URL(path, url.origin);
      if (target.origin === url.origin) {
        for (const name of ["project", "page", "folder", "blocks"]) {
          const value = target.searchParams.get(name);
          if (value) url.searchParams.set(name, value);
        }
      }
    }
    const saved = window.openai?.widgetState?.showaiWorkbench;
    if (url.searchParams.get("codexMode") === "thread" && !url.searchParams.has("project") &&
        typeof saved?.projectId === "string" && typeof saved?.pageId === "string") {
      url.searchParams.set("project", saved.projectId);
      url.searchParams.set("page", saved.pageId);
    }
    url.searchParams.set("codexInstance", instance);
    return url;
  }

  function openLink(url) {
    return request("ui/open-link", { url });
  }

  function canReference() {
    return launchUrl.searchParams.get("codexMode") === "thread"
      ? !!capabilities.updateModelContext
      : !!capabilities.message && !!capabilities.experimental?.["openai/message"];
  }

  function attachReference(reference, text, components) {
    const mode = launchUrl.searchParams.get("codexMode");
    const content = reference ? [{ type: "text", text }] : [];
    if (Array.isArray(components) && components.length)
      content.push({
        type: "text",
        text: "Selected component preview state: " + JSON.stringify(components),
      });
    if (mode === "thread" && capabilities.updateModelContext)
      return request("ui/update-model-context", {
        content,
        structuredContent: reference ? { showai: { reference, ...(components?.length ? { components } : {}) } } : {},
      });
    if (mode === "global" && capabilities.message && capabilities.experimental?.["openai/message"])
      return request("ui/message", {
        role: "user", content, _meta: { "openai/message": { target: "new", send: false } },
      });
    return Promise.reject(new Error(t("unavailable")));
  }

  function asset(value) {
    const url = new URL(value, launchUrl.origin);
    if (url.origin !== launchUrl.origin || !url.pathname.startsWith("/assets/"))
      throw new Error("Invalid ShowAI workbench asset");
    return url.href;
  }

  async function open() {
    if (!initialized || loading || ready || !launch) return;
    launchUrl = currentUrl();
    loading = true;
    show("loading");
    try {
      const response = await fetch(launchUrl, { cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("ShowAI workbench " + response.status);
      const source = new DOMParser().parseFromString(await response.text(), "text/html");
      const prefix = "window.__SHOWAI_LOCAL__=";
      const bootstrap = Array.from(source.scripts, script => script.textContent).find(script => script.startsWith(prefix));
      if (!bootstrap) throw new Error("Missing ShowAI workbench bootstrap");
      const config = JSON.parse(bootstrap.slice(prefix.length));
      if (!/^[0-9a-f]{64}$/.test(config.token)) throw new Error("Invalid ShowAI workbench bootstrap");
      window.__SHOWAI_LOCAL__ = { ...config, apiOrigin: launchUrl.origin, search: launchUrl.search };
      window.__SHOWAI_CODEX_HOST__ = {
        attachReference,
        canReference,
        openLink,
        updatePage: (projectId, pageId) => {
          if (launchUrl.searchParams.get("codexMode") === "thread")
            window.openai?.setWidgetState?.({
              ...window.openai.widgetState,
              showaiWorkbench: { projectId, pageId },
            });
        },
        ready: () => {
          ready = true;
          status.hidden = true;
          root.hidden = false;
        },
      };

      const loads = [];
      for (const link of source.querySelectorAll('link[rel="stylesheet"],link[rel="modulepreload"]')) {
        const node = document.createElement("link");
        node.rel = link.rel;
        node.crossOrigin = "anonymous";
        node.href = asset(link.getAttribute("href"));
        document.head.appendChild(node);
        loads.push(node);
      }
      for (const script of source.querySelectorAll('script[type="module"][src]')) {
        const node = document.createElement("script");
        node.type = "module";
        node.crossOrigin = "anonymous";
        node.src = asset(script.getAttribute("src"));
        loads.push(node);
        await new Promise((resolve, reject) => {
          node.onload = resolve;
          node.onerror = () => reject(new Error("ShowAI frontend module could not be loaded"));
          document.head.appendChild(node);
        }).catch(error => {
          for (const item of loads) item.remove();
          throw error;
        });
      }
      if (!ready) throw new Error("ShowAI workbench did not initialize");
    } catch (error) {
      show("failed", error.message);
    } finally {
      loading = false;
    }
  }

  retry.addEventListener("click", () => {
    if (capabilities.serverTools) void refreshLaunch();
    else void open();
  });
  external.addEventListener("click", () =>
    openLink(launchUrl.href).catch(error => { message.textContent = error.message; }),
  );

  function launchFrom(result) {
    const meta = result?._meta ?? result;
    const payload = meta?.mcp_tool_result ?? meta?.call_tool_result ?? meta;
    const value = (payload?._meta ?? payload)?.showaiWorkbench?.url;
    const url = typeof value === "string" ? URL.parse(value) : null;
    const targetMode = url?.searchParams.get("codexMode");
    if (!url || url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
        !/^[0-9a-f]{64}$/.test(url.searchParams.get("codexWorkbench") || "") ||
        (targetMode !== "global" && targetMode !== "thread")) return null;
    if (mode && targetMode !== mode) return null;
    mode ??= targetMode;
    return url;
  }

  function fromResult(result) {
    if (ready) return;
    const url = launchFrom(result);
    if (url?.origin === workbenchOrigin) {
      launch = url.href;
      clearTimeout(launchTimer);
      void open();
    } else if (initialized && url && !launch) {
      void refreshLaunch();
    }
  }

  async function refreshLaunch() {
    if (!initialized || refreshing || loading || ready) return;
    clearTimeout(launchTimer);
    const opener = context.toolInfo?.tool?.name;
    mode ??= opener?.endsWith("workbench_open_page") ? "thread" : "global";
    if (!capabilities.serverTools) {
      show("failed", t("connectionExpired"));
      return;
    }
    refreshing = true;
    show("loading");
    try {
      const result = await request("tools/call", {
        name: "workbench_refresh",
        arguments: { mode },
      });
      const url = launchFrom(result);
      if (url?.origin !== workbenchOrigin) throw new Error(t("connectionExpired"));
      launch = url.href;
      await open();
    } catch (error) {
      if (!ready) show("failed", error.message);
    } finally {
      refreshing = false;
    }
  }

  addEventListener("message", event => {
    if (event.source !== parent || event.data?.jsonrpc !== "2.0") return;
    const data = event.data;
    const waiting = pending.get(data.id);
    if (waiting) {
      pending.delete(data.id);
      clearTimeout(waiting.timeout);
      if (data.error) waiting.reject(new Error(data.error.message));
      else waiting.resolve(data.result);
      return;
    }
    if (data.method === "ui/notifications/tool-result") fromResult(data.params);
    if (data.method === "ui/notifications/host-context-changed") {
      const previous = context["openai/deepLink"]?.url;
      configure({ ...context, ...data.params });
      if (ready && previous !== context["openai/deepLink"]?.url) {
        const target = currentUrl();
        const pageId = target.searchParams.get("page");
        if (pageId) window.dispatchEvent(new CustomEvent("showai:open-page", {
          detail: {
            projectId: target.searchParams.get("project") ?? undefined,
            pageId,
            blockId: target.searchParams.get("blocks")?.split(",")[0],
          },
        }));
      }
    }
  });

  addEventListener("openai:set_globals", event => fromResult(event.detail?.globals?.toolResponseMetadata));
  fromResult(window.openai?.toolResponseMetadata);
  show("loading");
  request("ui/initialize", {
    appInfo: { name: "ShowAI", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26",
  }).then(result => {
    capabilities = result?.hostCapabilities || {};
    configure(result?.hostContext);
    initialized = true;
    if (!ready) show("loading");
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
    if (launch) void open();
    else launchTimer = setTimeout(refreshLaunch, 800);
  }).catch(error => show("failed", error.message));
})();
</script></body></html>`;
}
