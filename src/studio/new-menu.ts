import type { ProjectSummary } from "../core/model";

/** What the sidebar New menu can make inside a project or folder. */
export type CreationChoice =
  | "folder"
  | "page"
  | "board"
  | "agentPage"
  | "template"
  | "import";

export type NewMenuDestination<Target> =
  /** The open project or folder takes the new content. */
  | { kind: "context"; target: Target }
  /** No writable project is open: the most recently used one takes it. */
  | { kind: "recent"; project: ProjectSummary }
  /** No writable project exists: a new project is made first. */
  | { kind: "newProject" };

/** The writable, unarchived project used most recently. */
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

/**
 * Where the New menu's page, board and folder entries create content. The
 * menu always offers them; only their destination changes.
 */
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
