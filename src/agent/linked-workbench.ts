import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import { pageLink } from "../document/page-link.mjs";
import { openSystemUrl } from "../host/local-system";
import { getLocale, translator } from "../i18n";
import messages from "../i18n/messages/codex-workbench";
import cardStyles from "./codex-workbench-card.css?raw";
import {
  codexCardTarget,
  codexPageTarget,
  readCodexPageCards,
  readCodexPageTarget,
  writeCodexPageReference,
} from "./codex-page-reference";
import { codexWorkbenchHtml } from "./codex-workbench-ui";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import type { AgentService } from "./service";

const cardUri = "ui://showai/saved-page-card-v2.html";
const mimeType = "text/html;profile=mcp-app";
const icon = "data:image/svg+xml;base64," + Buffer.from(lightLogo).toString("base64");
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const escapeHtml = (value: string) => value.replace(
  /[&<>"']/g,
  character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
);

async function cardFiles(
  root: string,
  cards: Awaited<ReturnType<typeof readCodexPageCards>>,
  display: "fragment-file" | "model-html",
) {
  const locale = getLocale();
  const label = translator(messages)("cardDesktop");
  const rows = cards.map(card => {
    const href = pageLink({ ...card, blockIds: card.blockId ? [card.blockId] : [] });
    const detail = card.description || card.blockTitle;
    return `<article class="showai-card"><span class="showai-card-icon" aria-hidden="true"><img src="${icon}" alt=""></span>
      <div class="showai-card-content"><h2 class="showai-card-title">${escapeHtml(card.title)}</h2>
      <p class="showai-card-path">${escapeHtml(card.breadcrumb.join(" / "))}</p>
      ${detail ? `<p class="showai-card-body">${escapeHtml(detail)}</p>` : ""}</div>
      <a class="showai-card-open" href="${escapeHtml(href)}" aria-label="${escapeHtml(label + " · " + card.title)}" title="${escapeHtml(label)}"></a></article>`;
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
  const display = process.env.SHOWAI_HOST_DISPLAY;
  const fileCards = display === "fragment-file" || display === "model-html" ? display : undefined;
  return {
    configure(server: McpServer) {
      function pageUrl(base: string, target: { projectId: string; pageId: string; blockId?: string }) {
        const url = new URL(base);
        url.searchParams.set("project", target.projectId);
        url.searchParams.set("page", target.pageId);
        if (target.blockId) url.searchParams.set("blocks", target.blockId);
        return url.href;
      }
      if (!fileCards) for (const [name, uri] of [
        ["saved_page_card", cardUri],
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
        inputSchema: { ...codexCardTarget, additionalTargets: z.array(z.object(codexCardTarget)).optional() },
        annotations: readOnly,
        ...(!fileCards && { _meta: { ui: { resourceUri: cardUri, visibility: ["model", "app"] } } }),
      }, async ({ additionalTargets = [], ...first }) => {
        try {
          const cards = await readCodexPageCards(service, [first, ...additionalTargets]);
          const data = cards.length === 1 ? cards[0] : { id: randomUUID(), cards };
          const targets = cards.map(card => ({
            projectId: card.projectId,
            pageId: card.pageId,
            title: card.title,
            openUrl: pageLink({ ...card, blockIds: card.blockId ? [card.blockId] : [] }),
          }));
          if (fileCards) {
            const output = await cardFiles(
              presentationDirectory ?? join(service.store.root, "local", "presentations"),
              cards,
              fileCards,
            );
            return mcpSuccess({ ...data, ...output, targets });
          }
          const browser = await open().catch(error => {
            console.error("ShowAI browser workbench:", error);
            return undefined;
          });
          const attachments = browser ? cards.map(card => ({ ...card, editorUrl: pageUrl(browser.url, card) })) : cards;
          return {
            ...mcpSuccess({ ...data, targets }),
            _meta: cards.length === 1
              ? { showaiPageCard: attachments[0] }
              : { showaiCardGroup: { ...data, cards: attachments } },
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

      server.registerTool("workbench_page_url", {
        title: "Get an editable ShowAI page URL",
        description: "Get a local URL for a saved Page or Board to open in this host's browser pane. It edits the original Page in the connected library. Use only when the user asks to open the editor.",
        inputSchema: codexPageTarget,
        annotations: readOnly,
        _meta: { ui: { visibility: ["model", "app"] } },
      }, async target => {
        try {
          await readCodexPageTarget(service, target);
          const data = { ...target, url: pageUrl((await open()).url, target) };
          return { ...mcpSuccess(data), _meta: { showaiWorkbenchData: data } };
        } catch (error) {
          return mcpFailure(error);
        }
      });

      server.registerTool("workbench_url", {
        title: "Get the local ShowAI workbench URL",
        description: "Open the project library in this host's browser or the system browser when the user asks for the ShowAI workbench.",
        inputSchema: {},
        annotations: readOnly,
      }, async () => {
        try {
          return mcpSuccess({ url: (await open()).url });
        } catch (error) {
          return mcpFailure(error);
        }
      });

      if (!fileCards) server.registerTool("workbench_open_destination", {
        description: "Open the selected Page in the local ShowAI App from a card action.",
        inputSchema: { ...codexPageTarget, destination: z.enum(["desktop", "workbench"]) },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        _meta: { ui: { visibility: ["app"] } },
      }, async ({ destination, ...target }) => {
        try {
          await readCodexPageTarget(service, target);
          let url = pageLink({ ...target, blockIds: target.blockId ? [target.blockId] : [] });
          if (destination === "workbench") {
            if (!cursorEditor) throw new Error("This host does not have a registered ShowAI workbench.");
            const query = new URLSearchParams({ projectId: target.projectId, pageId: target.pageId });
            if (target.blockId) query.set("blockId", target.blockId);
            url = "cursor://renaissancemind.showai-workbench/page?" + query;
          }
          await openSystemUrl(url);
          return { content: [], _meta: { showaiWorkbenchData: { url } } };
        } catch (error) {
          return mcpFailure(error);
        }
      });
    },
  };
}
