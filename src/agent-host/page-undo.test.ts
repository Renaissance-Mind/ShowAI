import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../agent/mcp";
import { AgentService } from "../agent/service";
import { openLibrary } from "../core/open-library";
import { AgentHost } from "./host";
import { readPageWrites } from "./page-undo";
import type { AgentConversation, AgentTurn } from "./types";

let directory: string;
const close: (() => Promise<unknown> | void)[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-page-undo-"));
});
afterAll(async () => {
  for (const dispose of close.reverse()) await dispose();
  await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const root = join(directory, randomUUID());
  await openLibrary(root);
  const service = new AgentService({ root });
  const project = await service.store.createProject({
    name: "Concurrent editing",
  });
  const page = await service.store.createPage(project.id, { title: "Before" });
  const host = new AgentHost({
    root: join(root, "host"),
    workspaceRoot: join(root, "workspaces"),
    library: () => service.store,
    cli: () => ({ command: process.execPath, args: [], env: {} }),
    pluginRoot: () => root,
  });
  close.push(() => host.close());
  const conversationId = randomUUID();
  const turn: AgentTurn = {
    id: randomUUID(),
    conversationId,
    projectId: project.id,
    pageId: page.document.id,
    label: "Revise title",
    mode: "local",
    localAgent: "codex",
    state: "completed",
    startedAt: new Date().toISOString(),
    workspace: root,
    events: [],
    prompt: "Revise title",
    target: { kind: "page", pageId: page.document.id },
    baseHash: page.hash,
  };
  const conversation: AgentConversation = {
    id: conversationId,
    projectId: project.id,
    title: "Editing",
    mode: "local",
    localAgent: "codex",
    workspace: root,
    createdAt: turn.startedAt,
    updatedAt: turn.startedAt,
    turns: [turn],
  };
  host.conversations.add(conversation);
  const server = createMcpServer({
    root,
    projectId: project.id,
    pageWriteDirectory: host.conversations.writesPath(turn),
  });
  const client = new Client({ name: "undo-regression", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right);
  await client.connect(left);
  close.push(async () => {
    await client.close();
    await server.close();
  });
  const read = () => service.store.readPage(project.id, page.document.id);
  const human = async (icon: string) => {
    const current = await read();
    return service.applyPage(project.id, page.document.id, {
      baseHash: current.hash,
      baseRevision: current.revision,
      operations: [{ type: "page.set", fields: { icon } }],
    });
  };
  const agent = async (
    title: string,
    base?: Awaited<ReturnType<typeof read>>,
  ) => {
    const current = base ?? (await read());
    return client.callTool({
      name: "page_apply",
      arguments: {
        pageId: page.document.id,
        baseHash: current.hash,
        baseRevision: current.revision,
        operations: [{ type: "page.set", fields: { title } }],
        response: "receipt",
      },
    });
  };
  const finish = async () => {
    turn.resultHash = (await read()).hash;
    await host.conversations.save(conversation);
  };
  const undo = () => host.undoTurn(project.id, conversationId, turn.id);
  return { host, turn, read, human, agent, finish, undo };
}

test("real MCP writes undo to their own baseline, preserving a human edit made after the turn started", async () => {
  const f = await fixture();
  const manual = await f.human("🌿");
  expect((await f.agent("Agent first edit")).isError).not.toBe(true);
  expect((await f.agent("Agent final edit")).isError).not.toBe(true);
  await f.finish();
  expect(
    await readPageWrites(f.host.conversations.writesPath(f.turn)),
  ).toHaveLength(2);
  await f.undo();
  expect((await f.read()).hash).toBe(manual.hash);
  expect((await f.read()).document.icon).toBe("🌿");
  await expect(f.undo()).rejects.toThrow();
});

test.each([
  "between writes",
  "before turn completion",
  "after turn completion",
])(
  "undo refuses an intervening human edit %s without changing the page",
  async (when) => {
    const f = await fixture();
    expect((await f.agent("Agent edit")).isError).not.toBe(true);
    if (when === "after turn completion") await f.finish();
    await f.human("🌿");
    if (when === "between writes")
      expect((await f.agent("Agent final edit")).isError).not.toBe(true);
    if (when !== "after turn completion") await f.finish();
    const before = await f.read();
    await expect(f.undo()).rejects.toThrow();
    expect((await f.read()).hash).toBe(before.hash);
  },
);

test("failed and unchanged MCP writes do not create undo records", async () => {
  const f = await fixture();
  const stale = await f.read();
  expect((await f.agent("Before")).isError).not.toBe(true);
  await f.human("🌿");
  expect((await f.agent("Must conflict", stale)).isError).toBe(true);
  await f.finish();
  expect(await readPageWrites(f.host.conversations.writesPath(f.turn))).toEqual(
    [],
  );
  await expect(f.undo()).rejects.toThrow();
  expect((await f.read()).document.title).toBe("Before");
});

test("undo preserves a human baseline even when the Agent returns to the turn's initial hash", async () => {
  const f = await fixture();
  const original = await f.read();
  // A human edits after the turn starts, before the Agent's first write.
  const human = await new AgentService({
    root: f.host.options.library().root,
  }).applyPage(f.turn.projectId, f.turn.pageId!, {
    baseHash: original.hash,
    baseRevision: original.revision,
    operations: [{ type: "page.set", fields: { title: "Human title" } }],
  });
  expect((await f.agent("Before")).isError).not.toBe(true);
  await f.finish();
  expect(f.turn.resultHash).toBe(f.turn.baseHash);
  await f.undo();
  expect((await f.read()).hash).toBe(human.hash);
});
