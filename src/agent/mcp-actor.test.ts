import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLibraryMcpServer } from "./mcp-library";
import { mcpChangeContext } from "./mcp-actor";
import { openLibrary } from "../core/open-library";
import { versionedLibrary } from "../core/library-runtime";
import { readAgentCreated } from "../core/agent-created";
import { changeAuthor } from "../core/external-changes";
import { syncManager } from "../sync/manager";

let root: string;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-mcp-actor-"));
  await openLibrary(root);
});
afterAll(async () => {
  for (const close of closers) await close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

async function connect(name: string) {
  const server = createLibraryMcpServer({ root });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name, version: "1" });
  await server.connect(right);
  await client.connect(left);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return async (tool: string, args: Record<string, unknown>) => {
    const value = await client.callTool({ name: tool, arguments: args }, undefined, {
      timeout: 120000,
    });
    expect(value.isError, JSON.stringify(value.content)).not.toBe(true);
    return (value.structuredContent as any).data;
  };
}

test("unattributed MCP writes name the connected client, real attribution wins", () => {
  const unknown = { actor: { kind: "unknown" as const }, channel: "cli" as const };
  expect(mcpChangeContext(unknown, { name: "codex-mcp-client" })).toMatchObject({
    channel: "mcp",
    actor: { kind: "external", label: "codex-mcp-client" },
  });
  expect(
    mcpChangeContext(unknown, { name: "x", title: "Claude <Code>\n" }).actor,
  ).toEqual({ kind: "external", label: "Claude  Code" });
  expect(mcpChangeContext(unknown, undefined).actor).toEqual({ kind: "unknown" });
  const agent = {
    actor: { kind: "agent" as const, harness: "codex", sessionId: "s1" },
    channel: "cli" as const,
  };
  expect(mcpChangeContext(agent, { name: "codex-mcp-client" }).actor).toEqual(
    agent.actor,
  );
});

test("an MCP client's page writes and creations carry its name to the workbench", async () => {
  const call = await connect("codex-mcp-client");
  const project = await call("project_create", { name: "Actors" });
  const page = await call("page_create", { projectId: project.id, title: "New" });
  const library = versionedLibrary(root)!;
  expect(changeAuthor(await library.entryAt(page.revision))).toMatchObject({
    kind: "external",
    label: "codex-mcp-client",
    channel: "mcp",
  });
  const marks = await readAgentCreated(root, project.id);
  expect(marks[page.document.id]).toMatchObject({ label: "codex-mcp-client" });
  const applied = await call("page_apply", {
    projectId: project.id,
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [{ type: "page.set", fields: { title: "Renamed" } }],
  });
  expect(changeAuthor(await library.entryAt(applied.revision)).label).toBe(
    "codex-mcp-client",
  );
});
