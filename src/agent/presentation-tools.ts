import { COMPONENT_PARAMETER_CAPABILITIES } from "../portable/component-parameters.mjs";
import { cdnReaderOrigins, cdnReaderUrls } from "../core/cdn-reader";
import { CAPACITY } from "../portable/capacity.mjs";
import { TEMPLATE_WORKFLOW_CAPABILITIES } from "../portable/template-bundle.mjs";
import { TEMPLATE_STAGES } from "../portable/template-bundle.mjs";
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
  SHOW_COMPONENT_LIMIT,
  SHOW_DELIVERIES,
} from "./presentation";
import {
  mcpReaderHtml,
  mcpComponentHtml,
  readerResourceUri,
  componentResourceUri,
} from "./mcp-ui";
import { errorResult } from "./service";
import { supportInfo } from "./support";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderReading } from "./reading-renderer";
import type { ReadingOptions } from "./page-reading";

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

/** What the installing plugin declares about its host; harness names prove nothing. */
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
/** A model copies compact text into its reply; larger fragments are not passed this way. */
const COMPACT_BYTES = 32 * 1024;

/**
 * What a host whose model writes the HTML itself should do with a presented
 * page. Without this the model treats page_present as already displayed.
 */
export function conversationHandoff(
  compact: string | undefined,
  blockIds: string[] | undefined,
  display: HostDisplay | undefined,
  tool: "page_present" | "render_document",
) {
  const saved = tool === "page_present";
  if (!display || HOST_DISPLAYS[display] !== "compact") return undefined;
  if (!compact)
    return {
      mode: "unavailable",
      next: `This runtime has no CDN reader, so the page cannot be shown in the conversation. Give the person ${saved ? "openUrl" : "the html file"} and say that the inline view is unavailable.`,
    };
  const bytes = Buffer.byteLength(compact);
  if (bytes <= COMPACT_BYTES)
    return {
      mode: "compact",
      fragment: compact,
      next: `Pass fragment unchanged to the host's model-written HTML visualization tool now; the person has not seen the page until it is shown.${saved ? " Then give openUrl for the saved Page." : ""}`,
    };
  return {
    mode: "too-large",
    bytes,
    limit: COMPACT_BYTES,
    next: blockIds
      ? `These blocks are still too large to show in the conversation. Call ${tool} again with fewer blockIds, or give the person ${saved ? "openUrl" : "the html file"}.`
      : `The whole ${saved ? "page" : "document"} is too large to show in the conversation. Call ${tool} again with blockIds for the one to three blocks the person most needs to see${saved ? ' (page_read detail:"outline" lists them)' : ""}, show that fragment, and give ${saved ? "openUrl" : "the html file"} for the whole ${saved ? "page" : "document"}.`,
  };
}
/** Spreads a handoff into a tool result only when the host needs one. */
export function withConversation(
  conversation: ReturnType<typeof conversationHandoff>,
) {
  return conversation ? { conversation } : {};
}
/** Fragment files are conversation previews, not deliverables; only recent ones are kept. */
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
    // The image shows what the conversation fragment shows. Without these
    // overrides the root Page is viewport-high and scrolls its components
    // inside it, so the capture would end at the viewport.
    await writeFile(
      path,
      html.replace(
        /<head\b[^>]*>/i,
        (open) => `${open}<style>${INLINE_READER_OVERRIDES}</style>`,
      ),
      "utf8",
    );
    return await renderReading(path, {
      // A short viewport lets the full-page capture end where the components end.
      viewport: { width: 760, height: 240 },
      theme,
      actions: [],
    } as unknown as ReadingOptions);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
/** Legacy service receipts include CLI navigation hints. They are not Agent commands. */
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
export function mcpFailure(error: unknown) {
  const result = { ok: false, error: errorResult(error) };
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
    /** Read-only access to saved components; undefined on public connections. */
    componentLibrary?: {
      root: string;
      resolveProject(projectId?: string): Promise<string | undefined>;
    };
    /** Parent directory for fragment-file previews of show_component. */
    previewDirectory?: string;
    hostDisplay?: HostDisplay;
  },
) {
  const declaredDisplay = options.hostDisplay ?? hostDisplay();
  const safe = (handler: () => Promise<unknown>) =>
    handler().then(mcpSuccess, mcpFailure);
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  server.registerResource(
    "showai-reader",
    readerResourceUri,
    { mimeType: "text/html;profile=mcp-app" },
    async () => {
      // Conversation previews import the CDN reader; hosts block other origins.
      const domains = cdnReaderOrigins(await cdnReaderUrls());
      return {
        contents: [
          {
            uri: readerResourceUri,
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
  server.registerResource(
    "showai-component",
    componentResourceUri,
    { mimeType: "text/html;profile=mcp-app" },
    async () => {
      const domains = cdnReaderOrigins(await cdnReaderUrls());
      return {
        contents: [
          {
            uri: componentResourceUri,
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
          // Large arguments and results through files on the device running ShowAI.
          localFiles: {
            available:
              options.privateProjects !== false && options.transport !== "http",
            inputs: {
              page_apply: ["operationsFile"],
              dataset_write: ["valueFile", "operationsFile"],
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
            formats: ["json", "csv", "tsv"],
            exportConfirmation: { parameter: "externalData", value: "embed" },
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
          "Use MCP for all Agent document operations. Route each request: discussion is answered in text; a visualization the user only wants to see now uses show_component (1–5 components, nothing saved); a document to keep, edit or share resolves a project, reads/creates, edits, saves, then page_present. render_document is for a complete standalone document that is not saved. When the user later asks to keep a shown component, save the same {kind,data} in a Page. Do not switch connection, library or persistence mode after a failure.",
        next: `For a conversation visualization: public_catalog_describe (or catalog_describe) view=guide for the chosen component → show_component. For a complete standalone document: public_catalog_list → public_catalog_describe → render_document. ${options.privateProjects === false ? "This connection has no private project entry; use a project connection when persistence is requested." : `For project work: ${options.transport === "http" ? "projects_list" : "project_context"} → page_read/create/apply/save. Display is optional; check synchronization separately.`}`,
      }),
  );
  server.registerTool(
    "public_catalog_list",
    {
      description:
        "List public component and template names, descriptions, scenarios and one-line props signatures; limit/cursor paginate.",
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
        "Read a public component's guide, schema, examples or source, or a public template's source.",
      inputSchema: {
        id: z.string(),
        stage: z.enum(TEMPLATE_STAGES).optional(),
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
        "Render a complete standalone document from public components/templates or supplied sources without saving it.",
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
        return mcpFailure(error);
      }
    },
  );
  server.registerTool(
    "show_component",
    {
      description: `Show 1–${SHOW_COMPONENT_LIMIT} components in the conversation without saving. kind/data match page_apply component.insert, so the same component can later be saved in a Page.`,
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
                : "No CDN reader is configured for a compact fragment; an image is returned instead.",
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
          // Same field as page_present, so file-reading host adapters handle both.
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
        const result = mcpSuccess({
          ...(shown.title ? { title: shown.title } : {}),
          components: shown.components,
          delivery,
          bytes: {
            inline: shown.inline ? Buffer.byteLength(shown.inline) : null,
          },
          display: {
            resourceAttached: true,
            inlineAvailable: !!shown.inline,
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
            },
          },
        };
      } catch (error) {
        return mcpFailure(error);
      }
    },
  );
}
