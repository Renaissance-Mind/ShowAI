import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicRename } from "../core/atomic-rename";
import { MCP_LOG_RETENTION_DAYS } from "../host/protocol";

export type McpRetentionDays = (typeof MCP_LOG_RETENTION_DAYS)[number];
export interface McpLogSettings {
  directory: string;
  retentionDays: McpRetentionDays;
  recording: boolean;
}

export function mcpLogDirectory(directory: string) {
  return resolve(process.env.SHOWAI_MCP_LOG_DIRECTORY || directory);
}

export function libraryMcpLogDirectory(home: string) {
  return mcpLogDirectory(join(home, "local", "mcp-logs"));
}

export function readMcpRetention(directory: string): McpRetentionDays {
  try {
    const text = readFileSync(join(directory, "retention.json"), "utf8");
    const value = JSON.parse(text)?.retentionDays;
    return MCP_LOG_RETENTION_DAYS.find((days) => days === value) ?? 30;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return 30;
    throw error;
  }
}

export function mcpLogSettings(home: string): McpLogSettings {
  const directory = libraryMcpLogDirectory(home);
  return {
    directory,
    retentionDays: readMcpRetention(directory),
    recording: process.env.SHOWAI_MCP_LOG !== "0",
  };
}

export async function saveMcpRetention(home: string, value: unknown) {
  const days = MCP_LOG_RETENTION_DAYS.find((days) => days === value);
  if (!days)
    throw new Error("MCP call log retention must be 7, 30 or 90 days.");
  const directory = libraryMcpLogDirectory(home);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `retention-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ retentionDays: days }) + "\n", {
      mode: 0o600,
    });
    await atomicRename(temporary, join(directory, "retention.json"));
  } finally {
    await rm(temporary, { force: true });
  }
  return mcpLogSettings(home);
}

export const mcpCallLogName = /^calls-\d+-[a-f0-9-]{36}(?:\.\d+)?\.jsonl$/;
