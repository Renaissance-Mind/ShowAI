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
import { GUIDE_TOPICS } from "./guides";
import { getMcpGuide } from "./mcp-guides";
import { join } from "node:path";
import { writePresentation } from "./presentation";
import type { TemplateSelection } from "./template-workflow";
import { strictToolInputs } from "./mcp-actions";
import { pageWriteCapture, type PageWrite } from "../core/page-write-capture";
import { savePageWrites } from "../agent-host/page-undo";
import { WorkspaceService } from "./workspace-service";
import { recordConnections } from "./mcp-connections";
import { mcpChangeContext } from "./mcp-actor";
import { PROJECT_TOOLS } from "./mcp-tools";
import {
  registerTool,
  type McpServerOptions,
  type ToolConnection,
} from "./mcp-tools/tool";

/**
 * One MCP connection to a project: the connection context the tools share,
 * then the declared tools (./mcp-tools) and the presentation tools.
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const service = new AgentService(options);
  const projectId = service.requireProject(options.projectId);
  const server = strictToolInputs(
    new McpServer(
      { name: "showai", version: packageMetadata.version },
      {
        instructions:
          options.instructions ??
          `ShowAI project ${projectId}. Call guide first.`,
      },
    ),
  );
  const register: McpServer["registerTool"] = (name, config, callback) => {
    // All project operations accept an explicit identity, including bound connections.
    // Existing clients may omit it; an explicit mismatch must never be stripped silently.
    const tool = server.registerTool(name, config, callback);
    if (name !== "guide") {
      const shape = getObjectShape(tool.inputSchema);
      if (!shape) throw new Error(`Missing input schema: ${name}`);
      const original = tool.handler as ToolCallback<z.ZodRawShape>;
      // Failures name the step that failed: an export, a conversation view,
      // or a save for any other tool that writes.
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
        // Only runtimes serve MCP; their output follows the App's current language.
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
    }
    options.decorateTool?.(name, tool);
    return tool;
  };
  const inherited = options.sourceContext ?? changeContext();
  // Library connections pass their own reader; a bound connection is one.
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
  // Local connections share the library with the ShowAI App, which opens showai:// links.
  // Remote connections deliver through their own storage and have no local App.
  const openLinks = !options.storeProjectPresentation;
  const connection: ToolConnection = {
    service,
    projectId,
    options,
    call,
    // Device paths are only meaningful where ShowAI runs on the same machine.
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
  const server = strictToolInputs(
    new McpServer(
      { name: "showai", version: packageMetadata.version },
      {
        instructions:
          "ShowAI public components and templates, without a project. Call guide first.",
      },
    ),
  );
  server.registerTool(
    "guide",
    {
      description: "Read a focused ShowAI authoring or integration guide.",
      inputSchema: {
        topic: z.enum(GUIDE_TOPICS).optional(),
        knownHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ topic, knownHash }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(getMcpGuide(topic, knownHash)),
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
