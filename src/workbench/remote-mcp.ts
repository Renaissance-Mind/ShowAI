import { createHash, randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { version } from "../../package.json";
import lightLogo from "../../plugins/showai/assets/logo.svg?raw";
import { workbenchAssets } from "../browser/workbench-assets";
import { createWorkbench } from "./actions";
import type { DesktopInfo } from "../host/protocol";
import { CoreError } from "../core/model";
import type { PageReferences } from "../core/library-index";
import { EditorDrafts, type EditorDraftInput } from "../core/editor-drafts";
import { withChangeContext } from "../core/history-context";
import type { McpWorkbench } from "../agent/mcp-http";
import {
  codexCardTarget, codexPageTarget, readCodexPageCards,
  type CodexCardTarget,
} from "../agent/codex-page-reference";
import {
  codexWorkbenchHtml, codexWorkbenchUri, codexWorkbenchThreadUri,
  codexWorkbenchCardUri, codexWorkbenchTargetUri,
} from "../agent/codex-workbench-ui";
import { mcpFailure, mcpSuccess } from "../agent/presentation-tools";
import { AgentService } from "../agent/service";

const mimeType = "text/html;profile=mcp-app";
const icon = "data:image/svg+xml;base64," + Buffer.from(lightLogo).toString("base64");
const viewOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const security = (write: boolean) => [{
  type: "oauth2", scopes: write ? ["projects.read", "projects.write"] : ["projects.read"],
}];
const appOnly = (write = false) => ({
  ui: { visibility: ["app"] }, securitySchemes: security(write),
});

const aggregateReads = [
  "app:info", "projects:list", "projects:scan", "sidebar:get", "sync:status",
] as const;
const projectReads = [
  "folders:list", "pages:list", "pages:get", "pages:reference", "pages:references", "page:mergePreview", "drafts:list",
] as const;
const catalogReads = ["components:list", "components:get", "templates:list", "templates:get"] as const;
const storedDraftReads = ["drafts:read"] as const;
const storedDraftWrites = ["drafts:remove", "drafts:complete"] as const;
const projectWrites = [
  "folders:create", "folders:rename", "pages:create", "pages:save",
  "pages:duplicate", "pages:rename", "pages:pin", "pages:move", "pages:markSeen", "page:mergeSave", "drafts:save",
] as const;
const globalToolNames = new Set([
  "workbench_open_global", "workbench_open_page", "workbench_refresh", "workbench_asset", "workbench_card_choice",
]);
function isGlobalCall(name: string, args: Record<string, unknown> | undefined) {
  return globalToolNames.has(name) || (name === "workbench_remote_read" &&
    ([...aggregateReads, ...storedDraftReads].some(action => action === args?.action) ||
      (args?.projectId === undefined && catalogReads.some(action => action === args?.action)))) ||
    (name === "workbench_remote_write" && storedDraftWrites.some(action => action === args?.action));
}

export function remoteMcpWorkbench(assetsDirectory: string): McpWorkbench {
  const choices = new Map<string, { index: number; expires: number }>();
  const assets = workbenchAssets(assetsDirectory);
  return {
    isGlobalCall,
    register: (server, options) => registerRemoteWorkbench(server, options, assets, choices),
  };
}

function registerRemoteWorkbench(
  server: McpServer,
  options: Parameters<McpWorkbench["register"]>[1],
  assets: ReturnType<typeof workbenchAssets>,
  choices: Map<string, { index: number; expires: number }>,
) {
  const { grant, local, origin } = options;
  const service = new AgentService({ root: local.root });
  const drafts = new EditorDrafts(local.root);
  const draftPrefix = grant ? `mcp-${createHash("sha256").update(grant.id).digest("hex").slice(0, 32)}-` : undefined;
  const info: DesktopInfo = {
    home: "showai:connected-projects", version, packaged: true, mode: "browser",
    platform: "web", builtinDocs: false, cli: { command: "", args: [], env: {} },
  };
  const projects = async () => {
    if (!grant?.scopes.includes("projects.read")) throw new Error("Connect to ShowAI first.");
    return (await local.projects()).filter(project =>
      !project.archived && (grant.projectAccess === "account" || grant.projectIds.includes(project.id)));
  };
  const writable = (id: string, role?: string) => grant?.scopes.includes("projects.write") &&
    role !== "viewer" && (!grant.writeProjectIds || grant.writeProjectIds.includes(id));
  async function ownedDraft(id: unknown, write: boolean) {
    const visible = await projects();
    const record = typeof id === "string" ? (await drafts.list()).find(draft =>
      draft.id === id && draftPrefix && draft.clientId.startsWith(draftPrefix)) : undefined;
    const project = record && visible.find(project => project.id === record.projectId);
    if (!record || !project || (write && !writable(project.id, project.role)))
      throw new CoreError("NOT_FOUND", "This ShowAI draft is unavailable on this connection.");
    return record;
  }
  const command = createWorkbench(service.store, service, {
    info: () => info,
    preferencesChanged: () => {},
    openDialog: async () => ({ canceled: true, filePaths: [] }),
    saveDialog: async () => ({ canceled: true }),
    invoke: async () => { throw new CoreError("INVALID_DATA", "This action requires the local ShowAI App."); },
  });
  const data = (value: unknown) => ({ content: [], _meta: { showaiWorkbenchData: value } });
  const safe = async (run: () => Promise<unknown>) => {
    try {
      return data(await withChangeContext({ actor: { kind: "human" }, channel: "mcp" }, run));
    } catch (error) {
      return mcpFailure(error);
    }
  };

  const resources: { name: string; uri: string; mode: "global" | "thread"; entrypoint?: "card" | "open" }[] = [
    { name: "showai_remote_workbench", uri: codexWorkbenchUri, mode: "global" },
    { name: "showai_remote_page", uri: codexWorkbenchThreadUri, mode: "thread" },
    { name: "showai_remote_cards", uri: codexWorkbenchCardUri, mode: "thread", entrypoint: "card" },
    { name: "showai_remote_target", uri: codexWorkbenchTargetUri, mode: "thread", entrypoint: "open" },
  ];
  for (const { name, uri, mode, entrypoint } of resources) {
    server.registerResource(name, uri, { mimeType }, async () => ({
      contents: [{
        uri, mimeType,
        text: codexWorkbenchHtml(mode, entrypoint, icon, false, "remote"),
        _meta: {
          ui: { csp: { resourceDomains: ["blob:", "data:"], frameDomains: ["blob:", "data:"] }, prefersBorder: false },
          "openai/ui": {
            availableDisplayModes: ["inline", "fullscreen"],
            preferredDisplayMode: entrypoint === "card" ? "inline" : "fullscreen",
          },
        },
      }],
    }));
  }

  async function launch(mode: "global" | "thread") {
    try {
      await projects();
      const url = new URL(origin);
      url.searchParams.set("codexMode", mode);
      return { content: [], _meta: { showaiWorkbench: { url: url.href, bundle: await assets.bundle() } } };
    } catch (error) {
      return mcpFailure(error);
    }
  }
  for (const { mode, name, uri } of [
    { mode: "global", name: "workbench_open_global", uri: codexWorkbenchUri },
    { mode: "thread", name: "workbench_open_page", uri: codexWorkbenchThreadUri },
  ] as const) {
    server.registerTool(name, {
      title: "ShowAI",
      description: mode === "global" ? "Open the authorized ShowAI project library." : "Open the ShowAI editor next to this chat.",
      inputSchema: {},
      annotations: viewOnly,
      _meta: {
        ...appOnly(),
        ui: { resourceUri: uri, visibility: ["app"] },
        "openai/ui": { entrypoints: [{ type: mode }] },
      },
    }, () => launch(mode));
  }
  server.registerTool("workbench_refresh", {
    description: "Load the authorized ShowAI workbench.",
    inputSchema: { mode: z.enum(["global", "thread"]) }, annotations: viewOnly, _meta: appOnly(),
  }, ({ mode }) => launch(mode));
  server.registerTool("workbench_asset", {
    description: "Read a compiled ShowAI workbench asset chunk.",
    inputSchema: { name: z.string().min(1).max(200), offset: z.number().int().min(0) },
    annotations: viewOnly, _meta: appOnly(),
  }, ({ name, offset }) => safe(async () => { await projects(); return assets.asset(name, offset); }));
  server.registerTool("workbench_card_choice", {
    description: "Retain the selected page when the app expands.",
    inputSchema: { groupId: z.string().uuid(), index: z.number().int().min(0).optional() },
    _meta: appOnly(),
  }, ({ groupId, index }) => safe(async () => {
    await projects();
    const now = Date.now();
    for (const [key, choice] of choices) {
      if (choice.expires <= now) choices.delete(key);
    }
    const key = `${grant!.id}:${groupId}`;
    if (index !== undefined) {
      choices.set(key, { index, expires: now + 2 * 60_000 });
      if (choices.size > 512)
        choices.delete(choices.keys().next().value!);
    }
    return choices.get(key)?.index ?? null;
  }));

  async function cardsFor(targets: CodexCardTarget[]) {
    try {
      const allowed = new Set((await projects()).map(project => project.id));
      if (targets.some(target => !allowed.has(target.projectId)))
        throw new CoreError("NOT_FOUND", "A requested page is outside the approved ShowAI projects.");
      const cards = await readCodexPageCards(service, targets);
      const value = cards.length === 1 ? cards[0] : { id: randomUUID(), cards };
      return { ...mcpSuccess(value), _meta: { [cards.length === 1 ? "showaiPageCard" : "showaiCardGroup"]: value } };
    } catch (error) {
      return mcpFailure(error);
    }
  }
  server.registerTool("card_present", {
    title: "Show saved ShowAI cards",
    description: "Deliver saved Pages as cards. Use the actual projectId and pageId after saving, optional blockId and description, and additionalTargets for other Pages.",
    inputSchema: { ...codexCardTarget, additionalTargets: z.array(z.object(codexCardTarget)).optional() },
    annotations: viewOnly,
    _meta: { ui: { resourceUri: codexWorkbenchCardUri, visibility: ["model", "app"] }, securitySchemes: security(false) },
  }, ({ additionalTargets = [], ...first }) => cardsFor([first, ...additionalTargets]));
  server.registerTool("card_open", {
    title: "Open a ShowAI editor",
    description: "Open an original Page or Board in the authorized ShowAI editor.",
    inputSchema: codexPageTarget,
    annotations: viewOnly,
    _meta: { ui: { resourceUri: codexWorkbenchTargetUri, visibility: ["model", "app"] }, securitySchemes: security(false) },
  }, target => cardsFor([target]));

  server.registerTool("workbench_remote_read", {
    description: "Read an authorized project item for the ShowAI editor.",
    inputSchema: {
      action: z.enum([...aggregateReads, ...projectReads, ...catalogReads, ...storedDraftReads]),
      projectId: z.string().optional(),
      args: z.record(z.string(), z.unknown()),
    },
    annotations: viewOnly, _meta: appOnly(),
  }, ({ action, projectId, args }) => safe(async () => {
    const visible = await projects();
    let value: unknown;
    if (action === "app:info") value = info;
    else if (action === "sidebar:get") value = { groups: [], projectGroups: {} };
    else if (action === "sync:status") value = { projects: [], connections: [] };
    else if (action === "drafts:read") {
      const record = await ownedDraft(args.id, false);
      value = await drafts.read(record.id);
    }
    else if (action === "projects:scan" || action === "projects:list") {
      const ids = visible.map(project => project.id);
      const list = (ids.length ? await service.store.listProjects({ projectIds: ids }) : [])
        .map(({ sourceDirectory: _source, binding: _binding, bindings: _bindings, ...project }) => project);
      value = action === "projects:scan" ? { projects: list, unreadable: [] } : list;
    } else if (catalogReads.some(read => read === action)) {
      if (projectId !== undefined && !visible.some(project => project.id === projectId))
        throw new CoreError("NOT_FOUND", "This project is outside the approved ShowAI library.");
      const scope = projectId && args.scope === "project" ? "project" : "builtin";
      value = await command(action, { ...args, projectId, scope, expectedHome: local.root });
      if (projectId && scope === "builtin" && Array.isArray(value) &&
          (args.scope === undefined || args.scope === "all")) {
        const inProject = await command(action, { ...args, projectId, scope: "project", expectedHome: local.root });
        value = [...value, ...(inProject as unknown[])];
      }
    } else {
      const selected = visible.find(project => project.id === projectId);
      if (!selected) throw new CoreError("NOT_FOUND", "This project is outside the approved ShowAI library.");
      value = action === "drafts:list"
        ? (await drafts.list({
            projectId, kind: "page",
            resourceId: typeof args.resourceId === "string" ? args.resourceId : undefined,
          })).filter(draft => draftPrefix && draft.clientId.startsWith(draftPrefix))
        : await command(action, { ...args, projectId, expectedHome: local.root });
      if (action === "pages:get" && value && typeof value === "object") {
        const { path: _path, ...page } = value as Record<string, unknown>;
        value = { ...page, readOnly: page.readOnly || !writable(selected.id, selected.role) };
      } else if (action === "pages:references") {
        const refs = value as PageReferences;
        const allowed = new Set(visible.map(project => project.id));
        const to = refs.to.filter(ref => allowed.has(ref.projectId));
        const from = refs.from.filter(ref => allowed.has(ref.projectId));
        value = { ...refs, to, from, total: { to: to.length, from: from.length } };
      }
    }
    return { ok: true, data: value };
  }));
  server.registerTool("workbench_remote_write", {
    description: "Save or organize a page in an authorized writable ShowAI project.",
    inputSchema: {
      action: z.enum([...projectWrites, ...storedDraftWrites]),
      projectId: z.string().optional(),
      args: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: appOnly(true),
  }, ({ action, projectId, args }) => safe(async () => {
    if (action === "drafts:remove" || action === "drafts:complete") {
      const record = await ownedDraft(args.id, true);
      if (typeof args.generation !== "string")
        throw new CoreError("INVALID_DATA", "Provide the current draft generation.");
      if (action === "drafts:remove") {
        await drafts.remove(record.id, args.generation);
        return { ok: true };
      }
      if (typeof args.revision !== "string") throw new CoreError("INVALID_DATA", "Provide the saved page revision.");
      return { ok: true, data: await drafts.completePage(record.id, args.generation, args.revision) };
    }
    const selected = (await projects()).find(project => project.id === projectId);
    if (!selected || !writable(selected.id, selected.role))
      throw new CoreError("INVALID_DATA", "This project does not have write permission.");
    if (action === "drafts:save") {
      const input = args.input as EditorDraftInput | undefined;
      if (!input || input.kind !== "page" || typeof input.resourceId !== "string" ||
          typeof input.clientId !== "string" || !draftPrefix)
        throw new CoreError("INVALID_DATA", "Provide an editable page draft.");
      if (input.recoverySource) await ownedDraft(input.recoverySource.id, true);
      return { ok: true, data: await drafts.save({
        ...input, projectId: selected.id, actor: { kind: "human" },
        clientId: draftPrefix + createHash("sha256").update(input.clientId).digest("hex").slice(0, 32),
      }) };
    }
    const value = await command(action, { ...args, projectId, expectedHome: local.root });
    if (!value || typeof value !== "object") return { ok: true, data: value };
    const { path: _path, ...saved } = value as Record<string, unknown>;
    return { ok: true, data: saved };
  }));
}
