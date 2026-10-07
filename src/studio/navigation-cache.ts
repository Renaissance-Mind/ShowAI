import type { ProjectSummary, SidebarOrganization } from "../core/model";
export interface NavigationSnapshot {
  home: string;
  projects: ProjectSummary[];
  organization: SidebarOrganization;
  version: 1;
}
const key = (home: string) => `showai:navigation:v1:${home}`;
export function readNavigationCache(
  storage: Pick<Storage, "getItem">,
  home: string,
): NavigationSnapshot | undefined {
  const bytes = storage.getItem(key(home));
  if (!bytes) return;
  let value: NavigationSnapshot;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
  const date = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value));
  const optionalBoolean = (value: unknown) =>
    value === undefined || typeof value === "boolean";
  if (
    !value ||
    value.version !== 1 ||
    value.home !== home ||
    !Array.isArray(value.projects) ||
    !value.organization ||
    !Array.isArray(value.organization.groups) ||
    !value.organization.projectGroups ||
    typeof value.organization.projectGroups !== "object" ||
    Array.isArray(value.organization.projectGroups)
  )
    return;
  if (
    value.organization.groups.some(
      (group) =>
        !group ||
        typeof group.id !== "string" ||
        typeof group.name !== "string",
    ) ||
    Object.values(value.organization.projectGroups).some(
      (group) => typeof group !== "string",
    )
  )
    return;
  const organization = value.organization as SidebarOrganization & {
    projectOrder?: unknown;
    entryOrder?: unknown;
  };
  const order = (items: unknown) =>
    Array.isArray(items) &&
    items.length <= 100000 &&
    items.every((id) => typeof id === "string" && /^[\w-]{1,128}$/.test(id)) &&
    new Set(items).size === items.length;
  if (
    (organization.projectOrder !== undefined &&
      !order(organization.projectOrder)) ||
    (organization.entryOrder !== undefined &&
      (!organization.entryOrder ||
        typeof organization.entryOrder !== "object" ||
        Array.isArray(organization.entryOrder) ||
        Object.entries(organization.entryOrder).some(
          ([id, items]) => !/^[\w-]{1,128}$/.test(id) || !order(items),
        )))
  )
    return;
  if (
    value.projects.some(
      (project) =>
        !project ||
        typeof project.id !== "string" ||
        typeof project.name !== "string" ||
        !Number.isInteger(project.pageCount) ||
        project.pageCount < 0 ||
        !date(project.createdAt) ||
        !date(project.updatedAt) ||
        !optionalBoolean(project.pinned) ||
        !optionalBoolean(project.archived) ||
        (project.folders !== undefined &&
          (!Array.isArray(project.folders) ||
            project.folders.some(
              (folder) =>
                !folder ||
                typeof folder.id !== "string" ||
                typeof folder.name !== "string" ||
                (folder.parentId !== null &&
                  typeof folder.parentId !== "string") ||
                typeof folder.pinned !== "boolean" ||
                typeof folder.archived !== "boolean" ||
                !date(folder.createdAt) ||
                !date(folder.updatedAt),
            ))),
    )
  )
    return;
  return value;
}
export function writeNavigationCache(
  storage: Pick<Storage, "setItem">,
  snapshot: Omit<NavigationSnapshot, "version">,
) {
  storage.setItem(
    key(snapshot.home),
    JSON.stringify({ ...snapshot, version: 1 }),
  );
}
