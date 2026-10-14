import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import type { SyncProject } from "../sync/protocol";
import { AuthorizationError, upstream, type ProjectGrant } from "./mcp-auth";
import { AgentService } from "./service";

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
      (project) =>
        (grant.projectAccess === "account" ||
          grant.projectIds.includes(project.id)) &&
        !project.archived,
    );
  }
  private serialized<T>(id: string, operation: () => Promise<T>) {
    const next = (this.queues.get(id) ?? Promise.resolve()).then(operation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return next;
  }
  async createProject(grant: ProjectGrant, name: string, operationId?: string) {
    if (
      grant.projectAccess !== "account" ||
      !grant.scopes.includes("projects.create")
    )
      throw new AuthorizationError(
        "Authorize this account with project creation permission.",
        "insufficient_scope",
        403,
      );
    return this.serialized(grant.id, async () => {
      // Validate the upstream session before creating any local project.
      await this.projects(grant);
      const root = join(this.directory, grant.id);
      await openLibrary(root);
      const manager = syncManager(root),
        service = new AgentService({ root });
      const receiptPath = operationId
        ? join(root, "local", "project-creation", operationId + ".json")
        : undefined;
      const retained = receiptPath
        ? ((await readFile(receiptPath, "utf8").then(
            JSON.parse,
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            },
          )) as { name: string; id: string } | undefined)
        : undefined;
      if (retained && retained.name !== name)
        throw new Error(
          "An operationId cannot be reused with a different project name.",
        );
      const project = retained
        ? await service.store.readProject(retained.id)
        : await service.createProject(name);
      if (receiptPath && !retained) {
        await mkdir(join(root, "local", "project-creation"), {
          recursive: true,
        });
        await writeFile(receiptPath, JSON.stringify({ name, id: project.id }), {
          mode: 0o600,
        });
      }
      try {
        const configuration = await manager.configuration();
        const existing = configuration.connections.find(
          (c) =>
            c.serverId === grant.serverId &&
            c.user.id === grant.user.id &&
            c.token === grant.upstreamToken,
        );
        const connection =
          existing ??
          (await manager.connect({
            url: grant.serverUrl,
            token: grant.upstreamToken,
          }));
        if (configuration.projects.some((p) => p.projectId === project.id))
          await manager.run(project.id);
        else await manager.attach(connection.id, project.id);
        const state = (await manager.status()).projects.find(
          (p) => p.projectId === project.id,
        );
        if (state?.status !== "synced")
          throw new Error(
            `Project creation synchronization failed: ${state?.error ?? state?.status}`,
          );
        return {
          project: {
            id: project.id,
            name: project.name,
            role: "admin",
            archived: false,
          },
          synchronization: {
            projectId: project.id,
            state: state.status,
            remoteHead: state.remoteHead,
          },
        };
      } finally {
        await manager.stop();
      }
    });
  }
  /** Serialize pull → operation → push in the same grant's replica, preserving version checks. */
  async withProject<T>(
    grant: ProjectGrant,
    remoteId: string,
    write: boolean,
    operation: (context: { root: string; projectId: string }) => Promise<T>,
  ) {
    return this.serialized(grant.id, async () => {
      if (
        grant.projectAccess !== "account" &&
        !grant.projectIds.includes(remoteId)
      )
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
      try {
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
      } finally {
        await manager.stop();
      }
    });
  }
}
