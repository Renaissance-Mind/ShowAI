import { COMPONENT_PARAMETER_CAPABILITIES } from "../contract/component-parameters.mjs";
import { cdnReaderOrigins, cdnReaderUrls } from "../core/cdn-reader";
import { workRecordsLocation } from "../core/work-records";
import { CAPACITY } from "../portable/capacity.mjs";
import { TRANSFORM_LIMITS } from "../core/dataset-transform";
import { TEMPLATE_WORKFLOW_CAPABILITIES } from "../portable/template-bundle.mjs";
import { INLINE_READER_OVERRIDES } from "../portable/inline-style.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATALOG_VIEWS } from "./disclosure";
import { version } from "../../package.json";
import {
  publicCatalog,
  describePublicResource,
  presentationSchema,
  renderPresentation,
  renderComponents,
  showComponentSchema,
  compactPresentation,
  inlineReader,
  SHOW_COMPONENT_LIMIT,
  SHOW_DELIVERIES,
} from "./presentation";
import {
  mcpReaderHtml,
  mcpComponentHtml,
  readerResourceUri,
  componentResourceUri,
} from "./mcp-ui";
import { errorResult, type FailedOperation } from "./service";
import { supportInfo } from "./support";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderReading } from "./reading-renderer";
import { getLocale } from "../i18n";
import { PresentationSession, MAX_LIVE_SOURCE_BYTES } from "./presentation-session";
import { CoreError } from "../core/model";
import type { PageOperation } from "../core/model";
import { withLocalResources } from "../core/local-resources";

export type Presentation = Awaited<ReturnType<typeof renderPresentation>>;
export interface PresentationDelivery {
  artifactId?: string;
  html?: string;
  inline?: string;
  source?: string;
  expiresAt?: string;
}
export const noAuth = [{ type: "noauth" }];
export const readerToolMeta = {
  ui: { resourceUri: readerResourceUri },
  "openai/outputTemplate": readerResourceUri,
  "openai/toolInvocation/invoking": "正在生成 ShowAI 页面",
  "openai/toolInvocation/invoked": "ShowAI 页面已就绪",
};
const componentToolMeta = {
  ui: { resourceUri: componentResourceUri },
  "openai/outputTemplate": componentResourceUri,
  "openai/toolInvocation/invoking": "正在生成 ShowAI 组件",
  "openai/toolInvocation/invoked": "ShowAI 组件已就绪",
};

export const HOST_DISPLAYS = {
  "mcp-app": "mcp-app",
  "codex-visualize": "fragment-file",
  "fragment-file": "fragment-file",
  "model-html": "compact",
  image: "image",
  native: "mcp-app",
} as const;
export type HostDisplay = keyof typeof HOST_DISPLAYS;
export function hostDisplay(value = process.env.SHOWAI_HOST_DISPLAY) {
  if (!value) return undefined;
  if (!(value in HOST_DISPLAYS))
    throw new Error(
      `SHOWAI_HOST_DISPLAY must be one of ${Object.keys(HOST_DISPLAYS).join(", ")}.`,
    );
  return value as HostDisplay;
}
const COMPACT_BYTES = 32 * 1024;

export function conversationHandoff(
  compact: string | undefined,
  blockIds: string[] | undefined,
  display: HostDisplay | undefined,
  tool: "page_present" | "render_document",
  cdnReader: boolean,
) {
  const saved = tool === "page_present";
  if (!display || HOST_DISPLAYS[display] !== "compact") return undefined;
  if (!cdnReader)
    return {
      mode: "unavailable",
      next: `This runtime has no CDN reader, so the page cannot be shown in the conversation. Give the person ${saved ? "openUrl" : "the html file"} and say that the inline view is unavailable.`,
    };
  const bytes = compact ? Buffer.byteLength(compact) : undefined;
  if (compact && bytes! <= COMPACT_BYTES)
    return {
      mode: "compact",
      fragment: compact,
      next: `Pass fragment unchanged to the host's model-written HTML visualization tool now; the person has not seen the page until it is shown.${saved ? " Then give openUrl for the saved Page." : ""}`,
    };
  return {
    mode: "too-large",
    ...(bytes ? { bytes } : {}),
    limit: COMPACT_BYTES,
    next: blockIds
      ? `These blocks are still too large to show in the conversation. Call ${tool} again with fewer blockIds, or give the person ${saved ? "openUrl" : "the html file"}.`
      : `The whole ${saved ? "page" : "document"} is too large to show in the conversation. Call ${tool} again with blockIds for the one to three blocks the person most needs to see${saved ? ' (page_read detail:"outline" lists them)' : ""}, show that fragment, and give ${saved ? "openUrl" : "the html file"} for the whole ${saved ? "page" : "document"}.`,
  };
}
export function withConversation(
  conversation: ReturnType<typeof conversationHandoff>,
) {
  return conversation ? { conversation } : {};
}
const KEPT_FRAGMENTS = 20;

async function keepRecentFragments(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const previews = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        path: join(directory, entry.name),
        time: (await stat(join(directory, entry.name))).mtimeMs,
      })),
  );
  previews.sort((a, b) => b.time - a.time);
  for (const old of previews.slice(KEPT_FRAGMENTS))
    await rm(old.path, { recursive: true, force: true });
}

async function captureComponents(html: string, theme: "light" | "dark") {
  const directory = await mkdtemp(join(tmpdir(), "showai-show-image-"));
  try {
    const path = join(directory, "component.html");
    await writeFile(
      path,
      html.replace(
        /<head\b[^>]*>/i,
        (open) => `${open}<style>${INLINE_READER_OVERRIDES}</style>`,
      ),
      "utf8",
    );
    return await renderReading(
      path,
      {
        viewport: { width: 760, height: 240 },
        view: "image",
        format: "json",
        capture: "full",
        presentation: "spatial",
        draft: false,
        overwrite: false,
        theme,
        actions: [],
      },
      getLocale(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export function mcpData(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const value = { ...(data as Record<string, unknown>) };
  const shellHint = (entry: unknown) =>
    typeof entry === "string" && /^(showai |guide )/.test(entry);
  if (
    shellHint(value.next) ||
    (value.next &&
      typeof value.next === "object" &&
      Object.values(value.next).some(shellHint))
  )
    delete value.next;
  if (Array.isArray(value.items))
    value.items = value.items.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        !["component", "template"].includes(item.kind) ||
        !shellHint(item.describe)
      )
        return item;
      const { describe: _describe, ...summary } = item;
      return summary;
    });
  return value;
}

export function mcpSuccess(input: unknown) {
  const data = mcpData(input);
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ ok: true, data }) },
    ],
    structuredContent: { ok: true, data },
  };
}
export function mcpFailure(error: unknown, operation?: FailedOperation) {
  const result = { ok: false, error: errorResult(error, operation) };
  return {
    isError: true,
    structuredContent: result,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result),
      },
    ],
  };
}
export function registerPresentationTools(
  server: McpServer,
  options: {
    transport: "stdio" | "http";
    storePresentation?: (
      presentation: Presentation,
    ) => Promise<PresentationDelivery>;
    widgetDomain?: string;
    privateProjects?: boolean;
    projectAccess?: "library" | "project";
    boundProjectId?: string;
    componentLibrary?: {
      root: string;
      resolveProject(projectId?: string): Promise<string | undefined>;
    };
    previewDirectory?: string;
    hostDisplay?: HostDisplay;
  },
) {
  const declaredDisplay = options.hostDisplay ?? hostDisplay();
  const liveViews = new Map<string, { session: PresentationSession; projectId?: string; touched: number }>();
  const expireViews = () => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, view] of liveViews) if (view.touched < cutoff) {
      view.session.close();
      liveViews.delete(id);
    }
  };
  const liveView = async (id: string) => {
    expireViews();
    const view = liveViews.get(id);
    if (!view) {
      const error = new CoreError("NOT_FOUND", "Presentation is unavailable or expired. Create a new live presentation.");
      error.nextStep = "Create another show_component with live:true; temporary views expire after 30 minutes without access and do not survive reconnection.";
      throw error;
    }
    if (view.projectId) await options.componentLibrary!.resolveProject(view.projectId);
    view.touched = Date.now();
    return view.session;
  };
  const safe = (handler: () => Promise<unknown>) =>
    handler().then(mcpSuccess, mcpFailure);
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  for (const uri of [readerResourceUri, "ui://showai/reader-v3.html"]) server.registerResource(
    uri === readerResourceUri ? "showai-reader" : "showai-reader-legacy",
    uri,
    { mimeType: "text/html;profile=mcp-app" },
    async () => {
      const domains = cdnReaderOrigins(await cdnReaderUrls());
      return {
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: mcpReaderHtml,
            _meta: {
              ui: {
                prefersBorder: false,
                csp: { connectDomains: [], resourceDomains: domains },
                ...(options.widgetDomain
                  ? { domain: options.widgetDomain }
                  : {}),
              },
              "openai/widgetDescription":
                "Interactive ShowAI page. Read, explore and compare the supplied content.",
              "openai/widgetCSP": {
                connect_domains: [],
                resource_domains: domains,
              },
            },
          },
        ],
      };
    },
  );
  for (const uri of [componentResourceUri, "ui://showai/component-v1.html"]) server.registerResource(
    uri === componentResourceUri ? "showai-component" : "showai-component-legacy",
    uri,
    { mimeType: "text/html;profile=mcp-app" },
    async () => {
      const domains = cdnReaderOrigins(await cdnReaderUrls());
      return {
        contents: [
          {
            uri,
            mimeType: "text/html;profile=mcp-app",
            text: mcpComponentHtml,
            _meta: {
              ui: {
                prefersBorder: false,
                csp: { connectDomains: [], resourceDomains: domains },
                ...(options.widgetDomain
                  ? { domain: options.widgetDomain }
                  : {}),
              },
              "openai/widgetDescription":
                "Interactive ShowAI components shown in the conversation. Explore them; nothing is saved.",
              "openai/widgetCSP": {
                connect_domains: [],
                resource_domains: domains,
              },
            },
          },
        ],
      };
    },
  );
  server.registerTool(
    "showai_capabilities",
    {
      description: "Return this connection's ShowAI capabilities.",
      inputSchema: {},
      annotations: readOnly,
      _meta: { securitySchemes: noAuth },
    },
    async () =>
      mcpSuccess({
        version,
        agentProtocol: "showai-mcp-v1",
        support: await supportInfo(),
        templateWorkflow: {
          ...TEMPLATE_WORKFLOW_CAPABILITIES,
          taskContexts: options.privateProjects !== false,
          baseline: { tool: "guide", arguments: { topic: "presentation" } },
        },
        componentParameters: COMPONENT_PARAMETER_CAPABILITIES,
        authoring: {
          available: options.privateProjects !== false,
          pageOperations: [
            "component.insert",
            "component.props.set",
            "component.ref.set",
          ],
          localFiles: {
            available:
              options.privateProjects !== false && options.transport !== "http",
            inputs: {
              page_apply: ["operationsFile"],
              dataset_write: ["valueFile", "operationsFile", "scriptFile"],
              component_save: ["directory"],
            },
            outputs: {
              page_read: ["out"],
              page_diff: ["out"],
              dataset_read: ["out"],
              catalog_describe: ["out"],
            },
            paths: "absolute",
          },
          pageDiff: { entries: "record", paged: true },
          migrations: { guide: "migrations" },
          workRecords:
            options.transport !== "http" && options.componentLibrary
              ? {
                  available: true,
                  ...(await workRecordsLocation(
                    options.componentLibrary.root,
                  )),
                  layout:
                    "One folder per work: <directory>/<YYYYMMDD-HHmm>-<short name>-<8 random hex>/ with brief.md, material.md, presentation-plan.json and review.md.",
                }
              : {
                  available: false,
                  reason:
                    "This connection has no device file system; keep stage records in the conversation.",
                },
        },
        boardReading: {
          protocol: "showai-board-reading-v1",
          available: options.privateProjects !== false,
          tool: "board_read",
          defaultView: "visual",
          modes: ["visual", "tile", "region", "element", "source"],
          snapshotMinutes: 30,
          maxImages: 8,
          tilePixels: { width: 1600, height: 1600 },
          overlapPixels: 200,
          pageSource: {
            tool: "page_read",
            fields: ["snapshotId", "blockIds", "rendered"],
          },
        },
        capacities: { unit: "bytes", ...CAPACITY },
        datasets: {
          protocol: "showai-datasets-v1",
          available: options.privateProjects !== false,
          guide: "datasets",
          tools: ["dataset_read", "dataset_write", "dataset_delete"],
          externalFiles: {
            available: options.transport !== "http",
            tool: "dataset_write",
            action: "link",
            formats: ["json", "csv", "tsv", "xlsx"],
            readOnlyFormats: ["xlsx"],
            exportConfirmation: {
              parameter: "packaging",
              details: "packaging",
              everything: { parameter: "externalData", value: "embed" },
            },
            sync: {
              bundled: true,
              tool: "project_sync",
              parameter: "packaging",
            },
          },
          sources: {
            kinds: ["file", "url"],
            file: {
              available: options.transport !== "http",
              formats: ["json", "csv", "tsv", "xlsx"],
              writable: ["json", "csv", "tsv"],
            },
            url: {
              available: true,
              formats: ["json", "csv", "tsv", "xlsx"],
              readOnly: true,
              refreshSeconds: { default: 300, min: 0, max: 86_400 },
              refresh: { tool: "dataset_read", parameter: "refresh" },
            },
            readStatus: ["ok", "stale", "empty"],
          },
          transforms: {
            available: true,
            tool: "dataset_write",
            action: "transform",
            dryRun: { parameter: "dryRun" },
            script: "function transform(inputs, helpers) { return output; }",
            inputs: {
              max: TRANSFORM_LIMITS.maxInputs,
              kinds: ["project", "file", "url", "transform"],
            },
            helpers: ["sheet", "cell", "range", "table", "find", "columnName"],
            limits: {
              timeoutMs: TRANSFORM_LIMITS.timeoutMs,
              memoryBytes: TRANSFORM_LIMITS.memoryBytes,
              scriptBytes: TRANSFORM_LIMITS.scriptBytes,
              outputBytes: TRANSFORM_LIMITS.outputBytes,
            },
            readOnly: true,
          },
          pageOperations: [
            "component.binding.set",
            "component.binding.remove",
            "component.props.set",
          ],
        },
        management: {
          protocol: "showai-workspace-management-v1",
          folders: options.privateProjects !== false,
          projectMetadata: options.privateProjects !== false,
          directorySort: options.privateProjects !== false,
          references: options.privateProjects !== false,
          crossProjectPageMove:
            options.privateProjects !== false &&
            (options.transport === "http" ||
              options.projectAccess === "library"),
          sidebar: {
            available:
              options.privateProjects !== false &&
              (options.transport === "http" ||
                options.projectAccess === "library"),
            scope: options.transport === "http" ? "connection" : "library",
            synchronized: false,
          },
          drafts: {
            available: options.privateProjects !== false,
            scope:
              options.transport === "http"
                ? "connection-project"
                : "library-project",
            synchronized: false,
          },
          exportFormats:
            options.transport === "http"
              ? ["html", "inline"]
              : ["html", "inline", "site"],
          componentInput:
            options.transport === "http"
              ? "saved-source-references"
              : "source-or-compiled-packages",
        },
        transport: options.transport,
        presentation: {
          publicResources: true,
          customization: true,
          requiresProject: false,
          requiresSynchronization: false,
          outputs: ["mcp-app", "inline", "html", "source"],
          levels: ["show", "document"],
          show: {
            tool: "show_component",
            maxComponents: SHOW_COMPONENT_LIMIT,
            deliveries: SHOW_DELIVERIES,
            savesContent: false,
            projectComponents: !!options.componentLibrary,
          },
          liveUpdates: {
            protocol: "showai-live-presentation-v1",
            available: options.transport === "stdio",
            delivery: "mcp-app",
            requiresHostServerTools: true,
            defaultDeliverySupported: options.transport === "stdio" && (declaredDisplay === "mcp-app" || declaredDisplay === "native"),
            scope: "connection",
            idleMinutes: 30,
            maxViews: 32,
            maxSourceBytes: MAX_LIVE_SOURCE_BYTES,
            tools: options.transport === "stdio" ? ["show_component_update", "show_component_read", "show_component_close"] : [],
            preservesPageWorkflow: true,
          },
          declaredHostDisplay: declaredDisplay ?? "undeclared",
          hostDisplay:
            "The harness determines whether inline or MCP Apps can be displayed. show_component follows the plugin's declared host display; documents always preserve a usable file or project receipt.",
        },
        projects: {
          available: options.privateProjects ?? true,
          access:
            options.transport === "http"
              ? "authorized"
              : (options.projectAccess ?? "project"),
          ...(options.boundProjectId
            ? { boundProjectId: options.boundProjectId }
            : {}),
          authentication:
            options.transport === "http" ? "oauth2" : "local-runtime",
          sharedSynchronization: true,
          htmlDisplayRequired: false,
        },
        workflow:
          "Use MCP for all Agent document operations. The use-showai Skill (guide() without Skills) is the entry and decides the route by the result the user wants: discussion is answered in text; a visualization the user only wants to see now follows show-visual (show_component, 1–5 components, nothing saved); creating or revising a work follows show-document, whose presentation workflow is guide topic presentation without Skills; finding, reading and managing existing content stays in use-showai. render_document is for a complete standalone document that is not saved. Do not switch connection, library or persistence mode after a failure.",
        next: `For a conversation visualization: public_catalog_describe (or catalog_describe) view=guide for the chosen component → show_component. For a complete standalone document: public_catalog_list → public_catalog_describe → render_document. ${options.privateProjects === false ? "This connection has no private project entry; use a project connection when persistence is requested." : `For project work: ${options.transport === "http" ? "projects_list" : "project_context"} → page_read/create/apply/save. Display is optional; check synchronization separately.`}`,
      }),
  );
  server.registerTool(
    "public_catalog_list",
    {
      description:
        "List public components/templates with scenarios and props signatures.",
      inputSchema: {
        kind: z.enum(["component", "template"]).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      },
      annotations: readOnly,
      _meta: { securitySchemes: noAuth },
    },
    (input) => safe(() => publicCatalog(input)),
  );
  server.registerTool(
    "public_catalog_describe",
    {
      description:
        "Read public components or whole template guides.",
      inputSchema: {
        id: z.string(),
        version: z.string().optional(),
        integrity: z
          .string()
          .regex(/^sha256-[a-f0-9]{64}$/)
          .optional(),
        kind: z.enum(["component", "template"]).optional(),
        view: z.enum(CATALOG_VIEWS).optional(),
        parameterPath: z.string().min(1).max(500).optional(),
        parameterOffset: z.number().int().nonnegative().optional(),
        parameterLimit: z.number().int().min(1).max(50).optional(),
        knownHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        file: z.string().optional(),
      },
      annotations: readOnly,
      _meta: { securitySchemes: noAuth },
    },
    ({ id, ...input }) => safe(() => describePublicResource(id, input)),
  );
  server.registerTool(
    "render_document",
    {
      description:
        "Render standalone content without saving.",
      inputSchema: presentationSchema,
      annotations: readOnly,
      _meta: { securitySchemes: noAuth, ...readerToolMeta },
    },
    async (input) => {
      try {
        const presentation = await renderPresentation(input);
        const delivery = await options.storePresentation?.(presentation);
        return {
          ...mcpSuccess({
            title: presentation.title,
            persistence: presentation.persistence,
            bytes: presentation.bytes,
            display: {
              resourceAttached: true,
              inlineAvailable: !!presentation.inline,
              ...inlineReader(presentation),
              onlineAvailable: !!presentation.online,
              compactAvailable: !!presentation.compact,
              note: "The host displays the attached MCP Apps reader directly. Download URLs are for file delivery. If the execution sandbox cannot download them, use presentation_source when available.",
            },
            ...(presentation.inlineError
              ? { inlineError: presentation.inlineError }
              : {}),
            ...withConversation(
              conversationHandoff(
                presentation.compact,
                input.blockIds,
                declaredDisplay,
                "render_document",
                !!presentation.online,
              ),
            ),
            delivery: delivery ?? {
              mode: "mcp-resource",
              note: "Use the attached MCP Apps reader; use the delivery returned by the configured host adapter.",
            },
          }),
          _meta: {
            showai: {
              inline: presentation.inline,
              inlineError: presentation.inlineError,
              ...(delivery ? { delivery } : {}),
            },
          },
        };
      } catch (error) {
        return mcpFailure(error, "present");
      }
    },
  );
  server.registerTool(
    "show_component",
    {
      description: `Show 1–${SHOW_COMPONENT_LIMIT} components without saving; same kind/data as page_apply. live opts into updates.`,
      inputSchema: showComponentSchema,
      annotations: readOnly,
      _meta: { securitySchemes: noAuth, ...componentToolMeta },
    },
    async (input) => {
      try {
        if (input.projectId && !options.componentLibrary)
          throw new Error(
            "This connection cannot read saved project components. Show built-in components, pass componentSources, or save a Page in an authorized project.",
          );
        const library = options.componentLibrary && {
          root: options.componentLibrary.root,
          projectId: await options.componentLibrary.resolveProject(
            input.projectId,
          ),
        };
        const requestedDelivery = input.delivery && input.delivery !== "auto"
          ? input.delivery : declaredDisplay ? HOST_DISPLAYS[declaredDisplay] : undefined;
        if (input.live && (options.transport !== "stdio" || requestedDelivery !== "mcp-app"))
          throw new Error("Live updates require a local MCP Apps display. Use delivery mcp-app in a host that supports it, or omit live for ordinary presentation.");
        expireViews();
        if (input.live && liveViews.size >= 32)
          throw new Error("Too many live presentations. Close one before creating another.");
        const shown = await renderComponents(input, library);
        const warnings = [...shown.warnings];
        let mode: Exclude<(typeof SHOW_DELIVERIES)[number], "auto"> =
          input.delivery && input.delivery !== "auto"
            ? input.delivery
            : declaredDisplay
              ? HOST_DISPLAYS[declaredDisplay]
              : "mcp-app";
        if (!declaredDisplay && (!input.delivery || input.delivery === "auto"))
          warnings.push(
            "The plugin declared no host display. The MCP Apps view is attached; if this host shows nothing, call again with delivery image, compact or fragment-file according to the host's actual display.",
          );
        if (shown.inlineError && mode !== "image") {
          warnings.push(shown.inlineError);
          mode = "image";
        }
        let delivery: Record<string, unknown> = { mode };
        if (mode === "compact") {
          const compact = await compactPresentation(shown.html);
          if (compact && Buffer.byteLength(compact) <= COMPACT_BYTES)
            delivery = {
              mode,
              compact,
              note: "Pass this text unchanged to the host's model-written HTML visualization tool. It loads the ShowAI reader from public CDNs.",
            };
          else {
            warnings.push(
              compact
                ? `The compact fragment is ${Buffer.byteLength(compact)} bytes, above ${COMPACT_BYTES}; an image is returned instead.`
                : "No compact fragment is available: either no CDN reader is configured or the component data is over the conversation budget. An image is returned instead.",
            );
            mode = "image";
          }
        }
        if (mode === "fragment-file") {
          const directory = options.previewDirectory
            ? join(options.previewDirectory, "show-components")
            : undefined;
          if (!directory)
            throw new Error(
              "fragment-file needs a host-owned presentation directory. Configure SHOWAI_PRESENTATION_DIR or use another delivery.",
            );
          const path = join(directory, randomUUID(), "component.inline.html");
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, shown.inline!, "utf8");
          await keepRecentFragments(directory);
          delivery = {
            mode,
            inline: path,
            note: `A conversation preview, not a deliverable. Only the latest ${KEPT_FRAGMENTS} fragments are kept.`,
          };
        }
        let image: { data: string; mimeType: "image/png" } | undefined;
        if (mode === "image") {
          const capture = await captureComponents(
            shown.html,
            input.theme ?? "light",
          );
          image = {
            data: capture.png.toString("base64"),
            mimeType: "image/png",
          };
          delivery = {
            mode,
            width: capture.width,
            height: capture.height,
            note: "A static image. Interactive views need an MCP Apps, Codex or model-written HTML host.",
          };
        }
        if (input.live && (mode !== "mcp-app" || !shown.inline))
          throw new Error("This presentation cannot use a live MCP Apps view. Use ordinary presentation.");
        const renderedSource = input.live
          ? shown.html.match(/<script\b[^>]*\bid=["']showai-data["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
          : undefined;
        if (input.live && !renderedSource) throw new Error("Live reader source is missing.");
        const editableSources = input.live ? JSON.parse(shown.source).componentSources : undefined;
        const live = input.live ? new PresentationSession(randomUUID(), JSON.stringify({
          ...JSON.parse(renderedSource!), ...(editableSources ? { componentSources: editableSources } : {}),
        })) : undefined;
        const snapshot = live?.snapshot();
        if (snapshot) {
          expireViews();
          if (liveViews.size >= 32)
            throw new Error("Too many live presentations. Close one before creating another.");
          liveViews.set(snapshot.viewId, { session: live!, projectId: library?.projectId, touched: Date.now() });
        }
        const result = mcpSuccess({
          ...(snapshot ? { live: { viewId: snapshot.viewId, revision: snapshot.revision, complete: false },
            blocks: (shown.document.content.content ?? []).map(node => ({ id: node.attrs?.id, type: node.type, kind: node.attrs?.kind })) } : {}),
          ...(shown.title ? { title: shown.title } : {}),
          components: shown.components,
          delivery,
          bytes: {
            inline: shown.inline ? Buffer.byteLength(shown.inline) : null,
          },
          display: {
            resourceAttached: true,
            inlineAvailable: !!shown.inline,
            ...inlineReader(shown),
            imageAttached: !!image,
          },
          persistence: {
            savedToProject: false,
            files: mode === "fragment-file" ? "preview-directory" : "none",
          },
          ...(warnings.length ? { warnings } : {}),
          next: "To keep it, save the same blocks with page_create({projectId,blocks}) or page_apply component.insert in an authorized project, then page_present.",
        });
        return {
          ...result,
          content: [
            ...result.content,
            ...(image ? [{ type: "image" as const, ...image }] : []),
          ],
          _meta: {
            showai: {
              inline: shown.inline,
              inlineError: shown.inlineError,
              ...(snapshot ? { live: snapshot } : {}),
            },
          },
        };
      } catch (error) {
        return mcpFailure(error, "present");
      }
    },
  );
  if (options.transport !== "stdio") return;
  server.registerTool("show_component_update", {
    description: "Apply page_apply operations to a live view; complete finalizes it.",
    inputSchema: {
      viewId: z.string().min(1).max(128),
      operationId: z.string().min(1).max(128),
      baseRevision: z.number().int().nonnegative(),
      operations: z.array(z.record(z.string(), z.unknown())).max(100),
      complete: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { securitySchemes: noAuth },
  }, async ({ viewId, ...input }) => {
    try {
      const session = await liveView(viewId);
      const prepared = session.prepare({ ...input, operations: input.operations as PageOperation[] });
      const artifact = JSON.parse(prepared.snapshot.source);
      artifact.document = (await withLocalResources(artifact.document)).document;
      const snapshot = prepared.commit(JSON.stringify(artifact));
      return { ...mcpSuccess({ viewId, revision: snapshot.revision, complete: snapshot.complete, savedToProject: false }),
        _meta: { showai: { live: snapshot } } };
    } catch (error) { return mcpFailure(error, "present"); }
  });
  server.registerTool("show_component_read", {
    description: "Read live view; source returns portable content to save.",
    inputSchema: { viewId: z.string().min(1).max(128), sinceRevision: z.number().int().nonnegative().optional(), source: z.boolean().optional() },
    annotations: readOnly,
    _meta: { securitySchemes: noAuth },
  }, async ({ viewId, sinceRevision, source }) => {
    try {
      const snapshot = (await liveView(viewId)).snapshot();
      const changed = snapshot.revision !== sinceRevision;
      return { ...mcpSuccess({ viewId, revision: snapshot.revision, complete: snapshot.complete, changed,
        ...(source ? { artifact: JSON.parse(snapshot.source) } : {}) }),
        _meta: { showai: { ...(changed ? { live: snapshot } : {}) } } };
    } catch (error) { return mcpFailure(error, "present"); }
  });
  server.registerTool("show_component_close", {
    description: "Release temporary view.",
    inputSchema: { viewId: z.string().min(1).max(128) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { securitySchemes: noAuth },
  }, async ({ viewId }) => {
    liveViews.get(viewId)?.session.close();
    liveViews.delete(viewId);
    return mcpSuccess({ viewId, closed: true });
  });
}
