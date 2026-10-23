import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "../server/node";
import { AgentService } from "../agent/service";
import { FileStore } from "../core/store";
import { SyncManager } from "./manager";

test("a local copy stays on this device while new projects default to a server account", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-local-project-"));
  const server = await startSyncServer({
    home: join(directory, "server"),
    port: 0,
    registrationKey: "local-project-test-key",
  });
  const home = join(directory, "client"),
    service = new AgentService({ root: home }),
    store = new FileStore(home),
    manager = new SyncManager(home);
  try {
    const connection = await manager.connect({
      url: server.url,
      account: "local-copy-test",
      password: "test-only-local-copy-password",
      register: true,
      registrationKey: "local-project-test-key",
    });
    await manager.stop();
    await manager.setDefault(connection.id);
    const shared = await service.createProject("Shared by default");
    const local = await manager.createLocalProject((id) =>
      store.createProject({ id, name: "Local copy" }),
    );
    const status = await manager.run();
    expect(status.projects.map((item) => item.projectId)).toEqual([
      shared.id,
    ]);
    const remote = (await manager.remoteProjects(connection.id)).map(
      (item) => item.id,
    );
    expect(remote).toContain(shared.id);
    expect(remote).not.toContain(local.id);
    expect((await manager.configuration()).localProjectIds).toEqual([
      local.id,
    ]);
    // A failed creation releases its reserved id.
    await expect(
      manager.createLocalProject((id) =>
        store.createProject({ id: local.id, name: `Duplicate ${id}` }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await manager.configuration()).localProjectIds).toEqual([
      local.id,
    ]);
  } finally {
    await manager.stop();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
