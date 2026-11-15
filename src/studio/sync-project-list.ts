export function syncListedProjects<T extends { id: string; archived?: boolean }>(
  projects: T[],
  boundProjectIds: ReadonlySet<string>,
): T[] {
  return projects.filter(
    (project) => !project.archived || boundProjectIds.has(project.id),
  );
}
