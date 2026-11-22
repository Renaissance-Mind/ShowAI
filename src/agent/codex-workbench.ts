import { randomBytes, randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CAPACITY } from "../portable/capacity.mjs";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import darkLogo from "../../plugins/showai/assets/logo-dark.svg?raw";
import { workbenchRoutes, type CodexWorkbenchTransport } from "../host/codex-workbench-transport";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import { openSystemUrl } from "../host/local-system";
import { pageLink } from "../document/page-link.mjs";
import type { AgentService } from "./service";
import {
  codexPageIdentity,
  codexPageTarget,
  codexCardTarget,
  codexWorkbenchPageLink,
  type CodexCardTarget,
  codexPageReferenceExtension,
  codexPageReferenceMaxLength,
  resolveCodexPageReference,
  readCodexPageCards,
  readCodexPageTarget,
  writeCodexPageReference,
} from "./codex-page-reference";
import { CodexWorkbenchNavigation } from "./codex-workbench-navigation";
import {
  codexWorkbenchHtml,
  codexWorkbenchUri,
  codexWorkbenchFileUri,
  codexWorkbenchCardUri,
  previousWorkbenchCardUri,
  codexWorkbenchTargetUri,
  codexWorkbenchThreadUri,
  type CodexWorkbenchMode,
} from "./codex-workbench-ui";

type OpenCodexWorkbench = (key: string) => Promise<{
  url: string;
  localUrl: string;
  transport: CodexWorkbenchTransport;
  close(): Promise<void>;
}>;

const legacyWorkbenchUri = "ui://showai/workbench.html";
const codexWorkbenchIcons = ([
  ["light", lightLogo],
  ["dark", darkLogo],
] as const).map(([theme, svg]) => ({
  src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
  theme,
}));
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const appOnly = { ui: { visibility: ["app"] } };
const clientId = z.string().regex(/^[\w-]{1,100}$/);
const globalWorkbenchTool = "workbench_open_global";

export function codexWorkbenchConnection(
  open: OpenCodexWorkbench,
  service: AgentService,
  presentationDirectory?: string,
  host: "codex" | "qoder" | "cursor" = "codex",
) {
  return {
    icons: codexWorkbenchIcons,
    configure(server: McpServer) {
      registerCodexWorkbench(server, open, service, presentationDirectory, host);
      process.stdin.once("end", () =>
        void server.close().catch((error) => console.error("ShowAI MCP shutdown:", error)),
      );
    },
  };
}

function registerCodexWorkbench(
  server: McpServer,
  open: OpenCodexWorkbench,
  service: AgentService,
  presentationDirectory?: string,
  host: "codex" | "qoder" | "cursor" = "codex",
) {
  const qoder = host === "qoder";
  const key = randomBytes(32).toString("hex");
  const navigation = new CodexWorkbenchNavigation(key, qoder);
  // Cached v1–v6 card views use this choice when the host remounts them in fullscreen.
  const cardChoices = new Map<string, { index: number; expires: number }>();
  const uploads = new Map<string, {
    parts: string[];
    length: number;
    total: number;
    expires: number;
    result?: Promise<unknown>;
    completed?: boolean;
  }>();
  const responses = new Map<string, { text: string; expires: number }>();
  const transferLifetime = 5 * 60_000;
  function expireTransfers() {
    const now = Date.now();
    for (const [id, upload] of uploads) if (upload.expires <= now) uploads.delete(id);
    for (const [id, response] of responses) if (response.expires <= now) responses.delete(id);
  }
  const plugin = /^([\w-]+)@([\w-]+)$/.exec(process.env.SHOWAI_CODEX_PLUGIN_ID ?? "");
  // A test installation can coexist with the stable file handler. Keep the
  // side tab on the same MCP connection as its inline navigation controls.
  const panelExtension = plugin?.[1].startsWith("showai-workbench-test")
    ? "." + plugin[1].replace("showai-workbench-", "showai-") + "-ref"
    : codexPageReferenceExtension;
  const fileExtensions = [...new Set([codexPageReferenceExtension, panelExtension])];
  const globalEntrypoint = plugin
    ? `codex://plugins/${encodeURIComponent(plugin[1])}@${encodeURIComponent(plugin[2])}/app/${globalWorkbenchTool}`
    : undefined;
  let runtime: ReturnType<OpenCodexWorkbench> | undefined;
  const workbench = () => (runtime ??= open(key).catch((error) => {
    runtime = undefined;
    throw error;
  }));

  const onClose = server.server.onclose;
  server.server.onclose = () => {
    onClose?.();
    void runtime?.then((instance) => instance.close(), () => undefined)
      .catch((error) => console.error("ShowAI workbench shutdown:", error));
  };

  const views = [
    { mode: "global", name: globalWorkbenchTool, uri: codexWorkbenchUri, title: "ShowAI Workbench" },
    { mode: "thread", name: "workbench_open_page", uri: codexWorkbenchThreadUri, title: "ShowAI" },
  ] as const;
  const resources = [
    ...views,
    { mode: "thread", name: "workbench_file", uri: codexWorkbenchFileUri, entrypoint: "file" },
    { mode: "thread", name: "workbench_page_card", uri: codexWorkbenchCardUri, entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v10", uri: previousWorkbenchCardUri, entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v9", uri: "ui://showai/workbench-card-v9.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v8", uri: "ui://showai/workbench-card-v8.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v7", uri: "ui://showai/workbench-card-v7.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v6", uri: "ui://showai/workbench-card-v6.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v5", uri: "ui://showai/workbench-card-v5.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v4", uri: "ui://showai/workbench-card-v4.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_target", uri: codexWorkbenchTargetUri, entrypoint: "open" },
    { mode: "thread", name: "workbench_page_target_v2", uri: "ui://showai/workbench-target-v2.html", entrypoint: "open" },
    { mode: "thread", name: "workbench_page_target_v1", uri: "ui://showai/workbench-target-v1.html", entrypoint: "open" },
    { mode: "thread", name: "workbench_page_card_v3", uri: "ui://showai/workbench-card-v3.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v2", uri: "ui://showai/workbench-card-v2.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_page_card_v1", uri: "ui://showai/workbench-card-v1.html", entrypoint: "card" },
    { mode: "thread", name: "workbench_thread_v4", uri: "ui://showai/workbench-thread-v4.html" },
    { mode: "thread", name: "workbench_thread_v3", uri: "ui://showai/workbench-thread-v3.html" },
    { mode: "thread", name: "workbench_file_v2", uri: "ui://showai/workbench-file-v2.html", entrypoint: "file" },
    { mode: "thread", name: "workbench_file_v1", uri: "ui://showai/workbench-file-v1.html", entrypoint: "file" },
    { mode: undefined, name: "workbench_legacy", uri: legacyWorkbenchUri },
    { mode: "global", name: "workbench_global_v2", uri: "ui://showai/workbench-v2.html" },
    { mode: "thread", name: "workbench_thread_v2", uri: "ui://showai/workbench-thread-v2.html" },
  ] as const;
  const mimeType = "text/html;profile=mcp-app";
  for (const resource of resources) {
    const { mode, name, uri } = resource;
    const entrypoint = "entrypoint" in resource ? resource.entrypoint : undefined;
    server.registerResource(name, uri, { mimeType }, async () => {
      return {
        contents: [{
          uri,
          mimeType,
          text: codexWorkbenchHtml(mode, entrypoint, codexWorkbenchIcons[0].src, !!globalEntrypoint, host),
          _meta: {
            ui: {
              ...(!qoder && { csp: {
                resourceDomains: ["blob:", "data:"],
                frameDomains: ["blob:", "data:"],
              } }),
              prefersBorder: false,
              permissions: { clipboardWrite: {} },
            },
            ...(entrypoint === "card" || entrypoint === "open" ? {
              "openai/widgetMinFrameHeight": 0,
              "openai/ui": { availableDisplayModes: entrypoint === "open" ? ["inline", "fullscreen"] : ["inline"], preferredDisplayMode: entrypoint === "open" ? "fullscreen" : "inline" },
            } : {}),
            ...(qoder ? {
              "qoder/ui": {
                availableDisplayModes: entrypoint === "card" ? ["inline"] : ["fullscreen"],
                preferredDisplayMode: entrypoint === "card" ? "inline" : "fullscreen",
              },
            } : {}),
          },
        }],
      };
    });
  }

  async function launch(mode: CodexWorkbenchMode, meta?: Record<string, unknown>) {
    try {
      const { url, transport } = await workbench();
      const target = new URL(url);
      target.searchParams.set("codexWorkbench", key);
      target.searchParams.set("codexMode", mode);
      return {
        content: [{ type: "text" as const, text: "ShowAI workbench" }],
        _meta: { showaiWorkbench: { url: target.href, bundle: await transport.bundle(), scope: navigation.scope(meta) } },
      };
    } catch (error) {
      return mcpFailure(error);
    }
  }

  for (const { mode, name, uri, title } of views) {
    server.registerTool(name, {
      title,
      description: mode === "global"
        ? "Open the ShowAI project workbench."
        : "Open the ShowAI editor next to this chat.",
      inputSchema: {},
      annotations: readOnly,
      _meta: {
        ui: { resourceUri: uri, visibility: ["app"] },
        [qoder ? "qoder/ui" : "openai/ui"]: { entrypoints: [{ type: mode }] },
      },
    }, (_, extra) => launch(mode, extra._meta));
  }

  if (!qoder) server.registerTool("workbench_open_file", {
    title: "ShowAI",
    description: "Open the original Page linked by a ShowAI reference file.",
    inputSchema: {
      file: z.object({ name: z.string().min(1), resourceUri: z.string().min(1) }),
    },
    annotations: readOnly,
    _meta: {
      ui: { resourceUri: codexWorkbenchFileUri, visibility: ["app"] },
      "openai/ui": {
        entrypoints: [{ type: "file", extensions: fileExtensions }],
      },
    },
  }, (_, extra) => launch("thread", extra._meta));

  const cardTool = {
    inputSchema: codexPageTarget,
    annotations: readOnly,
    _meta: { ui: { resourceUri: codexWorkbenchCardUri, visibility: ["model", "app"] } },
  };
  async function presentPageCard(
    targets: CodexCardTarget[],
    meta?: Record<string, unknown>,
    adjustSpacing = false,
  ) {
    try {
      const cards = await readCodexPageCards(service, targets);
      const presentation = cards.length === 1 ? cards[0] : { id: randomUUID(), cards };
      const data = adjustSpacing ? { ...presentation, adjustSpacing: true } : presentation;
      return {
        ...mcpSuccess(data),
        _meta: {
          [cards.length === 1 ? "showaiPageCard" : "showaiCardGroup"]: data,
          showaiNavigationScope: navigation.scope(meta),
        },
      };
    } catch (error) {
      return mcpFailure(error);
    }
  }
  server.registerTool("card_present", {
    ...cardTool,
    title: "Show saved ShowAI cards",
    description: "Deliver the original Page as a clickable card after successfully creating or editing it, or when the user asks for a saved target. Optionally use a blockId from page_read to point to a component and description to summarize its contents or changes. Put remaining targets in additionalTargets to deliver all cards together.",
    inputSchema: {
      ...codexCardTarget,
      additionalTargets: z.array(z.object(codexCardTarget)).optional(),
      ...(!qoder && { adjustSpacing: z.boolean().optional().describe("Show live spacing controls only when the user wants to tune the card layout.") }),
    },
  }, ({ additionalTargets = [], adjustSpacing, ...first }, extra) =>
    presentPageCard([first, ...additionalTargets], extra._meta, adjustSpacing));
  server.registerTool("workbench_open_destination", {
    title: "Open a ShowAI page",
    description: "Open the selected saved Page or component in the ShowAI app, or in the host's registered Workbench when available.",
    inputSchema: { ...codexPageTarget, destination: z.enum(["workbench", "desktop"]) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: appOnly,
  }, async ({ destination, ...target }) => {
    try {
      await readCodexPageTarget(service, target);
      let url: string;
      if (destination === "workbench") {
        if (!globalEntrypoint) throw new Error("This installation has no Codex Workbench entrypoint.");
        url = codexWorkbenchPageLink(globalEntrypoint, target);
      } else {
        url = pageLink({ ...target, blockIds: target.blockId ? [target.blockId] : [] });
      }
      await openSystemUrl(url);
      return { content: [], _meta: { showaiWorkbenchData: { url } } };
    } catch (error) {
      return mcpFailure(error);
    }
  });
  server.registerTool("workbench_card_choice", {
    description: "Carry a clicked card's position from an inline group to its expanded editor.",
    inputSchema: { groupId: z.string().uuid(), index: z.number().int().nonnegative().optional() },
    _meta: appOnly,
  }, ({ groupId, index }) => {
    const now = Date.now();
    for (const [id, choice] of cardChoices) {
      if (choice.expires <= now) cardChoices.delete(id);
    }
    if (index !== undefined) cardChoices.set(groupId, { index, expires: now + 120_000 });
    return { content: [], _meta: { showaiWorkbenchData: cardChoices.get(groupId)?.index ?? null } };
  });
  server.registerTool("card_open", {
    ...cardTool,
    title: "Open a ShowAI editor",
    description: qoder
      ? "Open a saved Page or component in the Qoder side workspace."
      : "Open a saved Page or component directly in a new expanded editor. Try card_navigate first to reuse the current conversation's open editor.",
    _meta: { ui: { resourceUri: codexWorkbenchTargetUri, visibility: ["model", "app"] } },
  }, (target, extra) => presentPageCard([target], extra._meta));
  server.registerTool("card_navigate", {
    title: "Navigate the current ShowAI editor",
    description: qoder
      ? "Locate a saved Page or component in the visible ShowAI editor beside the current Qoder task."
      : "Locate a saved Page or its blockId in a visible ShowAI tab already showing that Page in this conversation. If status is unavailable, call card_open with the same target to open a separate Codex tab.",
    inputSchema: codexPageTarget,
    annotations: readOnly,
    _meta: { ui: { visibility: qoder ? ["app"] : ["model", "app"] } },
  }, async (target, extra) => {
    try {
      await readCodexPageTarget(service, target);
      const token = extra._meta?.["showai/navigationScope"];
      const scope = navigation.scope(extra._meta) ?? (typeof token === "string" ? token : undefined);
      return mcpSuccess({ status: await navigation.navigate(scope, target) });
    } catch (error) {
      return mcpFailure(error);
    }
  });
  if (!qoder) server.registerTool("workbench_side_file", {
    description: "Prepare a saved Page or component reference for an independent Codex file tab.",
    inputSchema: codexPageTarget,
    _meta: appOnly,
  }, async target => {
    try {
      const { path } = await writeCodexPageReference(service, presentationDirectory, target, panelExtension);
      return { content: [], _meta: { showaiWorkbenchData: path } };
    } catch (error) {
      return mcpFailure(error);
    }
  });
  if (!qoder) server.registerTool("workbench_page_reference", {
    ...cardTool,
    title: "Create a ShowAI page reference file",
    description: "Return the local .showai-ref file for a saved Page. Use card_present when the user asks for an interactive card.",
  }, async (target, extra) => {
    try {
      const { file, ...reference } = await writeCodexPageReference(service, presentationDirectory, target);
      const result = mcpSuccess(reference);
      return { ...result, content: [...result.content, file], _meta: {
        showaiPageCard: reference, showaiNavigationScope: navigation.scope(extra._meta),
      } };
    } catch (error) {
      return mcpFailure(error);
    }
  });

  if (!qoder) server.registerTool("workbench_resolve_reference", {
    description: "Verify a ShowAI reference file read through the Codex host and locate its saved Page.",
    inputSchema: { source: z.string().min(1).max(codexPageReferenceMaxLength) },
    annotations: readOnly,
    _meta: appOnly,
  }, async ({ source }) => {
    try {
      const page = await resolveCodexPageReference(service, source);
      return { content: [], _meta: { showaiWorkbenchData: page } };
    } catch (error) {
      return mcpFailure(error);
    }
  });

  server.registerTool("workbench_open", {
    title: "ShowAI",
    description: "Open the ShowAI workbench from a previous conversation.",
    inputSchema: {},
    annotations: readOnly,
    _meta: { ui: { resourceUri: legacyWorkbenchUri, visibility: ["app"] } },
  }, () => launch("global"));

  server.registerTool("workbench_refresh", {
    description: "Return a fresh launch target for the open ShowAI workbench.",
    inputSchema: { mode: z.enum(["global", "thread"]) },
    annotations: readOnly,
    _meta: { ui: { visibility: ["app"] } },
  }, ({ mode }, extra) => launch(mode, extra._meta));

  async function proxy<T>(run: (transport: CodexWorkbenchTransport) => T | Promise<T>) {
    try {
      const value = await run((await workbench()).transport);
      if (qoder) {
        const text = JSON.stringify(value);
        if (text && Buffer.byteLength(text) > 512 * 1024) {
          expireTransfers();
          if (responses.size >= 8) throw new Error("Too many workbench responses are waiting to be read.");
          const id = randomUUID();
          responses.set(id, { text, expires: Date.now() + transferLifetime });
          return { content: [], _meta: { showaiWorkbenchData: { qoderTransfer: { id, length: text.length } } } };
        }
      }
      return { content: [], _meta: { showaiWorkbenchData: value } };
    } catch (error) {
      return mcpFailure(error);
    }
  }
  server.registerTool("workbench_asset", {
    description: "Read a packaged workbench asset chunk.",
    inputSchema: { name: z.string().min(1), offset: z.number().int().nonnegative() },
    annotations: readOnly,
    _meta: appOnly,
  }, ({ name, offset }) => proxy((transport) => transport.asset(name, offset)));
  server.registerTool("workbench_request", {
    description: "Apply a workbench operation from the open editor.",
    inputSchema: {
      route: z.enum(workbenchRoutes),
      args: z.record(z.string(), z.unknown()),
      client: clientId,
    },
    _meta: appOnly,
  }, ({ route, args, client }) => proxy((transport) => transport.request(route, args, client)));
  if (qoder) {
    const request = z.object({
      route: z.enum(workbenchRoutes),
      args: z.record(z.string(), z.unknown()),
      client: clientId,
    });
    server.registerTool("workbench_upload_begin", {
      description: "Start a large Qoder workbench request.",
      inputSchema: { length: z.number().int().positive().max(CAPACITY.authoringRequestBytes) },
      _meta: appOnly,
    }, ({ length }) => {
      expireTransfers();
      if ([...uploads.values()].filter((upload) => !upload.completed).length >= 4)
        return mcpFailure(new Error("Too many workbench requests are in progress."));
      const id = randomUUID();
      uploads.set(id, { parts: [], length: 0, total: length, expires: Date.now() + transferLifetime });
      return { content: [], _meta: { showaiWorkbenchData: id } };
    });
    server.registerTool("workbench_upload_chunk", {
      description: "Append a chunk to a large Qoder workbench request.",
      inputSchema: { id: z.string().uuid(), offset: z.number().int().nonnegative(), text: z.string().min(1).max(100_000) },
      _meta: appOnly,
    }, ({ id, offset, text }) => {
      const upload = uploads.get(id);
      if (!upload || upload.expires <= Date.now() || upload.result || offset !== upload.length || offset + text.length > upload.total)
        return mcpFailure(new Error("The workbench request is unavailable or its chunks are out of order."));
      upload.parts.push(text);
      upload.length += text.length;
      upload.expires = Date.now() + transferLifetime;
      return { content: [], _meta: { showaiWorkbenchData: upload.length } };
    });
    server.registerTool("workbench_upload_finish", {
      description: "Run a complete Qoder workbench request once.",
      inputSchema: { id: z.string().uuid() },
      _meta: appOnly,
    }, async ({ id }) => {
      const upload = uploads.get(id);
      if (!upload || upload.expires <= Date.now() || upload.length !== upload.total)
        return mcpFailure(new Error("The workbench request is incomplete or expired."));
      if (!upload.result) {
        const text = upload.parts.join("");
        if (Buffer.byteLength(text) > CAPACITY.authoringRequestBytes)
          return mcpFailure(new Error("The workbench request exceeds the authoring limit."));
        const input = request.parse(JSON.parse(text));
        upload.parts = [];
        upload.expires = Date.now() + transferLifetime;
        upload.result = proxy((transport) => transport.request(input.route, input.args, input.client))
          .finally(() => { upload.completed = true; });
      }
      return await upload.result as Awaited<ReturnType<typeof proxy>>;
    });
    server.registerTool("workbench_response_chunk", {
      description: "Read a chunk of a large Qoder workbench response.",
      inputSchema: { id: z.string().uuid(), offset: z.number().int().nonnegative() },
      annotations: readOnly,
      _meta: appOnly,
    }, ({ id, offset }) => {
      const response = responses.get(id);
      if (!response || response.expires <= Date.now() || offset >= response.text.length)
        return mcpFailure(new Error("The workbench response is unavailable or expired."));
      response.expires = Date.now() + transferLifetime;
      return { content: [], _meta: { showaiWorkbenchData: response.text.slice(offset, offset + 100_000) } };
    });
    server.registerTool("workbench_response_release", {
      description: "Release a completed Qoder workbench response.",
      inputSchema: { id: z.string().uuid() },
      _meta: appOnly,
    }, ({ id }) => {
      responses.delete(id);
      return { content: [], _meta: { showaiWorkbenchData: true } };
    });
  }
  server.registerTool("workbench_changes", {
    description: "Read workbench changes after a cursor.",
    inputSchema: {
      after: z.number().int().min(-1), client: clientId,
      panel: z.object({
        scope: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        visible: z.boolean(),
        page: z.object(codexPageIdentity).optional(),
        acknowledged: z.string().uuid().optional(),
      }).optional(),
    },
    annotations: readOnly,
    _meta: appOnly,
  }, ({ after, client, panel }, extra) => proxy((transport) => {
    const changes = transport.changes(after, client);
    if (!panel) return changes;
    const scope = navigation.scope(extra._meta) ?? panel.scope;
    return scope ? { ...changes, navigation: navigation.poll(scope, client, panel) } : changes;
  }));
  server.registerTool("workbench_media", {
    description: "Read local media from a workbench grant.",
    inputSchema: {
      grant: z.string().regex(/^[0-9a-f-]{36}$/),
      offset: z.number().int().nonnegative(),
    },
    annotations: readOnly,
    _meta: appOnly,
  }, ({ grant, offset }) => proxy((transport) => transport.media(grant, offset)));
}
