import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentService, errorResult } from "./service";
import { validateDocument } from "../portable/validation.mjs";
import type { CompiledComponent } from "../components/custom/types";
import type { PageOperation } from "../core/model";

export function createMcpServer(options: {
  root?: string;
  projectId: string;
}): McpServer {
  const service = new AgentService(options);
  const projectId = service.requireProject(options.projectId);
  const server = new McpServer(
    { name: "showai", version: "0.3.1" },
    {
      instructions: `Create and revise interactive ShowAI pages in project ${projectId}. This connection cannot switch projects. Read pages before writing; keep their hash and use page_diff before a follow-up. Supply baseHash for saves and patches. A conflict means another edit occurred: reread, inspect the diff and merge deliberately. Export HTML for sharing, inline for a host-supported visualization surface, or site for static hosting. Export does not itself install UI in the host or publish to the internet.`,
    },
  );
  const call = (handler: () => Promise<unknown>) =>
    Promise.resolve()
      .then(handler)
      .then(
        (data) => ({
          content: [
            { type: "text" as const, text: JSON.stringify({ ok: true, data }) },
          ],
          structuredContent: { ok: true, data },
        }),
        (error: unknown) => ({
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: errorResult(error) }),
            },
          ],
          structuredContent: { ok: false, error: errorResult(error) },
        }),
      );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const write = {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  };
  server.registerTool(
    "project_context",
    {
      description:
        "Inspect the single project bound to this connection and the ShowAI storage directory.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      call(async () => ({
        project: (await service.listProjects())[0],
        root: service.store.root,
      })),
  );
  server.registerTool(
    "pages_list",
    {
      description:
        "List pages in this connection's project, including titles and current hashes.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => call(() => service.listPages(projectId)),
  );
  server.registerTool(
    "page_read",
    {
      description:
        "Read a page and checkpoint its content for later diff. Save the returned hash for the next revision.",
      inputSchema: { pageId: z.string().min(1) },
      annotations: readOnly,
    },
    ({ pageId }) => call(() => service.readPage(projectId, pageId)),
  );
  server.registerTool(
    "page_create",
    {
      description:
        "Create a page in this connection's project. A document, when supplied, is a ShowAI document JSON object.",
      inputSchema: {
        title: z.string().optional(),
        document: z.record(z.string(), z.unknown()).optional(),
        components: z
          .array(z.record(z.string(), z.unknown()))
          .max(100)
          .optional(),
      },
      annotations: write,
    },
    ({ title, document, components }) =>
      call(() =>
        service.createPage(projectId, {
          title,
          components: components as unknown as CompiledComponent[] | undefined,
          ...(document ? { document: validateDocument(document) } : {}),
        }),
      ),
  );
  server.registerTool(
    "page_save",
    {
      description:
        "Replace a page using a hash from page_read. Rejects stale writes with CONFLICT and currentHash.",
      inputSchema: {
        pageId: z.string(),
        document: z.record(z.string(), z.unknown()),
        components: z
          .array(z.record(z.string(), z.unknown()))
          .max(100)
          .optional(),
        baseHash: z.string().min(1),
      },
      annotations: write,
    },
    ({ pageId, document, baseHash, components }) =>
      call(() =>
        service.savePage(
          projectId,
          pageId,
          validateDocument(document),
          baseHash,
          components as unknown as CompiledComponent[] | undefined,
        ),
      ),
  );
  server.registerTool(
    "page_apply",
    {
      description:
        "Apply stable-block-id operations: page.set(fields), block.insert(node,parentId?,afterId?), block.remove(blockId), block.replace(blockId,node), block.move(blockId,parentId?,afterId?), block.attrs.set(blockId,attrs), block.text.set(blockId,text). Requires the last read hash.",
      inputSchema: {
        pageId: z.string(),
        baseHash: z.string().min(1),
        operations: z.array(z.record(z.string(), z.unknown())).max(1000),
      },
      annotations: write,
    },
    ({ pageId, baseHash, operations }) =>
      call(() =>
        service.applyPage(projectId, pageId, {
          baseHash,
          operations: operations as PageOperation[],
        }),
      ),
  );
  server.registerTool(
    "page_diff",
    {
      description:
        "Compare current content to a hash previously returned by page_read. Reports changed fields, added/removed/changed/moved blocks. Never marks changes as accepted.",
      inputSchema: { pageId: z.string(), sinceHash: z.string().min(1) },
      annotations: readOnly,
    },
    ({ pageId, sinceHash }) =>
      call(() => service.diffPage(projectId, pageId, sinceHash)),
  );
  server.registerTool(
    "page_export",
    {
      description:
        "Export a page as offline HTML, a conversation HTML fragment, or the project's pages as a static site. Returns local output/source paths. Does not publish or promise host UI rendering. Images must be embedded.",
      inputSchema: {
        pageId: z.string().optional(),
        format: z.enum(["html", "inline", "site"]),
        out: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
      annotations: write,
    },
    ({ pageId, format, out, overwrite }) =>
      call(() => service.export({ projectId, pageId, format, out, overwrite })),
  );
  server.registerTool(
    "catalog_list",
    {
      description:
        "Find available built-in and installed components and templates by kind or search text. Results contain usage descriptions and versions.",
      inputSchema: {
        kind: z.enum(["component", "template"]).optional(),
        query: z.string().optional(),
      },
      annotations: readOnly,
    },
    ({ kind, query }) =>
      call(() => service.catalogList({ projectId, kind, query })),
  );
  server.registerTool(
    "catalog_describe",
    {
      description:
        "Read a component's input schema, usage metadata and presets, or a template's full page structure. Component implementation code is omitted from the tool response.",
      inputSchema: {
        id: z.string(),
        kind: z.enum(["component", "template"]).optional(),
        version: z.string().optional(),
      },
      annotations: readOnly,
    },
    ({ id, kind, version }) =>
      call(() => service.catalogDescribe(id, { projectId, kind, version })),
  );
  server.registerTool(
    "component_import",
    {
      description:
        "Compile and install a local React component package into this project's catalog. Package versions are immutable; a changed implementation requires a new version.",
      inputSchema: { directory: z.string().min(1) },
      annotations: write,
    },
    ({ directory }) =>
      call(() => service.importComponent(directory, projectId)),
  );
  server.registerTool(
    "template_apply",
    {
      description:
        "Create a new editable page from a template in this project. Does not replace an existing page.",
      inputSchema: { templateId: z.string(), title: z.string().optional() },
      annotations: write,
    },
    ({ templateId, title }) =>
      call(() => service.applyTemplate(projectId, templateId, title)),
  );
  server.registerTool(
    "template_save",
    {
      description:
        "Save an existing page as a project template with its layout, content and component settings.",
      inputSchema: {
        pageId: z.string(),
        name: z.string(),
        description: z.string().default(""),
      },
      annotations: write,
    },
    ({ pageId, name, description }) =>
      call(() =>
        service.saveTemplate(projectId, pageId, { name, description }),
      ),
  );
  return server;
}

export async function startMcp(options: {
  root?: string;
  projectId: string;
}): Promise<void> {
  const service = new AgentService(options);
  // Fail before advertising tools when a project id was mistyped or is unavailable.
  await service.listPages(service.requireProject(options.projectId));
  const server = createMcpServer(options);
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `ShowAI MCP connected to project ${options.projectId}.\n`,
  );
}
