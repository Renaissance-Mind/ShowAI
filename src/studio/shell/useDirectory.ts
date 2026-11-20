import { useMemo, useState } from "react";
import { folderBreadcrumb } from "../../core/folder-breadcrumb";
import { sortDirectoryItems } from "../../core/directory-sort";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import { indexFolderPreviews } from "../folder-previews";
import {
  useDirectoryMarquee,
  useDirectoryPageSelection,
} from "../DirectoryPageSelection";
import { recentPages } from "../RecentPages";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";

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
  const [arrivals, setArrivals] = useState<{
    home: string;
    projectId: string;
    pages: Map<string, string>;
  }>();
  function showDroppedPage(
    home: string,
    projectId: string,
    folderId: string,
    pageId: string,
  ) {
    setArrivals((previous) => {
      const pages = new Map(
        previous?.home === home && previous.projectId === projectId
          ? previous.pages
          : [],
      );
      pages.set(folderId, pageId);
      return { home, projectId, pages };
    });
  }
  const grid = view === "project" && directoryView !== "list";
  const content = selectedProject ? contents[selectedProject] : undefined;
  const order = selectedProject
    ? organization.entryOrder?.[selectedProject]
    : undefined;
  const fronts =
    arrivals &&
    arrivals.home === info?.home &&
    arrivals.projectId === selectedProject
      ? arrivals.pages
      : undefined;
  const folderPreviews = useMemo(
    () =>
      grid && content
        ? indexFolderPreviews(content.folders, content.pages, order, fronts)
        : undefined,
    [grid, content, order, fronts],
  );
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
  const breadcrumbFolders = folderBreadcrumb(folders, selectedFolder);
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
    folderPreviews,
    showDroppedPage,
    pageSelection,
    directoryMarquee,
    selectedPageTargets,
    breadcrumbFolders,
  };
}

export type DirectoryState = ReturnType<typeof useDirectory>;
