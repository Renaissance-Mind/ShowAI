import { afterAll, beforeAll, expect, test } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentHost } from "./host";
import {
  ConversationStore,
  parseTarget,
  recap,
  targetInstructions,
} from "./conversations";
import type { AgentConversation, AgentTurn } from "./types";
import { FileStore } from "../core/store";
import { openLibrary } from "../core/open-library";
import { AgentService } from "../agent/service";
import { pageWriteCapture, type PageWrite } from "../core/page-write-capture";
import { savePageWrites } from "./page-undo";

let directory: string, library: FileStore, host: AgentHost, log: string;

// A stand-in for `claude -p --output-format stream-json` that records its arguments.
const fakeClaude = `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.SHOWAI_FAKE_AGENT_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
const out = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
out({ type: "system", subtype: "init", session_id: "ignored" });
out({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } });
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } } });
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } } });
out({ type: "assistant", message: { content: [{ type: "text", text: "Hello world" }, { type: "tool_use", name: "mcp__showai__page_read" }] } });
out({ type: "result", is_error: false, result: "Hello world" });
`;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-conversations-test-"));
  library = new FileStore(join(directory, "library"));
  await openLibrary(library.root);
  log = join(directory, "agent-args.jsonl");
  process.env.SHOWAI_FAKE_AGENT_LOG = log;
  const agentPath = join(directory, "claude");
  await writeFile(agentPath, fakeClaude);
  await chmod(agentPath, 0o755);
  host = new AgentHost({
    root: join(directory, "agent"),
    workspaceRoot: join(directory, "workspaces"),
    library: () => library,
    cli: () => ({ command: process.execPath, args: ["unused"], env: {} }),
    pluginRoot: () => join(directory, "plugin"),
  });
  await host.save({
    mode: "local",
    localAgent: "claude",
    sourceId: "",
    sources: [],
  });
  (host as unknown as { agents: unknown[] }).agents = [
    {
      id: "claude",
      name: "Claude Code",
      path: agentPath,
      version: "test",
      auth: "ready",
      detail: "",
      callable: true,
    },
  ];
});
afterAll(async () => {
  host.close();
  delete process.env.SHOWAI_FAKE_AGENT_LOG;
  await rm(directory, { recursive: true, force: true });
});

async function settled(projectId: string, id: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const conversation = await host.conversations.get(projectId, id);
    if (conversation.turns.every((turn) => turn.state !== "running"))
      return conversation;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The turn did not finish.");
}

test("targets keep stable ids, drop duplicates and bound quoted text", () => {
  expect(parseTarget(undefined)).toEqual({ kind: "page" });
  const target = parseTarget({
    kind: "text",
    pageId: "page-1",
    blockIds: ["a", "a", "b"],
    text: "x".repeat(5000),
  });
  expect(target.blockIds).toEqual(["a", "b"]);
  expect(target.text).toHaveLength(4000);
  expect(() => parseTarget({ kind: "blocks", blockIds: ["../x"] })).toThrow();
  const instructions = targetInstructions(target, "Report");
  expect(instructions).toContain('blockIds=["a","b"]');
  expect(instructions).toContain("page_read using blockIds");
  expect(targetInstructions({ kind: "page", pageId: "p" })).not.toContain(
    "page_read using blockIds",
  );
});

test("handed-over component state reaches the prompt without its private part", () => {
  const target = parseTarget({
    kind: "page",
    pageId: "page-1",
    components: [
      {
        blockId: "explorer",
        componentId: "damped",
        name: "Explorer",
        label: "γ=0.3",
        model: { gamma: 0.3 },
        private: { zoom: 2 },
      },
    ],
  });
  expect(target.components).toEqual([
    {
      blockId: "explorer",
      componentId: "damped",
      name: "Explorer",
      label: "γ=0.3",
      model: { gamma: 0.3 },
    },
  ]);
  const instructions = targetInstructions(target);
  expect(instructions).toContain('block explorer ("Explorer", damped)');
  expect(instructions).toContain('{"gamma":0.3}');
  expect(instructions).toContain("not saved to the page");
  expect(instructions).not.toContain("zoom");
  const item = { blockId: "b", name: "C", model: "x".repeat(9000) };
  expect(() => parseTarget({ kind: "page", components: [item] })).toThrow(
    /model exceeds/,
  );
  expect(() =>
    parseTarget({
      kind: "page",
      components: Array.from({ length: 7 }, (_, index) => ({
        blockId: `b${index}`,
        name: "C",
        model: 1,
      })),
    }),
  ).toThrow();
});

test("recap summarises finished turns for agents without session resume", () => {
  const turn = (
    id: string,
    prompt: string,
    reply: string,
    state = "completed",
  ) =>
    ({
      id,
      prompt,
      state,
      events: [{ sequence: 1, type: "message", text: reply }],
    }) as unknown as AgentTurn;
  const conversation = {
    turns: [turn("1", "Shorten it", "Done"), turn("2", "Now?", "", "running")],
  } as AgentConversation;
  const text = recap(conversation, "2");
  expect(text).toContain("User: Shorten it\nAssistant: Done");
  expect(text).not.toContain("Now?");
});

test("a conversation streams, persists and resumes the same Claude session", async () => {
  const project = await library.createProject({ name: "Conversation test" });
  const page = await library.createPage(project.id, { title: "Notes" });
  const first = await host.send({
    projectId: project.id,
    prompt: "Explain this block",
    target: { kind: "blocks", pageId: page.document.id, blockIds: ["b1"] },
  });
  const done = await settled(project.id, first.id);
  const [turn] = done.turns;
  expect(turn.state).toBe("completed");
  expect(
    turn.events.filter((event) => event.type === "message").map((e) => e.text),
  ).toEqual(["Hello world"]);
  expect(turn.events.some((event) => event.text === "showai · page_read")).toBe(
    true,
  );
  expect(turn.resultHash).toBe(turn.baseHash);
  expect(done.threadId).toBeTruthy();

  await host.send({
    projectId: project.id,
    conversationId: first.id,
    prompt: "And the next one?",
    target: { kind: "page", pageId: page.document.id },
  });
  const resumed = await settled(project.id, first.id);
  expect(resumed.turns).toHaveLength(2);
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  const sessionId = calls[0][calls[0].indexOf("--session-id") + 1];
  expect(sessionId).toBe(done.threadId);
  expect(calls[1][calls[1].indexOf("--resume") + 1]).toBe(sessionId);
  expect(calls[1][1]).toContain("Continue this ShowAI conversation");
  expect(calls[1][1]).not.toContain("Component directory");

  // A fresh store reads the same history from disk.
  const reloaded = await new ConversationStore(join(directory, "agent")).list(
    project.id,
  );
  expect(reloaded.map((item) => item.turns.length)).toEqual([2]);
});

test("undo restores the page only while it still matches the turn result", async () => {
  const project = await library.createProject({ name: "Undo test" });
  const page = await library.createPage(project.id, { title: "Before" });
  const conversation = await host.send({
    projectId: project.id,
    prompt: "Rename the page",
    target: { kind: "page", pageId: page.document.id },
  });
  const done = await settled(project.id, conversation.id);
  const turn = done.turns[0];
  await expect(
    host.undoTurn(project.id, conversation.id, turn.id),
  ).rejects.toThrow();
  // Simulate the Agent's write, then record it as the turn result.
  const current = await library.readPage(project.id, page.document.id);
  const writes: PageWrite[] = [];
  const saved = await pageWriteCapture.run(writes, () =>
    new AgentService({ root: library.root }).savePage(
      project.id,
      page.document.id,
      { ...current.document, title: "After" },
      current.hash,
      undefined,
      undefined,
      current.revision,
    ),
  );
  await savePageWrites(host.conversations.writesPath(turn), writes);
  turn.resultHash = saved.hash;
  const undone = await host.undoTurn(project.id, conversation.id, turn.id);
  expect(undone.turns[0].undone).toBe(true);
  expect(
    (await library.readPage(project.id, page.document.id)).document.title,
  ).toBe("Before");
  await expect(
    host.undoTurn(project.id, conversation.id, turn.id),
  ).rejects.toThrow();
});
