import { afterEach, expect, test } from "vitest";
import { appendFile, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpCallLog } from "./mcp-call-log";
import { readMcpCallHistory } from "./mcp-call-history";
import {
  libraryMcpLogDirectory,
  mcpLogSettings,
  saveMcpRetention,
} from "./mcp-log-settings";

const roots: string[] = [];
async function library() {
  const root = await mkdtemp(join(tmpdir(), "showai-call-history-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function call(log: McpCallLog, id: number) {
  const record = log.begin({
    method: "tools/call",
    id,
    params: { name: `tool_${id}`, arguments: { text: "private text" } },
  });
  log.finish(record, { value: { result: {} } });
}

test("pages overlapping sessions without duplicates and filters by transport", async () => {
  const root = await library();
  const directory = libraryMcpLogDirectory(root);
  const local = new McpCallLog({ directory, transport: "stdio" });
  const remote = new McpCallLog({ directory, transport: "http" });
  for (let i = 0; i < 64; i++) call(i % 2 ? remote : local, i);
  await appendFile(remote.path, '{"partial":');
  const first = await readMcpCallHistory(root);
  expect(first.records).toHaveLength(30);
  call(local, 64);
  const second = await readMcpCallHistory(root, { before: first.next });
  const third = await readMcpCallHistory(root, { before: second.next });
  const all = [...first.records, ...second.records, ...third.records];
  expect(new Set(all.map((row) => row.callId)).size).toBe(64);
  expect(all).toHaveLength(64);
  expect(third.next).toBeUndefined();
  const http = await readMcpCallHistory(root, { transport: "http" });
  expect(http.records.every((row) => row.transport === "http")).toBe(true);
  expect(JSON.stringify(all)).not.toContain("private text");
});

test("saves a library's retention atomically and the writer prunes using it", async () => {
  const root = await library();
  const directory = libraryMcpLogDirectory(root);
  expect(mcpLogSettings(root).retentionDays).toBe(30);
  await saveMcpRetention(root, 7);
  await expect(saveMcpRetention(root, -1)).rejects.toThrow();
  expect(mcpLogSettings(root).retentionDays).toBe(7);
  expect(mcpLogSettings(await library()).retentionDays).toBe(30);
  const old = new McpCallLog({ directory, transport: "stdio" });
  call(old, 1);
  const eightDaysAgo = new Date(Date.now() - 8 * 86400000);
  await utimes(old.path, eightDaysAgo, eightDaysAgo);
  call(new McpCallLog({ directory, transport: "stdio" }), 2);
  const history = await readMcpCallHistory(root);
  expect(history.records.map((row) => row.tool)).toEqual(["tool_2"]);
});
