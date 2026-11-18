import { CAPACITY } from "../portable/capacity.mjs";
import { randomUUID } from "node:crypto";
import { changeContext, withChangeContext } from "../core/history-context";
import {
  McpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerPresentationTools,
  mcpData,
  mcpFailure,
} from "./presentation-tools";
import { getObjectShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import packageMetadata from "../../package.json";
import {
  AgentService,
  errorResult,
  failedOperation,
  type FailedOperation,
} from "./service";
import { followAppLanguage } from "../core/app-language";
import { join, resolve } from "node:path";
import { writeCachedPresentation } from "./presentation-cache";
import type { TemplateSelection } from "./template-workflow";
import { strictToolInputs } from "./mcp-actions";
import { pageWriteCapture, type PageWrite } from "../core/page-write-capture";
import { savePageWrites } from "../agent-host/page-undo";
import { WorkspaceService } from "./workspace-service";
import { recordConnections } from "./mcp-connections";
import { recordMcpCalls } from "./mcp-call-log";
import { mcpChangeContext } from "./mcp-actor";
import { PROJECT_TOOLS } from "./mcp-tools";
import {
  registerTool,
  type McpServerOptions,
  type ToolConnection,
} from "./mcp-tools/tool";

export function createMcpServer(options: McpServerOptions): McpServer {
  const service = new AgentService(options);
  const projectId = service.requireProject(options.projectId);
  const server = strictToolInputs(
    new McpServer(
      { name: "showai", version: packageMetadata.version, icons: options.icons },
      {
        instructions:
          options.instructions ??
          `Read use-showai Skill. Bound project: ${projectId}.`,
      },
    ),
  );
  const register: McpServer["registerTool"] = (name, config, callback) => {
    const tool = server.registerTool(name, config, callback);
    const shape = getObjectShape(tool.inputSchema);
    if (!shape) throw new Error(`Missing input schema: ${name}`);
    const original = tool.handler as ToolCallback<z.ZodRawShape>;
    const operation: FailedOperation | undefined =
      name === "page_export"
        ? "export"
        : name === "page_present"
          ? "present"
          : config.annotations?.readOnlyHint
            ? undefined
            : "save";
    const handle: ToolCallback<z.ZodRawShape> = async (
      { projectId: selected, ...args },
      extra,
    ) => {
      if (selected !== undefined && selected !== projectId)
        return mcpFailure(
          new Error("This MCP connection is bound to another project."),
        );
      await followAppLanguage(service.store.root);
      if (!options.pageWriteDirectory) return original(args, extra);
      const writes: PageWrite[] = [];
      const result = await pageWriteCapture.run(writes, () =>
        original(args, extra),
      );
      if (!result.isError)
        await savePageWrites(options.pageWriteDirectory, writes);
      return result;
    };
    tool.update({
      paramsSchema: { ...shape, projectId: z.string().min(1).optional() },
      callback: operation
        ? (args, extra) =>
            failedOperation.run(operation, () => handle(args, extra))
        : handle,
    });
    options.decorateTool?.(name, tool);
    return tool;
  };
  const inherited = options.sourceContext ?? changeContext();
  const readerId = inherited.readerId ?? randomUUID();
  const call: ToolConnection["call"] = (handler, metadata = {}) =>
    Promise.resolve()
      .then(() =>
        withChangeContext(
          {
            ...mcpChangeContext(inherited, server.server.getClientVersion()),
            readerId,
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
  const openLinks = !options.storeProjectPresentation;
  const connection: ToolConnection = {
    service,
    projectId,
    options,
    call,
    localFiles: options.presentation?.transport !== "http",
    workspace: new WorkspaceService(service.store.root, projectId, {
      libraryAccess: options.projectAccess === "library",
      projectIds: options.workspaceProjectIds,
    }),
    async withOpenLink<T>(result: T, pageId?: unknown): Promise<T> {
      const value = result as Record<string, unknown> | null;
      const page =
        typeof pageId === "string"
          ? pageId
          : ((value?.document as { id?: unknown } | undefined)?.id ??
            value?.pageId);
      if (!openLinks || typeof page !== "string" || !value) return result;
      const project = await service.store.readProject(projectId);
      return {
        ...value,
        projectId,
        projectName: project.name,
        openUrl: `showai://project/${encodeURIComponent(projectId)}/page/${encodeURIComponent(page)}`,
      } as T;
    },
  };
  for (const tool of PROJECT_TOOLS) registerTool(register, connection, tool);
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
          await writeCachedPresentation(
            service.store.root,
            value,
            options.presentationDirectory,
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
  if (process.env.SHOWAI_MCP_CLIENT !== "builtin")
    recordConnections(transport, service.store.root);
  recordMcpCalls(transport, service.store.root, options.projectId);
  await createMcpServer({
    ...options,
    pageWriteDirectory: process.env.SHOWAI_AGENT_PAGE_WRITES,
  }).connect(transport);
  process.stderr.write(
    `ShowAI MCP connected to project ${options.projectId}.\n`,
  );
}

export async function startPublicMcp(root: string) {
  const server = strictToolInputs(
    new McpServer(
      { name: "showai", version: packageMetadata.version },
      {
        instructions:
          "Read use-showai Skill. Public catalogs and rendering only.",
      },
    ),
  );
  registerPresentationTools(server, {
    transport: "stdio",
    privateProjects: false,
    previewDirectory: join(root, "local", "agent-previews"),
    storePresentation: async (value) =>
      (await writeCachedPresentation(root, value)).delivery,
  });
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: CAPACITY.authoringRequestBytes,
  });
  recordMcpCalls(transport, root, undefined, `${resolve(root)}.mcp-logs`);
  await server.connect(transport);
}
