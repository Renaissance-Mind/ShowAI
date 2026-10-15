import { beforeAll, afterAll, expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { startSyncServer } from "../server/node";
import { AgentService } from "../agent/service";
import { syncManager, stopSyncManagers } from "../sync/manager";
import { AgentHost } from "./host";
import { RemoteMacConnector } from "./remote-connector";
let directory: string,
  gateway: string,
  token: string,
  deviceId: string,
  projectId: string;
let server: Awaited<ReturnType<typeof startSyncServer>>,
  worker: ChildProcess,
  connector: RemoteMacConnector,
  host: AgentHost;
let workerOutput = "";
const clientId = randomUUID();
async function request(path: string, input: Record<string, unknown> = {}) {
  const response = await fetch(gateway + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serverUrl: server.url, token, ...input }),
  });
  return { status: response.status, value: await response.json() };
}
beforeAll(async () => {
  directory = await mkdtemp(
    join(process.env.SHOWAI_TEST_ROOT ?? tmpdir(), "agent-relay-"),
  );
  server = await startSyncServer({
    home: join(directory, "server"),
    port: 0,
    registrationKey: "relay-test",
  });
  const account = await fetch(server.url + "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "relay-owner",
      password: "relay-integration-passphrase",
      device: "relay",
      registrationKey: "relay-test",
    }),
  }).then((r) => r.json());
  token = account.token;
  const local = new AgentService({ root: join(directory, "library") });
  const project = await local.createProject("Authorized relay project");
  projectId = project.id;
  const manager = syncManager(local.store.root);
  const connection = await manager.connect({ url: server.url, token });
  await manager.attach(connection.id, projectId);
  await manager.stop();
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((done) => socket.close(() => done()));
  gateway = `http://127.0.0.1:${port}`;
  const config = join(directory, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "isolated-agent-relay",
      main: resolve("deployments/cloudflare/agent-worker.mjs"),
      compatibility_date: "2026-10-13",
      vars: {
        SHOWAI_AGENT_URL: gateway,
        SHOWAI_AGENT_SYNC_SERVERS: server.url,
        SHOWAI_AGENT_KEY: "f".repeat(64),
      },
      durable_objects: {
        bindings: [{ name: "AGENTS", class_name: "ShowAIAgentGateway" }],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["ShowAIAgentGateway"] }],
      r2_buckets: [{ binding: "STATE", bucket_name: "isolated-agent-state" }],
    }),
  );
  worker = spawn(
    "npx",
    [
      "--yes",
      "wrangler@4.148.0",
      "dev",
      "--local",
      "--config",
      config,
      "--port",
      String(port),
      "--persist-to",
      join(directory, "worker-state"),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  worker.stdout!.on("data", (chunk) => (workerOutput += chunk));
  worker.stderr!.on("data", (chunk) => (workerOutput += chunk));
  let ready = false;
  for (let n = 0; n < 180; n++) {
    if (worker.exitCode !== null) throw new Error(workerOutput);
    try {
      if ((await fetch(gateway + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Worker is starting. */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Worker startup failed: " + workerOutput);
  host = new AgentHost({
    root: join(directory, "profile"),
    library: () => local.store,
    cli: () => ({
      command: process.execPath,
      args: [resolve("dist-agent/cli.mjs")],
      env: { SHOWAI_HOME: local.store.root },
    }),
    pluginRoot: () => resolve("plugins/showai"),
  });
  connector = new RemoteMacConnector(host, () => local.store.root);
  deviceId = randomUUID();
  await connector.save({
    enabled: true,
    gatewayUrl: gateway,
    connectionId: connection.id,
    projectIds: [projectId],
    deviceId,
    name: "Integration Mac",
  });
  for (let n = 0; n < 100; n++) {
    if ((await connector.status()).online) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error((await connector.status()).error);
}, 120000);
afterAll(async () => {
  connector?.close();
  host?.close();
  if (worker) {
    worker.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => worker.once("exit", r)),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  await stopSyncManagers();
  await server?.close();
  if (directory) {
    await writeFile(join(directory, "worker.log"), workerOutput);
    await rm(directory, { recursive: true, force: true });
  }
});
test("cloud OAuth returns the supported local-registration path before starting a container", async () => {
  const result = await request("/invoke", {
    destination: "cloud",
    requestId: randomUUID(),
    action: "agent:authorize",
    args: { id: randomUUID() },
  });
  expect(result.status).toBe(409);
  expect(result.value.error.code).toBe("LOCAL_CHATGPT_AUTH_REQUIRED");
});
test("a real outbound WebSocket requires Mac confirmation before returning an actual Agent status", async () => {
  const destinations = await request("/destinations");
  expect(destinations.value).toContainEqual(
    expect.objectContaining({
      id: deviceId,
      name: "Integration Mac",
      online: true,
    }),
  );
  const pending = await request("/invoke", {
    action: "agent:status",
    args: {},
    clientId,
    destination: deviceId,
    requestId: randomUUID(),
  });
  expect(pending.value).toMatchObject({ ok: false });
  expect((await connector.status()).pendingClients).toContainEqual(
    expect.objectContaining({ id: clientId }),
  );
  await connector.approveClient(clientId, true);
  const result = await request("/invoke", {
    action: "agent:status",
    args: {},
    clientId,
    destination: deviceId,
    requestId: randomUUID(),
  });
  expect(result.value).toMatchObject({
    ok: true,
    data: {
      credentialRoot: "",
      workspaceRoot: "",
      settings: { mode: "local" },
    },
  });
});
test("relay refuses unauthorized projects and host filesystem actions", async () => {
  expect(
    (await fetch(gateway + "/_operations/health", { method: "POST" })).status,
  ).toBe(404);
  expect(
    (
      await request("/invoke", {
        action: "agent:conversations",
        args: {},
        projectId: randomUUID(),
        destination: deviceId,
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request("/invoke", {
        action: "fs:reveal",
        args: { path: "/" },
        destination: deviceId,
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (await request("/destinations", { token: "revoked-session" })).status,
  ).toBe(401);
});
test("disabling sharing removes the Mac without opening any inbound listener", async () => {
  const status = await connector.status();
  await connector.save({ ...status.settings, enabled: false });
  await new Promise((r) => setTimeout(r, 250));
  expect((await request("/destinations")).value).not.toContainEqual(
    expect.objectContaining({ id: deviceId }),
  );
});
