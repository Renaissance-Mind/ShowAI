import { PROJECT_SCOPE_LIMIT, type DesktopChange } from "../host/protocol";
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
/** The change an operation on known projects makes, so only they are read again. */
export function libraryChange(
  home: string,
  projectIds: string[],
  options: { sidebar?: boolean; pageIds?: string[] } = {},
): DesktopChange {
  return {
    type: "files",
    home,
    projectIds: [...new Set(projectIds)],
    ...(options.sidebar ? { sidebar: true } : {}),
    ...(options.pageIds ? { pageIds: options.pageIds } : {}),
  };
}
/** Preserve unchanged navigation values so a background refresh does not rebuild the editor. */
export function retainEqual<T>(previous: T, next: T): T {
  return previous === next || JSON.stringify(previous) === JSON.stringify(next)
    ? previous
    : next;
}
/**
 * The sidebar contents after a refresh read the scanned projects and their
 * pages. Each project's folders come from the same scan, so pages and folders
 * always describe one moment: a page whose folder was created elsewhere (an
 * import, another window, an Agent) never shows without its folder, whether
 * or not the project is expanded or open.
 */
export function refreshedContents(
  current: ProjectContents,
  scanned: { project: ProjectSummary; pages: PageSummary[] }[],
  scope: { full: boolean; ids: ReadonlySet<string> },
): ProjectContents {
  const updated: ProjectContents = scope.full ? {} : { ...current };
  for (const id of scope.ids) delete updated[id];
  for (const { project, pages } of scanned)
    updated[project.id] = retainEqual(current[project.id], {
      pages,
      folders: project.folders ?? [],
    });
  return retainEqual(current, updated);
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
export interface LibraryEntryFields {
  name?: string;
  icon?: string;
  pinned?: boolean;
}
/** Shows a rename, icon or pin change in loaded navigation before the library confirms it. */
export function withLibraryEntry(
  contents: ProjectContents,
  target: { kind: "page" | "folder"; projectId: string; id: string },
  fields: LibraryEntryFields,
): ProjectContents {
  const current = contents[target.projectId];
  if (!current) return contents;
  if (target.kind === "folder") {
    if (!current.folders.some((folder) => folder.id === target.id))
      return contents;
    return {
      ...contents,
      [target.projectId]: {
        ...current,
        folders: current.folders.map((folder) =>
          folder.id === target.id
            ? {
                ...folder,
                ...(fields.name !== undefined ? { name: fields.name } : {}),
                ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
                ...(fields.pinned !== undefined ? { pinned: fields.pinned } : {}),
              }
            : folder,
        ),
      },
    };
  }
  if (!current.pages.some((page) => page.id === target.id)) return contents;
  return {
    ...contents,
    [target.projectId]: {
      ...current,
      pages: current.pages.map((page) =>
        page.id === target.id
          ? {
              ...page,
              ...(fields.name !== undefined ? { title: fields.name } : {}),
              ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
              ...(fields.pinned !== undefined ? { favorite: fields.pinned } : {}),
            }
          : page,
      ),
    },
  };
}
export function withProjectFields(
  projects: ProjectSummary[],
  projectId: string,
  fields: LibraryEntryFields,
): ProjectSummary[] {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return projects;
  return mergeNavigationProjects(
    projects,
    [
      {
        ...project,
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.icon !== undefined ? { icon: fields.icon } : {}),
        ...(fields.pinned !== undefined ? { pinned: fields.pinned } : {}),
      },
    ],
    new Set([projectId]),
  );
}
/** The folders and pages inside a folder, the folder included. */
export function folderSubtree(
  contents: ProjectContents,
  projectId: string,
  folderId: string,
): { folders: Set<string>; pages: Set<string> } {
  const current = contents[projectId];
  const folders = new Set([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const folder of current?.folders ?? [])
      if (
        folder.parentId &&
        folders.has(folder.parentId) &&
        !folders.has(folder.id)
      ) {
        folders.add(folder.id);
        grew = true;
      }
  }
  return {
    folders,
    pages: new Set(
      (current?.pages ?? [])
        .filter((page) => page.parentId && folders.has(page.parentId))
        .map((page) => page.id),
    ),
  };
}
/** Removes deleted folders and pages from loaded navigation before the library confirms it. */
export function withoutLibraryEntries(
  contents: ProjectContents,
  projectId: string,
  ids: Set<string>,
): ProjectContents {
  const current = contents[projectId];
  if (
    !current ||
    (!current.folders.some((folder) => ids.has(folder.id)) &&
      !current.pages.some((page) => ids.has(page.id)))
  )
    return contents;
  return {
    ...contents,
    [projectId]: {
      folders: current.folders.filter((folder) => !ids.has(folder.id)),
      pages: current.pages.filter((page) => !ids.has(page.id)),
    },
  };
}
/** Adds a page this window just created, until the scoped refresh lists it. */
export function withCreatedPage(
  contents: ProjectContents,
  projectId: string,
  record: Pick<PageRecord, "document" | "hash" | "revision">,
): ProjectContents {
  const current = contents[projectId];
  if (!current || current.pages.some((page) => page.id === record.document.id))
    return contents;
  const { document } = record;
  return {
    ...contents,
    [projectId]: {
      ...current,
      pages: [
        {
          id: document.id,
          title: document.title,
          icon: document.icon,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          hash: record.hash,
          ...(record.revision ? { revision: record.revision } : {}),
          blockCount: 0,
          parentId: document.parentId ?? null,
          favorite: !!document.favorite,
          archived: false,
        },
        ...current.pages,
      ],
    },
  };
}
export function withCreatedFolder(
  contents: ProjectContents,
  projectId: string,
  folder: FolderMetadata,
): ProjectContents {
  const current = contents[projectId];
  if (!current || current.folders.some((item) => item.id === folder.id))
    return contents;
  return {
    ...contents,
    [projectId]: { ...current, folders: [folder, ...current.folders] },
  };
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
