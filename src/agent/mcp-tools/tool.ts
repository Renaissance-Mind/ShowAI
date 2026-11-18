import { z } from "zod";
import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, Implementation } from "@modelcontextprotocol/sdk/types.js";
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
import type { Operation } from "../operations/operation";

export type Access = "read" | "write";

export interface McpServerOptions {
  root?: string;
  projectId: string;
  instructions?: string;
  icons?: Implementation["icons"];
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

export interface ToolConnection {
  service: AgentService;
  projectId: string;
  options: McpServerOptions;
  call: Call;
  localFiles: boolean;
  workspace: WorkspaceService;
  withOpenLink<T>(result: T, pageId?: unknown): Promise<T>;
}

interface ToolBase {
  name: string;
  access: Access;
  hints?: { openWorldHint?: true; destructiveHint?: true };
  available?(connection: ToolConnection): boolean;
  meta?: Record<string, unknown>;
}
export interface PlainTool extends ToolBase {
  operation?: Operation<any>;
  description: string | ((connection: ToolConnection) => string);
  input(connection: ToolConnection): z.ZodRawShape;
  run(
    connection: ToolConnection,
    input: Record<string, any>,
    extra: Parameters<ToolCallback<z.ZodRawShape>>[1],
  ): Promise<CallToolResult>;
}
export interface ActionToolDeclaration extends ToolBase {
  summary: string | ((connection: ToolConnection) => string);
  actions(connection: ToolConnection): Record<string, ToolAction>;
  operations?: Record<string, Operation<any>>;
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
