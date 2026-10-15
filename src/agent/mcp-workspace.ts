import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import type { SyncProject } from "../sync/protocol";
import { AuthorizationError, upstream, type ProjectGrant } from "./mcp-auth";
import { AgentService } from "./service";
import { atomicLibraryFile, readLibraryBytes } from "../core/library-files";

export interface RemoteWorkspaceContext {
  root: string;
  projectId: string;
  projectIds: string[];
  projectMap: Record<string, string>;
}

export class RemoteWorkspaces {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private directory: string) {}
  async projects(grant: ProjectGrant, includeArchived = false) {
    const projects = await upstream<SyncProject[]>(
      grant.serverUrl,
      "/api/projects",
      grant.upstreamToken,
    );
    return projects.filter(
      (project) =>
        (grant.projectAccess === "account" ||
          grant.projectIds.includes(project.id)) &&
        (includeArchived || !project.archived),
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
    return this.withProjects(grant, [remoteId], write, operation);
  }

  /** Hydrate and authorize every participant before an atomic local operation.
   * Multi-project publication is destination-first; a durable queue resumes it
   * before any later pull can publish a retained source deletion out of order.
   */
  async withProjects<T>(
    grant: ProjectGrant,
    remoteIds: string[],
    write: boolean,
    operation: (context: RemoteWorkspaceContext) => Promise<T>,
    options: {
      administrator?: string;
      synchronizeWrites?: boolean;
      writeProjectIds?: string[];
      afterSynchronization?: (
        value: T,
        context: RemoteWorkspaceContext,
      ) => Promise<T>;
    } = {},
  ) {
    return this.serialized(grant.id, async () => {
      const projects = await this.projects(grant, true);
      const ids = [...new Set(remoteIds)];
      const writers = options.writeProjectIds ?? (write ? ids : []);
      if (!ids.length) throw new Error("Select at least one project.");
      for (const id of ids) {
        const project = projects.find((p) => p.id === id);
        if (
          !project ||
          (writers.includes(id) &&
            (project.role === "viewer" ||
              !grant.scopes.includes("projects.write"))) ||
          (options.administrator === id && project.role !== "admin")
        )
          throw new AuthorizationError(
            "Current authorization and project permissions do not allow this operation.",
            "access_denied",
            403,
          );
      }
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
        const pendingPath = join(root, "local", "mcp-pending-sync.json");
        const drain = async () => {
          const bytes = await readLibraryBytes(root, pendingPath);
          const pending = bytes
            ? (JSON.parse(bytes.toString()) as {
                projectId: string;
                remoteId: string;
              }[])
            : [];
          for (const item of [...pending]) {
            const authorized = projects.find((p) => p.id === item.remoteId);
            if (
              !authorized ||
              authorized.role === "viewer" ||
              !grant.scopes.includes("projects.write")
            )
              throw new AuthorizationError(
                "A retained multi-project write needs its original project write permissions before it can resume.",
                "access_denied",
                403,
              );
            const after = (await manager.run(item.projectId)).projects.find(
              (p) => p.projectId === item.projectId,
            );
            await manager.stop();
            if (after?.status !== "synced") return false;
            pending.shift();
            await atomicLibraryFile(
              root,
              pendingPath,
              Buffer.from(JSON.stringify(pending)),
            );
          }
          return true;
        };
        if (!(await drain()))
          throw new Error(
            "A retained multi-project write has incomplete synchronization. Its source deletion has not been published; retry after resolving synchronization.",
          );
        const projectMap: Record<string, string> = {};
        for (const remoteId of ids) {
          await manager.subscribe(connection.id, remoteId);
          await manager.stop();
          const state = (await manager.status()).projects.find(
            (p) =>
              p.connectionId === connection.id &&
              p.remoteProjectId === remoteId,
          );
          if (!state || state.status !== "synced")
            throw new Error(
              `Cannot read a current synchronized project: ${state?.error ?? state?.status ?? "missing project"}.`,
            );
          projectMap[remoteId] = state.projectId;
        }
        if (write && options.synchronizeWrites !== false) {
          const ordered = [...ids.slice(1), ids[0]]
            .filter((id) => writers.includes(id))
            .map((remoteId) => ({
              remoteId,
              projectId: projectMap[remoteId],
            }));
          await atomicLibraryFile(
            root,
            pendingPath,
            Buffer.from(JSON.stringify(ordered)),
          );
        }
        const context = {
          root,
          projectId: projectMap[ids[0]],
          projectIds: Object.values(projectMap),
          projectMap,
        };
        let value = await operation(context);
        if (write && options.synchronizeWrites !== false) {
          await drain();
        }
        const status = await manager.status();
        const synchronizations = ids.map((remoteId) => {
          const state = status.projects.find(
            (p) => p.projectId === projectMap[remoteId],
          )!;
          return {
            projectId: remoteId,
            state: state.status,
            remoteHead: state.remoteHead,
            ...(state.error ? { error: state.error } : {}),
          };
        });
        const failure = synchronizations.find(
          (item) => item.state !== "synced",
        );
        if (!failure && options.afterSynchronization)
          value = await options.afterSynchronization(value, context);
        return {
          value,
          synchronization: failure
            ? {
                ...synchronizations[0],
                state: "error",
                error:
                  failure.error ??
                  "Multi-project synchronization is incomplete; retained writes will resume destination-first.",
              }
            : synchronizations[0],
          synchronizations,
        };
      } finally {
        await manager.stop();
      }
    });
  }
}
