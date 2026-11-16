import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentService } from "./service";
import { startMcpHttpServer } from "./mcp-http";
import { syncManager } from "../sync/manager";
import { CloudState } from "./cloud-state";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-mcp-log-acceptance-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  cleanup.push(() => syncManager(root).stop());
  return root;
}
async function logs(directory: string) {
  const files = (await readdir(directory)).filter((n) => n.endsWith(".jsonl"));
  return (
    await Promise.all(files.map((n) => readFile(join(directory, n), "utf8")))
  ).flatMap((text) =>
    text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  );
}

test.each(["library", "project", "public"])(
  "%s stdio entry writes logs using the built CLI",
  async (mode) => {
    const root = await fixture();
    const project = await new AgentService({ root }).createProject(
      "Logging acceptance",
    );
    const client = new Client({ name: "stdio-log-acceptance", version: "1" });
    cleanup.push(() => client.close());
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.SHOWAI_MCP_LOG_DIRECTORY;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve("dist-agent/cli.mjs"),
        "mcp",
        "--home",
        root,
        ...(mode === "public"
          ? ["--public"]
          : mode === "project"
            ? ["--project", project.id]
            : []),
      ],
      env: {
        ...env,
        SHOWAI_MCP_LOG: "1",
        SHOWAI_MCP_CLIENT: "builtin",
        SHOWAI_PLUGIN_VERSION: "log-test",
      },
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    await client.connect(transport);
    expect(
      (await client.callTool({ name: "guide", arguments: {} })).isError,
    ).not.toBe(true);
    expect(
      (
        await client.callTool({
          name: "guide",
          arguments: { topic: "invalid-topic" },
        })
      ).isError,
    ).toBe(true);
    expect(
      (await client.callTool({ name: "nonexistent_tool", arguments: {} }))
        .isError,
    ).toBe(true);
    const logDirectory =
      mode === "public" ? `${root}.mcp-logs` : join(root, "local", "mcp-logs");
    if (mode === "public")
      cleanup.push(() => rm(logDirectory, { recursive: true, force: true }));
    const saved = await logs(logDirectory);
    expect(saved).toHaveLength(6);
    expect(saved[1]).toMatchObject({
      event: "completed",
      status: "success",
      transport: "stdio",
      client: "stdio-log-acceptance",
      pluginVersion: "log-test",
      host: "builtin",
      tool: "guide",
    });
    expect(saved[1].outputBytes).toBeGreaterThan(0);
    expect(saved[3]).toMatchObject({
      status: "error",
      errorCode: "INVALID_ARGUMENTS",
    });
    expect(saved[5]).toMatchObject({
      status: "error",
      errorCode: "UNKNOWN_TOOL",
    });
  },
);

test.each([false, true])(
  "HTTP logs include success, unknown tools and denied authorization (local=%s)",
  async (local) => {
    const root = await fixture();
    const http = await startMcpHttpServer({
      stateDirectory: join(root, "state"),
      port: 0,
      ...(local
        ? {
            local: {
              root,
              projects: async () => [],
              consumePairingCode: () => false,
            },
          }
        : {}),
    });

    cleanup.push(() => http.close());
    const client = new Client({ name: "http-log-acceptance", version: "1" });
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(http.url + "/mcp")),
    );
    expect(
      (await client.callTool({ name: "guide", arguments: {} })).isError,
    ).not.toBe(true);
    const call = async (id: number, name: string, args = {}) => {
      const response = await fetch(http.url + "/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer private-bearer-secret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      return response.json();
    };
    expect(
      (await call(100, "pages_list", { projectId: "private-project" })).result
        .isError,
    ).toBe(true);
    expect((await call(101, "nonexistent_tool")).result.isError).toBe(true);
    const directory = local
      ? join(root, "local", "mcp-logs")
      : join(root, "state", "logs", "mcp");
    const saved = await logs(directory);
    expect(saved.filter((r) => r.event === "completed")).toHaveLength(3);
    expect(
      saved.find((r) => r.event === "completed" && r.tool === "guide"),
    ).toMatchObject({ status: "success", transport: "http", httpStatus: 200 });
    expect(
      saved.find((r) => r.event === "completed" && r.tool === "pages_list"),
    ).toMatchObject({ status: "error", errorCode: "invalid_token" });
    expect(
      saved.find(
        (r) => r.event === "completed" && r.tool === "nonexistent_tool",
      ),
    ).toMatchObject({ status: "error" });
    expect(JSON.stringify(saved)).not.toContain("private-");
  },
);

test("HTTP completion reflects a real durable checkpoint failure", async () => {
  const root = await fixture();
  const objects = join(root, "objects"),
    state = join(root, "state");
  await mkdir(objects);
  const durableState = new CloudState(
    state,
    {
      get: async (key) =>
        readFile(join(objects, key)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }),
      put: (key, value) => writeFile(join(objects, key), value),
    },
    "a".repeat(64),
  );
  const http = await startMcpHttpServer({
    stateDirectory: state,
    port: 0,
    durableState,
  });
  cleanup.push(() => http.close());
  const client = new Client({
    name: "durable-log-acceptance",
    version: "1",
  });
  cleanup.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(http.url + "/mcp")),
  );
  await rm(objects, { recursive: true });
  await writeFile(objects, "storage-is-now-a-file");
  await expect(
    client.callTool({ name: "guide", arguments: {} }),
  ).rejects.toThrow();
  const saved = await logs(join(state, "logs", "mcp"));
  expect(saved.filter((r) => r.event === "completed")).toHaveLength(1);
  expect(saved.at(-1)).toMatchObject({
    tool: "guide",
    status: "error",
    errorCode: "ENOTDIR",
    httpStatus: 500,
  });
});
