import messages from "../i18n/messages/codex-workbench";
import { workbenchChunkBytes } from "../host/codex-workbench-transport";
import { codexPageReferenceMaxLength } from "./codex-page-reference";

export type CodexWorkbenchMode = "global" | "thread";
export const codexWorkbenchUri = "ui://showai/workbench-v3.html";
export const codexWorkbenchThreadUri = "ui://showai/workbench-thread-v5.html";
export const codexWorkbenchFileUri = "ui://showai/workbench-file-v3.html";

export const codexWorkbenchCardUri = "ui://showai/workbench-card-v4.html";
export const codexWorkbenchTargetUri = "ui://showai/workbench-target-v2.html";

export function codexWorkbenchHtml(
  mode?: CodexWorkbenchMode,
  entrypoint?: "file" | "card" | "open",
  icon?: string,
  globalEntrypoint?: string,
) {
  const useCard = entrypoint === "card" || entrypoint === "open";
  const card = useCard
    ? `<article id="showai-page-card" aria-label="ShowAI" hidden>
        <img src="${icon ?? ""}" alt="" width="34" height="34">
        <div class="showai-card-content">
          <strong id="showai-card-title"></strong>
          <div id="showai-card-kind"></div>
        </div>
        <button type="button" id="showai-card-open" disabled></button>
      </article>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; font: 14px system-ui }
body { margin: 0 }
#showai-page-card {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
  gap: 14px; margin: 8px 0; padding: 14px 16px;
  border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas);
  border-left: 3px solid color-mix(in srgb, CanvasText 58%, Canvas); border-radius: 10px;
}
#showai-page-card[hidden] { display: none }
#showai-page-card img { background: white; padding: 3px; border-radius: 6px; box-sizing: border-box }
.showai-card-content { min-width: 0; overflow-wrap: anywhere }
#showai-card-kind { margin-top: 3px; opacity: 0.7 }
#showai-card-open { padding: 7px 12px; border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas);
  border-radius: 6px; background: Canvas; color: CanvasText; font: inherit; cursor: pointer }
#showai-card-open:disabled { opacity: 0.6; cursor: default }
#showai-card-open:focus-visible { outline: 2px solid Highlight; outline-offset: 2px }
#showai-launch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px }
#showai-launch[hidden], #showai-launch button[hidden] { display: none }
</style></head><body>
${card}
<div id="showai-launch" role="status"><span id="showai-message"></span><button id="showai-retry" hidden></button><button id="showai-external" hidden></button></div>
<div id="root" hidden></div>
<script>
(() => {
  const translations = ${JSON.stringify(messages.catalogs)};
  const globalEntrypoint = ${JSON.stringify(globalEntrypoint ?? null)};
  const chunkBytes = ${workbenchChunkBytes};
  const useFileEntrypoint = ${entrypoint === "file"};
  const usePageCard = ${useCard};
  const referenceLimit = ${codexPageReferenceMaxLength};
  let mode = ${JSON.stringify(mode) ?? "null"};
  const status = document.getElementById("showai-launch");
  const message = document.getElementById("showai-message");
  const retry = document.getElementById("showai-retry");
  const external = document.getElementById("showai-external");
  const root = document.getElementById("root");
  const card = document.getElementById("showai-page-card");
  const openCardButton = document.getElementById("showai-card-open");
  let pageCard, openingCard = false;
  let navigationScope, activePage, acknowledgedNavigation;
  const pending = new Map();
  let locale = navigator.language.startsWith("zh") ? "zh-CN" : "en";
  let context = {};
  let capabilities = {};
  let launch, launchUrl, bundle, launchTimer, initialized = false;
  let ready = false, refreshing = false, sequence = 0;
  let fileInput, referencePage, readingFile = false;
  const urls = new Map();
  const assetDownloads = new Map();
  const waitingDownloads = [];
  let activeDownloads = 0;
  const instance = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const t = key => translations[locale][key];

  function show(key, details) {
    message.textContent = details ? t(key) + " · " + details : t(key);
    retry.textContent = t("retry");
    retry.hidden = key !== "failed" || usePageCard || !!window.showai ||
      (useFileEntrypoint && !fileInput) || (!launch && !capabilities.serverTools);
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
    if (referencePage) {
      url.searchParams.set("project", referencePage.projectId);
      url.searchParams.set("page", referencePage.pageId);
      if (referencePage.blockId) url.searchParams.set("block", referencePage.blockId);
    } else if (typeof path === "string" && path.startsWith("/")) {
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

  async function openWorkbench(projectId, pageId) {
    const url = new URL(globalEntrypoint);
    url.searchParams.set("path", "/?" + new URLSearchParams({ project: projectId, page: pageId }));
    const result = await openLink(url.href);
    if (result?.isError) throw new Error(t("cannotOpenWorkbench"));
  }

  async function openPageTab(target) {
    if (!capabilities.experimental?.["openai/files"] || !capabilities.serverTools)
      throw new Error(t("cannotOpenPageTab"));
    const result = resultPayload(await request("tools/call", {
      name: "workbench_page_reference", arguments: target,
    }));
    const path = result?.structuredContent?.data?.path;
    if (result?.isError || typeof path !== "string")
      throw new Error(result?.structuredContent?.error?.message ?? t("cannotOpenPageTab"));
    const opened = await request("openai/files/open", { path });
    if (opened?.isError) throw new Error(t("cannotOpenPageTab"));
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

  function resultPayload(result) {
    const envelope = result?._meta ?? result;
    return envelope?.mcp_tool_result ?? envelope?.call_tool_result ?? result;
  }

  async function callWorkbench(name, args) {
    const payload = resultPayload(await request("tools/call", { name, arguments: args }));
    if (payload?.isError) {
      const error = payload.structuredContent?.error;
      throw new Error(error?.message ?? t("unavailable"));
    }
    if (!Object.hasOwn(payload?._meta ?? {}, "showaiWorkbenchData"))
      throw new Error(t("unavailable"));
    return payload._meta.showaiWorkbenchData;
  }

  async function fetchPart(read, offset) {
    if (activeDownloads >= 6)
      await new Promise(resolve => waitingDownloads.push(resolve));
    else activeDownloads++;
    try {
      return await read(offset);
    } finally {
      const next = waitingDownloads.shift();
      if (next) next();
      else activeDownloads--;
    }
  }

  async function readBytes(size, read) {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(t("invalidBundle"));
    const data = new Uint8Array(size);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, Math.ceil(size / chunkBytes)) }, async () => {
      while (next < size) {
        const offset = next;
        next += chunkBytes;
        const part = Uint8Array.from(atob(await fetchPart(read, offset)), character => character.charCodeAt(0));
        if (part.length !== Math.min(chunkBytes, size - offset))
          throw new Error(t("invalidBundle"));
        data.set(part, offset);
      }
    }));
    return data;
  }

  function downloadAsset(name) {
    if (!assetDownloads.has(name)) {
      const item = bundle.assets[name];
      if (!item) throw new Error(t("invalidBundle"));
      const download = (async () => {
        const bytes = await readBytes(item.bytes, offset => callWorkbench("workbench_asset", { name, offset }));
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        const hex = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
        if (hex !== item.sha256) throw new Error(t("invalidBundle"));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return new Response(stream).text();
      })().catch(error => {
        assetDownloads.delete(name);
        throw error;
      });
      assetDownloads.set(name, download);
    }
    return assetDownloads.get(name);
  }

  async function importAsset(entry) {
    const dependencies = new Set();
    function visit(name) {
      if (urls.has(name) || dependencies.has(name)) return;
      const item = bundle.assets[name];
      if (!item) throw new Error(t("invalidBundle"));
      dependencies.add(name);
      item.imports.forEach(visit);
    }
    visit(entry);
    const prepared = await Promise.all([...dependencies].map(async (name) =>
      [name, await downloadAsset(name)],
    ));
    const imports = {};
    for (const [name, source] of prepared) {
      if (urls.has(name)) continue;
      const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      urls.set(name, url);
      imports["@showai/workbench/" + name] = url;
    }
    if (Object.keys(imports).length) {
      const map = document.createElement("script");
      map.type = "importmap";
      map.textContent = JSON.stringify({ imports });
      document.head.appendChild(map);
    }
    return import("@showai/workbench/" + entry);
  }

  async function readMedia(grant) {
    const first = await callWorkbench("workbench_media", { grant, offset: 0 });
    const bytes = await readBytes(first.size, async offset =>
      offset === 0 ? first.base64 : (await callWorkbench("workbench_media", { grant, offset })).base64,
    );
    return new Blob([bytes], { type: first.mime });
  }

  function launchFrom(result) {
    const payload = resultPayload(result);
    const descriptor = (payload?._meta ?? payload)?.showaiWorkbench;
    const url = typeof descriptor?.url === "string" ? URL.parse(descriptor.url) : null;
    const targetMode = url?.searchParams.get("codexMode");
    if (!url || url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
        !/^[0-9a-f]{64}$/.test(url.searchParams.get("codexWorkbench") || "") ||
        (targetMode !== "global" && targetMode !== "thread")) return null;
    if (mode && targetMode !== mode) return null;
    mode ??= targetMode;
    navigationScope ??= descriptor.scope;
    return { url, bundle: descriptor.bundle };
  }

  function showPageCard() {
    if (!pageCard || ready || openingCard || refreshing) return;
    document.getElementById("showai-card-title").textContent = pageCard.blockTitle || pageCard.title;
    document.getElementById("showai-card-kind").textContent = pageCard.blockId ? pageCard.title : t("pageCardKind");
    openCardButton.textContent = t(pageCard.blockId ? "locateComponent" : "openOriginalPage");
    openCardButton.disabled = !initialized;
    card.hidden = false;
  }

  function presentPageCard() {
    if (initialized && context.displayMode === "fullscreen" && !referencePage && pageCard) {
      referencePage = pageCard;
      card.hidden = true;
      void refreshLaunch().then(showPageCard);
      return;
    }
    showPageCard();
  }

  async function openPageCard() {
    if (!initialized || !pageCard || openingCard) return;
    openingCard = true;
    openCardButton.disabled = true;
    status.hidden = true;
    try {
      if (capabilities.serverTools) {
        const { projectId, pageId, blockId } = pageCard;
        const reply = resultPayload(await request("tools/call", {
          name: "card_navigate", arguments: { projectId, pageId, ...(blockId && { blockId }) },
          ...(navigationScope && { _meta: { "showai/navigationScope": navigationScope } }),
        }));
        if (reply?.isError) throw new Error(reply.structuredContent?.error?.message ?? t("unavailable"));
        const status = reply?.structuredContent?.data?.status;
        if (status === "accepted" || status === "superseded") return;
      }
      const modeResult = await request("ui/request-display-mode", { mode: "fullscreen" });
      if ((modeResult?.mode ?? context.displayMode) !== "fullscreen")
        throw new Error(t("cannotExpandCard"));
      referencePage = pageCard;
      card.hidden = true;
      await refreshLaunch();
    } catch (error) {
      show("failed", error.message);
    } finally {
      openingCard = false;
      showPageCard();
    }
  }

  function fromResult(result) {
    if (ready) return;
    if (usePageCard) {
      const payload = resultPayload(result);
      if (payload?.isError) {
        show("failed", payload.structuredContent?.error?.message);
        return;
      }
      const meta = payload?._meta ?? payload;
      const target = meta?.showaiPageCard ?? payload?.structuredContent?.data;
      if (!target) return;
      navigationScope ??= meta?.showaiNavigationScope;
      pageCard = target;
      status.hidden = true;
      presentPageCard();
      return;
    }
    const target = launchFrom(result);
    if (target && !launch) launch = target.url.href;
    if (target && initialized) void refreshLaunch();
  }

  function displayPage(pageId, projectId, blockId) {
    window.dispatchEvent(new CustomEvent("showai:open-page", {
      detail: { pageId, projectId, blockId },
    }));
  }

  function receiveFileInput(args) {
    if (!useFileEntrypoint) return;
    const file = args?.file;
    if (typeof file?.resourceUri !== "string" || !file.resourceUri ||
        file.resourceUri === fileInput?.resourceUri) return;
    fileInput = file;
    if (initialized) void readReferenceFile();
  }

  async function readReferenceFile() {
    if (!initialized || !fileInput || readingFile) return;
    const file = fileInput;
    clearTimeout(launchTimer);
    readingFile = true;
    try {
      const response = await request("resources/read", {
        uri: file.resourceUri,
        _meta: { "openai/resource": { representation: "text" } },
      });
      const content = response?.contents?.[0];
      let source = content?.text;
      if (typeof source !== "string" && typeof content?.blob === "string" &&
          content.blob.length <= Math.ceil(referenceLimit / 3) * 4) {
        const bytes = Uint8Array.from(atob(content.blob), character => character.charCodeAt(0));
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      if (typeof source !== "string" || !source.length || source.length > referenceLimit)
        throw new Error(t("invalidReferenceFile"));
      const target = await callWorkbench("workbench_resolve_reference", { source });
      if (file !== fileInput) return;
      referencePage = target;
      if (!ready) await refreshLaunch();
      else {
        status.hidden = true;
        displayPage(target.pageId, target.projectId, target.blockId);
      }
    } catch (error) {
      if (file === fileInput) show("failed", error.message);
    } finally {
      readingFile = false;
      if (file !== fileInput) void readReferenceFile();
    }
  }

  async function refreshLaunch() {
    if (!initialized || refreshing || ready ||
        ((useFileEntrypoint || usePageCard) && !referencePage)) return;
    clearTimeout(launchTimer);
    const opener = context.toolInfo?.tool?.name;
    mode ??= opener?.endsWith("workbench_open_page") ? "thread" : "global";
    if (!capabilities.serverTools) {
      show("failed", t("unavailable"));
      return;
    }
    refreshing = true;
    show("loading");
    try {
      const result = await request("tools/call", {
        name: "workbench_refresh",
        arguments: { mode },
      });
      const target = launchFrom(result);
      if (!target?.bundle) throw new Error(t("connectionExpired"));
      launch = target.url.href;
      launchUrl = currentUrl();
      bundle = target.bundle;
      window.__SHOWAI_LOCAL__ = {
        token: "",
        apiOrigin: launchUrl.origin,
        search: launchUrl.search,
        codexWorkbench: { key: launchUrl.searchParams.get("codexWorkbench"), mode, instance },
      };
      window.__SHOWAI_CODEX_HOST__ = {
        attachReference,
        canReference,
        openLink,
        ...(globalEntrypoint && { openWorkbench }),
        openPageTab,
        importAsset,
        readMedia,
        workbenchRequest: (route, args, client) => callWorkbench("workbench_request", { route, args, client }),
        workbenchChanges: async (after, client) => {
          const panel = ready && mode === "thread" ? {
            scope: navigationScope, visible: document.visibilityState === "visible",
            page: activePage, acknowledged: acknowledgedNavigation,
          } : undefined;
          const changes = await callWorkbench("workbench_changes", { after, client, panel });
          if (changes.navigation && document.visibilityState === "visible") {
            const { id, target } = changes.navigation;
            if (activePage?.projectId === target.projectId && activePage?.pageId === target.pageId) {
              displayPage(target.pageId, target.projectId, target.blockId);
              acknowledgedNavigation = id;
            }
          }
          return changes;
        },
        updatePage: (projectId, pageId) => {
          if (mode !== "thread") return;
          activePage = projectId && pageId ? { projectId, pageId } : undefined;
          if (activePage)
            window.openai?.setWidgetState?.({
              ...window.openai.widgetState,
              showaiWorkbench: activePage,
            });
        },
        ready: () => {
          ready = true;
          status.hidden = true;
          root.hidden = false;
        },
      };
      const style = document.getElementById("showai-workbench-style") ?? document.createElement("style");
      style.id = "showai-workbench-style";
      style.textContent = await downloadAsset(bundle.style);
      document.head.appendChild(style);
      await importAsset(bundle.entry);
      if (!ready) throw new Error(t("invalidBundle"));
    } catch (error) {
      if (!ready) show("failed", error.message);
    } finally {
      refreshing = false;
    }
  }

  openCardButton?.addEventListener("click", openPageCard);
  retry.addEventListener("click", () => {
    if (useFileEntrypoint) void readReferenceFile();
    else void refreshLaunch();
  });
  external.addEventListener("click", () => {
    if (launchUrl) void openLink(launchUrl.href).catch(error => { message.textContent = error.message; });
  });

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
    if (data.method === "ui/notifications/tool-input") receiveFileInput(data.params?.arguments);
    if (data.method === "ui/notifications/tool-result") fromResult(data.params);
    if (data.method === "ui/notifications/host-context-changed") {
      const previous = context["openai/deepLink"]?.url;
      configure({ ...context, ...data.params });
      if (usePageCard && initialized && !openingCard) presentPageCard();
      if (ready && !useFileEntrypoint && !usePageCard && previous !== context["openai/deepLink"]?.url) {
        const target = currentUrl();
        const pageId = target.searchParams.get("page");
        if (pageId) displayPage(
          pageId,
          target.searchParams.get("project") ?? undefined,
          target.searchParams.get("blocks")?.split(",")[0],
        );
      }
    }
  });

  addEventListener("openai:set_globals", event => {
    receiveFileInput(event.detail?.globals?.toolInput);
    fromResult(event.detail?.globals?.toolResponseMetadata);
  });
  show("loading");
  receiveFileInput(window.openai?.toolInput);
  fromResult(window.openai?.toolResponseMetadata);
  request("ui/initialize", {
    appInfo: { name: "ShowAI", version: "1.0.0" },
    appCapabilities: usePageCard ? { availableDisplayModes: ["inline", "fullscreen"] } : {},
    protocolVersion: "2026-01-26",
  }).then(result => {
    capabilities = result?.hostCapabilities || {};
    configure(result?.hostContext);
    initialized = true;
    if (!ready && !pageCard) show("loading");
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
    if (usePageCard) presentPageCard();
    else if (useFileEntrypoint) {
      if (fileInput) void readReferenceFile();
      else launchTimer = setTimeout(() => show("failed", t("missingReferenceFile")), 8000);
    } else if (mode) void refreshLaunch();
    else launchTimer = setTimeout(refreshLaunch, 800);
  }).catch(error => show("failed", error.message));
})();
</script></body></html>`;
}
