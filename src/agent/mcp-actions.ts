import { z } from "zod";
import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { getObjectShape } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CoreError } from "../core/model";
import { mcpFailure } from "./presentation-tools";

/**
 * Every tool rejects arguments outside its schema instead of the SDK's silent
 * stripping, including after decorators replace the parameters.
 */
export function strictToolInputs<T extends McpServer>(server: T): T {
  const register = server.registerTool.bind(server) as (
    ...args: unknown[]
  ) => RegisteredTool;
  server.registerTool = ((...args: unknown[]) => {
    const tool = register(...args);
    const enforce = () => {
      const shape = getObjectShape(tool.inputSchema);
      if (shape) tool.inputSchema = z.object(shape as z.ZodRawShape).strict();
    };
    const update = tool.update.bind(tool);
    tool.update = (updates) => {
      update(updates);
      if (updates.paramsSchema !== undefined) enforce();
    };
    enforce();
    return tool;
  }) as typeof server.registerTool;
  return server;
}

export interface ToolAction {
  /** Fields this action accepts; anything else is rejected. */
  fields: z.ZodRawShape;
  run(input: Record<string, unknown>): Promise<CallToolResult>;
}

const optional = (schema: z.ZodType) => schema.safeParse(undefined).success;
const required = (schema: z.ZodType): z.ZodType =>
  schema instanceof z.ZodOptional
    ? required(schema.unwrap() as z.ZodType)
    : schema;
// Change metadata is accepted where listed but omitted from the action summary.
const unlisted = new Set(["operationId", "message", "groupId"]);

/**
 * One tool for related operations of the same permission class. The advertised
 * schema is the union of action fields; each call is validated against exactly
 * its action's fields.
 */
export function actionTool(
  summary: string,
  actions: Record<string, ToolAction>,
) {
  const names = Object.keys(actions);
  if (!names.length) throw new Error("An action tool needs actions.");
  const variants = new Map<string, z.ZodType[]>();
  for (const [action, { fields }] of Object.entries(actions))
    for (const [key, schema] of Object.entries(fields)) {
      if (key === "action")
        throw new Error(`${action} cannot declare an action field.`);
      const empty = (schema as z.ZodType).safeParse(undefined);
      // Defaults would be filled in for actions that do not accept the field.
      if (empty.success && empty.data !== undefined)
        throw new Error(`${action}.${key} cannot have a default.`);
      // The advertised field is optional anyway; X and X.nullable() advertise once.
      const list = variants.get(key) ?? [];
      const variant = required(schema as z.ZodType);
      if (!list.includes(variant)) list.push(variant);
      variants.set(key, list);
    }
  for (const [key, list] of variants)
    variants.set(
      key,
      list.filter(
        (variant) =>
          !list.some(
            (other) =>
              other instanceof z.ZodNullable && other.unwrap() === variant,
          ),
      ),
    );
  const inputSchema: Record<string, z.ZodType> = {
    action: z.enum(names as [string, ...string[]]),
  };
  for (const [key, list] of variants)
    inputSchema[key] = (
      list.length === 1
        ? list[0]
        : z.union(list as [z.ZodType, z.ZodType, ...z.ZodType[]])
    ).optional();
  const signature = (fields: z.ZodRawShape) =>
    Object.entries(fields)
      .filter(([key]) => !unlisted.has(key))
      .map(([key, schema]) => (optional(schema as z.ZodType) ? `${key}?` : key))
      .join(",");
  const description = `${summary} Actions: ${names
    .map((name) => `${name}{${signature(actions[name].fields)}}`)
    .join("; ")}.`;
  const handler = async ({
    action,
    ...input
  }: Record<string, unknown>): Promise<CallToolResult> => {
    const selected = actions[action as string];
    if (!selected)
      return mcpFailure(
        new CoreError("INVALID_DATA", `Unknown action: ${String(action)}.`),
      );
    const parsed = z.object(selected.fields).strict().safeParse(input);
    if (!parsed.success)
      return mcpFailure(
        new CoreError(
          "INVALID_DATA",
          `${String(action)} accepts {${Object.keys(selected.fields).join(",")}}: ${parsed.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
            )
            .join("; ")}`,
        ),
      );
    return selected.run(parsed.data);
  };
  return { description, inputSchema, handler };
}
