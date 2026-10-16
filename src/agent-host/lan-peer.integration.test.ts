import { beforeAll, afterAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, X509Certificate } from "node:crypto";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { WebSocket } from "ws";
import { startSyncServer } from "../server/node";
import { AgentService } from "../agent/service";
import { syncManager, stopSyncManagers } from "../sync/manager";
import { AgentHost } from "./host";
import { LanPeerServer } from "./lan-peer";
import type { ConnectorSettings } from "./remote-connector";
import type { ShowDocument } from "../types";
let root: string,
  peer: LanPeerServer,
  host: AgentHost,
  service: AgentService,
  projectId: string,
  pageId: string,
  certificate: Buffer,
  settings: ConnectorSettings;
let server: Awaited<ReturnType<typeof startSyncServer>>;
const clientId = randomUUID(),
  secret = "a".repeat(64),
  pairId = randomUUID();
async function post(
  path: string,
  body: unknown,
  authenticated = true,
  origin?: string,
  pin = peer.status.fingerprint,
): Promise<{ status: number; value: any }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: "127.0.0.1",
        port: peer.status.port,
        path,
        method: "POST",
        ca: certificate,
        checkServerIdentity: (_name, cert) =>
          cert.fingerprint256?.replaceAll(":", "").toLowerCase() === pin
            ? undefined
            : new Error("Certificate pin changed"),
        headers: {
          "content-type": "application/json",
          ...(authenticated
            ? { authorization: `Bearer ${secret}`, "x-showai-device": clientId }
            : {}),
          ...(origin ? { origin } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            value: JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}
const rpc = (
  action: string,
  args: Record<string, unknown> = {},
  requestId = randomUUID(),
  scope = projectId,
) => post("/rpc", { action, args, requestId, projectId: scope });
beforeAll(async () => {
  root = await mkdtemp(
    join(process.env.SHOWAI_TEST_ROOT ?? tmpdir(), "showai-lan-peer-"),
  );
  server = await startSyncServer({
    home: join(root, "server"),
    port: 0,
    registrationKey: "lan-test",
  });
  const account = await fetch(server.url + "/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "peer-owner",
      password: "peer-integration-passphrase",
      device: "integration",
      registrationKey: "lan-test",
    }),
  }).then((r) => r.json());
  service = new AgentService({ root: join(root, "library") });
  const project = await service.createProject("Paired project");
  projectId = project.id;
  pageId = (await service.createPage(projectId, { title: "Shared canvas" }))
    .document.id;
  const manager = syncManager(service.store.root);
  const connection = await manager.connect({
    url: server.url,
    token: account.token,
  });
  await manager.attach(connection.id, projectId);
  await manager.stop();
  host = new AgentHost({
    root: join(root, "agent"),
    library: () => service.store,
    cli: () => ({ command: process.execPath, args: [], env: {} }),
    pluginRoot: () => join(root, "plugin"),
  });
  settings = {
    enabled: true,
    gatewayUrl: "https://example.com",
    connectionId: connection.id,
    projectIds: [projectId],
    deviceId: randomUUID(),
    name: "Test Mac",
  };
  peer = new LanPeerServer(
    host,
    () => service.store.root,
    () => settings,
  );
  await peer.start();
  certificate = await readFile(join(root, "agent", "lan-peer", "identity.crt"));
});
afterAll(async () => {
  await peer?.close();
  host?.close();
  await stopSyncManagers();
  await server?.close();
  await rm(root, { recursive: true, force: true });
});
test("real TLS pairing requires matching consent, pins the certificate and limits project grants", async () => {
  expect(
    new X509Certificate(certificate).fingerprint256
      .replaceAll(":", "")
      .toLowerCase(),
  ).toBe(peer.status.fingerprint);
  await expect(
    post("/pair", {}, false, undefined, "0".repeat(64)),
  ).rejects.toThrow("Certificate pin changed");
  expect((await rpc("replica:index")).status).toBe(401);
  const result = await post(
    "/pair",
    { id: pairId, clientId, name: "Test iPad", secret },
    false,
  );
  expect(result.value.state).toBe("pending");
  expect(result.value.code).toMatch(/^\d{6}$/);
  expect(peer.status.pending[0].code).toBe(result.value.code);
  expect((await rpc("replica:index")).status).toBe(401);
  await peer.approve(pairId, true);
  expect(
    (
      await post(
        "/pair",
        { id: pairId, clientId, name: "Test iPad", secret },
        false,
      )
    ).value.state,
  ).toBe("approved");
  expect((await rpc("replica:index")).value.data.metadata.id).toBe(projectId);
  expect(
    (await rpc("replica:index", {}, randomUUID(), randomUUID())).status,
  ).toBe(403);
  expect((await post("/rpc", {}, true, "https://foreign.example")).status).toBe(
    403,
  );
  expect(
    (await rpc("agent:settings", { settings: { mode: "local" } })).status,
  ).toBe(403);
});
test("Mac writer merges independent real edits, retains overlapping changes, and preserves new page identity", async () => {
  const base = (await rpc("replica:page", { pageId })).value.data;
  const remote = structuredClone(base.document) as ShowDocument;
  remote.title = "Agent title";
  await service.savePage(
    projectId,
    pageId,
    remote,
    base.hash,
    undefined,
    undefined,
    base.revision,
  );
  const local = structuredClone(base.document) as ShowDocument;
  local.icon = "✏️";
  const id = randomUUID(),
    saved = await rpc(
      "replica:savePage",
      { document: local, base: base.document },
      id,
    );
  expect(saved.status).toBe(200);
  expect(saved.value.data.document.title).toBe("Agent title");
  expect(saved.value.data.document.icon).toBe("✏️");
  expect(
    (
      await rpc(
        "replica:savePage",
        { document: local, base: base.document },
        id,
      )
    ).value,
  ).toEqual(saved.value);
  expect(
    (
      await rpc(
        "replica:savePage",
        { document: { ...local, title: "Different" }, base: base.document },
        id,
      )
    ).status,
  ).toBe(400);
  const conflict = await rpc("replica:savePage", {
    document: { ...local, title: "Human title" },
    base: base.document,
  });
  expect(conflict.status).toBe(409);
  expect((await service.store.readPage(projectId, pageId)).document.title).toBe(
    "Agent title",
  );
  const fresh = {
    ...saved.value.data.document,
    id: randomUUID(),
    title: "New iPad page",
  };
  const created = await rpc("replica:savePage", { document: fresh });
  expect(created.status).toBe(200);
  expect((await service.store.readPage(projectId, fresh.id)).document.id).toBe(
    fresh.id,
  );
});
test("authenticated WSS delivers changes and consent survives restart; revocation forces pairing again", async () => {
  const socket = new WebSocket(`wss://127.0.0.1:${peer.status.port}/events`, {
    agent: new HttpsAgent({
      ca: certificate,
      checkServerIdentity: (_name, cert) =>
        cert.fingerprint256?.replaceAll(":", "").toLowerCase() ===
        peer.status.fingerprint
          ? undefined
          : new Error("Pin mismatch"),
    }),
    headers: { authorization: `Bearer ${secret}`, "x-showai-device": clientId },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("message", () => resolve());
    socket.once("error", reject);
  });
  const changed = new Promise<any>((resolve) =>
    socket.once("message", (bytes) => resolve(JSON.parse(String(bytes)))),
  );
  const original = await service.store.readPage(projectId, pageId);
  await service.savePage(
    projectId,
    pageId,
    { ...original.document, cover: "none" },
    original.hash,
    undefined,
    undefined,
    original.revision,
  );
  expect((await changed).type).toBe("changed");
  socket.terminate();
  await peer.close();
  peer = new LanPeerServer(
    host,
    () => service.store.root,
    () => settings,
  );
  await peer.start();
  expect((await rpc("replica:index")).status).toBe(200);
  await peer.approve(clientId, false);
  expect((await rpc("replica:index")).status).toBe(401);
  expect(
    (
      await post(
        "/pair",
        { id: randomUUID(), clientId, name: "Test iPad", secret },
        false,
      )
    ).value.state,
  ).toBe("pending");
});
