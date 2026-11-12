import { useMemo, type RefObject } from "react";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import studioMessages from "../../i18n/messages/studio";
import { useWorkspaceTabs } from "../useWorkspaceTabs";
import type { WorkspaceEntry } from "../workspace-tabs";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { CatalogState } from "./useCatalogState";
import type { MenuState } from "./menus/useMenuState";
import type { DirectoryState } from "./useDirectory";
import type { PageState, WorkspaceTabs } from "./types";

/**
 * The workspace tabs and their history: the entry this view records, and how
 * a tab's entry is shown again.
 */
export function useStudioWorkspace({
  feedback: { report, draftHeld },
  library: {
    info,
    contents,
    setExpandedProjects,
    loadProjectContents,
    expandFolderPath,
  },
  route: {
    workspaceReady,
    routing,
    docPage,
    setDocPage,
    docTitle,
    selectedProject,
    setSelectedProject,
    selectedFolder,
    setSelectedFolder,
    view,
    setView,
    setQuery,
    searchLibrary,
    setSearchLibrary,
    deferredQuery,
    restoredSearch,
    setRevealNode,
    setEditorControls,
    catalogScrollRef,
    selectedRef,
  },
  catalog: { loadCatalog },
  menus: { setContextMenu, setProjectsMenu, setGroupMenu, setExportMenu },
  directory: { project, currentFolder },
  page,
  workspaceRef,
}: {
  feedback: Pick<StudioFeedback, "report" | "draftHeld">;
  library: Pick<
    LibraryState,
    | "info"
    | "contents"
    | "setExpandedProjects"
    | "loadProjectContents"
    | "expandFolderPath"
  >;
  route: Pick<
    RouteState,
    | "workspaceReady"
    | "routing"
    | "docPage"
    | "setDocPage"
    | "docTitle"
    | "selectedProject"
    | "setSelectedProject"
    | "selectedFolder"
    | "setSelectedFolder"
    | "view"
    | "setView"
    | "setQuery"
    | "searchLibrary"
    | "setSearchLibrary"
    | "deferredQuery"
    | "restoredSearch"
    | "setRevealNode"
    | "setEditorControls"
    | "catalogScrollRef"
    | "selectedRef"
  >;
  catalog: Pick<CatalogState, "loadCatalog">;
  menus: Pick<
    MenuState,
    "setContextMenu" | "setProjectsMenu" | "setGroupMenu" | "setExportMenu"
  >;
  directory: Pick<DirectoryState, "project" | "currentFolder">;
  page: PageState;
  /** Hands the tabs to the router and actions created before them. */
  workspaceRef: RefObject<WorkspaceTabs>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const docMeta = view === "docs" && docPage ? docTitle(docPage.id) : null;
  const heading =
    view === "projects"
      ? t("heading.recent")
      : view === "project"
        ? (currentFolder?.name ?? project?.name ?? t("heading.project"))
        : view === "templates"
          ? t("heading.templates")
          : view === "components"
            ? t("heading.components")
            : view === "settings"
              ? t("heading.settings")
              : view === "docs"
                ? (docMeta?.title ?? "")
                : page.draft?.title || tc("untitled");
  const workspaceEntry = useMemo<WorkspaceEntry>(
    () => ({
      location: {
        view,
        projectId: selectedProject,
        folderId: selectedFolder,
        pageId:
          view === "page"
            ? (page.draft?.id ?? null)
            : view === "docs"
              ? (docPage?.id ?? null)
              : null,
      },
      title: heading,
      icon:
        view === "page"
          ? page.draft?.icon
          : view === "docs"
            ? docMeta?.icon
            : view === "project"
              ? selectedFolder
                ? currentFolder?.icon
                : project?.icon
              : undefined,
      scrollTop: 0,
      ...(deferredQuery ? { query: deferredQuery } : {}),
      ...(searchLibrary ? { searchLibrary } : {}),
    }),
    [
      view,
      selectedProject,
      selectedFolder,
      page.draft?.id,
      page.draft?.icon,
      project?.icon,
      currentFolder?.icon,
      heading,
      docPage?.id,
      docMeta?.icon,
      deferredQuery,
      searchLibrary,
    ],
  );
  const workspace = useWorkspaceTabs({
    home: info?.home,
    ready: workspaceReady && !routing,
    entry: workspaceEntry,
    getScroll: () => catalogScrollRef.current?.scrollTop ?? 0,
    onError: report,
    beforeClose: (tabId) => page.sessions.closeTab(tabId),
    restore: async (entry, tabId) => {
      const target = entry.location;
      const show =
        target.view === "page" && target.projectId && target.pageId
          ? await page.prepare(target.projectId, target.pageId)
          : await page.prepareClear();
      if (!show) {
        // Superseded switches end quietly; a page that could not keep its edits says so.
        if (page.status === "error") draftHeld();
        return null;
      }
      return () => {
        if (!show(tabId)) return false;
        const loaded = target.projectId ? contents[target.projectId] : null;
        selectedRef.current = target.projectId;
        setSelectedProject(target.projectId);
        const folderId =
          target.view === "page"
            ? (page.sessions.getSnapshot().active?.getSnapshot().draft
                ?.parentId ??
              loaded?.pages.find((item) => item.id === target.pageId)
                ?.parentId ??
              null)
            : target.folderId;
        setSelectedFolder(folderId);
        if (target.projectId) {
          setExpandedProjects((current) => ({
            ...current,
            [target.projectId!]: true,
          }));
          expandFolderPath(loaded?.folders ?? [], folderId);
        }
        setContextMenu(null);
        setProjectsMenu(null);
        setGroupMenu(null);
        setExportMenu(null);
        // The entry's search comes back with it, so Back shows the same results.
        const search = {
          view: target.view,
          query: entry.query ?? "",
          library: !!entry.searchLibrary,
        };
        restoredSearch.current = search;
        setQuery(search.query);
        setSearchLibrary(search.library);
        if (search.query && search.library)
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLInputElement>(
                ".studio-topbar .expandable-search input",
              )
              ?.focus(),
          );
        setRevealNode(null);
        if (target.view !== "page") setEditorControls(null);
        if (target.view === "docs" && target.pageId)
          setDocPage({ id: target.pageId, hash: "" });
        setView(target.view);
        if (target.projectId && !loaded)
          void loadProjectContents(target.projectId).catch(report);
        if (target.view === "templates" || target.view === "components")
          void loadCatalog().catch(report);
        requestAnimationFrame(() => {
          catalogScrollRef.current?.scrollTo({ top: entry.scrollTop });
        });
        return true;
      };
    },
  });
  workspaceRef.current = workspace;
  return { workspace, docMeta, heading, workspaceEntry };
}

export type StudioWorkbench = ReturnType<typeof useStudioWorkspace>;
