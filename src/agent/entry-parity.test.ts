import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { COMMANDS } from "./cli/commands";
import { commandKey } from "./cli/command";
import { PROJECT_TOOLS } from "./mcp-tools";
import { OPERATIONS } from "./operations";

// The CLI and MCP reach the same capabilities through shared operations
// (src/agent/operations). These lists name what only one entry offers. They
// may only shrink: a new command or tool runs a shared operation that the
// other entry also runs, or is added here on purpose.

/** CLI commands that run no shared operation. */
const CLI_ONLY = [
  "catalog describe",
  "catalog import",
  "catalog list",
  "catalog merge",
  "catalog promote",
  "catalog remove",
  "catalog save",
  "guide",
  "import",
  "importers",
  "library activate",
  "library archive",
  "library cleanup",
  "library cleanup-plan",
  "library compact",
  "library import",
  "library imports",
  "library init",
  "library migrate",
  "library policy",
  "library rebuild-index",
  "library stats",
  "library verify",
  "library verify-archive",
  "mcp",
  "mcp serve",
  "pages deleted",
  "pages diff",
  "projects bind",
  "projects create",
  "projects current",
  "projects list",
  "public describe",
  "public list",
  "publish list",
  "publish prepare",
  "publish verify",
  "render",
  "runtime",
  "search",
  "serve",
  "sync account",
  "sync attach",
  "sync conflict",
  "sync connect",
  "sync dashboard",
  "sync default",
  "sync detach",
  "sync disconnect",
  "sync join",
  "sync projects",
  "sync resolve",
  "sync retained",
  "sync run",
  "sync status",
  "sync subscribe",
  "template apply",
  "template context",
  "template export",
  "template import",
  "template save",
  "workspace conflict",
  "workspace conflicts",
  "workspace merge",
  "workspace recover-package",
  "workspace resolve",
];

/** MCP tools (tool:action for action tools) that run no shared operation. */
const MCP_ONLY = [
  "catalog_describe",
  "catalog_list",
  "catalog_merge_preview",
  "catalog_references",
  "catalog_version:fork",
  "catalog_version:importer",
  "catalog_version:merge",
  "catalog_version:remove",
  "component_save",
  "draft_read:list",
  "draft_read:read",
  "draft_remove",
  "draft_write:complete",
  "draft_write:save",
  "guide",
  "library_search",
  "organization_read:deleted",
  "organization_read:folders",
  "organization_read:sidebar",
  "organization_update:create_folder",
  "organization_update:create_group",
  "organization_update:move",
  "organization_update:move_project",
  "organization_update:sort",
  "organization_update:update_folder",
  "organization_update:update_group",
  "organization_update:update_project",
  "page_diff",
  "page_merge_preview",
  "page_merge_save",
  "page_present",
  "presentation_source",
  "project_context",
  "project_create",
  "project_resolve",
  "project_sync",
  "project_sync_status",
  "projects_list",
  "public_catalog_describe",
  "public_catalog_list",
  "publication_list",
  "publication_prepare",
  "render_document",
  "show_component",
  "showai_capabilities",
  "template_apply",
  "template_context",
  "template_save",
  "workspace_conflict:list",
  "workspace_conflict:read",
  "workspace_resolve:recover_package",
  "workspace_resolve:resolve",
];

/** Shared operations that only one entry runs yet. */
const OPERATION_CLI_ONLY: string[] = [];
const OPERATION_MCP_ONLY: string[] = [];

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"),
  ) as {
    name: string;
    inputSchema: { properties?: { action?: { enum?: string[] } } };
  }[];

/** Every MCP tool and action that any connection kind lists. */
function mcpEntries() {
  const entries = new Set<string>();
  for (const file of ["mcp-tools-library.json", "mcp-tools-project.json", "mcp-tools-http.json"])
    for (const tool of fixture(file)) {
      const actions = tool.inputSchema.properties?.action?.enum;
      if (actions) for (const action of actions) entries.add(`${tool.name}:${action}`);
      else entries.add(tool.name);
    }
  return [...entries].sort();
}

function mcpOperation(entry: string) {
  const [name, action] = entry.split(":");
  const tool = PROJECT_TOOLS.find((item) => item.name === name);
  if (!tool) return undefined;
  return "actions" in tool
    ? action
      ? tool.operations?.[action]
      : undefined
    : (tool as { operation?: (typeof OPERATIONS)[number] }).operation;
}

test("CLI commands and MCP tools without a shared operation stay listed", () => {
  const commands = COMMANDS.filter(
    (item) => !item.operation && item.actions?.[0] !== "*",
  ).map(commandKey);
  expect(commands.sort()).toEqual([...CLI_ONLY].sort());
  const tools = mcpEntries().filter((entry) => !mcpOperation(entry));
  expect(tools).toEqual([...MCP_ONLY].sort());
});

test("every shared operation runs from both entries", () => {
  const cli = new Set(COMMANDS.flatMap((item) => item.operation?.id ?? []));
  const mcp = new Set(
    mcpEntries().flatMap((entry) => mcpOperation(entry)?.id ?? []),
  );
  const ids = OPERATIONS.map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter((id) => cli.has(id) && !mcp.has(id))).toEqual(
    OPERATION_CLI_ONLY,
  );
  expect(ids.filter((id) => mcp.has(id) && !cli.has(id))).toEqual(
    OPERATION_MCP_ONLY,
  );
  expect(ids.filter((id) => !mcp.has(id) && !cli.has(id))).toEqual([]);
});

test("the entry files stay within their size limits", () => {
  const lines = (path: string) =>
    readFileSync(path, "utf8").split("\n").length - 1;
  const agent = import.meta.dirname;
  const over: string[] = [];
  for (const file of ["cli.ts", "mcp.ts"])
    if (lines(join(agent, file)) > 600) over.push(`${file}: ${lines(join(agent, file))}`);
  for (const directory of ["cli", "operations", "mcp-tools"])
    for (const file of readdirSync(join(agent, directory))) {
      const count = lines(join(agent, directory, file));
      if (count > 900) over.push(`${directory}/${file}: ${count}`);
    }
  expect(over).toEqual([]);
});
