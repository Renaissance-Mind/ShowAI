import { open, readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import {
  mcpCallLogName,
  mcpLogDirectory,
  mcpLogSettings,
} from "./mcp-log-settings";

export interface McpCallCursor {
  at: string;
  callId: string;
}
export interface McpCallRecord extends McpCallCursor {
  transport: "stdio" | "http";
  tool: string;
  action?: string;
  client?: string;
  durationMs?: number;
  status: "success" | "error" | "cancelled" | "interrupted" | "transport_error";
  errorCode?: string;
}
export interface McpCallPage {
  records: McpCallRecord[];
  next?: McpCallCursor;
}

const pageSize = 30;
const order = (left: McpCallCursor, right: McpCallCursor) =>
  right.at.localeCompare(left.at) || right.callId.localeCompare(left.callId);
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

function parseCall(line: string): McpCallRecord | undefined {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return; // A process can exit mid-write. Earlier complete events are still usable.
  }
  if (
    row?.format !== "showai-mcp-call" ||
    row.event !== "completed" ||
    typeof row.at !== "string" ||
    !Number.isFinite(Date.parse(row.at)) ||
    typeof row.callId !== "string" ||
    typeof row.tool !== "string" ||
    ![
      "success",
      "error",
      "cancelled",
      "interrupted",
      "transport_error",
    ].includes(row.status) ||
    (row.transport !== "stdio" && row.transport !== "http")
  )
    return;
  const client = row.client || row.host;
  return {
    at: row.at,
    callId: row.callId,
    tool: row.tool,
    transport: row.transport,
    status: row.status,
    ...(typeof client === "string" && { client }),
    ...(typeof row.action === "string" && { action: row.action }),
    ...(Number.isFinite(row.durationMs) && { durationMs: row.durationMs }),
    ...(typeof row.errorCode === "string" || typeof row.errorCode === "number"
      ? { errorCode: String(row.errorCode) }
      : {}),
  };
}

async function logFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (missing(error)) return [];
      throw error;
    },
  );
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && mcpCallLogName.test(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        const meta = await stat(path).catch((error) => {
          if (!missing(error)) throw error;
        });
        return meta && { path, modified: meta.mtimeMs };
      }),
  );
  return files.filter((file) => !!file);
}

export async function readMcpCallHistory(
  home: string,
  args: { before?: unknown; transport?: unknown } = {},
): Promise<McpCallPage> {
  const { before, transport } = args;
  let cursor: McpCallCursor | undefined;
  if (before !== undefined) {
    if (
      !before ||
      typeof before !== "object" ||
      !("at" in before) ||
      typeof before.at !== "string" ||
      !Number.isFinite(Date.parse(before.at)) ||
      !("callId" in before) ||
      typeof before.callId !== "string"
    )
      throw new Error("Invalid MCP call history cursor.");
    cursor = { at: before.at, callId: before.callId };
  }
  if (transport !== undefined && transport !== "stdio" && transport !== "http")
    throw new Error("Invalid MCP transport.");
  const settings = mcpLogSettings(home);
  const cutoff = new Date(
    Date.now() - settings.retentionDays * 86400000,
  ).toISOString();
  const directories = new Set([
    settings.directory,
    mcpLogDirectory(`${resolve(home)}.mcp-logs`),
  ]);
  const files = (await Promise.all([...directories].map(logFiles)))
    .flat()
    .sort((a, b) => b.modified - a.modified);
  const recent: McpCallRecord[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    // Newer files may overlap older sessions. Stop only once every remaining file predates the last result.
    const oldest = recent.length > pageSize ? recent[pageSize].at : cutoff;
    if (Math.ceil(file.modified) < Date.parse(oldest)) break;
    const handle = await open(file.path, "r").catch((error) => {
      if (!missing(error)) throw error;
    });
    if (!handle) continue;
    try {
      const lines = createInterface({
        input: handle.createReadStream(),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        const row = parseCall(line);
        if (
          !row ||
          row.at < cutoff ||
          (transport && row.transport !== transport) ||
          (cursor && order(row, cursor) <= 0) ||
          seen.has(row.callId)
        )
          continue;
        if (recent.length > pageSize && order(row, recent[pageSize]) >= 0)
          continue;
        const i = recent.findIndex((item) => order(row, item) < 0);
        recent.splice(i < 0 ? recent.length : i, 0, row);
        seen.add(row.callId);
        if (recent.length > pageSize + 1) seen.delete(recent.pop()!.callId);
      }
    } finally {
      await handle.close();
    }
  }
  const records = recent.slice(0, pageSize);
  const last = records[records.length - 1];
  return {
    records,
    ...(recent.length > pageSize && {
      next: { at: last.at, callId: last.callId },
    }),
  };
}
