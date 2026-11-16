import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { McpCallLog, recordMcpCalls } from "./mcp-call-log";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "showai-mcp-call-log-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
const request = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: {
    name: "page_read",
    arguments: {
      projectId: "private-project",
      pageId: "private-page",
      document: "private-document",
      password: "private-password",
    },
  },
});
const records = async (path: string) =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

test("records concurrent calls, failures and sizes without logging content or resource identifiers", async () => {
  const log = new McpCallLog({
    directory: await directory(),
    transport: "http",
  });
  const first = log.begin(request(1), { sessionId: "private-session" });
  const second = log.begin(request(2));
  log.authorize(first, "private-grant");
  const output = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "CONFLICT", message: "private-error-body" },
      },
    },
  };
  log.finish(second, { value: { result: {} }, httpStatus: 200 });
  log.finish(first, { value: output, httpStatus: 200 });
  const saved = await records(log.path);
  expect(saved.map((r) => r.event)).toEqual([
    "started",
    "started",
    "completed",
    "completed",
  ]);
  expect(saved[2]).toMatchObject({
    sequence: 2,
    status: "success",
    transport: "http",
  });
  expect(saved[3]).toMatchObject({
    sequence: 1,
    callId: saved[0].callId,
    status: "error",
    errorCode: "CONFLICT",
    inputBytes: Buffer.byteLength(JSON.stringify(request(1))),
    outputBytes: Buffer.byteLength(JSON.stringify(output)),
  });
  expect(saved[3].durationMs).toBeGreaterThanOrEqual(0);
  expect(saved[3].authorizationId).toHaveLength(24);
  expect(saved[0].sessionId).toHaveLength(24);
  expect(await readFile(log.path, "utf8")).not.toContain("private-");
  if (process.platform !== "win32")
    expect((await stat(log.path)).mode & 0o777).toBe(0o600);
});

test("rotates per writer, prunes expired logs and leaves unrelated files intact", async () => {
  const root = await directory();
  const old = join(root, "calls-1-00000000-0000-0000-0000-000000000000.jsonl");
  await writeFile(old, "expired");
  await utimes(old, new Date(0), new Date(0));
  await writeFile(join(root, "retain.jsonl"), "user-data");
  const log = new McpCallLog({
    directory: root,
    transport: "stdio",
    maxBytes: 1500,
    files: 2,
  });
  for (let i = 0; i < 12; i++)
    log.finish(log.begin(request(i)), { value: { result: {} } });
  const names = await readdir(root);
  expect(names).not.toContain(old.split(/[\\/]/).at(-1));
  expect(names.filter((n) => n.startsWith("calls-"))).toHaveLength(2);
  expect(await readFile(join(root, "retain.jsonl"), "utf8")).toBe("user-data");
  for (const name of names.filter((n) => n.startsWith("calls-"))) {
    expect((await stat(join(root, name))).size).toBeLessThanOrEqual(1500);
    expect((await records(join(root, name))).length).toBeGreaterThan(0);
  }
});

test("disabled logging and unavailable storage preserve operation results and errors", async () => {
  const root = await directory();
  const disabled = new McpCallLog({
    directory: join(root, "disabled"),
    transport: "http",
    enabled: false,
  });
  expect(
    await disabled.run(
      request(1),
      async () => 42,
      () => ({}),
    ),
  ).toBe(42);
  expect(await readdir(root)).toEqual([]);
  const blocked = join(root, "blocked");
  await writeFile(blocked, "file");
  const log = new McpCallLog({ directory: blocked, transport: "http" });
  expect(
    await log.run(
      request(2),
      async () => 43,
      () => ({}),
    ),
  ).toBe(43);
  const error = new Error("private-exception");
  await expect(
    log.run(
      request(3),
      async () => {
        throw error;
      },
      () => ({}),
    ),
  ).rejects.toBe(error);
});

test("transport hooks correlate real concurrent RPC responses and interrupted calls", async () => {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "call-log-test", version: "1" });
  server.registerTool(
    "echo",
    { inputSchema: { value: z.string() } },
    async ({ value }) => ({ content: [{ type: "text", text: value }] }),
  );
  const log = recordMcpCalls(right, await directory());
  const client = new Client({ name: "actual-client", version: "2" });
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(right);
  await client.connect(left);
  await Promise.all([
    client.callTool({ name: "echo", arguments: { value: "private-content" } }),
    client.callTool({ name: "echo", arguments: { value: 1 } }),
  ]);
  const saved = await records(log.path);
  expect(
    saved
      .filter((r) => r.event === "completed")
      .map((r) => r.status)
      .sort(),
  ).toEqual(["error", "success"]);
  expect(saved.find((r) => r.status === "error").errorCode).toBe("TOOL_ERROR");
  const protocolError = await client
    .callTool({ name: 123 as never })
    .catch((error) => error);
  expect(typeof protocolError.code).toBe("number");
  expect((await records(log.path)).at(-1).errorCode).toBe(protocolError.code);
  expect(
    saved.every((r) => r.client === "actual-client" && r.clientVersion === "2"),
  ).toBe(true);
  expect(new Set(saved.map((r) => r.sessionId)).size).toBe(1);
  expect(await readFile(log.path, "utf8")).not.toContain("private-content");
  await left.send({
    jsonrpc: "2.0",
    id: 900,
    method: "tools/call",
    params: { name: "echo", arguments: { value: "closing" } },
  });
  await client.close();
  const completed = (await records(log.path)).filter(
    (r) => r.event === "completed",
  );
  expect(completed).toHaveLength(4);
  expect(completed.at(-1).status).toBe("interrupted");
});

test("stdio cancellation is retained when the SDK suppresses the cancelled response", async () => {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "cancel-log-test", version: "1" });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  server.registerTool("wait", { inputSchema: {} }, async (_input, extra) => {
    entered();
    await new Promise<void>((resolve) =>
      extra.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { isError: true, content: [{ type: "text", text: "Cancelled" }] };
  });
  const log = recordMcpCalls(right, await directory());
  const client = new Client({ name: "cancel-client", version: "1" });
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(right);
  await client.connect(left);
  await left.send({
    jsonrpc: "2.0",
    id: 901,
    method: "tools/call",
    params: { name: "wait", arguments: {} },
  });
  await started;
  await left.send({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 901 },
  });
  await client.close();
  expect((await records(log.path)).at(-1)).toMatchObject({
    event: "completed",
    status: "cancelled",
  });
});
