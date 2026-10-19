import type { FolderMetadata, PageSummary } from "../core/model";
import type { LibraryDrop } from "./LibraryDrag";

export type LibraryContents = Record<
  string,
  { pages: PageSummary[]; folders: FolderMetadata[] }
>;

/** Keep a pending drop visible even when an older navigation read finishes. */
export function applyLibraryMove(
  contents: LibraryContents,
  drop: LibraryDrop,
): LibraryContents {
  const { source, projectId, parentId = null } = drop;
  if (source.kind === "project" || !projectId) return contents;
  const from = contents[source.projectId];
  const to = contents[projectId] ?? { pages: [], folders: [] };
  if (!from) return contents;
  if (source.kind === "folder") {
    if (source.projectId !== projectId) return contents;
    return {
      ...contents,
      [projectId]: {
        ...from,
        folders: from.folders.map((folder) =>
          folder.id === source.id ? { ...folder, parentId } : folder,
        ),
      },
    };
  }
  const page = from.pages.find((item) => item.id === source.id);
  // A refresh may already have completed the transfer.
  if (!page) return contents;
  const moved = { ...page, parentId };
  if (source.projectId === projectId)
    return {
      ...contents,
      [projectId]: {
        ...from,
        pages: from.pages.map((item) => (item.id === source.id ? moved : item)),
      },
    };
  return {
    ...contents,
    [source.projectId]: {
      ...from,
      pages: from.pages.filter((item) => item.id !== source.id),
    },
    [projectId]: {
      ...to,
      pages: [...to.pages.filter((item) => item.id !== source.id), moved],
    },
  };
}
