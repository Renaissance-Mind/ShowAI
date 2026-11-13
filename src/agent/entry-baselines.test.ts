import { rawSourcePlugin } from "../../scripts/raw-source-plugin.mjs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { createMcpServer } from "./mcp";
import { createLibraryMcpServer } from "./mcp-library";
import { startMcpHttpServer } from "./mcp-http";

// The tool lists of the four MCP connection kinds and the CLI help, byte for
// byte. They change only when a tool or the help is changed on purpose; then
// SHOWAI_WRITE_BASELINES=1 rewrites the files and the diff is reviewed.

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, "../..");
const fixtures = join(import.meta.dirname, "fixtures");
const write = process.env.SHOWAI_WRITE_BASELINES === "1";
let directory: string;
let bundle: string;
let cli: string;
const clients: Client[] = [];

async function compare(file: string, actual: string) {
  const path = join(fixtures, file);
  if (write) {
    await mkdir(fixtures, { recursive: true });
    await writeFile(path, actual);
    return;
  }
  expect(actual).toBe(await readFile(path, "utf8"));
}
const listing = async (client: Client) =>
  JSON.stringify((await client.listTools()).tools, null, 2) + "\n";
async function inMemory(server: McpServer) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "entry-baselines", version: "1" });
  await server.connect(right);
  await client.connect(left);
  clients.push(client);
  return client;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-entry-baselines-"));
  await openLibrary(join(directory, "library"));
  await mkdir(join(repository, "node_modules/.cache"), { recursive: true });
  bundle = await mkdtemp(join(repository, "node_modules/.cache/showai-baselines-"));
  cli = join(bundle, "cli.mjs");
  await build({
    entryPoints: [join(repository, "src/agent/cli.ts")],
    outfile: cli,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["esbuild"],
    plugins: [rawSourcePlugin],
    banner: {
      js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
    },
  });
}, 120_000);
afterAll(async () => {
  for (const client of clients) await client.close();
  await syncManager(join(directory, "library")).stop();
  await rm(directory, { recursive: true, force: true });
  await rm(bundle, { recursive: true, force: true });
});

test("showai --help prints the same text", async () => {
  const { stdout } = await execute(process.execPath, [cli, "--help"], {
    env: { ...process.env, SHOWAI_HOME: join(directory, "library") },
  });
  await compare("cli-help.txt", stdout);
});

test("a local library connection lists the same tools", async () => {
  const client = await inMemory(
    createLibraryMcpServer({ root: join(directory, "library") }),
  );
  await compare("mcp-tools-library.json", await listing(client));
});

test("a connection bound to a project lists the same tools", async () => {
  const root = join(directory, "library");
  const project = await new AgentService({ root }).createProject("Baseline");
  const client = await inMemory(createMcpServer({ root, projectId: project.id }));
  await compare("mcp-tools-project.json", await listing(client));
});

test("a hosted HTTP connection lists the same tools", async () => {
  const http = await startMcpHttpServer({
    stateDirectory: join(directory, "gateway"),
    publicUrl: "https://mcp.baseline.test",
    syncServers: ["https://sync.baseline.test"],
    port: 0,
  });
  try {
    const client = new Client({ name: "entry-baselines", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(http.localUrl + "/mcp")),
    );
    clients.push(client);
    await compare("mcp-tools-http.json", await listing(client));
  } finally {
    await http.close();
  }
});

test("showai mcp --public lists the same tools", async () => {
  const client = new Client({ name: "entry-baselines", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--public"],
      env: {
        ...(process.env as Record<string, string>),
        SHOWAI_HOME: join(directory, "public"),
      },
    }),
  );
  clients.push(client);
  await compare("mcp-tools-public.json", await listing(client));
}, 60_000);
