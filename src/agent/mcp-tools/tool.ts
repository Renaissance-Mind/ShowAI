import { z } from "zod";
import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChangeContext } from "../../core/history-model";
import type {
  Presentation,
  PresentationDelivery,
  registerPresentationTools,
} from "../presentation-tools";
import type { TemplateSelection } from "../template-workflow";
import type { AgentService, errorResult } from "../service";
import type { WorkspaceService } from "../workspace-service";
import { actionTool, type ToolAction } from "../mcp-actions";

export type Access = "read" | "write";

/** Options of one MCP connection to a project (see createMcpServer). */
export interface McpServerOptions {
  root?: string;
  projectId: string;
  instructions?: string;
  decorateTool?: (
    name: string,
    tool: import("@modelcontextprotocol/sdk/server/mcp.js").RegisteredTool,
  ) => void;
  presentation?: Parameters<typeof registerPresentationTools>[1];
  sourceContext?: ChangeContext;
  presentationDirectory?: string;
  sessionTemplates?: TemplateSelection[];
  projectAccess?: "library" | "project";
  workspaceProjectIds?: string[];
  pageWriteDirectory?: string;
  storeProjectPresentation?: (
    value: Presentation,
  ) => Promise<PresentationDelivery>;
}

export type ChangeMetadata = {
  operationId?: string;
  message?: string;
  groupId?: string;
};
/** A tool result made from a handler's value or failure. */
export type CallResult =
  | {
      isError?: undefined;
      content: { type: "text"; text: string }[];
      structuredContent: { ok: boolean; data: unknown };
    }
  | {
      isError: boolean;
      content: { type: "text"; text: string }[];
      structuredContent: { ok: boolean; error: ReturnType<typeof errorResult> };
    };
export type Call = (
  handler: () => Promise<unknown>,
  metadata?: ChangeMetadata,
) => Promise<CallResult>;

/** What every tool of one connection shares. */
export interface ToolConnection {
  service: AgentService;
  projectId: string;
  options: McpServerOptions;
  /** Runs a handler in the connection's change context and wraps its result. */
  call: Call;
  /** Device paths are only meaningful where ShowAI runs on the same machine. */
  localFiles: boolean;
  workspace: WorkspaceService;
  /** Where the saved page lives, so the Agent can say "saved to project X — open it here". */
  withOpenLink<T>(result: T, pageId?: unknown): Promise<T>;
}

interface ToolBase {
  name: string;
  /** Annotations follow from it; hints override single values. */
  access: Access;
  hints?: { openWorldHint?: true; destructiveHint?: true };
  /** Registered only on connections where this holds. */
  available?(connection: ToolConnection): boolean;
  meta?: Record<string, unknown>;
}
/** A tool with one input schema and handler. */
export interface PlainTool extends ToolBase {
  description: string | ((connection: ToolConnection) => string);
  input(connection: ToolConnection): z.ZodRawShape;
  run(
    connection: ToolConnection,
    input: Record<string, any>,
    extra: Parameters<ToolCallback<z.ZodRawShape>>[1],
  ): Promise<CallToolResult>;
}
/** Related operations of one access class as actions of one tool (actionTool). */
export interface ActionToolDeclaration extends ToolBase {
  summary: string | ((connection: ToolConnection) => string);
  actions(connection: ToolConnection): Record<string, ToolAction>;
}
export type ToolDeclaration = PlainTool | ActionToolDeclaration;

export const annotations = (tool: ToolDeclaration) => ({
  readOnlyHint: tool.access === "read",
  destructiveHint: false,
  openWorldHint: false,
  ...tool.hints,
});

const text = (
  value: string | ((connection: ToolConnection) => string),
  connection: ToolConnection,
) => (typeof value === "string" ? value : value(connection));

export function registerTool(
  register: McpServer["registerTool"],
  connection: ToolConnection,
  tool: ToolDeclaration,
) {
  if (tool.available && !tool.available(connection)) return;
  if ("actions" in tool) {
    const built = actionTool(
      text(tool.summary, connection),
      tool.actions(connection),
    );
    register(
      tool.name,
      {
        description: built.description,
        inputSchema: built.inputSchema,
        annotations: annotations(tool),
        ...(tool.meta ? { _meta: tool.meta } : {}),
      },
      built.handler,
    );
    return;
  }
  register(
    tool.name,
    {
      description: text(tool.description, connection),
      inputSchema: tool.input(connection),
      annotations: annotations(tool),
      ...(tool.meta ? { _meta: tool.meta } : {}),
    },
    ((input: Record<string, unknown>, extra) =>
      tool.run(connection, input, extra)) as ToolCallback<z.ZodRawShape>,
  );
}

// Schemas several tools share.
export const changeSchema = {
  operationId: z.string().max(1000).optional(),
  message: z.string().max(4000).optional(),
  groupId: z.string().max(1000).optional(),
};
export const jsonObject = z.record(z.string(), z.unknown());
export const scopeSchema = z.enum([
  "builtin",
  "global",
  "published",
  "project",
  "all",
]);
export const refSchema = z.object({
  kind: z.enum(["component", "template"]),
  id: z.string(),
  version: z.string(),
  integrity: z.string(),
  scope: z.enum(["builtin", "global", "published", "project"]).optional(),
  projectId: z.string().optional(),
});
export const templateSelection = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
  integrity: z.string().optional(),
  scope: z.enum(["builtin", "project", "global", "published"]).optional(),
});
export const knownHash = () =>
  z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional();
