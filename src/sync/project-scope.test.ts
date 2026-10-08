import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "../server/node";
import { AgentService } from "../agent/service";
import { SyncManager } from "./manager";

test("scoped synchronization never enrolls another project; the full background run still follows the default policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-scoped-sync-"));
  const server = await startSyncServer({
    home: join(directory, "server"),
    port: 0,
    registrationKey: "scoped-sync-test-key",
  });
  const home = join(directory, "client"),
    service = new AgentService({ root: home }),
    manager = new SyncManager(home);
  try {
    const connection = await manager.connect({
      url: server.url,
      account: "scope-test",
      password: "test-only-scoped-password",
      register: true,
      registrationKey: "scoped-sync-test-key",
    });
    await manager.stop();
    const selected = await service.createProject("Selected project");
    await manager.attach(connection.id, selected.id);
    await manager.stop();
    await manager.setDefault(connection.id);
    const other = await service.createProject("Another project");
    const scoped = await manager.run(selected.id);
    expect(scoped.projects.map((item) => item.projectId)).toEqual([
      selected.id,
    ]);
    expect(
      (await manager.remoteProjects(connection.id)).some(
        (item) => item.id === other.id,
      ),
    ).toBe(false);
    const all = await manager.run();
    expect(
      all.projects.find((item) => item.projectId === other.id)?.status,
    ).toBe("synced");
  } finally {
    await manager.stop();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
