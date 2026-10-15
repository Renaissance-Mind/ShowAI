import { beforeAll, afterAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startSyncServer } from "../server/node";
import { AgentService } from "../agent/service";
import { syncManager, stopSyncManagers } from "../sync/manager";
import { RemoteAgentEngine } from "./remote-engine";
import { invocation, type RemoteActor } from "./remote-protocol";

let directory: string,
  server: Awaited<ReturnType<typeof startSyncServer>>,
  engine: RemoteAgentEngine;
let actor: RemoteActor, projectId: string, pageId: string;
async function post(path: string, body: unknown) {
  const response = await fetch(server.url + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return value;
}
const request = (
  action: string,
  args: Record<string, unknown> = {},
  id?: string,
) => ({
  action,
  args,
  requestId: id ?? randomUUID(),
  destination: "cloud",
  projectId,
});
beforeAll(async () => {
  directory = await mkdtemp(
    join(process.env.SHOWAI_TEST_ROOT ?? tmpdir(), "remote-agent-"),
  );
  server = await startSyncServer({
    home: join(directory, "server"),
    port: 0,
    registrationKey: "isolated-agent-test",
  });
  const account = await post("/api/auth/register", {
    name: "agent-owner",
    password: "isolated-agent-test-passphrase",
    device: "integration",
    registrationKey: "isolated-agent-test",
  });
  const me = await fetch(server.url + "/api/me", {
    headers: { authorization: `Bearer ${account.token}` },
  }).then((r) => r.json());
  actor = {
    serverUrl: server.url,
    token: account.token,
    userId: me.user.id,
    serverId: me.serverId,
  };
  const service = new AgentService({ root: join(directory, "desktop") });
  const project = await service.createProject("Remote Agent acceptance");
  projectId = project.id;
  const page = await service.createPage(projectId, {
    title: "Version protected page",
  });
  pageId = page.document.id;
  const manager = syncManager(service.store.root);
  const connection = await manager.connect({
    url: server.url,
    token: account.token,
  });
  await manager.attach(connection.id, projectId);
  await manager.stop();
  engine = new RemoteAgentEngine({
    root: join(directory, "agent"),
    library: join(directory, "replica"),
    cli: () => ({
      command: process.execPath,
      args: [resolve("dist-agent/cli.mjs")],
      env: { SHOWAI_HOME: join(directory, "replica") },
    }),
    pluginRoot: () => resolve("plugins/showai"),
  });
}, 60000);
afterAll(async () => {
  engine?.host.close();
  await stopSyncManagers();
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test("wire validation strips transport credentials and rejects arbitrary host actions", () => {
  expect(
    invocation({ ...request("agent:status"), token: "transport-only" }),
  ).not.toHaveProperty("token");
  expect(() => invocation(request("fs:reveal"))).toThrow(
    "Invalid Agent request",
  );
});
test("account identity and current project membership are checked before opening a replica", async () => {
  await expect(
    engine.invoke(request("agent:status"), { ...actor, userId: randomUUID() }),
  ).rejects.toThrow("Account identity changed");
  await expect(
    engine.invoke(
      { ...request("agent:conversations"), projectId: randomUUID() },
      actor,
    ),
  ).rejects.toThrow();
});
test("pulls a real server project and refuses a stale page before model execution", async () => {
  await expect(
    engine.invoke(
      request("agent:send", {
        prompt: "Explain this page",
        target: { kind: "page", pageId },
        expectedHash: "stale",
      }),
      actor,
    ),
  ).rejects.toThrow("page changed");
  const list = await engine.invoke(request("agent:conversations"), actor);
  expect(list).toEqual([]);
});
test("mutation receipts survive engine recreation and reject request ID reuse", async () => {
  const id = randomUUID(),
    call = request(
      "agent:settings",
      {
        settings: {
          mode: "api",
          localAgent: "codex",
          sourceId: "",
          sources: [],
        },
      },
      id,
    );
  const status = await engine.invoke(call, actor);
  expect(status).toMatchObject({
    settings: { mode: "api" },
    credentialRoot: "",
    workspaceRoot: "",
  });
  const resumed = new RemoteAgentEngine(engine.options);
  expect(await resumed.invoke(call, actor)).toEqual(status);
  await expect(
    resumed.invoke(
      {
        ...call,
        args: {
          settings: {
            mode: "api",
            localAgent: "claude",
            sourceId: "",
            sources: [],
          },
        },
      },
      actor,
    ),
  ).rejects.toThrow("Request ID reused");
  resumed.host.close();
});
test("remote Mac grants cannot be expanded by the requesting device", async () => {
  const mac = new RemoteAgentEngine({
    ...engine.options,
    host: engine.host,
    connectionId: (await syncManager(engine.options.library).configuration())
      .connections[0].id,
    projectIds: [],
  });
  await expect(
    mac.invoke(request("agent:settings", { settings: {} })),
  ).rejects.toThrow("Configure this Mac");
  await expect(mac.invoke(request("agent:conversations"))).rejects.toThrow(
    "not shared",
  );
  await expect(
    engine.invoke(request("agent:cancel", { id: randomUUID() }), actor),
  ).rejects.toThrow("Task does not belong");
});
