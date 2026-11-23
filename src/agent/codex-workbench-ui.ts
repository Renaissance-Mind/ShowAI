import messages from "../i18n/messages/codex-workbench";
import { workbenchChunkBytes } from "../host/codex-workbench-transport";
import { codexPageReferenceMaxLength } from "./codex-page-reference";
import cardStyles from "./codex-workbench-card.css?raw";
import cardMarkup from "./codex-workbench-card.html?raw";
import cardView from "./codex-workbench-card-view.js?raw";
import cardSpacingEditor from "./codex-workbench-card-spacing.js?raw";
import chatgptMark from "../design/brands/openai.svg?raw";

export type CodexWorkbenchMode = "global" | "thread";
export const codexWorkbenchUri = "ui://showai/workbench-v3.html";
export const codexWorkbenchThreadUri = "ui://showai/workbench-thread-v5.html";
export const codexWorkbenchFileUri = "ui://showai/workbench-file-v3.html";

export const codexWorkbenchCardUri = "ui://showai/workbench-card-v15.html";
export const previousWorkbenchCardUri = "ui://showai/workbench-card-v10.html";
export const codexWorkbenchTargetUri = "ui://showai/workbench-target-v4.html";

export function codexWorkbenchHtml(
  mode?: CodexWorkbenchMode,
  entrypoint?: "file" | "card" | "open",
  icon?: string,
  hasGlobalEntrypoint = false,
  host: "codex" | "qoder" | "linked" | "cursor" | "remote" = "codex",
) {
  const useCard = entrypoint === "card" || entrypoint === "open";
  const card = useCard
    ? `<section id="showai-page-card" class="showai-card-list" aria-label="ShowAI" hidden></section>
      <template id="showai-card-template">${cardMarkup.replaceAll("__SHOWAI_ICON__", icon ?? "")
        .replaceAll("__CHATGPT_ICON__", "data:image/svg+xml;base64," + Buffer.from(chatgptMark).toString("base64"))}</template>
      <section id="showai-card-spacing" class="showai-spacing-editor" hidden></section>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; font: 14px system-ui }
body { margin: 0 }
${useCard ? cardStyles : ""}
#root[hidden] { display: none }
#showai-launch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 16px }
#showai-launch[hidden], #showai-launch button[hidden] { display: none }
</style></head><body>
${card}
<div id="showai-launch" role="status"><span id="showai-message"></span><button id="showai-retry" hidden></button><button id="showai-external" hidden></button></div>
<div id="root" hidden></div>
<script>
(() => {
  ${useCard ? cardView : ""}
  ${entrypoint === "card" ? cardSpacingEditor : ""}
  const translations = ${JSON.stringify(messages.catalogs)};
  const hasGlobalEntrypoint = ${hasGlobalEntrypoint};
  const qoder = ${host === "qoder"};
  const linked = ${host === "linked"};
  const cursor = ${host === "cursor"};
  const remote = ${host === "remote"};
  const editorBridge = cursor && typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  const scriptNonce = document.currentScript?.nonce;
  const send = value => editorBridge ? editorBridge.postMessage(value) : parent.postMessage(value, "*");
  const messageExtension = ${JSON.stringify(host === "qoder" ? "qoder/message" : "openai/message")};
  const deepLinkExtension = ${JSON.stringify(host === "qoder" ? "qoder/deepLink" : "openai/deepLink")};
  const chunkBytes = ${workbenchChunkBytes};
  const useFileEntrypoint = ${entrypoint === "file"};
  const usePageCard = ${useCard};
  const directEditor = ${entrypoint === "open" || host === "remote" && entrypoint === "card"};
  const referenceLimit = ${codexPageReferenceMaxLength};
  let mode = ${JSON.stringify(mode) ?? "null"};
  const status = document.getElementById("showai-launch");
  const message = document.getElementById("showai-message");
  const retry = document.getElementById("showai-retry");
  const external = document.getElementById("showai-external");
  const root = document.getElementById("root");
  const card = document.getElementById("showai-page-card");
  const cardTemplate = document.getElementById("showai-card-template");
  const cards = card ? createShowaiCardView(card, cardTemplate, openPageCard) : null;
  const spacingForm = document.getElementById("showai-card-spacing");
  let adjustSpacing = false, spacingEditor;
  let pageCards = [], cardGroup, openingCard = false;
  let navigationScope, activePage, acknowledgedNavigation, requestedNavigation;
  const pending = new Map();
  let locale = navigator.language.startsWith("zh") ? "zh-CN" : "en";
  let context = {};
  let capabilities = {};
  let t3Local = false, desktopRequested = false;
  let openSideCards = new Set(), checkingSideCards;
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
    external.hidden = remote || key !== "failed" || !launchUrl;
    status.hidden = false;
  }

  function request(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const awaitsApproval = t3Local && (method === "ui/message" ||
        (method === "tools/call" && params.name === "workbench_open_destination"));
      const timeout = awaitsApproval ? undefined : setTimeout(() => {
        pending.delete(id);
        reject(new Error(t("timedOut")));
      }, 8000);
      pending.set(id, { resolve, reject, timeout });
      send({ jsonrpc: "2.0", id, method, params });
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
    const path = context[deepLinkExtension]?.url;
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

  async function openWorkbench(projectId, pageId, blockId) {
    if (editorBridge) return request("showai/open-workbench", { projectId, pageId, blockId });
    if (!hasGlobalEntrypoint) throw new Error(t("cannotOpenWorkbench"));
    return callWorkbench("workbench_open_destination", {
      destination: "workbench", projectId, pageId, ...(blockId && { blockId }),
    });
  }

  function canOpenPageTab() {
    return !!editorBridge || (!qoder && !remote && !linked && !!capabilities.serverTools && !!capabilities.experimental?.["openai/files"]);
  }

  async function openPageTab({ projectId, pageId, blockId }) {
    if (editorBridge) return request("showai/open-page", { projectId, pageId, blockId });
    if (!canOpenPageTab()) throw new Error(t("cannotOpenPageTab"));
    const path = await callWorkbench("workbench_side_file", { projectId, pageId, ...(blockId && { blockId }) });
    if (typeof path !== "string") throw new Error(t("cannotOpenPageTab"));
    const opened = await request("openai/files/open", { path });
    if (opened?.isError) throw new Error(t("cannotOpenPageTab"));
  }

  function canReference() {
    return launchUrl.searchParams.get("codexMode") === "thread"
      ? !!capabilities.updateModelContext
      : !!capabilities.message && !!capabilities.experimental?.[messageExtension];
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
    if (mode === "global" && capabilities.message && capabilities.experimental?.[messageExtension])
      return request("ui/message", {
        role: "user", content, _meta: { [messageExtension]: { target: "new", send: false } },
      });
    return Promise.reject(new Error(t("unavailable")));
  }

  function resultPayload(result) {
    const envelope = result?._meta ?? result;
    return envelope?.mcp_tool_result ?? envelope?.call_tool_result ?? result;
  }

  async function callWorkbench(name, args, meta) {
    const payload = resultPayload(await request("tools/call", { name, arguments: args, ...(meta && { _meta: meta }) }));
    if (payload?.isError) {
      const error = payload.structuredContent?.error;
      throw new Error(error?.message ?? t("unavailable"));
    }
    if (!Object.hasOwn(payload?._meta ?? {}, "showaiWorkbenchData"))
      throw new Error(t("unavailable"));
    const data = payload._meta.showaiWorkbenchData;
    if (qoder && data?.qoderTransfer) {
      const { id, length } = data.qoderTransfer;
      if (typeof id !== "string" || !Number.isSafeInteger(length) || length < 1)
        throw new Error(t("invalidBundle"));
      let text = "";
      while (text.length < length) {
        const part = await callWorkbench("workbench_response_chunk", { id, offset: text.length });
        if (typeof part !== "string" || !part || text.length + part.length > length)
          throw new Error(t("invalidBundle"));
        text += part;
      }
      void callWorkbench("workbench_response_release", { id }).catch(() => {});
      return JSON.parse(text);
    }
    return data;
  }

  async function workbenchRequest(route, args, client) {
    if (remote) {
      if (route === "locale") return { ok: true, data: { locale } };
      if (route !== "invoke") return { ok: false, error: { code: "INVALID_DATA", message: t("unavailable") } };
      const { action, args: input = {} } = args;
      const { projectId = input.input?.projectId, ...rest } = input;
      const write = [
        "folders:create", "folders:rename", "pages:create", "pages:save",
        "pages:duplicate", "pages:rename", "pages:pin", "pages:move", "pages:markSeen",
        "page:mergeSave", "drafts:save", "drafts:remove", "drafts:complete",
      ].includes(action);
      try {
        const payload = resultPayload(await request("tools/call", {
          name: write ? "workbench_remote_write" : "workbench_remote_read",
          arguments: { action, projectId, args: rest },
        }));
        if (payload?.isError && payload.structuredContent?.error)
          return { ok: false, error: payload.structuredContent.error };
        if (!payload?._meta?.showaiWorkbenchData) throw new Error(t("unavailable"));
        return payload._meta.showaiWorkbenchData;
      } catch (error) {
        return { ok: false, error: { code: "INVALID_DATA", message: error.message } };
      }
    }
    const input = { route, args, client };
    if (!qoder) return callWorkbench("workbench_request", input);
    const text = JSON.stringify(input);
    if (new TextEncoder().encode(text).length <= 512 * 1024)
      return callWorkbench("workbench_request", input);
    const id = await callWorkbench("workbench_upload_begin", { length: text.length });
    for (let offset = 0; offset < text.length; offset += 100_000)
      await callWorkbench("workbench_upload_chunk", { id, offset, text: text.slice(offset, offset + 100_000) });
    return callWorkbench("workbench_upload_finish", { id });
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
      if (scriptNonce) map.nonce = scriptNonce;
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
    if (!url || (targetMode !== "global" && targetMode !== "thread")) return null;
    const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
    if (remote ? !loopback && url.protocol !== "https:"
      : !loopback || !/^[0-9a-f]{64}$/.test(url.searchParams.get("codexWorkbench") || "")) return null;
    if (mode && targetMode !== mode) return null;
    mode ??= targetMode;
    navigationScope ??= descriptor.scope;
    return { url, bundle: descriptor.bundle };
  }

  function cardDestinations(index) {
    if (!initialized) return [];
    const server = !!capabilities.serverTools;
    if (t3Local || desktopRequested) return server ? ["desktop"] : [];
    if (remote) {
      const modes = context.availableDisplayModes;
      return server && (!Array.isArray(modes) || modes.includes("fullscreen")) ? ["editor"] : [];
    }
    const result = [];
    if (canOpenPageTab() || (!linked && server && openSideCards.has(index))) result.push("panel");
    if (editorBridge || (hasGlobalEntrypoint && server && !qoder)) result.push("workbench");
    if (linked && (server || pageCards[index].editorUrl))
      result.push(result.length ? "copyLink" : "editorLink");
    if (server) result.push("desktop");
    return result;
  }

  async function refreshOpenSideCards() {
    if (!initialized || !navigationScope || !pageCards.length || !capabilities.serverTools ||
        remote || linked || t3Local || desktopRequested || canOpenPageTab() ||
        openingCard || checkingSideCards === pageCards) return;
    const group = pageCards;
    checkingSideCards = group;
    try {
      const pages = group.map(({ projectId, pageId }) => ({ projectId, pageId }));
      const indices = await callWorkbench("workbench_card_panels", { pages }, { "showai/navigationScope": navigationScope });
      if (pageCards === group) {
        openSideCards = new Set(indices);
        showPageCard();
      }
    } catch (error) {
      console.warn("ShowAI side panel availability:", error.message);
    } finally {
      if (checkingSideCards === group) checkingSideCards = undefined;
    }
  }

  function showPageCard() {
    if (!pageCards.length || (ready && !root.hidden) || refreshing) return;
    cards.updateActions(t, openingCard, cardDestinations, linked && hasGlobalEntrypoint ? "cardCursor" : "cardWorkbench");
    card.hidden = false;
    if (initialized && adjustSpacing && !spacingEditor) {
      spacingEditor = createShowaiSpacingEditor(spacingForm, card, t, {
        restore: () => window.openai?.widgetState?.showaiCardSpacing,
        save: values => window.openai?.setWidgetState?.({ ...window.openai.widgetState, showaiCardSpacing: values }),
        submit: async prompt => {
          if (capabilities.message) {
            const params = { role: "user", content: [{ type: "text", text: prompt }] };
            if (capabilities.experimental?.["openai/message"])
              params._meta = { "openai/message": { target: "active", send: true } };
            return !(await request("ui/message", params))?.isError;
          }
          if (!window.openai?.sendFollowUpMessage) return false;
          await window.openai.sendFollowUpMessage({ prompt });
          return true;
        },
      });
    }
    spacingForm.hidden = !spacingEditor || !adjustSpacing;
  }

  function revealEditorLink(row, url) {
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = url;
    input.setAttribute("aria-label", t("editorLink"));
    row.dataset.kind = "info";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = t("copyEditorLink");
    copy.addEventListener("click", () => copyEditorLink(row, url));
    row.replaceChildren(t("editorLinkSideHint"), document.createElement("br"), input, copy);
    row.hidden = false;
    input.focus();
    input.select();
  }

  async function copyEditorLink(row, url) {
    try {
      await navigator.clipboard.writeText(url);
      row.dataset.kind = "info";
      row.textContent = t("copiedEditorLink");
      row.hidden = false;
    } catch {
      revealEditorLink(row, url);
    }
  }

  async function showCardEditor(target) {
    if (ready && activePage && (activePage.projectId !== target.projectId || activePage.pageId !== target.pageId)) {
      await openPageTab(target);
      return;
    }
    referencePage = target;
    cards?.closeMenu();
    card.hidden = true;
    if (ready) {
      root.hidden = false;
      displayPage(target.pageId, target.projectId, target.blockId);
    } else {
      await refreshLaunch();
      if (!ready) showPageCard();
    }
  }

  async function presentPageCard() {
    if (!initialized || openingCard || !pageCards.length) return;
    if (!directEditor || context.displayMode !== "fullscreen") {
      if (directEditor && ready && context.displayMode === "inline") {
        root.hidden = true;
        referencePage = undefined;
      }
      showPageCard();
    } else if (!referencePage) {
      try {
        const picked = remote && cardGroup &&
          await callWorkbench("workbench_card_choice", { groupId: cardGroup });
        await showCardEditor(pageCards[typeof picked === "number" ? picked : 0] ?? pageCards[0]);
      } catch (error) {
        show("failed", error.message);
        showPageCard();
      }
    }
  }

  async function openPageCard(index, destination) {
    const pageCard = pageCards[index];
    if (!initialized || !pageCard || openingCard) return;
    const { projectId, pageId, blockId } = pageCard;
    const target = { projectId, pageId, ...(blockId && { blockId }) };
    const errorMessage = card.children[index].querySelector(".showai-card-error");
    errorMessage.hidden = true;
    errorMessage.removeAttribute("data-kind");
    openingCard = true;
    showPageCard();
    status.hidden = true;
    try {
      if (destination === "desktop") {
        await callWorkbench("workbench_open_destination", { ...target, destination: "desktop" });
        return;
      }
      if (destination === "workbench") return await openWorkbench(projectId, pageId, blockId);
      if (destination === "editor") {
        if (cardGroup) await callWorkbench("workbench_card_choice", { groupId: cardGroup, index });
        const reply = await request(${JSON.stringify(host === "remote" ? "ui/request-display-mode" : "")}, { mode: "fullscreen" });
        if (reply?.mode !== "fullscreen" && reply?.displayMode !== "fullscreen" && context.displayMode !== "fullscreen")
          throw new Error(t("cannotOpenTarget"));
        await showCardEditor(target);
        return;
      }
      if (destination === "editorLink" || destination === "copyLink") {
        const url = pageCard.editorUrl ?? (await callWorkbench("workbench_page_url", target)).url;
        if (destination === "editorLink") revealEditorLink(errorMessage, url);
        else await copyEditorLink(errorMessage, url);
        return;
      }
      if (editorBridge) return await openPageTab(target);
      if (capabilities.serverTools) {
        const reply = resultPayload(await request("tools/call", {
          name: "card_navigate", arguments: target,
          ...(navigationScope && { _meta: { "showai/navigationScope": navigationScope } }),
        }));
        if (reply?.isError) throw new Error(reply.structuredContent?.error?.message ?? t("unavailable"));
        const status = reply?.structuredContent?.data?.status;
        if (status === "accepted" || status === "superseded") return;
        openSideCards.delete(index);
      }
      if (qoder) {
        errorMessage.dataset.kind = "info";
        errorMessage.textContent = t("qoderSideHint");
        errorMessage.hidden = false;
        return;
      }
      await openPageTab(target);
    } catch (error) {
      errorMessage.textContent = [t("cannotOpenTarget"), error.message].filter(Boolean).join(" · ");
      errorMessage.hidden = false;
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
      const data = payload?.structuredContent?.data;
      const group = meta?.showaiCardGroup ?? (Array.isArray(data?.cards) ? data : undefined);
      const target = meta?.showaiPageCard ?? data;
      const targets = group?.cards ?? (target?.pageId ? [target] : undefined);
      if (!targets?.length) return;
      desktopRequested = !remote && meta?.showaiCardDestination === "desktop";
      openSideCards = new Set(Array.isArray(meta?.showaiOpenSideCards) ? meta.showaiOpenSideCards : []);
      adjustSpacing = !qoder && !directEditor && (group ?? target)?.adjustSpacing === true;
      navigationScope ??= meta?.showaiNavigationScope;
      const singleChanged = !group && (["projectId", "pageId", "blockId", "title", "blockTitle", "description", "editorUrl"]
        .some(key => pageCards[0]?.[key] !== target?.[key]) ||
        JSON.stringify(pageCards[0]?.breadcrumb) !== JSON.stringify(target?.breadcrumb));
      if (!pageCards.length || group?.id !== cardGroup || singleChanged) {
        cardGroup = group?.id;
        pageCards = targets;
        cards.render(targets);
      }
      status.hidden = true;
      showPageCard();
      void presentPageCard();
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
        codexWorkbench: { key: launchUrl.searchParams.get("codexWorkbench") ?? "", mode, instance, remote },
      };
      window.__SHOWAI_CODEX_HOST__ = {
        attachReference,
        canReference,
        openLink,
        ...((hasGlobalEntrypoint || editorBridge) && { openWorkbench }),
        openPageTab,
        importAsset,
        ...(!remote && { readMedia }),
        workbenchRequest,
        workbenchChanges: async (after, client) => {
          if (remote) return { cursor: after, changes: [] };
          const panel = ready && mode === "thread" ? {
            scope: navigationScope, visible: !root.hidden && document.visibilityState === "visible",
            page: activePage, acknowledged: acknowledgedNavigation,
          } : undefined;
          const changes = await callWorkbench("workbench_changes", { after, client, panel });
          if (changes.navigation && !root.hidden && document.visibilityState === "visible") {
            const { id, target } = changes.navigation;
            const samePage = activePage?.projectId === target.projectId && activePage?.pageId === target.pageId;
            if (qoder || samePage) {
              if (qoder && !samePage) requestedNavigation = { id, target };
              else acknowledgedNavigation = id;
              displayPage(target.pageId, target.projectId, target.blockId);
            }
          }
          return changes;
        },
        updatePage: (projectId, pageId) => {
          if (mode !== "thread") return;
          activePage = projectId && pageId ? { projectId, pageId } : undefined;
          if (requestedNavigation && requestedNavigation.target.projectId === projectId && requestedNavigation.target.pageId === pageId) {
            acknowledgedNavigation = requestedNavigation.id;
            requestedNavigation = undefined;
          }
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
      if (qoder) {
        const script = document.createElement("script");
        script.type = "module";
        if (scriptNonce) script.nonce = scriptNonce;
        script.textContent = await downloadAsset(bundle.entry);
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error(t("invalidBundle")));
          document.body.appendChild(script);
        });
      } else await importAsset(bundle.entry);
      if (!ready) throw new Error(t("invalidBundle"));
    } catch (error) {
      if (!ready) show("failed", error.message);
    } finally {
      refreshing = false;
    }
  }

  const reportCardSize = card && observeShowaiCardHeight([card, spacingForm, status],
    () => initialized && root.hidden && context.displayMode !== "fullscreen");
  if (card) {
    card.addEventListener("pointerenter", refreshOpenSideCards);
    card.addEventListener("focusin", refreshOpenSideCards);
    window.addEventListener("focus", refreshOpenSideCards);
  }
  retry.addEventListener("click", () => {
    if (useFileEntrypoint) void readReferenceFile();
    else void refreshLaunch();
  });
  external.addEventListener("click", () => {
    if (launchUrl) void openLink(launchUrl.href).catch(error => { message.textContent = error.message; });
  });

  addEventListener("message", event => {
    const fromHost = editorBridge ? event.origin === window.origin : event.source === parent;
    if (!fromHost || event.data?.jsonrpc !== "2.0") return;
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
      const previous = context[deepLinkExtension]?.url;
      configure({ ...context, ...data.params });
      if (usePageCard && initialized && !openingCard) {
        presentPageCard();
        reportCardSize();
      }
      if (ready && !useFileEntrypoint && !usePageCard && previous !== context[deepLinkExtension]?.url) {
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
    spacingEditor?.restoreValues(event.detail?.globals?.widgetState?.showaiCardSpacing);
    receiveFileInput(event.detail?.globals?.toolInput);
    fromResult(event.detail?.globals?.toolResponseMetadata);
  });
  show("loading");
  receiveFileInput(window.openai?.toolInput);
  fromResult(window.openai?.toolResponseMetadata);
  request("ui/initialize", {
    appInfo: { name: "ShowAI", version: "1.0.0" },
    appCapabilities: usePageCard ? { availableDisplayModes: directEditor ? ["inline", "fullscreen"] : ["inline"] } : {},
    protocolVersion: "2026-01-26",
  }).then(result => {
    capabilities = result?.hostCapabilities || {};
    t3Local = ${host === "codex" || host === "linked"} && result?.hostInfo?.name === "t3-code";
    configure(result?.hostContext);
    initialized = true;
    if (!ready && !pageCards.length) show("loading");
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    if (usePageCard) {
      presentPageCard();
      reportCardSize();
    } else if (useFileEntrypoint) {
      if (fileInput) void readReferenceFile();
      else launchTimer = setTimeout(() => show("failed", t("missingReferenceFile")), 8000);
    } else if (mode) void refreshLaunch();
    else launchTimer = setTimeout(refreshLaunch, 800);
  }).catch(error => show("failed", error.message));
})();
</script></body></html>`;
}
