import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSyncServer, SQLiteMetadata } from "./node";
import { SyncManager } from "../sync/manager";
import { accountRequest } from "../sync/account-manager";
import type { SignedIdentity, SignedGrant } from "../sync/accounts";
import type { ServerConnection } from "../sync/protocol";
import { ModelResourceClient } from "../sync/model-resources";
import { AgentHost } from "../agent-host/host";
import { FileStore } from "../core/store";
import type { AccountResource } from "../sync/accounts";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function setup() {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "account-federation-"));
  cleanup.push(() => rm(root, { recursive: true }));
  const services = [];
  for (let index = 0; index < 3; index++) {
    const service = await startSyncServer({
      home: join(root, `server-${index}`),
      port: 0,
      name: `Service ${index}`,
      registrationMode: "open",
    });
    services.push(service);
    cleanup.push(() => service.close());
  }
  const client = new SyncManager(join(root, "device-one"));
  cleanup.push(() => client.stop());
  const connections = [];
  for (const service of services) {
    const added = await client.connect({
      url: service.url,
      account: "Owner",
      password: "account-password",
      register: true,
    });
    connections.push(
      (await client.configuration()).connections.find(
        (item) => item.id === added.id,
      )!,
    );
  }
  return { root, services, client, connections };
}
test("three real services bind transitively and any login restores per-device sessions", async () => {
  const f = await setup(),
    [a, b, c] = f.connections;
  expect((await f.client.accounts.bind(a.id, b.id)).pending).toHaveLength(0);
  expect((await f.client.accounts.bind(b.id, c.id)).pending).toHaveLength(0);
  for (const connection of f.connections) {
    const profile = await f.client.accounts.profile(connection.id);
    expect(
      profile.peers.filter((item) => item.state === "active"),
    ).toHaveLength(2);
  }
  for (const original of f.connections) {
    const device = new SyncManager(join(f.root, `new-${original.serverId}`));
    cleanup.push(() => device.stop());
    await device.connect({ url: original.url, token: original.token });
    const config = await device.configuration();
    expect(config.connections).toHaveLength(3);
    for (const connection of config.connections) {
      const me = await accountRequest<{ serverId: string }>(
        connection,
        "/api/me",
      );
      expect(me.serverId).toBe(connection.serverId);
      if (connection.serverId !== original.serverId)
        expect(connection.token).not.toBe(
          f.connections.find((item) => item.serverId === connection.serverId)!
            .token,
        );
    }
    expect(
      (await device.status()).connections.every((item) => !("token" in item)),
    ).toBe(true);
  }
  const db = new SQLiteMetadata(join(f.root, "server-0/metadata.sqlite"));
  expect(
    JSON.stringify(await db.all("SELECT * FROM account_identities")),
  ).not.toContain('"d":');
  db.close();
  expect(
    (await readFile(join(f.root, "server-0/vault.key"), "utf8")).length,
  ).toBe(64);
}, 60_000);
test("grants reject forgery, wrong audience, replay, unrelated users and removed peers", async () => {
  const f = await setup(),
    [a, b, c] = f.connections;
  await f.client.accounts.bind(a.id, b.id);
  const grant = await accountRequest<SignedGrant>(
    a,
    "/api/account/grants",
    "POST",
    {
      serverId: b.serverId,
      deviceId: crypto.randomUUID(),
      device: "Test device",
    },
  );
  await expect(
    accountRequest(
      { url: c.url, token: "" },
      "/api/auth/exchange",
      "POST",
      grant,
    ),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    accountRequest({ url: b.url, token: "" }, "/api/auth/exchange", "POST", {
      ...grant,
      grant: { ...grant.grant, device: "Tampered" },
    }),
  ).rejects.toMatchObject({ status: 401 });
  const exchanged = await accountRequest<{ token: string }>(
    b,
    "/api/auth/exchange",
    "POST",
    grant,
  );
  await expect(
    accountRequest(b, "/api/auth/exchange", "POST", grant),
  ).rejects.toMatchObject({ status: 409 });
  const second = await accountRequest<SignedGrant>(
    a,
    "/api/account/grants",
    "POST",
    {
      serverId: b.serverId,
      deviceId: crypto.randomUUID(),
      device: "Another device",
    },
  );
  await f.client.accounts.unbind(a.id, b.serverId);
  await expect(
    accountRequest(b, "/api/auth/exchange", "POST", second),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    accountRequest({ ...b, token: exchanged.token }, "/api/me"),
  ).rejects.toMatchObject({ status: 401 });
  const stranger = new SyncManager(join(f.root, "stranger"));
  cleanup.push(() => stranger.stop());
  const added = await stranger.connect({
    url: b.url,
    account: "Stranger",
    password: "stranger-password",
    register: true,
  });
  const unrelated = (await stranger.configuration()).connections.find(
    (item) => item.id === added.id,
  )!;
  expect(
    (
      await accountRequest<{ peers: unknown[] }>(
        unrelated,
        "/api/account/federation",
      )
    ).peers,
  ).toHaveLength(0);
}, 60_000);
test("private personal tokens and device display choices remain independently revocable", async () => {
  const f = await setup(),
    a = f.connections[0];
  const generated = await accountRequest<{
    token: string;
    kind: string;
    expiresAt: string;
  }>(a, "/api/account/tokens", "POST", { device: "Personal token" });
  expect(generated.kind).toBe("personal");
  expect(Date.parse(generated.expiresAt)).toBeGreaterThan(
    Date.now() + 300 * 86400_000,
  );
  const me = await accountRequest<{ user: { id: string } }>(
    { ...a, token: generated.token },
    "/api/me",
  );
  expect(me.user.id).toBe(a.user.id);
  await f.client.setProjectVisibility("project-one", false);
  const other = new SyncManager(join(f.root, "device-two"));
  cleanup.push(() => other.stop());
  await other.connect({ url: a.url, token: generated.token });
  expect((await other.configuration()).hiddenProjectIds ?? []).toEqual([]);
  expect((await f.client.configuration()).hiddenProjectIds).toEqual([
    "project-one",
  ]);
  const own = await accountRequest<SignedIdentity>(
    a,
    "/api/account/identity",
    "POST",
    {},
  );
  const profile = await accountRequest(a, "/api/account/federation");
  expect(JSON.stringify(profile)).not.toContain(generated.token);
  expect(own.identity.user.id).toBe(a.user.id);
  const sessions = await accountRequest<
    { digest: string; credential_kind: string }[]
  >(a, "/api/sessions");
  const personal = sessions.find(
    (item) => item.credential_kind === "personal",
  )!;
  await accountRequest(a, "/api/sessions/revoke", "POST", {
    digest: personal.digest,
  });
  await expect(
    accountRequest(
      { ...a, token: generated.token } as ServerConnection,
      "/api/me",
    ),
  ).rejects.toMatchObject({ status: 401 });
}, 60_000);
test("resources stay encrypted, retain their origin and work after restoring a bound login", async () => {
  const f = await setup(),
    [a, b] = f.connections;
  await f.client.accounts.bind(a.id, b.id);
  const id = crypto.randomUUID(),
    publicationId = crypto.randomUUID(),
    apiKey = `fixture-key-${crypto.randomUUID()}`;
  const input = {
    id,
    publicationId,
    name: "Private API resource",
    provider: "custom",
    baseUrl: "https://api.example.com/v1",
    model: "resource-model",
    protocol: "chat",
    credential: "api-key",
    secret: { apiKey },
  };
  const saved = await accountRequest<AccountResource>(
    b,
    "/api/account/resources",
    "PUT",
    input,
  );
  expect(saved.source.serverId).toBe(b.serverId);
  expect(saved.source.serverName).toBe("Service 1");
  expect(JSON.stringify(saved)).not.toContain(apiKey);
  expect(
    (
      await accountRequest<AccountResource>(
        b,
        "/api/account/resources",
        "PUT",
        input,
      )
    ).version,
  ).toBe(saved.version);
  await expect(
    accountRequest(b, "/api/account/resources", "PUT", {
      ...input,
      secret: { apiKey: "changed" },
    }),
  ).rejects.toMatchObject({ code: "PUBLICATION_ID_REUSED" });
  const db = new SQLiteMetadata(join(f.root, "server-1/metadata.sqlite"));
  expect(
    JSON.stringify(await db.all("SELECT * FROM account_resources")),
  ).not.toContain(apiKey);
  db.close();
  const device = new SyncManager(join(f.root, "resource-device"));
  cleanup.push(() => device.stop());
  await device.connect({ url: a.url, token: a.token });
  const resources = new ModelResourceClient(() => device.home),
    catalog = await resources.list();
  expect(catalog).toHaveLength(1);
  expect(catalog[0].source.serverId).toBe(b.serverId);
  const host = new AgentHost({
    root: join(f.root, "agent-resource-profile"),
    library: () => new FileStore(device.home),
    resources,
    cli: () => ({ command: process.execPath, args: [], env: {} }),
    pluginRoot: () => "",
  });
  cleanup.push(async () => host.close());
  const status = await host.addServerResource(catalog[0].id),
    source = status.settings.sources[0];
  expect(source.hosted?.serverName).toBe("Service 1");
  expect(JSON.stringify(status)).not.toContain(apiKey);
  expect(await host.token(source)).toBe(apiKey);
  await expect(
    host.token({ ...source, baseUrl: "https://other.example.com/v1" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await host.removeSource(source.id);
  expect(
    await accountRequest<AccountResource[]>(b, "/api/account/resources"),
  ).toHaveLength(1);
  const stale = {
    ...input,
    publicationId: crypto.randomUUID(),
    secret: undefined,
    model: "new-model",
  };
  await expect(
    accountRequest(b, "/api/account/resources", "PUT", stale),
  ).rejects.toMatchObject({ code: "RESOURCE_CHANGED" });
  const updated = await accountRequest<AccountResource>(
    b,
    "/api/account/resources",
    "PUT",
    { ...stale, version: saved.version },
  );
  expect(updated.model).toBe("new-model");
  const stranger = new SyncManager(join(f.root, "resource-stranger"));
  cleanup.push(() => stranger.stop());
  await stranger.connect({
    url: b.url,
    account: "Resource stranger",
    password: "stranger-password",
    register: true,
  });
  const unrelated = (await stranger.configuration()).connections[0];
  expect(await accountRequest(unrelated, "/api/account/resources")).toEqual([]);
  await expect(
    accountRequest(
      unrelated,
      `/api/account/resources/${id}/access`,
      "POST",
      {},
    ),
  ).rejects.toMatchObject({ status: 404 });
}, 60_000);
test("publishing a local API source leaves a server reference and supports another device", async () => {
  const f = await setup(),
    a = f.connections[0];
  const resources = new ModelResourceClient(() => f.client.home),
    profile = join(f.root, "publish-agent");
  const host = new AgentHost({
    root: profile,
    library: () => new FileStore(f.client.home),
    resources,
    cli: () => ({ command: process.execPath, args: [], env: {} }),
    pluginRoot: () => "",
  });
  cleanup.push(async () => host.close());
  const id = crypto.randomUUID(),
    apiKey = `fixture-key-${crypto.randomUUID()}`;
  await host.saveSource(
    {
      id,
      name: "Saved source",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "configured-model",
      protocol: "responses",
      credential: "api-key",
    },
    apiKey,
  );
  const result = await host.publishSource(id, a.id),
    source = result.settings.sources[0];
  expect(source.hosted?.resourceId).toBe(id);
  expect(await host.token(source)).toBe(apiKey);
  await expect(
    readFile(join(profile, "credentials", id + ".json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(join(profile, "credentials", `transfer-${id}.json`)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify(result)).not.toContain(apiKey);
}, 60_000);
