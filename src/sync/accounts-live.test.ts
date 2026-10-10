import { expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncManager } from "./manager";
import { accountRequest } from "./account-manager";
import type { AccountResource, SignedGrant } from "./accounts";

const fixturePath = process.env.SHOWAI_ACCOUNT_SERVERS_FIXTURE;
test.skipIf(!fixturePath)(
  "real deployments restore every bound service from either login and retain resource ownership",
  async () => {
    const fixture = JSON.parse(await readFile(fixturePath!, "utf8")) as {
      servers: { url: string; registrationKeyFile: string }[];
      output: string;
    };
    expect(fixture.servers.length).toBeGreaterThanOrEqual(2);
    const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, "live-accounts-"));
    const clients: SyncManager[] = [];
    const account = `Bound QA ${crypto.randomUUID()}`;
    try {
      const owner = new SyncManager(join(root, "owner"));
      clients.push(owner);
      for (const server of fixture.servers) {
        await owner.connect({
          url: server.url,
          account,
          register: true,
          personalToken: true,
          registrationKey: (
            await readFile(server.registrationKeyFile, "utf8")
          ).trim(),
        });
      }
      const connections = (await owner.configuration()).connections;
      for (const peer of connections.slice(1)) {
        const result = await owner.accounts.bind(connections[0].id, peer.id);
        expect(result.pending).toEqual([]);
        expect(result.errors).toEqual({});
      }
      const resourceId = crypto.randomUUID(),
        probe = crypto.randomUUID();
      const source = connections[1];
      const saved = await accountRequest<AccountResource>(
        source,
        "/api/account/resources",
        "PUT",
        {
          id: resourceId,
          publicationId: crypto.randomUUID(),
          name: "Credential storage acceptance",
          provider: "custom",
          baseUrl: "https://api.example.com/v1",
          model: "storage-only",
          protocol: "chat",
          credential: "api-key",
          secret: { apiKey: probe },
        },
      );
      expect(saved.source.serverId).toBe(source.serverId);
      expect(JSON.stringify(saved)).not.toContain(probe);
      for (const original of connections) {
        const device = new SyncManager(join(root, `from-${original.serverId}`));
        clients.push(device);
        await device.connect({ url: original.url, token: original.token });
        const restored = (await device.configuration()).connections;
        expect(restored.map((item) => item.serverId).sort()).toEqual(
          connections.map((item) => item.serverId).sort(),
        );
        for (const connection of restored) {
          expect(
            (await accountRequest<{ serverId: string }>(connection, "/api/me"))
              .serverId,
          ).toBe(connection.serverId);
          if (connection.serverId !== original.serverId)
            expect(connection.token).not.toBe(
              connections.find((item) => item.serverId === connection.serverId)!
                .token,
            );
        }
        const catalogue = await device.accounts.resources();
        const resource = catalogue.find(
          (item) => item.resourceId === resourceId,
        )!;
        expect(resource.available).toBe(true);
        expect(resource.source.serverId).toBe(source.serverId);
        const access = await accountRequest<{ token: string }>(
          restored.find((item) => item.serverId === source.serverId)!,
          `/api/account/resources/${resourceId}/access`,
          "POST",
          {},
        );
        expect(access.token).toBe(probe);
      }
      const [a, b] = connections;
      const grant = await accountRequest<SignedGrant>(
        a,
        "/api/account/grants",
        "POST",
        {
          serverId: b.serverId,
          deviceId: crypto.randomUUID(),
          device: "Revocation acceptance",
        },
      );
      const issued = await accountRequest<{ token: string }>(
        b,
        "/api/auth/exchange",
        "POST",
        grant,
      );
      await expect(
        accountRequest(b, "/api/auth/exchange", "POST", grant),
      ).rejects.toMatchObject({ status: 409 });
      const removed = await owner.accounts.unbind(a.id, b.serverId);
      expect(removed.pending).toEqual([]);
      await expect(
        accountRequest({ ...b, token: issued.token }, "/api/me"),
      ).rejects.toMatchObject({ status: 401 });
      // Original per-service credentials remain independent of the binding.
      expect(
        (await accountRequest<{ serverId: string }>(b, "/api/me")).serverId,
      ).toBe(b.serverId);
      await writeFile(
        fixture.output,
        JSON.stringify(
          {
            servers: connections.map(({ serverId, url, name }) => ({
              serverId,
              url,
              name,
            })),
            restoreFromEachMember: true,
            freshPerDeviceSessions: true,
            resourceOrigin: saved.source,
            credentialStorageAndRetrieval: true,
            actualModelInference: false,
            replayRejected: true,
            unbindRevokesFederatedSessions: true,
          },
          null,
          2,
        ),
      );
    } finally {
      for (const client of clients.reverse()) await client.stop();
      await rm(root, { recursive: true });
    }
  },
  240_000,
);
