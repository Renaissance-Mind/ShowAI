import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import packageMetadata from "../../package.json";
import { AgentService, errorResult } from "./service";
import { validateDocument } from "../portable/validation.mjs";
import type {
  CompiledComponent,
  ComponentSource,
  EditablePackage,
  SaveTemplateInput,
} from "../components/custom/types";
import type { PageOperation } from "../core/model";
import type { PublishedComponentLocator } from "../core/publication";
import { CATALOG_VIEWS } from "./disclosure";
import { GUIDE_TOPICS } from "./guides";
import { pageReadSchema, type PageReadResult } from "./page-reading";
import { readFile } from "node:fs/promises";

const scopeSchema = z.enum([
  "builtin",
  "global",
  "published",
  "project",
  "all",
]);
const refSchema = z.object({
  kind: z.enum(["component", "template"]),
  id: z.string(),
  version: z.string(),
  integrity: z.string(),
  scope: z.enum(["builtin", "global", "published", "project"]).optional(),
  projectId: z.string().optional(),
});
const jsonObject = z.record(z.string(), z.unknown());

export function createMcpServer(options: {
  root?: string;
  projectId: string;
}): McpServer {
  const service = new AgentService(options);
  const projectId = service.requireProject(options.projectId);
  const server = new McpServer(
    { name: "showai", version: packageMetadata.version },
    {
      instructions: `ShowAI creates interactive pages in project ${projectId}. This connection is bound to that project. Page reading defaults to structured JSON/Markdown. Use image for visual checks and html for browser DOM and interaction checks; guide reading documents viewport, theme, partial scope, actions and temporary draft previews. Retain the source hash before writing. Use catalog summaries to choose resources and explicit views for details or source. Shared revisions are immutable; fork/merge into this project. Shared promotion or published registration needs an explicit CLI/desktop action.`,
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
    "guide",
    {
      description:
        "Read one focused ShowAI guide only when that operation is needed. Omitting topic lists the available guides.",
      inputSchema: { topic: z.enum(GUIDE_TOPICS).optional() },
      annotations: readOnly,
    },
    ({ topic }) => call(async () => service.guide(topic)),
  );
  server.registerTool(
    "project_context",
    {
      description:
        "Inspect this connection's project identity and storage root. It cannot select another project.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      call(async () => ({
        project: (await service.listProjects())[0],
        root: service.store.root,
        next: "guide workspace",
      })),
  );
  server.registerTool(
    "pages_list",
    {
      description:
        "List page titles, identities and current hashes in the bound project.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => call(() => service.listPages(projectId)),
  );
  server.registerTool(
    "page_read",
    {
      description:
        "Read one Page in structured (default JSON/Markdown), image (PNG) or html (browser accessibility/DOM plus an interactive file) view. Use structured for content/data, image to verify styling, and html/actions to check interactions. detail=outline discovers IDs; blockIds selects a component/region. All views share source hash and pinned component refs. draft=true edits only a temporary preview. See guide reading.",
      inputSchema: { pageId: z.string().min(1), ...pageReadSchema.shape },
      annotations: readOnly,
    },
    ({ pageId, ...readOptions }) =>
      call(() => service.readPage(projectId, pageId, readOptions)).then(
        async (result) => {
          if (!("data" in result.structuredContent)) return result;
          const data = result.structuredContent.data as PageReadResult;
          if (data.view !== "image" || !data.path) return result;
          const png = await readFile(data.path);
          if (png.length > 8 * 1024 * 1024)
            throw new Error(
              "PNG exceeds the 8 MB MCP image limit. Read a smaller blockIds scope or viewport.",
            );
          return {
            ...result,
            content: [
              ...result.content,
              {
                type: "image" as const,
                mimeType: "image/png",
                data: png.toString("base64"),
              },
            ],
          };
        },
      ),
  );
  server.registerTool(
    "page_create",
    {
      description:
        "Create a page in the bound project. Optional artifact components are imported into this project; remote components are fetched and verified.",
      inputSchema: {
        title: z.string().optional(),
        kind: z.enum(["page", "board"]).optional(),
        document: jsonObject.optional(),
        components: z.array(jsonObject).max(100).optional(),
        remoteComponents: z.array(jsonObject).max(100).optional(),
      },
      annotations: { ...write, openWorldHint: true },
    },
    ({ title, kind, document, components, remoteComponents }) =>
      call(() =>
        service.createPage(projectId, {
          title,
          kind,
          ...(document ? { document: validateDocument(document) } : {}),
          components: components as unknown as CompiledComponent[] | undefined,
          remoteComponents: remoteComponents as unknown as
            PublishedComponentLocator[] | undefined,
        }),
      ),
  );
  server.registerTool(
    "page_save",
    {
      description:
        "Save a page with its current baseHash; rejects stale content with CONFLICT. Use guide authoring for the editing workflow.",
      inputSchema: {
        pageId: z.string(),
        document: jsonObject,
        baseHash: z.string().min(1),
        components: z.array(jsonObject).max(100).optional(),
        remoteComponents: z.array(jsonObject).max(100).optional(),
      },
      annotations: { ...write, openWorldHint: true },
    },
    ({ pageId, document, baseHash, components, remoteComponents }) =>
      call(() =>
        service.savePage(
          projectId,
          pageId,
          validateDocument(document),
          baseHash,
          components as unknown as CompiledComponent[] | undefined,
          remoteComponents as unknown as
            PublishedComponentLocator[] | undefined,
        ),
      ),
  );
  server.registerTool(
    "page_apply",
    {
      description:
        "Apply stable-block-id operations with a current baseHash. Query guide authoring for the operation shapes.",
      inputSchema: {
        pageId: z.string(),
        baseHash: z.string().min(1),
        operations: z.array(jsonObject).max(1000),
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
        "Compare a page with a previous read hash, including user edits, without accepting or overwriting changes.",
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
        "Build HTML, a conversation fragment or a static site. Select page blocks with blockIds for partial HTML/inline display; partial exports default to reading layout. Bundled is offline; remote needs verified locators. Inline requires bundled. This does not upload a site.",
      inputSchema: {
        pageId: z.string().optional(),
        blockIds: z.array(z.string().min(1)).min(1).optional(),
        format: z.enum(["html", "inline", "site"]),
        presentation: z.enum(["spatial", "reading"]).optional(),
        components: z.enum(["bundled", "remote"]).optional(),
        out: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
      annotations: write,
    },
    ({ pageId, blockIds, format, components, out, overwrite, presentation }) =>
      call(() =>
        service.export({
          projectId,
          pageId,
          blockIds,
          format,
          components,
          out,
          overwrite,
          presentation,
        }),
      ),
  );

  server.registerTool(
    "catalog_list",
    {
      description:
        "Find paginated component/template summaries. Does not return schemas, default data, source or complete template documents.",
      inputSchema: {
        kind: z.enum(["component", "template"]).optional(),
        scope: scopeSchema.optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      },
      annotations: readOnly,
    },
    (input) => call(() => service.catalogList({ projectId, ...input })),
  );
  server.registerTool(
    "catalog_describe",
    {
      description:
        "Read a resource summary by default. Request guide/schema/examples/dependencies/full only as needed; source code or template bodies require view=source.",
      inputSchema: {
        id: z.string(),
        kind: z.enum(["component", "template"]).optional(),
        scope: scopeSchema.optional(),
        version: z.string().optional(),
        integrity: z.string().optional(),
        view: z.enum(CATALOG_VIEWS).optional(),
        file: z.string().optional(),
      },
      annotations: readOnly,
    },
    ({ id, ...input }) =>
      call(() => service.catalogDescribe(id, { projectId, ...input })),
  );
  server.registerTool(
    "component_import",
    {
      description:
        "Import and compile a local component package into this project. Existing revisions cannot be overwritten.",
      inputSchema: { directory: z.string().min(1) },
      annotations: write,
    },
    ({ directory }) =>
      call(() => service.importComponent(directory, projectId)),
  );
  server.registerTool(
    "component_save",
    {
      description:
        "Save explicitly supplied component source as a new immutable revision in this project. Read guide catalog and source view first.",
      inputSchema: { source: jsonObject },
      annotations: write,
    },
    ({ source }) =>
      call(() =>
        service.saveComponent(projectId, source as unknown as ComponentSource),
      ),
  );
  server.registerTool(
    "template_apply",
    {
      description:
        "Create a whiteboard from a template, or insert into pageId with its baseHash and optional parentId. Returns the updated page and hash.",
      inputSchema: {
        templateId: z.string(),
        pageId: z.string().optional(),
        baseHash: z.string().optional(),
        parentId: z.string().optional(),
        title: z.string().optional(),
        scope: z.enum(["builtin", "global", "published", "project"]).optional(),
        version: z.string().optional(),
        integrity: z.string().optional(),
      },
      annotations: write,
    },
    ({ templateId, title, ...selection }) =>
      call(() =>
        service.applyTemplate(projectId, templateId, title, selection),
      ),
  );
  server.registerTool(
    "template_save",
    {
      description:
        "Create an immutable project template from a page or explicit metadata/composition. Use guide templates for input shape.",
      inputSchema: { pageId: z.string().optional(), input: jsonObject },
      annotations: write,
    },
    ({ pageId, input }) =>
      call(() =>
        service.saveTemplate(
          projectId,
          pageId,
          input as unknown as SaveTemplateInput,
        ),
      ),
  );
  server.registerTool(
    "catalog_fork",
    {
      description:
        "Fork an exact shared or current-project revision into a new revision owned by this project.",
      inputSchema: {
        ref: refSchema,
        id: z.string().optional(),
        version: z.string(),
        name: z.string().optional(),
      },
      annotations: write,
    },
    ({ ref, ...target }) => call(() => service.fork(projectId, ref, target)),
  );
  server.registerTool(
    "catalog_merge_preview",
    {
      description:
        "Preview a three-way merge without writing. Defaults to conflict paths; view=source explicitly returns the editable candidate and conflict values.",
      inputSchema: {
        base: refSchema,
        ours: refSchema,
        theirs: refSchema,
        view: z.enum(["summary", "source"]).optional(),
      },
      annotations: readOnly,
    },
    ({ view, ...input }) =>
      call(async () => {
        const preview = await service.previewMerge(projectId, input);
        return view === "source"
          ? preview
          : {
              projectId,
              kind: preview.kind,
              base: preview.base,
              ours: preview.ours,
              theirs: preview.theirs,
              conflictCount: preview.conflicts.length,
              conflicts: preview.conflicts.map(({ path, kind }) => ({
                path,
                kind,
              })),
              next: "Read catalog_merge_preview with view=source, resolve conflicts, then catalog_merge_resolve with a new version.",
            };
      }),
  );
  server.registerTool(
    "catalog_merge_resolve",
    {
      description:
        "Save a reviewed merge resolution as a new project revision. Shared scopes cannot be overwritten from this connection.",
      inputSchema: {
        base: refSchema,
        ours: refSchema,
        theirs: refSchema,
        id: z.string().optional(),
        version: z.string(),
        resolved: jsonObject,
      },
      annotations: write,
    },
    ({ resolved, ...input }) =>
      call(() =>
        service.resolveMerge(projectId, {
          ...input,
          resolved: resolved as unknown as EditablePackage,
        }),
      ),
  );
  server.registerTool(
    "publication_prepare",
    {
      description:
        "Prepare local static publication files from exact refs. Does not upload or register a shared published release. Query guide publish for the explicit next step.",
      inputSchema: { refs: z.array(refSchema).min(1), out: z.string() },
      annotations: write,
    },
    (input) => call(() => service.preparePublication(projectId, input)),
  );
  server.registerTool(
    "publication_list",
    {
      description:
        "List small verified publication references already registered in the local shared library; no network or registration writes.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      },
      annotations: readOnly,
    },
    (input) => call(() => service.publications(input)),
  );
  return server;
}

export async function startMcp(options: {
  root?: string;
  projectId: string;
}): Promise<void> {
  const service = new AgentService(options);
  await service.listPages(service.requireProject(options.projectId));
  await createMcpServer(options).connect(new StdioServerTransport());
  process.stderr.write(
    `ShowAI MCP connected to project ${options.projectId}.\n`,
  );
}
