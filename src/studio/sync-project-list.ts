/**
 * Settings → Sync lists the projects people can act on. Deleted (archived)
 * projects stay out unless a sync connection still needs managing.
 */
export function syncListedProjects<T extends { id: string; archived?: boolean }>(
  projects: T[],
  boundProjectIds: ReadonlySet<string>,
): T[] {
  return projects.filter(
    (project) => !project.archived || boundProjectIds.has(project.id),
  );
}
