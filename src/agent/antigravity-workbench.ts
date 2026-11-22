import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import darkLogo from "../../plugins/showai/assets/logo-dark.svg?raw";
import antigravityMark from "../plugin/assets/antigravity.svg?raw";
import messages from "../i18n/messages/codex-workbench";
import { openSystemUrl } from "../host/local-system";
import { pageLink } from "../document/page-link.mjs";
import type { AgentService } from "./service";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import {
  codexCardTarget,
  codexPageReferenceExtension,
  codexPageReferenceMaxLength,
  codexPageTarget,
  readCodexPageCards,
  readCodexPageTarget,
  resolveCodexPageReference,
  type CodexCardTarget,
  type CodexPageTarget,
} from "./codex-page-reference";
import cardStyles from "./codex-workbench-card.css?raw";
import cardMarkup from "./codex-workbench-card.html?raw";
import cardView from "./codex-workbench-card-view.js?raw";
import cardSpacingEditor from "./codex-workbench-card-spacing.js?raw";

export const antigravityCardUri = "ui://showai/antigravity-card-v2.html";
export const antigravityFileUri = "ui://showai/antigravity-file-v1.html";
const NAV_FILE = "antigravity-workbench-nav.json";
const STATE_FILE = "antigravity-workbench-state.json";
const ACTIVE_STATE_MAX_AGE_MS = 15_000;

export type OpenAntigravityWorkbench = (key: string) => Promise<{
  url: string;
  localUrl: string;
  close(): Promise<void>;
  navigateAntigravityTab?: (target: CodexPageTarget) => boolean;
}>;

const antigravityIcons = ([
  ["light", lightLogo],
  ["dark", darkLogo],
] as const).map(([theme, svg]) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const appOnly = { ui: { visibility: ["app"] } };

export function buildAntigravitySidecarUrl({
  projectId,
  pageId,
  blockId,
}: CodexPageTarget) {
  const params = new URLSearchParams({ project: projectId, page: pageId });
  if (blockId) params.set("block", blockId);
  return `sidecar://showai/workbench/?${params.toString()}`;
}

async function atomicWriteJson(targetPath: string, value: unknown) {
  await mkdir(dirname(targetPath), { recursive: true });
  const temp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, targetPath);
}

export async function readAntigravityWorkbenchOpen(home: string) {
  try {
    const raw = await readFile(join(home, "local", STATE_FILE), "utf8");
    const parsed = JSON.parse(raw) as {
      visibleClients?: unknown;
      viewportVerified?: unknown;
      updatedAt?: unknown;
    };
    return (
      parsed?.viewportVerified === true &&
      typeof parsed?.visibleClients === "number" &&
      parsed.visibleClients > 0 &&
      typeof parsed?.updatedAt === "number" &&
      Date.now() - parsed.updatedAt <= ACTIVE_STATE_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

export async function writeAntigravityTabReference(
  service: AgentService,
  target: CodexPageTarget,
) {
  const page = await readCodexPageTarget(service, target);
  const title = page.title
    .replace(/[<>:"/\\|?*\p{C}]/gu, " ")
    .trim()
    .slice(0, 65);
  const name = "ShowAI - " + (title || "Page") + codexPageReferenceExtension;
  const dir = join(
    service.store.root,
    "local",
    "antigravity-page-tabs",
    target.projectId,
    target.pageId,
  );
  const path = join(dir, name);
  await atomicWriteJson(path, {
    format: "showai-page-reference",
    version: target.blockId ? 2 : 1,
    projectId: target.projectId,
    pageId: target.pageId,
    ...(target.blockId ? { blockId: target.blockId } : {}),
  });
  return {
    path,
    fileUri: pathToFileURL(path).href,
    title: page.title,
  };
}

export async function writeAntigravityNavTarget(
  home: string,
  target: CodexPageTarget,
) {
  const record = {
    id: randomUUID(),
    projectId: target.projectId,
    pageId: target.pageId,
    ...(target.blockId ? { blockId: target.blockId } : {}),
    requestedAt: Date.now(),
  };
  await atomicWriteJson(join(home, "local", NAV_FILE), record);
  const isOpen = await readAntigravityWorkbenchOpen(home);
  return {
    status: isOpen ? ("accepted" as const) : ("queued" as const),
    sidecarUrl: buildAntigravitySidecarUrl(target),
    navigationId: record.id,
  };
}

export function antigravityCardHtml(showaiIcon = antigravityIcons[0].src) {
  const sizedMark = antigravityMark
    .replace('height="1em"', 'height="24"')
    .replace('width="1em"', 'width="24"');
  const agIcon =
    "data:image/svg+xml;base64," +
    Buffer.from(sizedMark).toString("base64");
  const templateHtml = cardMarkup
    .replaceAll("__SHOWAI_ICON__", showaiIcon)
    .replaceAll("__CHATGPT_ICON__", agIcon)
    .replace('class="showai-card-app-icon is-chatgpt"', 'class="showai-card-app-icon"');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; font: 14px system-ui, sans-serif }
body { margin: 0; background: transparent }
${cardStyles}
.showai-card-error[data-kind="info"] {
  color: var(--card-muted);
}
#showai-launch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; color: var(--color-text-secondary, CanvasText); font-size: 13px }
#showai-launch[hidden] { display: none }
</style></head><body>
<section id="showai-page-card" class="showai-card-list" aria-label="ShowAI" hidden></section>
<template id="showai-card-template">${templateHtml}</template>
<section id="showai-card-spacing" class="showai-spacing-editor" hidden></section>
<div id="showai-launch" role="status"><span id="showai-message"></span></div>
<script>
(() => {
  ${cardView}
  ${cardSpacingEditor}
  const translations = ${JSON.stringify(messages.catalogs)};
  const status = document.getElementById("showai-launch");
  const message = document.getElementById("showai-message");
  const card = document.getElementById("showai-page-card");
  const cardTemplate = document.getElementById("showai-card-template");
  const spacingForm = document.getElementById("showai-card-spacing");
  let locale = navigator.language.startsWith("zh") ? "zh-CN" : "en";
  let initialized = false, serverTools = false, messageSupported = false;
  let toolPrefix = "";
  let pageCards = [], cardGroup, adjustSpacing = false, spacingEditor, openingCard = false, showBusy = false;
  let sequence = 0;
  const pending = new Map();
  const t = key => translations[locale][key];

  const cards = createShowaiCardView(card, cardTemplate, openPageCard);

  function notify(method, params) {
    parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
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

  function applyHostContext(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    if (typeof ctx.locale === "string") {
      locale = ctx.locale.startsWith("zh") ? "zh-CN" : "en";
      document.documentElement.lang = locale;
    }
    if (ctx.theme === "dark" || ctx.theme === "light") {
      document.documentElement.style.colorScheme = ctx.theme;
      document.documentElement.dataset.theme = ctx.theme;
    }
    const vars = ctx.styles?.variables;
    if (vars && typeof vars === "object") {
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v === "string") document.documentElement.style.setProperty(k, v);
      }
    }
    const opener = ctx.toolInfo?.tool?.name;
    if (typeof opener === "string" && opener.endsWith("card_present")) {
      toolPrefix = opener.slice(0, -"card_present".length);
    }
    if (pageCards.length) updateCardControls();
  }

  function resultPayload(result) {
    const envelope = result?._meta ?? result;
    return envelope?.mcp_tool_result ?? envelope?.call_tool_result ?? result;
  }

  function parseTextData(payload) {
    const firstText = Array.isArray(payload?.content)
      ? payload.content.find(c => c?.type === "text")?.text
      : undefined;
    if (typeof firstText !== "string") return undefined;
    try {
      return JSON.parse(firstText)?.data;
    } catch {
      return undefined;
    }
  }

  async function callServerTool(baseName, args) {
    const candidates = toolPrefix ? [toolPrefix + baseName, baseName] : [baseName];
    let lastError;
    for (const name of candidates) {
      try {
        const raw = await request("tools/call", { name, arguments: args });
        const payload = resultPayload(raw);
        if (payload?.isError) {
          throw new Error(payload.structuredContent?.error?.message ?? t("cannotOpenTarget"));
        }
        return (
          payload?._meta?.showaiWorkbenchData ??
          payload?.structuredContent?.data ??
          parseTextData(payload) ??
          {}
        );
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error(t("cannotOpenTarget"));
  }

  function updateCardControls() {
    if (!pageCards.length) return;
    cards.updateActions(t, {
      busy: !initialized || showBusy,
      workbench: serverTools,
      desktop: serverTools,
    });
    card.hidden = false;
    if (initialized && adjustSpacing && !spacingEditor) {
      spacingEditor = createShowaiSpacingEditor(spacingForm, card, t, {
        restore: () => null,
        save: () => {},
        submit: async prompt => {
          if (!messageSupported) return false;
          const res = await request("ui/message", {
            role: "user",
            content: [{ type: "text", text: prompt }],
          });
          return !res?.isError;
        },
      });
    }
    spacingForm.hidden = !spacingEditor || !adjustSpacing;
    reportSize();
  }

  async function openPageCard(index, destination = "panel") {
    const pageCard = pageCards[index];
    if (!initialized || !pageCard || openingCard) return;
    const { projectId, pageId, blockId } = pageCard;
    const target = { projectId, pageId, ...(blockId && { blockId }) };
    const noteNode = card.children[index]?.querySelector(".showai-card-error");
    if (noteNode) {
      noteNode.hidden = true;
      noteNode.removeAttribute("data-kind");
    }
    openingCard = true;
    const busyTimer = setTimeout(() => {
      showBusy = true;
      updateCardControls();
    }, 180);
    try {
      const targetDest = destination === "desktop" ? "desktop" : "workbench";
      const data = await callServerTool("workbench_open_destination", {
        ...target,
        destination: targetDest,
      });
      if (targetDest === "workbench" && data?.status === "queued") {
        let openedAuxPane = false;
        if (typeof data?.fileUri === "string" && data.fileUri.startsWith("file://")) {
          const opened = await request("com.google.antigravity/toggle-aux-pane", {
            tabType: "fileView",
            uri: data.fileUri,
          }).catch(() => ({ isError: true }));
          openedAuxPane = !opened?.isError;
        }
        if (!openedAuxPane && noteNode) {
          noteNode.dataset.kind = "info";
          noteNode.textContent = t("antigravityQueued");
          noteNode.hidden = false;
        }
      }
    } catch (error) {
      if (noteNode) {
        noteNode.removeAttribute("data-kind");
        noteNode.textContent = [t("cannotOpenTarget"), error.message].filter(Boolean).join(" · ");
        noteNode.hidden = false;
      }
    } finally {
      clearTimeout(busyTimer);
      openingCard = false;
      if (showBusy) {
        showBusy = false;
        updateCardControls();
      }
    }
  }

  function fromResult(result) {
    const payload = resultPayload(result);
    if (payload?.isError) {
      message.textContent = payload.structuredContent?.error?.message || t("failed");
      status.hidden = false;
      reportSize();
      return;
    }
    const meta = payload?._meta ?? payload;
    const data = payload?.structuredContent?.data ?? parseTextData(payload);
    const group = meta?.showaiCardGroup ?? (Array.isArray(data?.cards) ? data : undefined);
    const target = meta?.showaiPageCard ?? data;
    const targets = group?.cards ?? (target?.pageId ? [target] : undefined);
    if (!targets?.length) return;
    adjustSpacing = (group ?? target)?.adjustSpacing === true;
    const singleChanged =
      !group &&
      (["projectId", "pageId", "blockId", "title", "blockTitle", "description"].some(
        key => pageCards[0]?.[key] !== target?.[key],
      ) ||
        JSON.stringify(pageCards[0]?.breadcrumb) !== JSON.stringify(target?.breadcrumb));
    if (!pageCards.length || group?.id !== cardGroup || singleChanged) {
      cardGroup = group?.id;
      pageCards = targets;
      cards.render(targets);
    }
    status.hidden = true;
    updateCardControls();
  }

  const reportSize = observeShowaiCardHeight([card, spacingForm, status], () => initialized);

  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.jsonrpc !== "2.0") return;
    const msg = event.data;
    if (pending.has(msg.id)) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(waiter.timeout);
      msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
      return;
    }
    if (msg.method === "ui/notifications/tool-input" && !pageCards.length) {
      message.textContent = t("loading");
      status.hidden = false;
      reportSize();
    } else if (msg.method === "ui/notifications/tool-result") {
      fromResult(msg.params);
    } else if (msg.method === "ui/notifications/host-context-changed") {
      applyHostContext(msg.params);
    }
  });

  request("ui/initialize", {
    appInfo: { name: "ShowAI Cards", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26",
  })
    .then(result => {
      initialized = true;
      serverTools = !!result?.hostCapabilities?.serverTools;
      messageSupported = !!result?.hostCapabilities?.message;
      applyHostContext(result?.hostContext);
      notify("ui/notifications/initialized");
      if (pageCards.length) updateCardControls();
      else reportSize();
    })
    .catch(err => {
      if (!pageCards.length) {
        message.textContent = err.message;
        status.hidden = false;
      }
    });

})();
</script></body></html>`;
}

export function antigravityFileHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: light dark; font: 14px system-ui, sans-serif }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: var(--color-background-primary, Canvas); color: var(--color-text-primary, CanvasText) }
@keyframes showai-status-in { to { opacity: 1 } }
#showai-status { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 18px; font-size: 13px; color: var(--color-text-secondary, CanvasText); opacity: 0; animation: showai-status-in .16s ease .22s forwards }
#showai-status[hidden] { display: none }
#showai-frame { position: fixed; inset: 0; display: block; width: 100%; height: 100%; border: 0; opacity: 0; pointer-events: none; transition: opacity .14s ease-out }
#showai-frame[data-ready="1"] { opacity: 1; pointer-events: auto }
</style></head><body>
<div id="showai-status" role="status"><span id="showai-msg"></span></div>
<iframe id="showai-frame" title="ShowAI"></iframe>
<div id="showai-vis-probe" aria-hidden="true" style="position:fixed;left:25%;top:25%;width:50%;height:50%;pointer-events:none;z-index:2147483647"></div>
<script>
(() => {
  const translations = ${JSON.stringify(messages.catalogs)};
  const referenceLimit = ${codexPageReferenceMaxLength};
  const statusEl = document.getElementById("showai-status");
  const msgEl = document.getElementById("showai-msg");
  const frame = document.getElementById("showai-frame");
  const visProbe = document.getElementById("showai-vis-probe");
  let locale = navigator.language.startsWith("zh") ? "zh-CN" : "en";
  let initialized = false, contextSupported = false, hostTheme = "", toolPrefix = "";
  let fileInput = null, readingFile = false, mountedPage = null, frameOrigin = "", revealTimer = 0;
  let hostViewportVisible = typeof IntersectionObserver !== "function";
  let sequence = 0;
  const pending = new Map();
  const t = key => translations[locale][key];

  function revealFrame() {
    if (revealTimer) {
      clearTimeout(revealTimer);
      revealTimer = 0;
    }
    frame.dataset.ready = "1";
    statusEl.hidden = true;
  }

  function sendHostVisibility(overrideVisible) {
    if (!frameOrigin || !frame.contentWindow) return;
    const visible = typeof overrideVisible === "boolean"
      ? overrideVisible
      : hostViewportVisible &&
        document.visibilityState === "visible" &&
        window.innerWidth > 40 &&
        window.innerHeight > 40;
    frame.contentWindow.postMessage({ type: "showai:ag-host-visibility", visible }, frameOrigin);
  }

  if (typeof IntersectionObserver === "function" && visProbe) {
    const onIntersect = entries => {
      const e = entries[entries.length - 1];
      if (!e) return;
      const next =
        e.isIntersecting &&
        e.intersectionRect.width > 20 &&
        e.intersectionRect.height > 20 &&
        (typeof e.isVisible !== "boolean" || e.isVisible);
      if (next !== hostViewportVisible) {
        hostViewportVisible = next;
        sendHostVisibility();
      }
    };
    let io;
    try {
      io = new IntersectionObserver(onIntersect, {
        threshold: [0, 0.05, 0.5],
        trackVisibility: true,
        delay: 120,
      });
    } catch {
      io = new IntersectionObserver(onIntersect, { threshold: [0, 0.05, 0.5] });
    }
    io.observe(visProbe);
  }

  function request(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(t("timedOut")));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  function notify(method, params) {
    parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  function showStatus(text) {
    msgEl.textContent = text;
    statusEl.hidden = false;
  }

  function applyHostContext(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    if (typeof ctx.locale === "string") {
      locale = ctx.locale.startsWith("zh") ? "zh-CN" : "en";
      document.documentElement.lang = locale;
    }
    if (ctx.theme === "dark" || ctx.theme === "light") {
      hostTheme = ctx.theme;
      document.documentElement.style.colorScheme = ctx.theme;
      if (frameOrigin && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: "showai:ag-host-theme", theme: ctx.theme }, frameOrigin);
      }
    }
    const vars = ctx.styles?.variables;
    if (vars && typeof vars === "object") {
      for (const [k, v] of Object.entries(vars)) {
        if (typeof v === "string") document.documentElement.style.setProperty(k, v);
      }
    }
    const opener = ctx.toolInfo?.tool?.name;
    if (typeof opener === "string" && opener.endsWith("workbench_open_file")) {
      toolPrefix = opener.slice(0, -"workbench_open_file".length);
    }
  }

  function resultPayload(result) {
    const envelope = result?._meta ?? result;
    return envelope?.mcp_tool_result ?? envelope?.call_tool_result ?? result;
  }

  function parseTextData(payload) {
    const firstText = Array.isArray(payload?.content)
      ? payload.content.find(c => c?.type === "text")?.text
      : undefined;
    if (typeof firstText !== "string") return undefined;
    try {
      return JSON.parse(firstText)?.data;
    } catch {
      return undefined;
    }
  }

  async function callServerTool(baseName, args) {
    const candidates = toolPrefix ? [toolPrefix + baseName, baseName] : [baseName];
    let lastError;
    for (const name of candidates) {
      try {
        const raw = await request("tools/call", { name, arguments: args });
        const payload = resultPayload(raw);
        if (payload?.isError) {
          throw new Error(payload.structuredContent?.error?.message ?? t("unavailable"));
        }
        return payload?._meta?.showaiWorkbenchData ?? payload?.structuredContent?.data ?? parseTextData(payload) ?? {};
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error(t("unavailable"));
  }

  async function readReferenceFile(refreshOnly = false) {
    if (!initialized || !fileInput || readingFile) return;
    const currentFile = fileInput;
    readingFile = true;
    if (!mountedPage && !refreshOnly) showStatus(t("loading"));
    try {
      const response = await request("resources/read", { uri: currentFile.resourceUri });
      const content = response?.contents?.[0];
      let source = content?.text;
      if (typeof source !== "string" && typeof content?.blob === "string" &&
          content.blob.length <= Math.ceil(referenceLimit / 3) * 4) {
        const bytes = Uint8Array.from(atob(content.blob), ch => ch.charCodeAt(0));
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      if (typeof source !== "string" || !source.length || source.length > referenceLimit) {
        throw new Error(t("invalidReferenceFile"));
      }
      const resolved = await callServerTool("workbench_resolve_reference", { source });
      if (!resolved?.launchUrl || !resolved?.pageId) {
        throw new Error(t("unavailable"));
      }
      const targetUrl = new URL(resolved.launchUrl);
      frameOrigin = targetUrl.origin;
      targetUrl.searchParams.set("project", resolved.projectId);
      targetUrl.searchParams.set("page", resolved.pageId);
      if (resolved.blockId) targetUrl.searchParams.set("block", resolved.blockId);
      if (hostTheme) targetUrl.searchParams.set("theme", hostTheme);
      if (
        mountedPage &&
        mountedPage.projectId === resolved.projectId &&
        mountedPage.pageId === resolved.pageId &&
        frame.contentWindow
      ) {
        if (mountedPage.blockId !== resolved.blockId) {
          mountedPage = resolved;
          frame.contentWindow.postMessage(
            { type: "showai:ag-open-page", detail: resolved },
            frameOrigin,
          );
        }
        return;
      }
      mountedPage = resolved;
      delete frame.dataset.ready;
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = 0;
      }
      frame.onload = () => {
        if (frame.dataset.ready !== "1") {
          revealTimer = setTimeout(revealFrame, 1600);
        }
        if (hostTheme && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: "showai:ag-host-theme", theme: hostTheme }, frameOrigin);
        }
        sendHostVisibility();
      };
      frame.src = targetUrl.href;
    } catch (err) {
      if (!mountedPage) {
        statusEl.style.opacity = "1";
        statusEl.style.animation = "none";
        showStatus([t("failed"), err.message].filter(Boolean).join(" · "));
      }
    } finally {
      readingFile = false;
    }
  }

  window.addEventListener("message", async event => {
    if (event.source === frame.contentWindow && frameOrigin && event.origin === frameOrigin) {
      const data = event.data;
      if (data?.type === "showai:ag-page-ready") {
        revealFrame();
        sendHostVisibility();
        return;
      }
      if (data?.type === "showai:ag-file-reference") {
        try {
          if (!contextSupported) throw new Error(t("unavailable"));
          const content = data.reference ? [{ type: "text", text: String(data.text || "") }] : [];
          if (Array.isArray(data.components) && data.components.length) {
            content.push({
              type: "text",
              text: "Selected component preview state: " + JSON.stringify(data.components),
            });
          }
          await request("ui/update-model-context", {
            content,
            structuredContent: data.reference
              ? { showai: { reference: data.reference, ...(data.components?.length ? { components: data.components } : {}) } }
              : {},
          });
          frame.contentWindow?.postMessage({ type: "showai:ag-file-reference-ack", id: data.id }, frameOrigin);
        } catch (err) {
          frame.contentWindow?.postMessage(
            { type: "showai:ag-file-reference-ack", id: data.id, error: err.message },
            frameOrigin,
          );
        }
      }
      return;
    }
    if (event.source !== parent || event.data?.jsonrpc !== "2.0") return;
    const msg = event.data;
    if (pending.has(msg.id)) {
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(waiter.timeout);
      msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
      return;
    }
    if (msg.method === "ui/notifications/tool-input") {
      const f = msg.params?.arguments?.file;
      if (typeof f?.resourceUri === "string" && f.resourceUri) {
        fileInput = f;
        if (initialized) void readReferenceFile();
      }
    } else if (msg.method === "ui/notifications/host-context-changed") {
      applyHostContext(msg.params);
    }
  });

  document.addEventListener("visibilitychange", () => sendHostVisibility());
  window.addEventListener("resize", () => sendHostVisibility());
  window.addEventListener("pagehide", () => sendHostVisibility(false));
  window.addEventListener("focus", () => {
    sendHostVisibility();
    if (initialized && fileInput && mountedPage) void readReferenceFile(true);
  });

  showStatus(t("loading"));
  request("ui/initialize", {
    appInfo: { name: "ShowAI", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26",
  })
    .then(result => {
      initialized = true;
      contextSupported = !!result?.hostCapabilities?.updateModelContext;
      applyHostContext(result?.hostContext);
      notify("ui/notifications/initialized");
      if (fileInput) void readReferenceFile();
    })
    .catch(err => showStatus(err.message));
})();
</script></body></html>`;
}

export function antigravityWorkbenchConnection(
  service: AgentService,
  open?: OpenAntigravityWorkbench,
) {
  return {
    icons: antigravityIcons,
    configure(server: McpServer) {
      const key = randomBytes(32).toString("hex");
      let runtime: ReturnType<OpenAntigravityWorkbench> | undefined;
      let activeWorkbench:
        | Awaited<ReturnType<OpenAntigravityWorkbench>>
        | undefined;
      const ensureWorkbench = open
        ? () =>
            (runtime ??= open(key).then(
              (instance) => {
                activeWorkbench = instance;
                return instance;
              },
              (err) => {
                runtime = undefined;
                activeWorkbench = undefined;
                throw err;
              },
            ))
        : undefined;

      const closeRuntime = () => {
        activeWorkbench = undefined;
        void runtime?.then(
          (instance) => instance.close(),
          () => undefined,
        );
      };
      const prevClose = server.server.onclose;
      server.server.onclose = () => {
        prevClose?.();
        closeRuntime();
      };
      process.stdin.once("end", closeRuntime);

      async function workbenchLaunchUrl() {
        if (!ensureWorkbench) return undefined;
        const { url } = await ensureWorkbench();
        const target = new URL(url);
        target.searchParams.set("agWorkbench", key);
        return { origin: target.origin, launchUrl: target.href };
      }

      const mimeType = "text/html;profile=mcp-app";
      for (const [name, uri] of [
        ["antigravity_page_card", antigravityCardUri],
        ["antigravity_page_card_v1", "ui://showai/antigravity-card-v1.html"],
      ]) server.registerResource(
        name,
        uri,
        { mimeType },
        async () => ({
          contents: [
            {
              uri,
              mimeType,
              text: antigravityCardHtml(antigravityIcons[0].src),
              _meta: {
                "openai/widgetMinFrameHeight": 0,
                ui: {
                  prefersBorder: false,
                },
              },
            },
          ],
        }),
      );

      server.registerResource(
        "antigravity_file_viewer",
        antigravityFileUri,
        { mimeType },
        async () => {
          const wb = await workbenchLaunchUrl();
          return {
            contents: [
              {
                uri: antigravityFileUri,
                mimeType,
                text: antigravityFileHtml(),
                _meta: {
                  ui: {
                    ...(wb ? { csp: { frameDomains: [wb.origin] } } : {}),
                    prefersBorder: false,
                  },
                },
              },
            ],
          };
        },
      );

      server.registerTool(
        "workbench_open_file",
        {
          title: "ShowAI",
          description: "Open the original Page linked by a ShowAI reference file.",
          inputSchema: {
            file: z.object({
              name: z.string().min(1),
              resourceUri: z.string().min(1),
            }),
          },
          annotations: readOnly,
          _meta: {
            ui: { resourceUri: antigravityFileUri, visibility: ["app"] },
            "com.google.antigravity/ui": {
              entrypoints: [
                {
                  type: "file",
                  title: "ShowAI",
                  extensions: [codexPageReferenceExtension],
                },
              ],
            },
          },
        },
        async () => {
          try {
            const wb = await workbenchLaunchUrl();
            const data = { status: "ready" as const, ...(wb ?? {}) };
            return {
              ...mcpSuccess(data),
              _meta: { showaiWorkbenchData: data },
            };
          } catch (error) {
            return mcpFailure(error);
          }
        },
      );

      server.registerTool(
        "workbench_resolve_reference",
        {
          description:
            "Verify a ShowAI reference file read through Antigravity and locate its saved Page.",
          inputSchema: {
            source: z.string().min(1).max(codexPageReferenceMaxLength),
          },
          annotations: readOnly,
          _meta: appOnly,
        },
        async ({ source }) => {
          try {
            const page = await resolveCodexPageReference(service, source);
            const wb = await workbenchLaunchUrl();
            const data = { ...page, ...(wb ? { launchUrl: wb.launchUrl } : {}) };
            return {
              ...mcpSuccess(data),
              _meta: { showaiWorkbenchData: data },
            };
          } catch (error) {
            return mcpFailure(error);
          }
        },
      );

      async function presentCards(
        targets: CodexCardTarget[],
        adjustSpacing = false,
      ) {
        try {
          const cards = await readCodexPageCards(service, targets);
          const presentation =
            cards.length === 1 ? cards[0] : { id: randomUUID(), cards };
          const data = adjustSpacing
            ? { ...presentation, adjustSpacing: true }
            : presentation;
          return {
            ...mcpSuccess(data),
            _meta: {
              [cards.length === 1 ? "showaiPageCard" : "showaiCardGroup"]: data,
            },
          };
        } catch (error) {
          return mcpFailure(error);
        }
      }

      server.registerTool(
        "card_present",
        {
          title: "Show saved ShowAI cards",
          description:
            "Deliver saved ShowAI Pages or components as interactive cards in the conversation after creating or editing them, or when the user asks for a saved page card. Optionally pass blockId from page_read to point to a specific component and description to summarize contents or edits. Put remaining targets in additionalTargets to deliver multiple cards together.",
          inputSchema: {
            ...codexCardTarget,
            additionalTargets: z.array(z.object(codexCardTarget)).optional(),
            adjustSpacing: z
              .boolean()
              .optional()
              .describe(
                "Show live spacing controls only when the user wants to tune the card layout.",
              ),
          },
          annotations: readOnly,
          _meta: {
            ui: {
              resourceUri: antigravityCardUri,
              visibility: ["model", "app"],
            },
          },
        },
        ({ additionalTargets = [], adjustSpacing, ...first }) =>
          presentCards([first, ...additionalTargets], adjustSpacing),
      );

      async function navigateTarget(target: CodexPageTarget) {
        const nav = await writeAntigravityNavTarget(service.store.root, target);
        if (
          nav.status === "queued" &&
          activeWorkbench?.navigateAntigravityTab?.(target)
        ) {
          return { ...nav, status: "accepted" as const };
        }
        return nav;
      }

      server.registerTool(
        "card_navigate",
        {
          title: "Navigate the ShowAI workbench",
          description:
            "Jump the right-pane ShowAI workbench to a saved Page or component blockId. Returns status accepted when an open workbench received the jump immediately, or queued with sidecarUrl when the side pane is closed.",
          inputSchema: codexPageTarget,
          annotations: readOnly,
          _meta: { ui: { visibility: ["model", "app"] } },
        },
        async (target) => {
          try {
            await readCodexPageTarget(service, target);
            const result = await navigateTarget(target);
            return mcpSuccess(result);
          } catch (error) {
            return mcpFailure(error);
          }
        },
      );

      server.registerTool(
        "workbench_open_destination",
        {
          title: "Open a ShowAI page",
          description:
            "Open the selected saved Page or component in the Antigravity sidecar workbench or the ShowAI desktop app.",
          inputSchema: {
            ...codexPageTarget,
            destination: z.enum(["workbench", "desktop"]),
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: true,
          },
          _meta: appOnly,
        },
        async ({ destination, ...target }) => {
          try {
            await readCodexPageTarget(service, target);
            if (destination === "workbench") {
              const nav = await navigateTarget(target);
              if (nav.status === "queued") {
                const tabRef = await writeAntigravityTabReference(service, target);
                const wb = await workbenchLaunchUrl();
                const enriched = {
                  ...nav,
                  fileUri: tabRef.fileUri,
                  ...(wb ? { launchUrl: wb.launchUrl } : {}),
                };
                return {
                  ...mcpSuccess(enriched),
                  _meta: { showaiWorkbenchData: enriched },
                };
              }
              return {
                ...mcpSuccess(nav),
                _meta: { showaiWorkbenchData: nav },
              };
            }
            const url = pageLink({
              ...target,
              blockIds: target.blockId ? [target.blockId] : [],
            });
            await openSystemUrl(url);
            const opened = { status: "opened" as const, url };
            return {
              ...mcpSuccess(opened),
              _meta: { showaiWorkbenchData: opened },
            };
          } catch (error) {
            return mcpFailure(error);
          }
        },
      );
    },
  };
}
