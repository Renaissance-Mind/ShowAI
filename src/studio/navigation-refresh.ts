import { PROJECT_SCOPE_LIMIT, type DesktopChange } from "../desktop/bridge";
import type {
  FolderMetadata,
  PageRecord,
  PageSummary,
  ProjectSummary,
} from "../core/model";

export interface NavigationScope {
  all: boolean;
  sidebar: boolean;
  ids: Set<string>;
}
export const emptyNavigationScope = (): NavigationScope => ({
  all: false,
  sidebar: false,
  ids: new Set(),
});
function boundScope(scope: NavigationScope) {
  if (scope.all || scope.ids.size > PROJECT_SCOPE_LIMIT) {
    scope.all = true;
    scope.ids.clear();
  }
}
export function mergeNavigationScope(
  target: NavigationScope,
  source: NavigationScope,
) {
  target.all ||= source.all;
  target.sidebar ||= source.sidebar;
  for (const id of source.ids) target.ids.add(id);
  boundScope(target);
}
export function queueNavigationScope(
  scope: NavigationScope,
  change?: DesktopChange,
) {
  scope.all ||=
    !change ||
    change.type === "home" ||
    !!change.all ||
    !change.projectIds ||
    (!!change.projects && !change.projectIds.length);
  scope.sidebar ||= !!change?.sidebar;
  for (const id of change?.projectIds ?? []) scope.ids.add(id);
  boundScope(scope);
}
/** Preserve unchanged navigation values so a background refresh does not rebuild the editor. */
export function retainEqual<T>(previous: T, next: T): T {
  return previous === next || JSON.stringify(previous) === JSON.stringify(next)
    ? previous
    : next;
}
export function mergeNavigationProjects(
  previous: ProjectSummary[],
  next: ProjectSummary[],
  ids?: Set<string>,
) {
  const old = new Map(previous.map((project) => [project.id, project]));
  const incoming = next.map((project) =>
    retainEqual(old.get(project.id), project)!,
  );
  const byId = new Map(incoming.map((project) => [project.id, project]));
  const merged = ids
    ? [
        ...previous.flatMap((project) =>
          ids.has(project.id)
            ? byId.has(project.id)
              ? [byId.get(project.id)!]
              : []
            : [project],
        ),
        ...incoming.filter((project) => !old.has(project.id)),
      ]
    : incoming;
  merged.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  return retainEqual(previous, merged);
}

type ProjectContents = Record<
  string,
  { pages: PageSummary[]; folders: FolderMetadata[] }
>;
/**
 * Applies this window's own save to loaded navigation. The file watcher no
 * longer echoes that save back here, so the sidebar updates from its record.
 */
export function withSavedPage(
  contents: ProjectContents,
  projectId: string,
  record: Pick<PageRecord, "document" | "hash" | "revision">,
): ProjectContents {
  const current = contents[projectId];
  const index = current?.pages.findIndex(
    (page) => page.id === record.document.id,
  );
  if (!current || index === undefined || index < 0) return contents;
  const previous = current.pages[index];
  const { document } = record;
  const next: PageSummary = {
    ...previous,
    title: document.title,
    icon: document.icon ?? previous.icon,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    hash: record.hash,
    ...(record.revision ? { revision: record.revision } : {}),
    parentId: document.parentId ?? null,
    favorite: !!document.favorite,
    archived: !!document.archived,
  };
  if (retainEqual(previous, next) === previous) return contents;
  const pages = [...current.pages];
  pages[index] = next;
  return { ...contents, [projectId]: { ...current, pages } };
}
/** Structure changes still need a scoped refresh of that project's lists. */
export function savedPageMoved(
  contents: ProjectContents,
  projectId: string,
  record: Pick<PageRecord, "document">,
): boolean {
  const current = contents[projectId];
  if (!current) return false;
  const previous = current.pages.find((page) => page.id === record.document.id);
  return (
    !previous ||
    previous.parentId !== (record.document.parentId ?? null) ||
    previous.archived !== !!record.document.archived
  );
}
export function withSavedProjectTime(
  projects: ProjectSummary[],
  projectId: string,
  updatedAt: string,
): ProjectSummary[] {
  const project = projects.find((item) => item.id === projectId);
  if (!project || project.updatedAt >= updatedAt) return projects;
  return mergeNavigationProjects(
    projects,
    [{ ...project, updatedAt }],
    new Set([projectId]),
  );
}
