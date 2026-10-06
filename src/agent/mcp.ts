import { randomUUID } from "node:crypto";
import { changeContext, withChangeContext } from "../core/history-context";
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
      instructions: `ShowAI creates interactive pages in project ${projectId}. This connection is bound to that project. Page reading defaults to structured JSON/Markdown. Use image for visual checks and html for browser DOM and interaction checks; guide reading documents viewport, theme, partial scope, actions and temporary draft previews. Retain the source hash and revision before writing; versioned page writes require baseRevision. Use catalog summaries to choose resources and explicit views for details or source. Shared revisions are immutable; fork/merge into this project. Shared promotion or published registration needs an explicit CLI/desktop action.`,
    },
  );
  const inherited = changeContext();
  const changeSchema = {
    operationId: z.string().max(1000).optional(),
    message: z.string().max(4000).optional(),
    groupId: z.string().max(1000).optional(),
  };
  const call = (
    handler: () => Promise<unknown>,
    metadata: { operationId?: string; message?: string; groupId?: string } = {},
  ) =>
    Promise.resolve()
      .then(() =>
        withChangeContext(
          {
            ...inherited,
            channel: "mcp",
            operationId: metadata.operationId ?? randomUUID(),
            requestFingerprint: undefined,
            message: metadata.message ?? inherited.message,
            groupId: metadata.groupId ?? inherited.groupId,
          },
          handler,
        ),
      )
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
        ...changeSchema,
        title: z.string().optional(),
        kind: z.enum(["page", "board"]).optional(),
        document: jsonObject.optional(),
        components: z.array(jsonObject).max(100).optional(),
        remoteComponents: z.array(jsonObject).max(100).optional(),
      },
      annotations: { ...write, openWorldHint: true },
    },
    ({ title, kind, document, components, remoteComponents, ...metadata }) =>
      call(
        () =>
          service.createPage(projectId, {
            title,
            kind,
            ...(document ? { document: validateDocument(document) } : {}),
            components: components as unknown as
              CompiledComponent[] | undefined,
            remoteComponents: remoteComponents as unknown as
              PublishedComponentLocator[] | undefined,
          }),
        metadata,
      ),
  );
  server.registerTool(
    "page_save",
    {
      description:
        "Save a page with its current baseHash; rejects stale content with CONFLICT. Use guide authoring for the editing workflow.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        document: jsonObject,
        baseHash: z.string().min(1),
        baseRevision: z.string().optional(),
        components: z.array(jsonObject).max(100).optional(),
        remoteComponents: z.array(jsonObject).max(100).optional(),
      },
      annotations: { ...write, openWorldHint: true },
    },
    ({
      pageId,
      document,
      baseHash,
      baseRevision,
      components,
      remoteComponents,
      ...metadata
    }) =>
      call(
        () =>
          service.savePage(
            projectId,
            pageId,
            validateDocument(document),
            baseHash,
            components as unknown as CompiledComponent[] | undefined,
            remoteComponents as unknown as
              PublishedComponentLocator[] | undefined,
            baseRevision,
          ),
        metadata,
      ),
  );
  server.registerTool(
    "page_apply",
    {
      description:
        "Apply stable-block-id operations with a current baseHash. Query guide authoring for the operation shapes.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        baseHash: z.string().min(1),
        baseRevision: z.string().optional(),
        operations: z.array(jsonObject).max(1000),
      },
      annotations: write,
    },
    ({ pageId, baseHash, baseRevision, operations, ...metadata }) =>
      call(
        () =>
          service.applyPage(projectId, pageId, {
            baseHash,
            baseRevision,
            operations: operations as PageOperation[],
          }),
        metadata,
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
        revision: z.string().optional(),
        importedSnapshot: z
          .object({ importId: z.string(), snapshotId: z.string() })
          .optional(),
        components: z.enum(["bundled", "remote"]).optional(),
        out: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
      annotations: write,
    },
    ({
      pageId,
      blockIds,
      format,
      components,
      out,
      overwrite,
      presentation,
      revision,
      importedSnapshot,
    }) =>
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
          revision,
          importedSnapshot,
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
      inputSchema: { ...changeSchema, directory: z.string().min(1) },
      annotations: write,
    },
    ({ directory, ...metadata }) =>
      call(() => service.importComponent(directory, projectId), metadata),
  );
  server.registerTool(
    "component_save",
    {
      description:
        "Save explicitly supplied component source as a new immutable revision in this project. Read guide catalog and source view first.",
      inputSchema: { ...changeSchema, source: jsonObject },
      annotations: write,
    },
    ({ source, ...metadata }) =>
      call(
        () =>
          service.saveComponent(
            projectId,
            source as unknown as ComponentSource,
          ),
        metadata,
      ),
  );
  server.registerTool(
    "template_apply",
    {
      description:
        "Create a whiteboard from a template, or insert into pageId with its baseHash and optional parentId. Returns the updated page and hash.",
      inputSchema: {
        ...changeSchema,
        templateId: z.string(),
        pageId: z.string().optional(),
        baseHash: z.string().optional(),
        baseRevision: z.string().optional(),
        parentId: z.string().optional(),
        title: z.string().optional(),
        scope: z.enum(["builtin", "global", "published", "project"]).optional(),
        version: z.string().optional(),
        integrity: z.string().optional(),
      },
      annotations: write,
    },
    ({ templateId, title, operationId, message, groupId, ...selection }) =>
      call(
        () => service.applyTemplate(projectId, templateId, title, selection),
        { operationId, message, groupId },
      ),
  );
  server.registerTool(
    "template_save",
    {
      description:
        "Create an immutable project template from a page or explicit metadata/composition. Use guide templates for input shape.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string().optional(),
        input: jsonObject,
      },
      annotations: write,
    },
    ({ pageId, input, ...metadata }) =>
      call(
        () =>
          service.saveTemplate(
            projectId,
            pageId,
            input as unknown as SaveTemplateInput,
          ),
        metadata,
      ),
  );
  server.registerTool(
    "catalog_fork",
    {
      description:
        "Fork an exact shared or current-project revision into a new revision owned by this project.",
      inputSchema: {
        ...changeSchema,
        ref: refSchema,
        id: z.string().optional(),
        version: z.string(),
        name: z.string().optional(),
      },
      annotations: write,
    },
    ({ ref, operationId, message, groupId, ...target }) =>
      call(() => service.fork(projectId, ref, target), {
        operationId,
        message,
        groupId,
      }),
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
        ...changeSchema,
        base: refSchema,
        ours: refSchema,
        theirs: refSchema,
        id: z.string().optional(),
        version: z.string(),
        resolved: jsonObject,
      },
      annotations: write,
    },
    ({ resolved, operationId, message, groupId, ...input }) =>
      call(
        () =>
          service.resolveMerge(projectId, {
            ...input,
            resolved: resolved as unknown as EditablePackage,
          }),
        { operationId, message, groupId },
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
  server.registerTool(
    "history_list",
    {
      description:
        "List committed change times, actors, sessions and touched resources in this project.",
      inputSchema: {
        pageId: z.string().optional(),
        harness: z.string().optional(),
        sessionId: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        before: z.string().optional(),
      },
      annotations: readOnly,
    },
    (input) => call(() => service.history({ ...input, projectId })),
  );
  server.registerTool(
    "library_search",
    {
      description:
        "Search this project's page body, nested containers, component/template descriptions and source, returning node locations.",
      inputSchema: {
        query: z.string(),
        kind: z
          .enum(["page", "component", "template", "project", "source"])
          .optional(),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      },
      annotations: readOnly,
    },
    (input) => call(() => service.search({ ...input, projectId })),
  );
  server.registerTool(
    "history_compare",
    {
      description:
        "Compare two exact committed revisions, optionally for one page.",
      inputSchema: {
        before: z.string(),
        after: z.string(),
        pageId: z.string().optional(),
      },
      annotations: readOnly,
    },
    ({ before, after, pageId }) =>
      call(() => service.compareHistory(before, after, { projectId, pageId })),
  );
  server.registerTool(
    "history_page",
    {
      description:
        "Read a historical page with its exact verified component dependency closure.",
      inputSchema: { pageId: z.string(), revision: z.string() },
      annotations: readOnly,
    },
    ({ pageId, revision }) =>
      call(() => service.historicalPage(projectId, pageId, revision)),
  );
  server.registerTool(
    "history_restore",
    {
      description:
        "Restore a page and its needed component/source versions as a new change. Requires the current resource revision.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        revision: z.string(),
        baseRevision: z.string(),
      },
      annotations: write,
    },
    ({ operationId, message, groupId, ...input }) =>
      call(() => service.restorePage({ ...input, projectId }), {
        operationId,
        message,
        groupId,
      }),
  );
  server.registerTool(
    "history_html",
    {
      description:
        "Render a historical page with its captured reader code and exact component dependencies.",
      inputSchema: { pageId: z.string(), revision: z.string() },
      annotations: readOnly,
    },
    ({ pageId, revision }) =>
      call(() => service.historicalHtml(projectId, pageId, revision)),
  );
  server.registerTool(
    "history_imported_snapshots",
    {
      description:
        "List separately imported old checkpoints. Original edit times, actors and ordering are unknown.",
      inputSchema: { pageId: z.string().optional() },
      annotations: readOnly,
    },
    ({ pageId }) => call(() => service.importedSnapshots(projectId, pageId)),
  );
  server.registerTool(
    "history_imported_page",
    {
      description:
        "Read a retained old checkpoint and its verified dependencies without assigning a fabricated history order.",
      inputSchema: {
        pageId: z.string(),
        importId: z.string(),
        snapshotId: z.string(),
      },
      annotations: readOnly,
    },
    ({ pageId, ...ref }) =>
      call(() => service.importedPage(projectId, pageId, ref)),
  );
  server.registerTool(
    "history_restore_imported_snapshot",
    {
      description:
        "Restore a reviewed old checkpoint as a new attributed commit while preserving its unknown original provenance.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        importId: z.string(),
        snapshotId: z.string(),
        baseRevision: z.string().nullable(),
      },
      annotations: write,
    },
    ({ operationId, message, groupId, ...input }) =>
      call(() => service.restoreImportedSnapshot({ ...input, projectId }), {
        operationId,
        message,
        groupId,
      }),
  );
  server.registerTool(
    "page_merge_preview",
    {
      description:
        "Compare a local draft, its exact base and the current page; conflicts retain all three values.",
      inputSchema: {
        pageId: z.string(),
        baseRevision: z.string(),
        document: jsonObject,
      },
      annotations: readOnly,
    },
    ({ document, ...input }) =>
      call(() =>
        service.pageMergePreview({
          ...input,
          projectId,
          document: validateDocument(document),
        }),
      ),
  );
  server.registerTool(
    "page_merge_save",
    {
      description:
        "Commit a reviewed resolved page, rechecking the current resource revision.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        baseRevision: z.string(),
        currentRevision: z.string(),
        document: jsonObject,
      },
      annotations: write,
    },
    ({ operationId, message, groupId, document, ...input }) =>
      call(
        () =>
          service.pageMergeSave({
            ...input,
            projectId,
            document: validateDocument(document),
          }),
        { operationId, message, groupId },
      ),
  );
  server.registerTool(
    "workspace_conflicts",
    {
      description: "List retained external file changes in this project.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => call(() => service.workspaceConflicts(projectId)),
  );
  server.registerTool(
    "workspace_conflict",
    {
      description:
        "Read the preserved external bytes and their formal/baseline versions.",
      inputSchema: { id: z.string() },
      annotations: readOnly,
    },
    ({ id }) => call(() => service.workspaceConflict(id)),
  );
  server.registerTool(
    "workspace_resolve",
    {
      description:
        "Resolve an external change by discard, validated page import or reviewed merge. Preserved external snapshots remain available.",
      inputSchema: {
        ...changeSchema,
        id: z.string(),
        resolution: z.enum(["discard", "import", "merge"]),
        document: jsonObject.optional(),
      },
      annotations: write,
    },
    ({ operationId, message, groupId, document, ...input }) =>
      call(
        () =>
          service.resolveWorkspaceConflict({
            ...input,
            ...(document ? { document: validateDocument(document) } : {}),
          }),
        { operationId, message, groupId },
      ),
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
