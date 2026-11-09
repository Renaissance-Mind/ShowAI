import type { ProjectSummary } from "../core/model";
import type {
  ProjectConnection,
  ServerConnection,
  SyncProject,
} from "../sync/protocol";
export type ProjectAccount = Omit<ServerConnection, "token">;
export type ManagedProject = {
  key: string;
  name: string;
  archived: boolean;
  local?: ProjectSummary;
  binding?: ProjectConnection;
  connection?: ProjectAccount;
  remote?: SyncProject;
};
/** Join by server/project identity, never by name, including stopped sync bindings. */
export function managedProjects(
  local: ProjectSummary[],
  bindings: ProjectConnection[],
  connections: ProjectAccount[],
  catalogs: Record<string, SyncProject[]>,
  filter = "all",
): ManagedProject[] {
  const rows: ManagedProject[] = [];
  const remoteKeys = new Set<string>();
  const identity = (connection: ProjectAccount, id: string) =>
    `${connection.serverId}:${id}`;
  for (const project of local) {
    const binding = bindings.find((item) => item.projectId === project.id);
    const connection = connections.find(
      (item) => item.id === binding?.connectionId,
    );
    if (filter !== "all" && filter !== "local" && connection?.id !== filter)
      continue;
    const remote =
      connection &&
      catalogs[connection.id]?.find(
        (item) => item.id === binding?.remoteProjectId,
      );
    if (connection && binding)
      remoteKeys.add(identity(connection, binding.remoteProjectId));
    rows.push({
      key: `local:${project.id}`,
      name: project.name,
      archived: remote?.archived ?? !!project.archived,
      local: project,
      binding,
      connection,
      remote,
    });
  }
  if (filter !== "local")
    for (const connection of connections) {
      if (filter !== "all" && filter !== connection.id) continue;
      for (const remote of catalogs[connection.id] ?? []) {
        const key = identity(connection, remote.id);
        if (remoteKeys.has(key)) continue;
        const binding = bindings.find(
          (item) =>
            item.remoteProjectId === remote.id &&
            connections.find((account) => account.id === item.connectionId)
              ?.serverId === connection.serverId,
        );
        const project = local.find((item) => item.id === binding?.projectId);
        remoteKeys.add(key);
        rows.push({
          key: project ? `local:${project.id}` : `remote:${key}`,
          name: remote.name,
          archived: remote.archived,
          local: project,
          binding,
          connection,
          remote,
        });
      }
    }
  return rows;
}
