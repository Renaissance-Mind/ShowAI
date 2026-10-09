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
import { createMcpServer } from "./mcp";
import { AgentService } from "./service";
import { mcpFailure, mcpSuccess } from "./presentation-tools";
import { withChangeContext, changeContext } from "../core/history-context";
import { openLibrary } from "../core/open-library";

/** Explicit project identities, no mutable connection-wide "current project". */
export function createLibraryMcpServer(options: {
  root: string;
  presentationDirectory?: string;
}) {
  const service = new AgentService({ root: options.root });
  const inherited = changeContext();
  const call = async (action: () => Promise<unknown>) => {
    try {
      return mcpSuccess(
        await withChangeContext({ ...inherited, channel: "mcp" }, action),
      );
    } catch (error) {
      return mcpFailure(error);
    }
  };
  const server = createMcpServer({
    ...options,
    projectId: "unselected",
    projectAccess: "library",
    instructions:
      "Use ShowAI MCP for document operations. This connection is fixed to one local content library. Inspect project_context, then projects_list for existing content or project_resolve with a trusted host sourceDirectory for new formal work. Pass projectId explicitly to every project tool. There is no shared mutable current project. Read before editing; save with the returned hash/revision. Use page_present after saving. render_document is only for an explicitly standalone result. Connection failure is not permission to switch libraries, use authoring CLI, or silently produce an unsaved file.",
    decorateTool(name, tool) {
      if (name === "guide") return;
      if (name === "project_context") {
        tool.update({
          paramsSchema: { projectId: z.string().min(1).optional() },
          callback: ({ projectId }) =>
            call(async () => ({
              root: service.store.root,
              scope: "library",
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
      description:
        "List existing projects in this fixed local library. Does not create a project.",
      inputSchema: {},
      annotations: readOnly,
    },
    () => call(() => service.listProjects()),
  );
  server.registerTool(
    "project_resolve",
    {
      description:
        "Resolve a trusted host sourceDirectory to a formal project, creating its mapping only if missing. Use projects_list for read-only lookup. Never use a plugin, preview, or temporary directory as the user's project.",
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
      description:
        "Create a separately named project only when requested by the user. Ordinary new content uses project_resolve.",
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
  await createLibraryMcpServer(options).connect(new StdioServerTransport());
  process.stderr.write(
    "ShowAI MCP connected to the configured library. Select projectId explicitly.\n",
  );
}
