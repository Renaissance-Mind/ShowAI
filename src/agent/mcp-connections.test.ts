import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLibraryMcpServer } from "./mcp-library";
import { readAgentConnections, recordConnections } from "./mcp-connections";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function connect(root: string, name: string) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const server = createLibraryMcpServer({ root });
  const recorder = recordConnections(right, root);
  await server.connect(right);
  const client = new Client({ name, version: "2.1.0" });
  await client.connect(left);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, recorder };
}

test("records each MCP client's first connection and first tool call", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-mcp-connections-"));
  cleanup.push(async () => {
    await syncManager(root).stop();
    await rm(root, { recursive: true, force: true });
  });
  await openLibrary(root);
  expect(await readAgentConnections(root)).toEqual([]);

  const first = await connect(root, "claude-code");
  await first.recorder.flush();
  const [connected] = await readAgentConnections(root);
  expect(connected).toMatchObject({ client: "claude-code", version: "2.1.0" });
  expect(connected.firstConnectedAt).toBe(connected.lastConnectedAt);
  expect(connected.firstCallAt).toBeUndefined();

  const result = await first.client.callTool({
    name: "projects_list",
    arguments: {},
  });
  expect(result.isError).not.toBe(true);
  await first.recorder.flush();
  const [called] = await readAgentConnections(root);
  expect(called.firstCallAt).toBeDefined();
  expect(called.firstConnectedAt).toBe(connected.firstConnectedAt);

  // A later session keeps the first call and adds the other host separately.
  await new Promise((done) => setTimeout(done, 5));
  const again = await connect(root, "claude-code");
  const codex = await connect(root, "codex-mcp-client");
  await again.recorder.flush();
  await codex.recorder.flush();
  const records = await readAgentConnections(root);
  expect(records.map((record) => record.client).sort()).toEqual([
    "claude-code",
    "codex-mcp-client",
  ]);
  const claude = records.find((record) => record.client === "claude-code")!;
  expect(claude.firstCallAt).toBe(called.firstCallAt);
  expect(claude.lastConnectedAt > claude.firstConnectedAt).toBe(true);
  expect(
    records.find((record) => record.client === "codex-mcp-client")!.firstCallAt,
  ).toBeUndefined();
});
