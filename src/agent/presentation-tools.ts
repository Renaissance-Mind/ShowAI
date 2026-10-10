import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATALOG_VIEWS } from "./disclosure";
import { version } from "../../package.json";
import {
  publicCatalog,
  describePublicResource,
  presentationSchema,
  renderPresentation,
} from "./presentation";
import { mcpReaderHtml, readerResourceUri } from "./mcp-ui";
import { errorResult } from "./service";

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
  },
) {
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
    async () => ({
      contents: [
        {
          uri: readerResourceUri,
          mimeType: "text/html;profile=mcp-app",
          text: mcpReaderHtml,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
              ...(options.widgetDomain ? { domain: options.widgetDomain } : {}),
            },
            "openai/widgetDescription":
              "Interactive ShowAI page. Read, explore and compare the supplied content.",
            "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
          },
        },
      ],
    }),
  );
  server.registerTool(
    "showai_capabilities",
    {
      description:
        "Discover ShowAI capabilities before choosing a workflow. Presentation and project synchronization are independent. No login required.",
      inputSchema: {},
      annotations: readOnly,
      _meta: { securitySchemes: noAuth },
    },
    async () =>
      mcpSuccess({
        version,
        agentProtocol: "showai-mcp-v1",
        transport: options.transport,
        presentation: {
          publicResources: true,
          customization: true,
          requiresProject: false,
          requiresSynchronization: false,
          outputs: ["mcp-app", "inline", "html", "source"],
          hostDisplay:
            "The harness determines whether inline or MCP Apps can be displayed. Always preserve a usable file or project receipt.",
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
          "Use MCP for all Agent document operations. Formal content: resolve project, read/create, edit, save, then page_present. Only explicitly standalone content uses render_document. Do not switch connection, library or persistence mode after a failure.",
        next: `For explicitly standalone presentation: public_catalog_list → public_catalog_describe → render_document. ${options.privateProjects === false ? "This connection has no private project entry; use a project connection when persistence is requested." : `For project work: ${options.transport === "http" ? "projects_list" : "project_context"} → page_read/create/apply/save. Display is optional; check synchronization separately.`}`,
      }),
  );
  server.registerTool(
    "public_catalog_list",
    {
      description:
        "Return all public component/template names, descriptions and scenarios by default, without login or synchronization. Omit query/limit/cursor for the full catalog; explicit limit/cursor opts into pagination. Read details with public_catalog_describe.",
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
        "Read public component guides, schemas, examples and editable source, or public template source. Customize locally or pass source to render_document; synchronization is optional.",
      inputSchema: {
        id: z.string(),
        kind: z.enum(["component", "template"]).optional(),
        view: z.enum(CATALOG_VIEWS).optional(),
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
        "Render explicitly standalone ShowAI content using public components/templates or supplied custom sources. Formal work uses page_create/save then page_present. Anonymous, independent of shared projects. Does not save into a personal project. Hosts without inline still receive usable HTML/source delivery. Read the relevant component schema first.",
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
              note: "The host displays the attached MCP Apps reader directly. Download URLs are for file delivery. If the execution sandbox cannot download them, use presentation_source when available.",
            },
            ...(presentation.inlineError
              ? { inlineError: presentation.inlineError }
              : {}),
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
}
