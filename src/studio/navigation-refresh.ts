import { PROJECT_SCOPE_LIMIT, type DesktopChange } from "../desktop/bridge";
import type { ProjectSummary } from "../core/model";

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
  const merged = ids
    ? [...previous.filter((project) => !ids.has(project.id)), ...incoming]
    : incoming;
  merged.sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  return retainEqual(previous, merged);
}
