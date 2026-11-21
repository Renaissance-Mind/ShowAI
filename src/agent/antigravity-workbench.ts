import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import darkLogo from "../../plugins/showai/assets/logo-dark.svg?raw";
import antigravityMark from "../studio/assets/agent-brands/antigravity.svg?raw";
import messages from "../i18n/messages/codex-workbench";
import { openSystemUrl } from "../host/local-system";
import { pageLink } from "../document/page-link.mjs";
import type { AgentService } from "./service";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import {
  codexCardTarget,
  codexPageTarget,
  readCodexPageCards,
  readCodexPageTarget,
  type CodexCardTarget,
  type CodexPageTarget,
} from "./codex-page-reference";
import cardStyles from "./codex-workbench-card.css?raw";
import cardMarkup from "./codex-workbench-card.html?raw";
import cardView from "./codex-workbench-card-view.js?raw";
import cardSpacingEditor from "./codex-workbench-card-spacing.js?raw";

export const antigravityCardUri = "ui://showai/antigravity-card-v1.html";
const NAV_FILE = "antigravity-workbench-nav.json";
const STATE_FILE = "antigravity-workbench-state.json";
const ACTIVE_STATE_MAX_AGE_MS = 15_000;

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
      openClients?: unknown;
      updatedAt?: unknown;
    };
    return (
      typeof parsed?.openClients === "number" &&
      parsed.openClients > 0 &&
      typeof parsed?.updatedAt === "number" &&
      Date.now() - parsed.updatedAt <= ACTIVE_STATE_MAX_AGE_MS
    );
  } catch {
    return false;
  }
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
  let pageCards = [], cardGroup, adjustSpacing = false, spacingEditor, openingCard = false;
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
      busy: !initialized || openingCard,
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
    updateCardControls();
    try {
      const targetDest = destination === "desktop" ? "desktop" : "workbench";
      const data = await callServerTool("workbench_open_destination", {
        ...target,
        destination: targetDest,
      });
      if (targetDest === "workbench" && data?.status === "queued" && noteNode) {
        noteNode.dataset.kind = "info";
        noteNode.textContent = t("antigravityQueued");
        noteNode.hidden = false;
      }
    } catch (error) {
      if (noteNode) {
        noteNode.removeAttribute("data-kind");
        noteNode.textContent = [t("cannotOpenTarget"), error.message].filter(Boolean).join(" · ");
        noteNode.hidden = false;
      }
    } finally {
      openingCard = false;
      updateCardControls();
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

  let lastHeight = 0;
  function reportSize() {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height > 0 && height !== lastHeight) {
      lastHeight = height;
      notify("ui/notifications/size-changed", { height });
    }
  }

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
    })
    .catch(err => {
      if (!pageCards.length) {
        message.textContent = err.message;
        status.hidden = false;
      }
    });

  const ro = new ResizeObserver(reportSize);
  ro.observe(document.body);
  ro.observe(card);
  new MutationObserver(reportSize).observe(card, {
    attributes: true,
    attributeFilter: ["style", "hidden"],
  });
})();
</script></body></html>`;
}

export function antigravityWorkbenchConnection(service: AgentService) {
  return {
    icons: antigravityIcons,
    configure(server: McpServer) {
      const mimeType = "text/html;profile=mcp-app";
      server.registerResource(
        "antigravity_page_card",
        antigravityCardUri,
        { mimeType },
        async () => ({
          contents: [
            {
              uri: antigravityCardUri,
              mimeType,
              text: antigravityCardHtml(antigravityIcons[0].src),
              _meta: {
                ui: {
                  prefersBorder: false,
                },
              },
            },
          ],
        }),
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
            const result = await writeAntigravityNavTarget(
              service.store.root,
              target,
            );
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
              const nav = await writeAntigravityNavTarget(
                service.store.root,
                target,
              );
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
