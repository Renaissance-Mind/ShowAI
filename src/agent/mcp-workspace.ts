import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import type { SyncProject } from "../sync/protocol";
import { AuthorizationError, upstream, type ProjectGrant } from "./mcp-auth";

export class RemoteWorkspaces {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private directory: string) {}
  async projects(grant: ProjectGrant) {
    const projects = await upstream<SyncProject[]>(
      grant.serverUrl,
      "/api/projects",
      grant.upstreamToken,
    );
    return projects.filter(
      (project) => grant.projectIds.includes(project.id) && !project.archived,
    );
  }
  /** Serialize pull → operation → push in the same grant's replica, preserving version checks. */
  async withProject<T>(
    grant: ProjectGrant,
    remoteId: string,
    write: boolean,
    operation: (context: { root: string; projectId: string }) => Promise<T>,
  ) {
    const previous = this.queues.get(grant.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (!grant.projectIds.includes(remoteId))
        throw new AuthorizationError(
          "The selected project is outside this connection's authorization.",
          "access_denied",
          403,
        );
      const project = (await this.projects(grant)).find(
        (p) => p.id === remoteId,
      );
      if (
        !project ||
        (write &&
          (project.role === "viewer" ||
            !grant.scopes.includes("projects.write")))
      )
        throw new AuthorizationError(
          "Current project permissions do not allow this operation.",
          "access_denied",
          403,
        );
      const root = join(this.directory, grant.id);
      await mkdir(root, { recursive: true, mode: 0o700 });
      await openLibrary(root);
      const manager = syncManager(root);
      const configuration = await manager.configuration();
      let connection = configuration.connections.find(
        (c) =>
          c.serverId === grant.serverId &&
          c.user.id === grant.user.id &&
          c.token === grant.upstreamToken,
      );
      if (!connection) {
        const connected = await manager.connect({
          url: grant.serverUrl,
          token: grant.upstreamToken,
        });
        await manager.stop();
        connection = (await manager.configuration()).connections.find(
          (c) => c.id === connected.id,
        )!;
      }
      await manager.subscribe(connection.id, remoteId);
      await manager.stop();
      const state = (await manager.status()).projects.find(
        (p) =>
          p.connectionId === connection.id && p.remoteProjectId === remoteId,
      );
      if (!state || state.status !== "synced")
        throw new Error(
          `Cannot read a current synchronized project: ${state?.error ?? state?.status ?? "missing project"}.`,
        );
      const value = await operation({ root, projectId: state.projectId });
      const after = write
        ? (await manager.run(state.projectId)).projects.find(
            (p) => p.projectId === state.projectId,
          )!
        : state;
      await manager.stop();
      return {
        value,
        synchronization: {
          projectId: remoteId,
          state: after.status,
          remoteHead: after.remoteHead,
          ...(after.error ? { error: after.error } : {}),
        },
      };
    });
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(grant.id, settled);
    void settled.then(() => {
      if (this.queues.get(grant.id) === settled) this.queues.delete(grant.id);
    });
    return next;
  }
}
