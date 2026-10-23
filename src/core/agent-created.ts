import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { atomicRename } from "./atomic-rename";
import type { ChangeContext } from "./history-model";
import { assertId } from "./store";

/**
 * Pages an Agent created that the person has not opened yet. One small file
 * per page under local/ (never synced or versioned); opening the page in the
 * workbench removes it.
 */
export interface AgentCreatedMark {
  /** Display name of the writer: harness or MCP client name. */
  label?: string;
  at: string;
}

const directory = (root: string, projectId: string) =>
  join(root, "local", "agent-created", assertId(projectId));

/** Writes by Agents through MCP or the CLI with Agent attribution. */
export function agentAuthored(context: ChangeContext) {
  return (
    context.actor.kind === "agent" ||
    (context.channel === "mcp" &&
      (context.actor.kind === "external" || context.actor.kind === "unknown"))
  );
}
export function agentLabel(context: ChangeContext): string | undefined {
  return context.actor.label ?? context.actor.harness;
}

export async function markAgentCreated(
  root: string,
  projectId: string,
  pageId: string,
  mark: AgentCreatedMark,
) {
  const base = directory(root, projectId);
  await mkdir(base, { recursive: true });
  const path = join(base, `${assertId(pageId)}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(mark));
  await atomicRename(temporary, path);
}

export async function readAgentCreated(
  root: string,
  projectId: string,
): Promise<Record<string, AgentCreatedMark>> {
  const base = directory(root, projectId);
  const names = await readdir(base).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  const marks: Record<string, AgentCreatedMark> = {};
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const text = await readFile(join(base, name), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        // Removed by an opening window between readdir and read.
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (text !== null) marks[name.slice(0, -5)] = JSON.parse(text);
  }
  return marks;
}

export async function clearAgentCreated(
  root: string,
  projectId: string,
  pageId: string,
) {
  await rm(join(directory(root, projectId), `${assertId(pageId)}.json`), {
    force: true,
  });
}
