import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readAgentConnections } from "../agent/mcp-connections";

const launcher = resolve(import.meta.dirname, "../../plugins/showai/mcp/launch.mjs");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function library() {
  const root = await mkdtemp(join(tmpdir(), "showai-launch-failure-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "library");
  await mkdir(home);
  return { root, home };
}

/** Connects like a host: initialize, list tools, call the only tool. */
async function connect(home: string, env: Record<string, string> = {}) {
  const client = new Client({ name: "claude-code", version: "9.9.9" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [launcher],
      env: { PATH: process.env.PATH ?? "", SHOWAI_HOME: home, ...env },
      stderr: "pipe",
    }),
  );
  cleanup.push(() => client.close());
  const { tools } = await client.listTools();
  const result = await client.callTool({ name: tools[0].name, arguments: {} });
  return {
    instructions: client.getInstructions(),
    tools,
    result,
    error: (result.structuredContent as { error: Record<string, any> }).error,
  };
}

test("a missing registration still completes the handshake with one diagnostic tool", async () => {
  const { home } = await library();
  const { tools, result, error, instructions } = await connect(home);
  expect(tools.map((tool) => tool.name)).toEqual(["showai_connection_problem"]);
  // One small tool keeps the host's plugin tool budget.
  expect(JSON.stringify(tools).length).toBeLessThan(600);
  expect(instructions).toContain("showai_connection_problem");
  expect(result.isError).toBe(true);
  expect(error.code).toBe("RUNTIME_MISSING");
  expect(error.userMessage["zh-CN"]).toContain("agent-runtime.json");
  expect(error.steps["zh-CN"].join("")).toContain("修复登记");
  expect(error.steps.en.length).toBeGreaterThan(1);
  expect(error.support.reportUrl).toBe(
    "https://github.com/Renaissance-Mind/ShowAI/issues/new",
  );
  // The failure is recorded for Settings → Plugins, without the person's home path.
  const [record] = await readAgentConnections(home);
  expect(record).toMatchObject({
    client: "claude-code",
    neverConnected: true,
    lastFailure: { code: "RUNTIME_MISSING" },
  });
  const files = await readdir(join(home, "local/agent-connections"));
  expect(files).toEqual([expect.stringMatching(/^claude-code-[0-9a-f]{8}-failure\.json$/)]);
  const raw = await readFile(join(home, "local/agent-connections", files[0]), "utf8");
  expect(raw).not.toContain(home);
});

test("an invalid registration and a library mismatch have their own codes", async () => {
  const { root, home } = await library();
  await writeFile(join(home, "agent-runtime.json"), "{ not json");
  expect((await connect(home)).error.code).toBe("RUNTIME_INVALID");
  await writeFile(
    join(home, "agent-runtime.json"),
    JSON.stringify({
      format: "showai-agent-runtime",
      protocol: 1,
      version: "0.1.0",
      home: join(root, "another"),
      launch: { command: process.execPath, args: [launcher], env: {} },
    }),
  );
  const mismatch = await connect(home);
  expect(mismatch.error.code).toBe("LIBRARY_MISMATCH");
  expect(mismatch.error.detail).toContain("<library>");
});

test("a runtime without the plugin's tool protocol is reported as outdated", async () => {
  const { root, home } = await library();
  // An earlier ShowAI build: its runtime info lacks the merged tool surface.
  const old = join(root, "old-runtime.mjs");
  await writeFile(
    old,
    `process.stdout.write(JSON.stringify({ok:true,data:{version:"0.1.0",home:${JSON.stringify(home)},capabilities:{agentOperations:{protocol:"showai-mcp-v1"},templateWorkflow:{protocol:"showai-template-workflow-v2"},componentParameters:{protocol:"showai-component-parameters-v1"}}}}));`,
  );
  await writeFile(
    join(home, "agent-runtime.json"),
    JSON.stringify({
      format: "showai-agent-runtime",
      protocol: 1,
      version: "0.1.0",
      home,
      launch: { command: process.execPath, args: [old], env: {} },
    }),
  );
  const { error } = await connect(home);
  expect(error.code).toBe("RUNTIME_OUTDATED");
  expect(error.detail).toContain("0.1.0");
  expect(error.detail).toContain("merged tool surface");
  // The probe is cached by the runtime files; a replaced runtime is probed again.
  await expect(
    readFile(join(home, "local/agent-runtime-probe.json"), "utf8"),
  ).resolves.toContain('"key"');
  await writeFile(
    old,
    `process.stdout.write(JSON.stringify({ok:true,data:{version:"0.1.1",home:${JSON.stringify(home)},capabilities:{agentOperations:{protocol:"showai-mcp-v1",toolSurface:"showai-mcp-tools-v2"},templateWorkflow:{protocol:"showai-template-workflow-v2"}}}}));`,
  );
  const again = await connect(home);
  expect(again.error.detail).toContain("0.1.1");
  expect(again.error.detail).toContain("component parameters");
});

test("a moved runtime is reported as unavailable", async () => {
  const { root, home } = await library();
  await writeFile(
    join(home, "agent-runtime.json"),
    JSON.stringify({
      format: "showai-agent-runtime",
      protocol: 1,
      version: "0.1.0",
      home,
      launch: {
        command: process.execPath,
        args: [join(root, "moved/cli.mjs")],
        env: {},
      },
    }),
  );
  expect((await connect(home)).error.code).toBe("RUNTIME_UNAVAILABLE");
});

test("a runtime whose probe exits silently reports the exit code", async () => {
  const { root, home } = await library();
  // A probe that dies without stderr used to surface only "Command failed".
  const broken = join(root, "broken-runtime.mjs");
  await writeFile(broken, "process.exit(3);");
  await writeFile(
    join(home, "agent-runtime.json"),
    JSON.stringify({
      format: "showai-agent-runtime",
      protocol: 1,
      version: "0.1.0",
      home,
      launch: { command: process.execPath, args: [broken], env: {} },
    }),
  );
  const { error } = await connect(home);
  expect(error.code).toBe("RUNTIME_PROBE_FAILED");
  expect(error.detail).toContain("exit 3");
});
