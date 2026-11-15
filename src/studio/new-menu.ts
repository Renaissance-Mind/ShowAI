import type { ProjectSummary } from "../core/model";

export type CreationChoice =
  | "folder"
  | "page"
  | "board"
  | "agentPage"
  | "template"
  | "import";

export type NewMenuDestination<Target> =
  | { kind: "context"; target: Target }
  | { kind: "recent"; project: ProjectSummary }
  | { kind: "newProject" };

export function recentWritableProject(
  projects: ProjectSummary[],
  readOnly: (projectId: string) => boolean,
): ProjectSummary | undefined {
  let best: ProjectSummary | undefined;
  for (const project of projects) {
    if (project.archived || readOnly(project.id)) continue;
    if (!best || project.updatedAt > best.updatedAt) best = project;
  }
  return best;
}

export function newMenuDestination<Target>(
  context: { target: Target; projectId: string } | null,
  projects: ProjectSummary[],
  readOnly: (projectId: string) => boolean,
): NewMenuDestination<Target> {
  if (context && !readOnly(context.projectId))
    return { kind: "context", target: context.target };
  const project = recentWritableProject(projects, readOnly);
  return project ? { kind: "recent", project } : { kind: "newProject" };
}
