import { randomUUID } from "node:crypto";
import { changeContext, withChangeContext } from "../core/history-context";
import type { ChangeContext } from "../core/history-model";
import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerPresentationTools,
  mcpSuccess,
  mcpData,
  mcpFailure,
  readerToolMeta,
  type Presentation,
} from "./presentation-tools";
import { presentPage } from "./page-presentation";
import { getObjectShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
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
import { getMcpGuide } from "./mcp-guides";
import { pageReadSchema, type PageReadResult } from "./page-reading";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writePresentation } from "./presentation";
import { syncManager } from "../sync/manager";

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
  instructions?: string;
  decorateTool?: (name: string, tool: RegisteredTool) => void;
  presentation?: Parameters<typeof registerPresentationTools>[1];
  sourceContext?: ChangeContext;
  presentationDirectory?: string;
  projectAccess?: "library" | "project";
  storeProjectPresentation?: (
    value: Presentation,
  ) => Promise<import("./presentation-tools").PresentationDelivery>;
}): McpServer {
  const service = new AgentService(options);
  const projectId = service.requireProject(options.projectId);
  const server = new McpServer(
    { name: "showai", version: packageMetadata.version },
    {
      instructions:
        options.instructions ??
        `ShowAI creates interactive pages in project ${projectId}. This connection is bound to that project. Page reading defaults to structured JSON/Markdown. Use image for visual checks and html for browser DOM and interaction checks; guide reading documents viewport, theme, partial scope, actions and temporary draft previews. Retain the source hash and revision before writing; versioned page writes require baseRevision. Use catalog summaries to choose resources and explicit views for details or source. Shared revisions are immutable; fork/merge into this project. Shared promotion or published registration needs an explicit CLI/desktop action.`,
    },
  );
  const register: McpServer["registerTool"] = (name, config, callback) => {
    // All project operations accept an explicit identity, including bound connections.
    // Existing clients may omit it; an explicit mismatch must never be stripped silently.
    const tool = server.registerTool(name, config, callback);
    if (name !== "guide") {
      const shape = getObjectShape(tool.inputSchema);
      if (!shape) throw new Error(`Missing input schema: ${name}`);
      const original = tool.handler as ToolCallback<z.ZodRawShape>;
      tool.update({
        paramsSchema: { ...shape, projectId: z.string().min(1).optional() },
        callback: ({ projectId: selected, ...args }, extra) => {
          if (selected !== undefined && selected !== projectId)
            return mcpFailure(
              new Error("This MCP connection is bound to another project."),
            );
          return original(args, extra);
        },
      });
    }
    options.decorateTool?.(name, tool);
    return tool;
  };
  const inherited = options.sourceContext ?? changeContext();
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
        (input) => {
          const data = mcpData(input);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: true, data }),
              },
            ],
            structuredContent: { ok: true, data },
          };
        },
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

  register(
    "guide",
    {
      description:
        "Read one focused ShowAI guide only when that operation is needed. Omitting topic lists the available guides.",
      inputSchema: { topic: z.enum(GUIDE_TOPICS).optional() },
      annotations: readOnly,
    },
    ({ topic }) => call(async () => getMcpGuide(topic)),
  );
  register(
    "project_context",
    {
      description:
        "Initialize page/component work: inspect the bound project and receive the complete compact component index, revision and workflow guidance. It cannot select another project.",
      inputSchema: {
        knownCatalogRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      },
      annotations: readOnly,
    },
    ({ knownCatalogRevision }) =>
      call(async () => ({
        project: (await service.listProjects())[0],
        root: service.store.root,
        componentCatalog: await service.componentContext(
          projectId,
          knownCatalogRevision,
        ),
        next: "guide workspace",
      })),
  );
  register(
    "pages_list",
    {
      description:
        "List page titles, identities and current hashes in the bound project.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => call(() => service.listPages(projectId)),
  );
  register(
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
  register(
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
  register(
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
  register(
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
  register(
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
  register(
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

  register(
    "catalog_list",
    {
      description:
        "Return all component/template names, descriptions and scenarios, with identities for detail lookup. Components default to built-ins plus the selected project's components; explicitly set scope to query global/published/all. Omit query/limit/cursor for the full result; explicit limit/cursor opts into pagination. Schemas, examples and source require catalog_describe.",
      inputSchema: {
        kind: z.enum(["component", "template"]).optional(),
        scope: scopeSchema.optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
        versions: z.enum(["recommended", "all"]).optional(),
      },
      annotations: readOnly,
    },
    (input) => call(() => service.catalogList({ projectId, ...input })),
  );
  register(
    "catalog_describe",
    {
      description:
        "Read a summary by default. guide provides the versioned use contract, schema and a compact example; development provides implementation guidance without source. Read examples/dependencies/full as needed. Executable source requires view=source. Legacy missing documentation is explicitly marked.",
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
  register(
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
  register(
    "component_save",
    {
      description:
        "Save explicitly supplied component source as a new immutable revision in this project. Read guide catalog and source view first.",
      inputSchema: { ...changeSchema, source: jsonObject },
      annotations: write,
    },
    ({ source, ...metadata }) =>
      call(() => {
        if (
          !(source.manifest as Record<string, unknown> | undefined)
            ?.documentation
        )
          throw new Error(
            "New component authoring requires manifest.documentation. Read guide component for the contract; use component_import only for an existing legacy package.",
          );
        return service.saveComponent(
          projectId,
          source as unknown as ComponentSource,
        );
      }, metadata),
  );
  register(
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
  register(
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
  register(
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
  register(
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
  register(
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
  register(
    "publication_prepare",
    {
      description:
        "Prepare local static publication files from exact refs. Does not upload or register a shared published release. Query guide publish for the explicit next step.",
      inputSchema: { refs: z.array(refSchema).min(1), out: z.string() },
      annotations: write,
    },
    (input) => call(() => service.preparePublication(projectId, input)),
  );
  register(
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
  register(
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
  register(
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
  register(
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
  register(
    "workspace_conflicts",
    {
      description: "List retained external file changes in this project.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => call(() => service.workspaceConflicts(projectId)),
  );
  register(
    "workspace_recover_package",
    {
      description:
        "Retain external package source, schema and assets as an editable local draft, restore the immutable version projection, then publish edits as a new version.",
      inputSchema: { conflictId: z.string(), clientId: z.string() },
      annotations: write,
    },
    ({ conflictId, clientId }) =>
      call(() =>
        service.recoverPackageConflict({
          id: conflictId,
          clientId,
          targetProjectId: projectId,
        }),
      ),
  );
  register(
    "workspace_conflict",
    {
      description:
        "Read the preserved external bytes and their formal/baseline versions.",
      inputSchema: { id: z.string() },
      annotations: readOnly,
    },
    ({ id }) => call(() => service.workspaceConflict(id)),
  );
  register(
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
  if (options.presentation?.transport !== "http") {
    const syncState = async () => {
      const state = await syncManager(service.store.root).status();
      const project = state.projects.find(
        (item) => item.projectId === projectId,
      );
      return {
        projectId,
        connected: !!project,
        ...(project ? { synchronization: project } : { mode: "local" }),
      };
    };
    register(
      "project_sync_status",
      {
        description:
          "Inspect synchronization for this bound project only. No HTML display is required.",
        inputSchema: {},
        annotations: readOnly,
      },
      () => call(syncState),
    );
    register(
      "project_sync",
      {
        description:
          "Synchronize this already-connected project after local MCP writes, then inspect the returned status/error/remoteHead. Leaves local-only projects local. Does not connect a server or expose other projects.",
        inputSchema: {},
        annotations: write,
      },
      () =>
        call(async () => {
          const before = await syncState();
          if (!before.connected) return before;
          await syncManager(service.store.root).run(projectId);
          const after = await syncState();
          if (
            "synchronization" in after &&
            after.synchronization.status !== "synced"
          )
            throw new Error(
              `Project synchronization is incomplete (${after.synchronization.status}): ${after.synchronization.error ?? "inspect project_sync_status"}. Local content is retained.`,
            );
          return after;
        }),
    );
  }
  register(
    "page_present",
    {
      description:
        "Present a saved Page or selected block preview. Complete HTML/source always retain the whole Page. Does not save or synchronize. Use returned delivery and display contract; do not guess an output directory.",
      inputSchema: {
        pageId: z.string().min(1),
        blockIds: z.array(z.string().min(1)).min(1).optional(),
      },
      annotations: readOnly,
      _meta: readerToolMeta,
    },
    async ({ pageId, blockIds }) => {
      try {
        const value = await presentPage({
          root: service.store.root,
          projectId,
          pageId,
          blockIds,
        });
        const delivery = options.storeProjectPresentation
          ? await options.storeProjectPresentation(value)
          : (
              await writePresentation(
                value,
                join(
                  options.presentationDirectory ??
                    join(service.store.root, "local", "agent-previews"),
                  randomUUID(),
                  "page.html",
                ),
              )
            ).delivery;
        return {
          ...mcpSuccess({
            title: value.title,
            pageId: value.pageId,
            projectId,
            hash: value.hash,
            revision: value.revision,
            delivery,
            bytes: value.bytes,
            persistence: value.persistence,
            synchronization: { state: "not_checked" },
            display: {
              resourceAttached: true,
              inlineAvailable: !!value.inline,
              fullPageAvailable: true,
              ...(blockIds ? { blockIds } : {}),
            },
            ...(value.inlineError ? { inlineError: value.inlineError } : {}),
          }),
          _meta: {
            showai: {
              inline: value.inline,
              inlineError: value.inlineError,
              delivery,
            },
          },
        };
      } catch (error) {
        return mcpFailure(error);
      }
    },
  );
  registerPresentationTools(
    server,
    options.presentation ?? {
      transport: "stdio",
      projectAccess: options.projectAccess ?? "project",
      boundProjectId:
        options.projectAccess === "library" ? undefined : projectId,
      storePresentation: async (value) =>
        (
          await writePresentation(
            value,
            join(
              options.presentationDirectory ??
                join(service.store.root, "local", "agent-previews"),
              randomUUID(),
              "page.html",
            ),
          )
        ).delivery,
    },
  );
  return server;
}

export async function startMcp(options: {
  root?: string;
  projectId: string;
  presentationDirectory?: string;
}): Promise<void> {
  const service = new AgentService(options);
  await service.listPages(service.requireProject(options.projectId));
  await createMcpServer(options).connect(new StdioServerTransport());
  process.stderr.write(
    `ShowAI MCP connected to project ${options.projectId}.\n`,
  );
}

export async function startPublicMcp(root: string) {
  const server = new McpServer(
    { name: "showai", version: packageMetadata.version },
    {
      instructions:
        "Create presentations without a personal project or synchronization. Discover public resources, customize their document/source, then render_document. Use the returned inline/HTML files or MCP Apps resource only when your harness supports that display. No project data is available on this connection.",
    },
  );
  server.registerTool(
    "guide",
    {
      description: "Read a focused ShowAI authoring or integration guide.",
      inputSchema: { topic: z.enum(GUIDE_TOPICS).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ topic }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(getMcpGuide(topic)),
        },
      ],
    }),
  );
  registerPresentationTools(server, {
    transport: "stdio",
    privateProjects: false,
    storePresentation: async (value) =>
      (
        await writePresentation(
          value,
          join(root, "local", "agent-previews", randomUUID(), "page.html"),
        )
      ).delivery,
  });
  await server.connect(new StdioServerTransport());
}
