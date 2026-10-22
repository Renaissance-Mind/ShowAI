import { CAPACITY, CapacityError } from "../portable/capacity.mjs";
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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
import { TEMPLATE_STAGES } from "../portable/template-bundle.mjs";
import type { TemplateSelection } from "./template-workflow";
import { compactMcpResult } from "./mcp-response";
import { boardReadSchema, type BoardReadResult } from "./board-reading";
import { pageWriteCapture, type PageWrite } from "../core/page-write-capture";
import { savePageWrites } from "../agent-host/page-undo";
import { WorkspaceService } from "./workspace-service";
import { registerOrganizationTools } from "./mcp-organization";
import { registerDatasetTools } from "./mcp-datasets";
import { recordConnections } from "./mcp-connections";

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
  sessionTemplates?: TemplateSelection[];
  projectAccess?: "library" | "project";
  workspaceProjectIds?: string[];
  pageWriteDirectory?: string;
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
        `ShowAI project ${projectId}. Call guide first.`,
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
        callback: async ({ projectId: selected, ...args }, extra) => {
          if (selected !== undefined && selected !== projectId)
            return mcpFailure(
              new Error("This MCP connection is bound to another project."),
            );
          if (!options.pageWriteDirectory) return original(args, extra);
          const writes: PageWrite[] = [];
          const result = await pageWriteCapture.run(writes, () =>
            original(args, extra),
          );
          if (!result.isError)
            await savePageWrites(options.pageWriteDirectory, writes);
          return result;
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

  registerDatasetTools(
    register,
    service,
    projectId,
    call,
    { readOnly, write },
    changeSchema,
  );
  registerOrganizationTools(
    register,
    new WorkspaceService(service.store.root, projectId, {
      libraryAccess: options.projectAccess === "library",
      projectIds: options.workspaceProjectIds,
    }),
    call,
  );

  register(
    "guide",
    {
      description:
        "Read a focused ShowAI guide; without topic, list the guides.",
      inputSchema: {
        topic: z.enum(GUIDE_TOPICS).optional(),
        stage: z.enum(TEMPLATE_STAGES).optional(),
        knownHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      },
      annotations: readOnly,
    },
    ({ topic, stage, knownHash }) =>
      call(async () => getMcpGuide(topic, stage, knownHash)),
  );
  const templateSelection = z.object({
    id: z.string().min(1),
    version: z.string().optional(),
    integrity: z.string().optional(),
    scope: z.enum(["builtin", "project", "global", "published"]).optional(),
  });
  register(
    "template_context",
    {
      description:
        "Resolve the system baseline, selected template READMEs, exact refs and template components for this task. templates:[] uses only the system baseline.",
      inputSchema: {
        templates: z.array(templateSelection).max(8).optional(),
        knownHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        knownSystemHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        componentOffset: z.number().int().nonnegative().optional(),
        componentLimit: z.number().int().min(1).max(50).optional(),
      },
      annotations: readOnly,
    },
    ({
      templates,
      knownHash,
      knownSystemHash,
      componentOffset,
      componentLimit,
    }) =>
      call(() =>
        service.templateContext(
          projectId,
          templates ?? options.sessionTemplates ?? [],
          knownHash,
          componentOffset,
          componentLimit,
          knownSystemHash,
        ),
      ),
  );
  register(
    "template_guide",
    {
      description:
        "Read one presentation stage: the system instructions plus the selected template guides for that stage. templates:[] reads only the system stage; file reads an additional guide file.",
      inputSchema: {
        stage: z.enum(TEMPLATE_STAGES),
        templates: z.array(templateSelection).max(8).optional(),
        knownHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        file: z.string().optional(),
        templateId: z.string().optional(),
      },
      annotations: readOnly,
    },
    ({ stage, templates, knownHash, file, templateId }) =>
      call(() =>
        service.templateGuide(
          projectId,
          stage,
          templates ?? options.sessionTemplates ?? [],
          knownHash,
          file,
          templateId,
        ),
      ),
  );
  register(
    "project_context",
    {
      description:
        "Return the project and its compact component index (names, descriptions, scenarios, props signatures) with the index revision.",
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
        project: await service.store.readProject(projectId),
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
      description: "List pages with titles, IDs and hashes.",
      inputSchema: { includeArchived: z.boolean().optional() },
      annotations: readOnly,
    },
    ({ includeArchived }) =>
      call(() => service.store.listPages(projectId, { includeArchived })),
  );
  register(
    "page_read",
    {
      description:
        'Read a Page as structured JSON/Markdown (default), a PNG image, or html (DOM, accessibility tree and an interactive file; actions run interactions). detail:"outline" lists block IDs; blockIds selects blocks.',
      inputSchema: {
        pageId: z.string().min(1),
        ...pageReadSchema.shape,
        response: z.enum(["full", "source", "receipt"]).default("full"),
      },
      annotations: readOnly,
    },
    ({ pageId, response, ...readOptions }) =>
      call(() => service.readPage(projectId, pageId, readOptions)).then(
        async (result) => {
          if (!("data" in result.structuredContent)) return result;
          const data = result.structuredContent.data as PageReadResult;
          if (data.view !== "image" || !data.path)
            return compactMcpResult(result, response);
          const png = await readFile(data.path);
          if (png.length > CAPACITY.mcpImageBytes) {
            const error = new CapacityError(
              "MCP PNG image",
              png.length,
              CAPACITY.mcpImageBytes,
            );
            error.message += " Read a smaller blockIds scope or viewport.";
            return mcpFailure(error);
          }
          return {
            ...compactMcpResult(result, response),
            content: [
              ...compactMcpResult(result, response).content,
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
    "board_read",
    {
      description:
        "Read a Board: a full image for small boards, otherwise an overview with overlapping tiles and element/Page indexes. Pass the returned snapshotId with mode tile/region/element/source for details. boardId selects a Board inside a Page.",
      inputSchema: { pageId: z.string().min(1), ...boardReadSchema.shape },
      annotations: readOnly,
    },
    ({ pageId, ...input }) =>
      call(() => service.readBoard(projectId, pageId, input)).then(
        async (result) => {
          if (!("data" in result.structuredContent)) return result;
          const data = result.structuredContent.data as BoardReadResult;
          const content: CallToolResult["content"] = [...result.content];
          for (const image of data.images) {
            const png = await readFile(image.path);
            if (png.length > CAPACITY.mcpImageBytes)
              return mcpFailure(
                new CapacityError(
                  "Board PNG image",
                  png.length,
                  CAPACITY.mcpImageBytes,
                ),
              );
            content.push({
              type: "text",
              text: JSON.stringify({
                imageKey: image.imageKey,
                attachmentIndex: image.attachmentIndex,
                pixelSize: image.pixelSize,
              }),
            });
            content.push({
              type: "image",
              mimeType: "image/png",
              data: png.toString("base64"),
            });
          }
          return { ...result, content };
        },
      ),
  );
  register(
    "page_create",
    {
      description:
        'Create a Page or Board. Prefer blocks:[{kind,data}] in reading order, e.g. {kind:"text",data:{format:"markdown",content:"..."}}, and add more with page_apply component.insert.',
      inputSchema: {
        ...changeSchema,
        title: z.string().optional(),
        kind: z.enum(["page", "board"]).optional(),
        parentId: z.string().min(1).nullable().optional(),
        blocks: z
          .array(z.object({ kind: z.string().min(1), data: jsonObject }))
          .max(100)
          .optional(),
        document: jsonObject.optional(),
        components: z.array(jsonObject).max(100).optional(),
        remoteComponents: z.array(jsonObject).max(100).optional(),
      },
      annotations: { ...write, openWorldHint: true },
    },
    ({
      title,
      kind,
      parentId,
      blocks,
      document,
      components,
      remoteComponents,
      ...metadata
    }) =>
      call(
        () =>
          service.createPage(projectId, {
            title,
            kind,
            parentId,
            blocks,
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
        "Save a full Page document with its baseHash; stale content returns CONFLICT.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        document: jsonObject,
        baseHash: z.string().min(1),
        baseRevision: z.string().optional(),
        components: z.array(jsonObject).max(100).optional(),
        remoteComponents: z.array(jsonObject).max(100).optional(),
        response: z.enum(["full", "source", "receipt"]).default("full"),
      },
      annotations: { ...write, openWorldHint: true },
    },
    ({
      pageId,
      document,
      baseHash,
      baseRevision,
      response,
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
      ).then((result) => compactMcpResult(result, response)),
  );
  register(
    "page_apply",
    {
      description:
        'Apply operations by stable block id with the Page\'s baseHash. Insert components with {type:"component.insert",kind,data,parentId?,afterId?} and change their data with {type:"component.props.set",blockId,props}. Other operations: guide authoring.',
      inputSchema: {
        ...changeSchema,
        pageId: z.string(),
        baseHash: z.string().min(1),
        baseRevision: z.string().optional(),
        operations: z.array(jsonObject).max(1000),
        datasetBases: z.record(z.string(), z.string()).optional(),
        response: z.enum(["full", "source", "receipt"]).default("full"),
      },
      annotations: write,
    },
    ({
      pageId,
      baseHash,
      baseRevision,
      operations,
      datasetBases,
      response,
      ...metadata
    }) =>
      call(
        () =>
          service.applyPage(projectId, pageId, {
            baseHash,
            baseRevision,
            operations: operations as PageOperation[],
            datasetBases,
          }),
        metadata,
      ).then((result) => compactMcpResult(result, response)),
  );
  register(
    "page_diff",
    {
      description: "Compare a Page with an earlier read hash.",
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
        'Export a Page as HTML, an inline conversation fragment or a static site at out; blockIds exports part of it. Data from files outside the library returns CONFIRMATION_REQUIRED with sizes; repeat with externalData:"embed" after the person agrees.',
      inputSchema: {
        pageId: z.string().optional(),
        blockIds: z.array(z.string().min(1)).min(1).optional(),
        format: z.enum(["html", "inline", "site"]),
        presentation: z.enum(["spatial", "reading"]).optional(),
        components: z.enum(["bundled", "remote"]).optional(),
        reader: z.enum(["bundled", "cdn"]).optional(),
        out: z.string().min(1),
        overwrite: z.boolean().optional(),
        externalData: z.literal("embed").optional(),
      },
      annotations: write,
    },
    ({
      pageId,
      blockIds,
      format,
      components,
      reader,
      out,
      overwrite,
      presentation,
      externalData,
    }) =>
      call(() =>
        service.export({
          projectId,
          pageId,
          blockIds,
          format,
          components,
          reader,
          out,
          overwrite,
          presentation,
          externalData,
        }),
      ),
  );

  register(
    "catalog_list",
    {
      description:
        "List component and template names, descriptions, scenarios and one-line props signatures. Defaults to built-ins plus this project's components; scope selects global/published/all; limit/cursor paginate.",
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
        "Describe a component or template. view: summary (default), guide (use contract, schema, example), parameters (paged by parameterPath/offset/limit), development, examples, dependencies, source or full.",
      inputSchema: {
        id: z.string(),
        kind: z.enum(["component", "template"]).optional(),
        scope: scopeSchema.optional(),
        version: z.string().optional(),
        integrity: z.string().optional(),
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
    },
    ({ id, ...input }) =>
      call(() => service.catalogDescribe(id, { projectId, ...input })),
  );
  register(
    "component_import",
    {
      description:
        "Import and compile a local component package directory into this project.",
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
        "Save component source as a new immutable revision in this project.",
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
        "Create a resource from a template, or insert it into pageId with its baseHash/baseRevision and optional parentId.",
      inputSchema: {
        ...changeSchema,
        templateId: z.string(),
        templates: z.array(templateSelection).max(8).optional(),
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
        () =>
          service.applyTemplate(projectId, templateId, title, {
            ...selection,
            templates: selection.templates ?? options.sessionTemplates,
          }),
        { operationId, message, groupId },
      ),
  );
  register(
    "template_save",
    {
      description:
        "Create an immutable project template from pageId or input:{bundle:{format:1,files,assets?}}; bundled components are compiled and registered.",
      inputSchema: {
        ...changeSchema,
        pageId: z.string().optional(),
        input: jsonObject,
      },
      annotations: write,
    },
    ({ pageId, input, ...metadata }) =>
      call(async () => {
        const saved = await service.saveTemplate(
          projectId,
          pageId,
          input as unknown as SaveTemplateInput,
        );
        return input.bundle
          ? {
              id: saved.id,
              name: saved.name,
              version: saved.version,
              integrity: saved.integrity,
              scope: saved.scope,
              workflow: saved.workflow,
              next: {
                tool: "template_context",
                arguments: {
                  projectId,
                  templates: [
                    {
                      id: saved.id,
                      scope: saved.scope,
                      version: saved.version,
                      integrity: saved.integrity,
                    },
                  ],
                },
              },
            }
          : saved;
      }, metadata),
  );
  register(
    "catalog_fork",
    {
      description:
        "Fork an exact revision into a new revision owned by this project.",
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
        'Preview a three-way merge without writing; view:"source" returns the candidate and conflict values.',
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
        "Save a reviewed merge resolution as a new project revision.",
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
      description: "Prepare local static publication files from exact refs.",
      inputSchema: { refs: z.array(refSchema).min(1), out: z.string() },
      annotations: write,
    },
    (input) => call(() => service.preparePublication(projectId, input)),
  );
  register(
    "publication_list",
    {
      description:
        "List verified publication references in the local shared library.",
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
        "Search this project's pages, containers and component/template descriptions and source; returns node locations.",
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
      description: "Compare a local draft, its base and the current Page.",
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
        "Save a reviewed merged Page, rechecking the current revision.",
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
        "Recover an external package change as an editable local draft and restore the immutable version.",
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
        "Read a retained external change with its formal and baseline versions.",
      inputSchema: { id: z.string() },
      annotations: readOnly,
    },
    ({ id }) => call(() => service.workspaceConflict(id)),
  );
  register(
    "workspace_resolve",
    {
      description:
        "Resolve an external change by discard, page import or reviewed merge.",
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
        description: "Return synchronization status for this project.",
        inputSchema: {},
        annotations: readOnly,
      },
      () => call(syncState),
    );
    register(
      "project_sync",
      {
        description:
          "Synchronize this connected project and return status, error and remoteHead.",
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
        "Present a saved Page, or selected blocks inline, and return host delivery references. externalSnapshots lists embedded data from files outside the library; get the person's agreement before sharing those files.",
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
              onlineAvailable: !!value.online,
              compactAvailable: !!value.compact,
              fullPageAvailable: true,
              ...(blockIds ? { blockIds } : {}),
            },
            ...(value.inlineError ? { inlineError: value.inlineError } : {}),
            ...(value.externalSnapshots
              ? { externalSnapshots: value.externalSnapshots }
              : {}),
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
      previewDirectory:
        options.presentationDirectory ??
        join(service.store.root, "local", "agent-previews"),
      componentLibrary: {
        root: service.store.root,
        async resolveProject(selected) {
          if (options.projectAccess !== "library") {
            if (selected !== undefined && selected !== projectId)
              throw new Error(
                "This MCP connection is bound to another project.",
              );
            return projectId;
          }
          if (selected === undefined) return undefined;
          await service.store.readProject(selected);
          return selected;
        },
      },
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
  sessionTemplates?: TemplateSelection[];
}): Promise<void> {
  const service = new AgentService(options);
  await service.listPages(service.requireProject(options.projectId));
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: CAPACITY.authoringRequestBytes,
  });
  // Host plugins pinned to a project are recorded too; the built-in Agent is not a host.
  if (process.env.SHOWAI_MCP_CLIENT !== "builtin")
    recordConnections(transport, service.store.root);
  await createMcpServer({
    ...options,
    pageWriteDirectory: process.env.SHOWAI_AGENT_PAGE_WRITES,
  }).connect(transport);
  process.stderr.write(
    `ShowAI MCP connected to project ${options.projectId}.\n`,
  );
}

export async function startPublicMcp(root: string) {
  const server = new McpServer(
    { name: "showai", version: packageMetadata.version },
    {
      instructions:
        "ShowAI public components and templates, without a project. Call guide first.",
    },
  );
  server.registerTool(
    "guide",
    {
      description: "Read a focused ShowAI authoring or integration guide.",
      inputSchema: {
        topic: z.enum(GUIDE_TOPICS).optional(),
        stage: z.enum(TEMPLATE_STAGES).optional(),
        knownHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ topic, stage, knownHash }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(getMcpGuide(topic, stage, knownHash)),
        },
      ],
    }),
  );
  registerPresentationTools(server, {
    transport: "stdio",
    privateProjects: false,
    previewDirectory: join(root, "local", "agent-previews"),
    storePresentation: async (value) =>
      (
        await writePresentation(
          value,
          join(root, "local", "agent-previews", randomUUID(), "page.html"),
        )
      ).delivery,
  });
  await server.connect(
    new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: CAPACITY.authoringRequestBytes,
    }),
  );
}
