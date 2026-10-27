import { CAPACITY } from "../portable/capacity.mjs";
import { z } from "zod";
import type {
  RegisteredTool,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getObjectShape,
  safeParseAsync,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { createMcpServer } from "./mcp";
import { AgentService } from "./service";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import { withChangeContext, changeContext } from "../core/history-context";
import { openLibrary } from "../core/open-library";
import { recordConnections } from "./mcp-connections";
import { mcpChangeContext } from "./mcp-actor";

/** Explicit project identities, no mutable connection-wide "current project". */
export function createLibraryMcpServer(options: {
  root: string;
  presentationDirectory?: string;
}) {
  const service = new AgentService({ root: options.root });
  // One dataset reader for the whole connection, across its per-call servers.
  const inherited = { ...changeContext(), readerId: randomUUID() };
  const call = async (action: () => Promise<unknown>) => {
    try {
      return mcpSuccess(
        await withChangeContext(
          mcpChangeContext(inherited, server.server.getClientVersion()),
          action,
        ),
      );
    } catch (error) {
      return mcpFailure(error);
    }
  };
  const server = createMcpServer({
    ...options,
    projectId: "unselected",
    projectAccess: "library",
    sourceContext: inherited,
    instructions:
      "Call ShowAI guide first; pass projectId to project tools.",
    decorateTool(name, tool) {
      if (name === "guide") return;
      if (name === "project_context") {
        tool.update({
          paramsSchema: {
            projectId: z.string().min(1).optional(),
            knownCatalogRevision: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          },
          callback: ({ projectId, knownCatalogRevision }) =>
            call(async () => ({
              root: service.store.root,
              scope: "library",
              componentCatalog: await service.componentContext(
                projectId,
                knownCatalogRevision,
              ),
              ...(projectId
                ? { project: await service.store.readProject(projectId) }
                : {}),
              next: "projects_list or project_resolve; pass the selected projectId explicitly",
            })),
        });
        return;
      }
      const shape = getObjectShape(tool.inputSchema);
      if (!shape) throw new Error(`Missing project tool schema: ${name}`);
      tool.update({
        paramsSchema: { ...shape, projectId: z.string().min(1) },
        callback: async ({ projectId, ...args }, extra) => {
          let bound: ReturnType<typeof createMcpServer> | undefined;
          try {
            await service.store.readProject(projectId);
            let operation: RegisteredTool | undefined;
            bound = createMcpServer({
              ...options,
              projectId,
              projectAccess: "library",
              // The per-call server is never connected; it writes as this connection's client.
              sourceContext: mcpChangeContext(
                inherited,
                server.server.getClientVersion(),
              ),
              decorateTool: (key, value) => {
                if (key === name) operation = value;
              },
            });
            if (!operation?.inputSchema)
              throw new Error(`Missing tool: ${name}`);
            const input = await safeParseAsync(operation.inputSchema, args);
            if (!input.success) throw new Error(String(input.error));
            return await (operation.handler as ToolCallback<z.ZodRawShape>)(
              input.data as Record<string, unknown>,
              extra,
            );
          } catch (error) {
            return mcpFailure(error);
          } finally {
            await bound?.close();
          }
        },
      });
    },
  });
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  server.registerTool(
    "projects_list",
    {
      description: "List projects in this library.",
      inputSchema: { includeArchived: z.boolean().optional() },
      annotations: readOnly,
    },
    ({ includeArchived }) => call(() => service.listProjects(includeArchived)),
  );
  server.registerTool(
    "project_resolve",
    {
      description:
        "Resolve the user's project directory (absolute sourceDirectory) to its project, creating the mapping if missing.",
      inputSchema: {
        sourceDirectory: z
          .string()
          .refine(isAbsolute, "Provide an absolute host project directory."),
      },
      annotations: { ...readOnly, readOnlyHint: false },
    },
    (input) =>
      call(async () => {
        const result = await service.currentProject(input);
        return {
          ...result,
          next: {
            tool: "pages_list",
            arguments: { projectId: result.project.id },
          },
        };
      }),
  );
  server.registerTool(
    "project_create",
    {
      description: "Create a separately named project.",
      inputSchema: { name: z.string().min(1).max(1000) },
      annotations: { ...readOnly, readOnlyHint: false },
    },
    ({ name }) => call(() => service.createProject(name)),
  );
  return server;
}

export async function startLibraryMcp(
  options: Parameters<typeof createLibraryMcpServer>[0],
) {
  await openLibrary(options.root);
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: CAPACITY.authoringRequestBytes,
  });
  // Lets Settings → Plugins confirm that the host reached this library.
  recordConnections(transport, options.root);
  await createLibraryMcpServer(options).connect(transport);
  process.stderr.write(
    "ShowAI MCP connected to the configured library. Select projectId explicitly.\n",
  );
}
