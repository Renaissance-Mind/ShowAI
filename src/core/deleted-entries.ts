import type { FolderMetadata, PageSummary, ProjectSummary } from "./model";

/** Deleting a project, folder or page only archives it; these can be restored. */
export interface DeletedEntries {
  projects: { id: string; name: string; icon?: string; updatedAt: string }[];
  folders: {
    projectId: string;
    projectName: string;
    id: string;
    name: string;
    icon?: string;
    updatedAt: string;
  }[];
  pages: {
    projectId: string;
    projectName: string;
    id: string;
    title: string;
    icon?: string;
    updatedAt: string;
  }[];
}

/** True when every ancestor folder of `parentId` exists and is not archived. */
function ancestorsVisible(folders: FolderMetadata[], parentId: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current = parentId === null ? undefined : byId.get(parentId);
  while (current && !seen.has(current.id)) {
    if (current.archived) return false;
    seen.add(current.id);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return true;
}

/**
 * Lists the archived items that restoring would bring back into view: archived
 * projects, and archived folders and pages whose project and ancestors remain
 * visible. Items inside an archived folder or project come back with it.
 */
export function deletedEntries(
  projects: {
    project: ProjectSummary;
    folders: FolderMetadata[];
    pages: PageSummary[];
  }[],
): DeletedEntries {
  const result: DeletedEntries = { projects: [], folders: [], pages: [] };
  for (const { project, folders, pages } of projects) {
    if (project.archived) {
      result.projects.push({
        id: project.id,
        name: project.name,
        ...(project.icon ? { icon: project.icon } : {}),
        updatedAt: project.updatedAt,
      });
      continue;
    }
    for (const folder of folders)
      if (folder.archived && ancestorsVisible(folders, folder.parentId))
        result.folders.push({
          projectId: project.id,
          projectName: project.name,
          id: folder.id,
          name: folder.name,
          ...(folder.icon ? { icon: folder.icon } : {}),
          updatedAt: folder.updatedAt,
        });
    for (const page of pages)
      if (page.archived && ancestorsVisible(folders, page.parentId))
        result.pages.push({
          projectId: project.id,
          projectName: project.name,
          id: page.id,
          title: page.title,
          ...(page.icon ? { icon: page.icon } : {}),
          updatedAt: page.updatedAt,
        });
  }
  const newest = (a: { updatedAt: string }, b: { updatedAt: string }) =>
    b.updatedAt.localeCompare(a.updatedAt);
  result.projects.sort(newest);
  result.folders.sort(newest);
  result.pages.sort(newest);
  return result;
}
