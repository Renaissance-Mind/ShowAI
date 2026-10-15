import { expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "./service";
import { WorkspaceService } from "./workspace-service";
import { RemoteWorkspaces } from "./mcp-workspace";
import type { ProjectGrant } from "./mcp-auth";
import { startSyncServer } from "../server/node";
import { syncManager } from "../sync/manager";
import { withChangeContext } from "../core/history-context";

test("a real server outage retains destination-first publication and a fresh gateway resumes before pulling source", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-multi-project-recovery-"));
  const serverHome = join(root, "server"),
    local = new AgentService({ root: join(root, "desktop") });
  let server = await startSyncServer({
    home: serverHome,
    port: 0,
    registrationKey: "workspace-recovery-test",
  });
  const manager = syncManager(local.store.root);
  try {
    const response = await fetch(server.url + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "recovery-owner",
        password: "workspace-recovery-password",
        registrationKey: "workspace-recovery-test",
      }),
    });
    expect(response.ok).toBe(true);
    const account = await response.json();
    const source = await local.createProject("Transfer source"),
      destination = await local.createProject("Transfer destination");
    const page = await local.createPage(source.id, {
      title: "Retain through interruption",
    });
    const connection = await manager.connect({
      url: server.url,
      token: account.token,
    });
    for (const project of [source, destination]) {
      await manager.attach(connection.id, project.id);
      await manager.stop();
    }
    const grant: ProjectGrant = {
      id: "recovery-grant",
      clientId: "test-client",
      serverUrl: server.url,
      serverId: connection.serverId,
      user: account.user,
      upstreamToken: account.token,
      projectIds: [source.id, destination.id],
      scopes: ["projects.read", "projects.write"],
    };
    const workspaces = new RemoteWorkspaces(join(root, "replicas"));
    const failed = await workspaces.withProjects(
      grant,
      [source.id, destination.id],
      true,
      async (context) => {
        const service = new AgentService({ root: context.root });
        const read = await service.store.readPage(
          context.projectId,
          page.document.id,
        );
        const result = await withChangeContext(
          {
            actor: { kind: "external", label: "MCP recovery integration test" },
            channel: "mcp",
            operationId: "interrupted-transfer",
          },
          () =>
            new WorkspaceService(context.root, context.projectId, {
              projectIds: context.projectIds,
              libraryAccess: true,
            }).moveEntry({
              kind: "page",
              id: page.document.id,
              destinationProjectId: context.projectMap[destination.id],
              parentId: null,
              baseHash: read.hash,
              baseRevision: read.revision,
            }),
        );
        await server.close();
        return result;
      },
    );
    expect(failed.synchronization.state).toBe("error");
    const pending = JSON.parse(
      await readFile(
        join(root, "replicas", grant.id, "local/mcp-pending-sync.json"),
        "utf8",
      ),
    );
    expect(pending.map((p: any) => p.remoteId)).toEqual([
      destination.id,
      source.id,
    ]);
    const port = Number(new URL(grant.serverUrl).port);
    server = await startSyncServer({
      home: serverHome,
      port,
      registrationKey: "workspace-recovery-test",
    });
    await manager.run(source.id);
    await manager.stop();
    expect((await local.store.listPages(source.id)).map((p) => p.id)).toContain(
      page.document.id,
    );
    await new RemoteWorkspaces(join(root, "replicas")).withProjects(
      grant,
      [source.id],
      false,
      async (context) =>
        new AgentService({ root: context.root }).listPages(context.projectId),
    );
    await manager.run(source.id);
    await manager.run(destination.id);
    await manager.stop();
    expect(await local.store.listPages(source.id)).toEqual([]);
    expect(
      (await local.store.listPages(destination.id)).map((p) => p.id),
    ).toEqual([page.document.id]);
    expect(
      JSON.parse(
        await readFile(
          join(root, "replicas", grant.id, "local/mcp-pending-sync.json"),
          "utf8",
        ),
      ),
    ).toEqual([]);
  } finally {
    await manager.stop();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
