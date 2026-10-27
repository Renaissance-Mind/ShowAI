import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getObjectShape,
  safeParseAsync,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
export { TOOL_CHANGES } from "./tool-changes";

/**
 * Tool shapes change between ShowAI versions while Agents still follow older
 * Skills, notes or habits. Calls in a recent earlier shape are translated to
 * the current tool and carry `migration` with the current form; other argument
 * mistakes return a structured INVALID_ARGUMENTS error that lists what the
 * tool accepts instead of the SDK's bare validation message.
 */

interface Rename {
  tool: string;
  action?: string;
  rename?: Record<string, string>;
  add?: Record<string, unknown>;
}

/** Old tool names and the current tool that does the same. */
const RENAMED: Record<string, Rename> = {
  dataset_list: { tool: "dataset_read", action: "list" },
  dataset_create: { tool: "dataset_write", action: "create" },
  dataset_apply: { tool: "dataset_write", action: "apply" },
  dataset_link: { tool: "dataset_write", action: "link" },
  folders_list: { tool: "organization_read", action: "folders" },
  folder_create: { tool: "organization_update", action: "create_folder" },
  folder_update: { tool: "organization_update", action: "update_folder" },
  project_update: { tool: "organization_update", action: "update_project" },
  directory_sort: { tool: "organization_update", action: "sort" },
  entry_move: { tool: "organization_update", action: "move" },
  sidebar_read: { tool: "organization_read", action: "sidebar" },
  sidebar_group_create: {
    tool: "organization_update",
    action: "create_group",
  },
  sidebar_group_update: {
    tool: "organization_update",
    action: "update_group",
  },
  sidebar_project_move: {
    tool: "organization_update",
    action: "move_project",
  },
  drafts_list: { tool: "draft_read", action: "list" },
  draft_save: { tool: "draft_write", action: "save" },
  draft_complete: { tool: "draft_write", action: "complete" },
  workspace_conflicts: { tool: "workspace_conflict", action: "list" },
  workspace_recover_package: {
    tool: "workspace_resolve",
    action: "recover_package",
    rename: { conflictId: "id" },
  },
  catalog_fork: { tool: "catalog_version", action: "fork" },
  catalog_merge_resolve: { tool: "catalog_version", action: "merge" },
  component_import: { tool: "component_save", add: { legacy: true } },
};

type Args = Record<string, unknown>;
const has = (args: Args, key: string) => args[key] !== undefined;

/** Current tools whose action became required: the earlier shape names it. */
const IMPLIED_ACTION: Record<string, (args: Args) => string | undefined> = {
  dataset_read: (args) => (has(args, "datasetId") ? "read" : "list"),
  draft_read: (args) => (has(args, "draftId") ? "read" : "list"),
  workspace_conflict: (args) => (has(args, "id") ? "read" : "list"),
  workspace_resolve: (args) =>
    has(args, "clientId")
      ? "recover_package"
      : has(args, "resolution")
        ? "resolve"
        : undefined,
  dataset_write: (args) =>
    has(args, "path")
      ? "link"
      : has(args, "operations") || has(args, "operationsFile")
        ? "apply"
        : has(args, "name") || has(args, "fromBlock")
          ? "create"
          : undefined,
};

/** Arguments that were removed and are now ignored. */
const DROPPED: Record<string, string[]> = {
  board_read: [
    "tilePixels",
    "overlapPixels",
    "maxImages",
    "pageLimit",
    "elementLimit",
    "margin",
    "imageScope",
    "theme",
  ],
};

/** Arguments that only exist where ShowAI runs on the caller's device. */
const LOCAL_ONLY: Record<string, string[]> = {
  page_read: ["out", "overwrite"],
  page_diff: ["out", "overwrite"],
  page_apply: ["operationsFile"],
  dataset_write: ["valueFile", "operationsFile"],
  dataset_read: ["out", "overwrite"],
  component_save: ["directory", "legacy"],
  catalog_describe: ["out", "overwrite"],
};

/** Per-action fields of action tools, keyed by their advertised action enum. */
export const actionRegistry = new WeakMap<
  z.ZodType,
  Record<string, z.ZodRawShape>
>();

/** The actions and their fields when a tool's shape belongs to an action tool. */
export function actionFields(
  shape: Record<string, unknown> | undefined,
): Record<string, z.ZodRawShape> | undefined {
  const action = shape?.action;
  return action ? actionRegistry.get(action as z.ZodType) : undefined;
}

export interface Migration {
  from: { tool: string; arguments: string[] };
  use: { tool: string; arguments: Args };
  changes: string[];
}

const optional = (schema: unknown) =>
  (schema as z.ZodType).safeParse(undefined).success;

function fieldList(shape: Record<string, unknown>) {
  const entries = Object.entries(shape).filter(
    ([key]) => !["operationId", "message", "groupId"].includes(key),
  );
  return {
    required: entries.filter(([, s]) => !optional(s)).map(([key]) => key),
    optional: entries.filter(([, s]) => optional(s)).map(([key]) => key),
  };
}

/** The argument shape with long or nested values elided, for receipts. */
function outline(args: Args): Args {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      (typeof value === "string" && value.length <= 512)
        ? value
        : Array.isArray(value)
          ? `[${value.length} item(s)]`
          : "…",
    ]),
  );
}

/** Translates a call in an earlier tool shape; undefined when it is current. */
export function migrateCall(
  name: string,
  args: Args,
  tools: Map<string, RegisteredTool>,
): Migration | undefined {
  const changes: string[] = [];
  let tool = name;
  let next: Args = { ...args };
  const renamed = !tools.has(name) ? RENAMED[name] : undefined;
  if (renamed) {
    tool = renamed.tool;
    for (const [before, after] of Object.entries(renamed.rename ?? {}))
      if (has(next, before)) {
        next[after] = next[before];
        delete next[before];
        changes.push(`${before} is now ${after}`);
      }
    if (renamed.action && !has(next, "action")) next.action = renamed.action;
    for (const [key, value] of Object.entries(renamed.add ?? {}))
      if (!has(next, key)) next[key] = value;
    changes.unshift(
      `${name} was replaced by ${tool}${renamed.action ? ` action ${renamed.action}` : ""}`,
    );
  }
  const shape = tools.has(tool)
    ? (getObjectShape(tools.get(tool)!.inputSchema) as
        Record<string, unknown> | undefined)
    : undefined;
  if (shape && !has(next, "action") && "action" in shape) {
    const action = IMPLIED_ACTION[tool]?.(next);
    const actions = actionFields(shape);
    if (action && actions && action in actions) {
      next.action = action;
      changes.push(`${tool} needs action; this call is action ${action}`);
    }
  }
  if (shape)
    for (const key of DROPPED[tool] ?? [])
      if (has(next, key) && !(key in shape)) {
        delete next[key];
        changes.push(`${tool} no longer takes ${key}; it was ignored`);
      }
  if (!changes.length) return undefined;
  if (renamed && !tools.has(tool)) return undefined;
  next = Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined),
  );
  return {
    from: { tool: name, arguments: Object.keys(args) },
    use: { tool, arguments: next },
    changes,
  };
}

export interface ArgumentProblem {
  code: "INVALID_ARGUMENTS";
  message: string;
  tool: string;
  unexpected?: string[];
  issues?: { path: string; message: string }[];
  expected: { required: string[]; optional: string[] };
  actions?: Record<string, { required: string[]; optional: string[] }>;
  nextStep: string;
}

/** Structured validation of a call against the tool's live schema. */
export async function checkArguments(
  name: string,
  tool: RegisteredTool,
  args: Args,
  localConnection: boolean,
): Promise<ArgumentProblem | undefined> {
  const shape = (getObjectShape(tool.inputSchema) ?? {}) as Record<
    string,
    unknown
  >;
  const actions = actionFields(shape);
  const action = typeof args.action === "string" ? args.action : undefined;
  const selected = actions && action ? actions[action] : undefined;
  const accepted: Record<string, unknown> = selected
    ? {
        ...selected,
        action: shape.action,
        ...("projectId" in shape ? { projectId: shape.projectId } : {}),
      }
    : shape;
  const unexpected = Object.keys(args).filter(
    (key) => args[key] !== undefined && !(key in accepted),
  );
  const problems: string[] = [];
  const local = unexpected.filter((key) =>
    (LOCAL_ONLY[name] ?? []).includes(key),
  );
  if (local.length)
    problems.push(
      localConnection
        ? `${local.join(", ")} ${local.length > 1 ? "are" : "is"} not available on this connection`
        : `${local.join(", ")} ${local.length > 1 ? "read or write files" : "reads or writes a file"} on the device running ShowAI, which a hosted connection cannot do; pass the data inline (or read with response:"receipt"/blockIds)`,
    );
  const other = unexpected.filter((key) => !local.includes(key));
  if (other.length)
    problems.push(
      `unknown argument${other.length > 1 ? "s" : ""} ${other.join(", ")}`,
    );
  let issues: { path: string; message: string }[] = [];
  if (actions && action && !selected)
    problems.push(
      `action ${JSON.stringify(action)} is not one of ${Object.keys(actions).join(", ")}`,
    );
  else if (actions && !action)
    problems.push(`action is required (${Object.keys(actions).join(", ")})`);
  if (!unexpected.length && !problems.length) {
    const target = selected
      ? z.object({ ...(selected as z.ZodRawShape) }).passthrough()
      : tool.inputSchema;
    const parsed = await safeParseAsync(
      target as Parameters<typeof safeParseAsync>[0],
      selected
        ? Object.fromEntries(
            Object.entries(args).filter(
              ([key]) => key !== "action" && key !== "projectId",
            ),
          )
        : args,
    );
    if (!parsed.success)
      issues = (
        (
          parsed.error as {
            issues?: { path: PropertyKey[]; message: string }[];
          }
        ).issues ?? []
      ).map((issue) => ({
        path: issue.path.map(String).join(".") || "arguments",
        message: issue.message,
      }));
  }
  if (!problems.length && !issues.length) return undefined;
  const expected = fieldList(
    selected
      ? { action: shape.action, ...selected }
      : (Object.fromEntries(
          Object.entries(shape).filter(([key]) => key !== "projectId"),
        ) as Record<string, unknown>),
  );
  return {
    code: "INVALID_ARGUMENTS",
    message: `${name}${selected ? ` action ${action}` : ""}: ${[
      ...problems,
      ...issues.map((issue) => `${issue.path}: ${issue.message}`),
    ].join("; ")}.`,
    tool: name,
    ...(unexpected.length ? { unexpected } : {}),
    ...(issues.length ? { issues } : {}),
    expected,
    ...(actions && !selected
      ? {
          actions: Object.fromEntries(
            Object.entries(actions).map(([key, fields]) => [
              key,
              fieldList(fields),
            ]),
          ),
        }
      : {}),
    nextStep:
      'Call again with the expected arguments (the tool\'s inputSchema is authoritative). guide({topic:"migrations"}) lists recent tool changes.',
  };
}

function errorCall(error: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
    structuredContent: { ok: false, error },
  };
}

function withMigration(
  result: CallToolResult,
  migration: Migration,
): CallToolResult {
  const note = {
    from: migration.from,
    use: {
      tool: migration.use.tool,
      arguments: outline(migration.use.arguments),
    },
    changes: migration.changes,
    guide: "guide migrations",
  };
  const structured = result.structuredContent as
    Record<string, unknown> | undefined;
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== "text") return item;
      try {
        const value = JSON.parse(item.text);
        if (value && typeof value === "object" && !Array.isArray(value))
          return {
            ...item,
            text: JSON.stringify({ ...value, migration: note }),
          };
      } catch {
        // Plain-text results keep their text; structuredContent carries the note.
      }
      return item;
    }),
    structuredContent: { ...(structured ?? {}), migration: note },
  };
}

function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length];
}

/** Nearest current tool names for an unknown one. */
function suggestions(name: string, tools: Map<string, RegisteredTool>) {
  const words = new Set(name.split("_"));
  return [...tools.keys()]
    .filter((tool) => tools.get(tool)!.enabled)
    .map((tool) => ({
      tool,
      shared: tool.split("_").filter((word) => words.has(word)).length,
      distance: distance(name, tool),
    }))
    .filter((item) => item.shared > 0 || item.distance <= 3)
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        b.shared - a.shared ||
        a.tool.localeCompare(b.tool),
    )
    .slice(0, 5)
    .map((item) => item.tool);
}

type Handler = (request: unknown, extra: unknown) => unknown;

const servers = new WeakMap<McpServer, Map<string, RegisteredTool>>();

/** The current tools of a server, as the compatibility layer sees them. */
export function registeredTools(
  server: McpServer,
): ReadonlyMap<string, RegisteredTool> {
  const tools = servers.get(server);
  if (!tools)
    throw new Error("The server was not created with strictToolInputs.");
  return tools;
}

/** Old tool names that calls are still translated from. */
export const RENAMED_TOOLS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(RENAMED).map(([name, target]) => [name, target.tool]),
  ),
);

/**
 * Wraps the tools/call handler the McpServer installs. Uses only the public
 * setRequestHandler entry point, intercepting the registration before the
 * first tool is registered.
 */
export function installToolCompatibility(
  server: McpServer,
  tools: Map<string, RegisteredTool>,
) {
  servers.set(server, tools);
  const low = server.server;
  const set = low.setRequestHandler.bind(low) as (
    schema: unknown,
    handler: Handler,
  ) => void;
  (low as unknown as { setRequestHandler: typeof set }).setRequestHandler = (
    schema,
    handler,
  ) => {
    if (schema !== CallToolRequestSchema) return set(schema, handler);
    return set(schema, async (request, extra) => {
      const params = (request as { params: { name: string; arguments?: Args } })
        .params;
      const args = params.arguments ?? {};
      const migration = migrateCall(params.name, args, tools);
      const name = migration?.use.tool ?? params.name;
      const tool = tools.get(name);
      if (!tool || !tool.enabled)
        return errorCall({
          code: "UNKNOWN_TOOL",
          message: `ShowAI has no tool ${params.name}${
            RENAMED[params.name]
              ? ` on this connection (it became ${RENAMED[params.name].tool}, which this connection does not offer)`
              : ""
          }.`,
          tool: params.name,
          similar: suggestions(params.name, tools),
          nextStep:
            'Use only tools listed by this connection. guide({topic:"migrations"}) lists renamed tools.',
        });
      const callArgs = migration?.use.arguments ?? args;
      const local = !!tools.get("project_sync_status");
      const problem = await checkArguments(name, tool, callArgs, local);
      if (problem) {
        const failure = errorCall({ ...problem });
        return migration ? withMigration(failure, migration) : failure;
      }
      const result = (await handler(
        migration
          ? {
              ...(request as object),
              params: { ...params, name, arguments: callArgs },
            }
          : request,
        extra,
      )) as CallToolResult;
      return migration ? withMigration(result, migration) : result;
    });
  };
}
