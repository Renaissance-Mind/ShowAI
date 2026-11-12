import { useMemo, useState } from "react";
import type { FolderMetadata } from "../../core/model";
import {
  directoryEntries,
  sortDirectoryItems,
} from "../../core/directory-sort";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import type { FolderThumbnailEntry } from "../FolderThumbnail";
import {
  useDirectoryMarquee,
  useDirectoryPageSelection,
} from "../DirectoryPageSelection";
import { recentPages } from "../RecentPages";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";

/** The selected project and folder as the directory shows them, with its page selection. */
export function useDirectory({
  library: {
    info,
    projects,
    contents,
    organization,
    syncOverview,
    projectSyncMarker,
    folderPreferences,
    folderTarget,
    pageTarget,
  },
  route: { view, selectedProject, selectedFolder, deferredQuery },
  dialogs: { dialog },
  menus: { directoryView },
}: {
  library: Pick<
    LibraryState,
    | "info"
    | "projects"
    | "contents"
    | "organization"
    | "syncOverview"
    | "projectSyncMarker"
    | "folderPreferences"
    | "folderTarget"
    | "pageTarget"
  >;
  route: Pick<
    RouteState,
    "view" | "selectedProject" | "selectedFolder" | "deferredQuery"
  >;
  dialogs: Pick<DialogControl, "dialog">;
  menus: Pick<MenuState, "directoryView">;
}) {
  const tc = useTranslator(commonMessages);
  const syncReadOnly = syncOverview.loaded
    ? syncOverview.markers.get(selectedProject ?? "") === "readOnly"
    : undefined;
  const selectedMarker = selectedProject
    ? projectSyncMarker(selectedProject)
    : undefined;
  const pages = selectedProject ? (contents[selectedProject]?.pages ?? []) : [];
  const folders = selectedProject
    ? (contents[selectedProject]?.folders ?? [])
    : [];
  const [fileDrop, setFileDrop] = useState(false);
  const project = projects.find((item) => item.id === selectedProject);
  const recent = useMemo(
    () => recentPages(projects, contents),
    [projects, contents],
  );
  const folderIds = new Set(folders.map((item) => item.id));
  const currentFolder = folders.find((item) => item.id === selectedFolder);
  const filteredPages = pages.filter(
    (item) =>
      item.title.toLowerCase().includes(deferredQuery.toLowerCase()) &&
      (deferredQuery ||
        (item.parentId && folderIds.has(item.parentId)
          ? item.parentId
          : null) === selectedFolder),
  );
  const filteredFolders = folders.filter(
    (item) =>
      item.name.toLowerCase().includes(deferredQuery.toLowerCase()) &&
      (deferredQuery || (item.parentId ?? null) === selectedFolder),
  );
  const visibleEntries = sortDirectoryItems(
    [
      ...filteredFolders.map((item) => ({
        target: folderTarget(item, selectedProject!),
        hash: "",
        name: item.name,
        pinned: item.pinned,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      ...filteredPages.map((item) => ({
        target: pageTarget(item, selectedProject!),
        hash: item.hash,
        name: item.title || tc("untitled"),
        pinned: item.favorite,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    ].map((item) => ({ ...item, id: item.target.id })),
    selectedProject ? folderPreferences(selectedProject, selectedFolder) : {},
    organization.entryOrder?.[selectedProject ?? ""],
  );
  const folderChildren = new Map<string, ReturnType<typeof directoryEntries>>();
  if (view === "project" && directoryView !== "list")
    for (const item of directoryEntries(folders, pages)) {
      const parent = item.parentId ?? "";
      if (!folderChildren.has(parent)) folderChildren.set(parent, []);
      folderChildren.get(parent)!.push(item);
    }
  /** A folder's first entries, in its own order, for its card preview. */
  function folderThumbnailEntries(folderId: string): FolderThumbnailEntry[] {
    return sortDirectoryItems(
      folderChildren.get(folderId) ?? [],
      folderPreferences(selectedProject!, folderId),
      organization.entryOrder?.[selectedProject!],
    )
      .slice(0, 3)
      .map(({ kind, id, updatedAt, hash }) => ({ kind, id, updatedAt, hash }));
  }
  const pageSelection = useDirectoryPageSelection(
    JSON.stringify([
      info?.home,
      view,
      selectedProject,
      selectedFolder,
      deferredQuery,
    ]),
    visibleEntries.map((item) => item.id),
  );
  const directoryMarquee = useDirectoryMarquee(
    pageSelection,
    JSON.stringify([
      info?.home,
      view,
      selectedProject,
      selectedFolder,
      deferredQuery,
    ]),
    view === "project" && !dialog,
  );
  const selectedPageTargets = visibleEntries
    .filter((item) => pageSelection.ids.includes(item.id))
    .map((item) => item.target);
  const breadcrumbFolders: FolderMetadata[] = [];
  let breadcrumbFolder = currentFolder;
  while (
    breadcrumbFolder &&
    !breadcrumbFolders.some((item) => item.id === breadcrumbFolder!.id)
  ) {
    breadcrumbFolders.unshift(breadcrumbFolder);
    breadcrumbFolder = folders.find(
      (item) => item.id === breadcrumbFolder!.parentId,
    );
  }
  return {
    syncReadOnly,
    selectedMarker,
    pages,
    folders,
    fileDrop,
    setFileDrop,
    project,
    recent,
    currentFolder,
    visibleEntries,
    folderThumbnailEntries,
    pageSelection,
    directoryMarquee,
    selectedPageTargets,
    breadcrumbFolders,
  };
}

export type DirectoryState = ReturnType<typeof useDirectory>;
