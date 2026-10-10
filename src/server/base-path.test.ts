import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSyncServer } from "./node";
import { SyncManager } from "../sync/manager";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { once } from "node:events";
import WebSocket from "ws";
import { eventProtocol } from "../sync/events";
import privateProxy from "./private-proxy";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});

test("prefixed Linux service supports real clients, invitation aliases and synchronization", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-prefix-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const server = await startSyncServer({
    home: join(root, "server"),
    port: 0,
    registrationMode: "open",
    publicUrl: "https://example.com/cloud/",
  });
  cleanup.push(() => server.close());
  const origin = new URL(server.url).origin;
  for (const path of [
    "/api/info",
    "/cloud-staging/api/info",
    "/clouded/api/info",
    "/",
  ])
    expect((await fetch(origin + path)).status).toBe(404);
  expect((await fetch(server.url + "/api/info/?probe=1")).status).toBe(200);
  const clients = [];
  for (const name of ["Alice", "Bob"]) {
    const home = join(root, name);
    await new GitLibrary(home).initialize();
    const manager = new SyncManager(home),
      store = new FileStore(home);
    cleanup.push(() => manager.stop());
    const connection = await manager.connect({
      url: server.url + "/",
      account: name,
      password: "test-password",
      register: true,
    });
    await manager.stop();
    clients.push({ manager, store, connection });
  }
  const [alice, bob] = clients;
  const project = await alice.store.createProject({ name: "Prefix project" });
  const page = await alice.store.createPage(project.id, {
    title: "Prefix content",
  });
  await alice.manager.attach(alice.connection.id, project.id);
  await alice.manager.stop();
  const invite = (await alice.manager.manage(
    alice.connection.id,
    project.id,
    "invite",
    { role: "editor" },
  )) as { url: string };
  expect(new URL(invite.url).pathname).toBe("/cloud/join");
  expect(new URL(invite.url).origin).toBe("https://example.com");
  expect((await alice.manager.previewInvite(invite.url)).url).toBe(server.url);
  const html = await (await fetch(server.url + "/join")).text();
  expect(html).toContain('"https://example.com/cloud"');
  expect(
    (await fetch(server.url + "/join")).headers.get("referrer-policy"),
  ).toBe("no-referrer");
  await bob.manager.join(bob.connection.id, invite.url);
  await bob.manager.stop();
  expect(
    (await bob.store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Prefix content");
  expect((await bob.manager.status()).projects[0].status).toBe("synced");
});

test("preferred HTTPS prefix and explicit legacy root share accounts, tokens and real event sockets", async () => {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  const root = await mkdtemp(join(base, "showai-alias-"));
  cleanup.push(() => rm(root, { recursive: true }));
  const server = await startSyncServer({
    home: join(root, "server"),
    port: 0,
    registrationMode: "open",
    publicUrl: "https://showai.example.com/private",
    pathAliases: [""],
  });
  cleanup.push(() => server.close());
  const origin = new URL(server.url).origin;
  const manager = new SyncManager(join(root, "client"));
  cleanup.push(() => manager.stop());
  const added = await manager.connect({
    url: origin,
    account: "Alias owner",
    register: true,
    personalToken: true,
  });
  const connection = (await manager.configuration()).connections.find(
    (item) => item.id === added.id,
  )!;
  await manager.stop();
  for (const base of [origin, server.url]) {
    const me = await fetch(base + "/api/me", {
      headers: { authorization: `Bearer ${connection.token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).serverId).toBe(connection.serverId);
    const socket = new WebSocket(
      base.replace(/^http/, "ws") + "/api/events",
      eventProtocol,
      { headers: { authorization: `Bearer ${connection.token}` } },
    );
    cleanup.push(async () => {
      socket.terminate();
    });
    await once(socket, "open", { signal: AbortSignal.timeout(10_000) });
    const closed = once(socket, "close");
    socket.close();
    await closed;
  }
  const identity = await fetch(server.url + "/api/account/identity", {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect((await identity.json()).identity.url).toBe(
    "https://showai.example.com/private",
  );
  const info = await privateProxy.fetch(
    new Request("https://showai.example.com/private/api/info?probe=1"),
    { PRIVATE_ORIGIN: origin },
  );
  expect((await info.json()).serverId).toBe(connection.serverId);
  const generated = await privateProxy.fetch(
    new Request("https://showai.example.com/private/api/account/tokens", {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ device: "Proxy transport acceptance" }),
    }),
    { PRIVATE_ORIGIN: origin },
  );
  expect(generated.status).toBe(201);
  expect((await generated.json()).kind).toBe("personal");
  expect(
    (
      await privateProxy.fetch(
        new Request("https://showai.example.com/private-extra/api/info"),
        { PRIVATE_ORIGIN: origin },
      )
    ).status,
  ).toBe(404);
  await expect(
    startSyncServer({
      home: join(root, "invalid"),
      port: 0,
      publicUrl: "https://showai.example.com/private",
      pathAliases: ["/private/../cloud"],
    }),
  ).rejects.toThrow();
}, 60_000);
