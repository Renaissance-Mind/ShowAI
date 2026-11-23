import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import { pageLink } from "../document/page-link.mjs";
import { openSystemUrl } from "../host/local-system";
import { openDesktopPage } from "./desktop-page";
import { getLocale, translator } from "../i18n";
import messages from "../i18n/messages/codex-workbench";
import cardStyles from "./codex-workbench-card.css?raw";
import {
  codexCardTarget,
  codexPageTarget,
  type CodexPageTarget,
  readCodexPageCards,
  readCodexPageTarget,
  writeCodexPageReference,
} from "./codex-page-reference";
import { codexWorkbenchHtml } from "./codex-workbench-ui";
import { hostDisplay, mcpFailure, mcpSuccess } from "./presentation-tools";
import type { AgentService } from "./service";

const cardUri = "ui://showai/saved-page-card-v5.html";
const mimeType = "text/html;profile=mcp-app";
const icon = "data:image/svg+xml;base64," + Buffer.from(lightLogo).toString("base64");
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const escapeHtml = (value: string) => value.replace(
  /[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
);

function editorUrl(base: string, target?: CodexPageTarget, t3 = false) {
  const url = new URL(base);
  if (t3) url.hostname = "localhost";
  if (target) {
    url.searchParams.set("project", target.projectId);
    url.searchParams.set("page", target.pageId);
    if (target.blockId) url.searchParams.set("blocks", target.blockId);
    if (t3) url.searchParams.set("t3Page", "1");
  }
  return url;
}

function browserDestination(url: URL, t3: boolean) {
  if (!t3) return { url: url.href };
  return {
    url: url.href,
    previewTarget: {
      kind: "environment-port" as const,
      protocol: "http" as const,
      port: Number(url.port || 80),
      path: url.pathname + url.search + url.hash,
    },
    next: "In T3 Code, use preview_status to find this Page's existing Browser tab. Open previewTarget with preview_open, reusing that tabId or setting reuseExistingTab:false for a new Page.",
  };
}

export function registerBrowserWorkbenchTools(
  server: McpServer,
  service: AgentService,
  open: () => Promise<{ url: string }>,
) {
  const surface = z.literal("t3-code").optional().describe("Return a T3 Code Browser target for the thread's environment.");
  server.registerTool("workbench_page_url", {
    title: "Get an editable ShowAI page URL",
    description: "Open the original Page or Board in the host's browser pane when asked. Use surface=t3-code for T3 Code.",
    inputSchema: { ...codexPageTarget, surface },
    annotations: readOnly,
    _meta: { ui: { visibility: ["model", "app"] } },
  }, async ({ surface, ...target }) => {
    try {
      await readCodexPageTarget(service, target);
      const t3 = surface === "t3-code";
      const url = editorUrl((await open()).url, target, t3);
      const data = { ...target, ...browserDestination(url, t3) };
      return { ...mcpSuccess(data), _meta: { showaiWorkbenchData: data } };
    } catch (error) {
      return mcpFailure(error);
    }
  });
  server.registerTool("workbench_url", {
    title: "Get the local ShowAI workbench URL",
    description: "Open the connected project library when asked. Use surface=t3-code for the T3 Code Browser.",
    inputSchema: { surface }, annotations: readOnly,
  }, async ({ surface }) => {
    try {
      const t3 = surface === "t3-code";
      return mcpSuccess(browserDestination(editorUrl((await open()).url, undefined, t3), t3));
    } catch (error) {
      return mcpFailure(error);
    }
  });
}

async function cardFiles(
  root: string,
  cards: Awaited<ReturnType<typeof readCodexPageCards>>,
  display: "fragment-file" | "model-html" | "t3-html",
) {
  const locale = getLocale();
  const t = translator(messages);
  const label = t("cardDesktopPrimary");
  const rows = cards.map(card => {
    const href = escapeHtml(pageLink({ ...card, blockIds: card.blockId ? [card.blockId] : [] }));
    const detail = card.description || card.blockTitle;
    const linkField = display === "t3-html"
      ? `<label class="showai-card-app-link">${escapeHtml(t("desktopPageLink"))}<input readonly value="${href}" onfocus="this.select()" onclick="this.select()"></label>`
      : "";
    return `<article class="showai-card"><span class="showai-card-icon" aria-hidden="true"><img src="${icon}" alt=""></span>
      <div class="showai-card-content"><h2 class="showai-card-title">${escapeHtml(card.title)}</h2>
      <p class="showai-card-path">${escapeHtml(card.breadcrumb.join(" / "))}</p>
      ${detail ? `<p class="showai-card-body">${escapeHtml(detail)}</p>` : ""}${linkField}</div>
      ${linkField ? "" : `<div class="showai-card-actions"><a class="showai-card-open" href="${href}" aria-label="${escapeHtml(label + " · " + card.title)}">${escapeHtml(label)}</a></div>`}</article>`;
  }).join("\n");
  const fragment = `<style>${cardStyles}</style><section class="showai-card-list" aria-label="ShowAI">${rows}</section>`;
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "page-cards-"));
  const html = join(dir, "cards.html");
  await writeFile(html, `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>ShowAI</title>
    <style>html { color-scheme: light dark; font: 14px system-ui } body { margin: 8px }</style>
    </head><body>${fragment}</body></html>`, { flag: "wx", mode: 0o600 });
  return {
    delivery: display === "model-html"
      ? { mode: display, html, ...(Buffer.byteLength(fragment) <= 32 * 1024 && { compact: fragment }) }
      : display === "t3-html" ? { mode: display, path: html, next: "Use html_preview then html_render once. This HTML card has a selectable ShowAI app link. If the person asks to open the page on this computer, use workbench_open_destination with destination desktop when available." }
      : { mode: display, html, inline: html },
    display: { reader: "bundled" },
  };
}

export function linkedWorkbenchConnection(
  service: AgentService,
  open: () => Promise<{ url: string }>,
  presentationDirectory?: string,
) {
  const cursorEditor = process.env.SHOWAI_CURSOR_WORKBENCH_LINK === "1";
  const display = hostDisplay();
  const fileCards = display === "fragment-file" || display === "model-html" || display === "t3-html" ? display : undefined;
  return {
    configure(server: McpServer) {
      registerBrowserWorkbenchTools(server, service, open);
      if (!fileCards) for (const [name, uri] of [
        ["saved_page_card", cardUri],
        ["saved_page_card_v4", "ui://showai/saved-page-card-v4.html"],
        ["saved_page_card_v3", "ui://showai/saved-page-card-v3.html"],
        ["saved_page_card_v2", "ui://showai/saved-page-card-v2.html"],
        ["saved_page_card_v1", "ui://showai/saved-page-card-v1.html"],
      ]) {
        server.registerResource(name, uri, { mimeType }, async () => ({
          contents: [{
            uri,
            mimeType,
            text: codexWorkbenchHtml("thread", "card", icon, cursorEditor, "linked"),
            _meta: { ui: { prefersBorder: false, permissions: { clipboardWrite: {} } } },
          }],
        }));
      }

      server.registerTool("card_present", {
        title: "Show saved ShowAI cards",
        description: "Deliver the original Page as a clickable card after saving it, or when the user asks for a saved target. Use blockId to link a specific component and additionalTargets for other Pages.",
        inputSchema: {
          ...codexCardTarget,
          additionalTargets: z.array(z.object(codexCardTarget)).optional(),
          delivery: z.literal("t3-html").optional(),
          openIn: z.literal("desktop").optional().describe("Open the original in the local ShowAI desktop app when the user clicks an MCP App card."),
        },
        annotations: readOnly,
        ...(!fileCards && { _meta: { ui: { resourceUri: cardUri, visibility: ["model", "app"] } } }),
      }, async ({ additionalTargets = [], delivery, openIn, ...first }) => {
        try {
          const cards = await readCodexPageCards(service, [first, ...additionalTargets]);
          const data = cards.length === 1 ? cards[0] : { id: randomUUID(), cards };
          const targets = cards.map(card => ({
            projectId: card.projectId,
            pageId: card.pageId,
            title: card.title,
            openUrl: pageLink({ ...card, blockIds: card.blockId ? [card.blockId] : [] }),
          }));
          const fileMode = delivery ?? fileCards;
          if (fileMode) {
            const output = await cardFiles(
              presentationDirectory ?? join(service.store.root, "local", "presentations"),
              cards,
              fileMode,
            );
            return mcpSuccess({ ...data, ...output, targets });
          }
          const desktop = openIn === "desktop" || process.env.SHOWAI_CARD_DESTINATION === "desktop" || !!process.env.T3CODE_THREAD_ID;
          const browser = desktop ? undefined : await open().catch(error => {
            console.error("ShowAI browser workbench:", error);
            return undefined;
          });
          const attachments = browser ? cards.map(card => ({ ...card, editorUrl: editorUrl(browser.url, card).href })) : cards;
          return {
            ...mcpSuccess({ ...data, targets }),
            _meta: {
              ...(cards.length === 1 ? { showaiPageCard: attachments[0] } : { showaiCardGroup: { ...data, cards: attachments } }),
              ...(desktop && { showaiCardDestination: "desktop" }),
            },
          };
        } catch (error) {
          return mcpFailure(error);
        }
      });

      if (cursorEditor || process.env.SHOWAI_LOCAL_PAGE_REFERENCES === "1") server.registerTool("workbench_page_reference", {
        title: "Create a ShowAI page reference file",
        description: "Return a .showai-ref file that opens the original Page in the installed ShowAI IDE workbench.",
        inputSchema: codexPageTarget,
        annotations: readOnly,
      }, async target => {
        try {
          const { file, ...reference } = await writeCodexPageReference(service, presentationDirectory, target);
          const result = mcpSuccess(reference);
          return { ...result, content: [...result.content, file] };
        } catch (error) {
          return mcpFailure(error);
        }
      });

      if (!fileCards || fileCards === "t3-html") server.registerTool("workbench_open_destination", {
        description: fileCards === "t3-html"
          ? "Open the saved Page or Board in the ShowAI desktop app on this computer only when the person asks. Use the target from the card."
          : "Open the selected Page in the local ShowAI App from a card action.",
        inputSchema: { ...codexPageTarget, destination: fileCards === "t3-html" ? z.literal("desktop") : z.enum(["desktop", "workbench"]) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        _meta: { ui: { visibility: fileCards === "t3-html" ? ["model"] : ["app"] } },
      }, async ({ destination, ...target }) => {
        try {
          await readCodexPageTarget(service, target);
          let url: string;
          if (destination === "workbench") {
            if (!cursorEditor) throw new Error("This host does not have a registered ShowAI workbench.");
            const query = new URLSearchParams({ projectId: target.projectId, pageId: target.pageId });
            if (target.blockId) query.set("blockId", target.blockId);
            url = "cursor://renaissancemind.showai-workbench/page?" + query;
            await openSystemUrl(url);
          } else url = await openDesktopPage(service.store.root, target);
          const result = fileCards === "t3-html"
            ? mcpSuccess({ ...target, openUrl: url, dispatched: true })
            : { content: [] };
          return { ...result, _meta: { showaiWorkbenchData: { url } } };
        } catch (error) {
          return mcpFailure(error);
        }
      });
    },
  };
}
