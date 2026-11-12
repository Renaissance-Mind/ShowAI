import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopChange, DesktopInfo } from "../../host/protocol";
import type {
  DirectoryPreferences,
  FolderMetadata,
  PageSummary,
  ProjectSummary,
  SidebarOrganization,
  UnreadableProject,
} from "../../core/model";
import { placeSidebarItem } from "../../core/sidebar-order";
import {
  directoryEntries,
  sortDirectoryItems,
} from "../../core/directory-sort";
import { desktop } from "../../host/bridge";
import { coalescedTask } from "../../lib/coalesced-task";
import { labelProblem } from "../../problems";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import syncMessages from "../../i18n/messages/sync";
import { workbenchCapabilities } from "../capabilities";
import { useSyncOverview } from "../useSyncOverview";
import {
  emptyNavigationScope,
  libraryChange,
  mergeNavigationProjects,
  mergeNavigationScope,
  queueNavigationScope,
  refreshedContents,
  retainEqual,
} from "../navigation-refresh";
import { LibraryHistory, type LibraryChange } from "../library-history";
import { writeNavigationCache } from "../navigation-cache";
import { applyLibraryMove, type LibraryContents } from "../library-move";
import type { LibraryDrop } from "../LibraryDrag";
import type { LibraryTarget } from "../LibraryNavigation";
import { applySidebarReorder, type SidebarReorder } from "../sidebar-reorder";
import { readSidebarExpansion, sidebarExpansionKey } from "../sidebar-state";
import { writerName } from "../external-change";
import type { StudioFeedback } from "./useStudioFeedback";
import {
  LOAD_LIBRARY,
  operation,
  type ProjectScan,
} from "./types";

/**
 * The content library as the navigation shows it: projects, their pages and
 * folders, the sidebar organization and expansion, and the library's undo history.
 */
export function useLibraryState({
  resolveProblem,
}: Pick<StudioFeedback, "resolveProblem">) {
  const tc = useTranslator(commonMessages);
  const ts = useTranslator(syncMessages);
  const [navigationUpdating, setNavigationUpdating] = useState(true);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const capabilities = workbenchCapabilities(info?.platform);
  const externalChangesAvailable =
    capabilities.externalChanges && info?.libraryVersion === 2;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [unreadableProjects, setUnreadableProjects] = useState<
    UnreadableProject[]
  >([]);
  const [dismissedUnreadable, setDismissedUnreadable] = useState<string[]>([]);
  const [savedOrganization, setOrganization] = useState<SidebarOrganization>({
    groups: [],
    projectGroups: {},
  });
  const [pendingReorders, setPendingReorders] = useState<
    (SidebarReorder & { token: number; home: string })[]
  >([]);
  const reorderQueue = useRef(Promise.resolve());
  const sidebarRevision = useRef(0);
  const reorderCount = useRef(0);
  const organization = useMemo(
    () =>
      pendingReorders
        .filter((move) => move.home === info?.home)
        .reduce(applySidebarReorder, savedOrganization),
    [pendingReorders, savedOrganization, info?.home],
  );
  useEffect(
    () =>
      desktop.onBeforeClose(async () => {
        await reorderQueue.current;
        return true;
      }, "sidebar"),
    [],
  );
  // Sync state for project rows, the page header and workbench banners.
  const syncOverview = useSyncOverview(info?.home);
  const projectSyncMarker = (projectId: string) => {
    const marker = syncOverview.markers.get(projectId);
    if (!marker) return undefined;
    const binding = syncOverview.bindings.get(projectId);
    return {
      label: ts(
        marker === "readOnly"
          ? "marker.readOnly"
          : marker === "signIn"
            ? "marker.signIn"
            : "marker.unsynced",
      ),
      title: binding?.error,
      tone: marker === "readOnly" ? ("muted" as const) : ("warning" as const),
    };
  };
  const [savedContents, setContents] = useState<LibraryContents>({});
  const [pendingLibraryMove, setPendingLibraryMove] = useState<{
    home: string;
    drop: LibraryDrop;
  } | null>(null);
  const contents = useMemo(
    () =>
      pendingLibraryMove && pendingLibraryMove.home === info?.home
        ? applyLibraryMove(savedContents, pendingLibraryMove.drop)
        : savedContents,
    [savedContents, pendingLibraryMove, info?.home],
  );
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >({});
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  const sidebarHome = useRef<string | null>(null);
  const expandedRef = useRef(expandedProjects);
  expandedRef.current = expandedProjects;
  // Cmd+Z in the library reverses moves, deletions and renames, newest first.
  const libraryHistory = useRef<LibraryHistory>(null!);
  libraryHistory.current ??= new LibraryHistory();
  const historyBusy = useRef(false);
  const [, refreshLibraryHistory] = useState(0);
  function rememberLibraryChange(entry: LibraryChange) {
    libraryHistory.current.record(entry);
    refreshLibraryHistory((value) => value + 1);
  }
  // A toast's Undo reaches the library history, which records its changes later.
  const undoLibraryRef = useRef<(entry: LibraryChange) => Promise<unknown>>(
    () => Promise.resolve(),
  );
  const loadProjectContents = useCallback(async (id: string) => {
    const [nextPages, nextFolders] = await Promise.all([
      desktop.invoke<PageSummary[]>("pages:list", { projectId: id }),
      desktop.invoke<FolderMetadata[]>("folders:list", { projectId: id }),
    ]);
    const next = { pages: nextPages, folders: nextFolders };
    setContents((current) => ({ ...current, [id]: next }));
    return next;
  }, []);
  const navigationScope = useRef(emptyNavigationScope());
  // Counts library switches; a refresh started before one discards its reads.
  const libraryGeneration = useRef(0);
  useEffect(
    () =>
      desktop.onChange((change) => {
        if (change.type === "home") libraryGeneration.current++;
      }),
    [],
  );
  const navigationState = useRef({ projects, organization: savedOrganization });
  navigationState.current = { projects, organization: savedOrganization };
  const refreshNavigation = useMemo(
    () =>
      coalescedTask(async () => {
        const requested = navigationScope.current;
        navigationScope.current = emptyNavigationScope();
        try {
          const revision = sidebarRevision.current;
          const generation = libraryGeneration.current;
          const appInfo = await desktop.invoke<DesktopInfo>("app:info");
          const scope = { expectedHome: appInfo.home };
          const changedHome = sidebarHome.current !== appInfo.home;
          const full = requested.all || changedHome;
          const [scanned, sidebar] = await Promise.all([
            full || requested.ids.size
              ? desktop.invoke<ProjectScan>("projects:scan", {
                  ...scope,
                  ...(full ? {} : { projectIds: [...requested.ids] }),
                })
              : Promise.resolve({
                  projects: [],
                  unreadable: [],
                } as ProjectScan),
            full || requested.sidebar
              ? desktop.invoke<SidebarOrganization>("sidebar:get", scope)
              : Promise.resolve(navigationState.current.organization),
          ]);
          if (generation !== libraryGeneration.current) return;
          if (changedHome) {
            libraryHistory.current.clear();
            refreshLibraryHistory((value) => value + 1);
            const saved = readSidebarExpansion(appInfo.home);
            sidebarHome.current = appInfo.home;
            expandedRef.current = saved.projects;
            setExpandedProjects(saved.projects);
            setExpandedFolders(saved.folders);
            setCollapsedSections(saved.collapsedSections);
          }
          setInfo((current) => retainEqual(current, appInfo));
          const next = scanned.projects;
          if (full || requested.ids.size)
            setUnreadableProjects((current) =>
              retainEqual(
                current,
                full
                  ? scanned.unreadable
                  : [
                      ...current.filter(
                        (item) => !requested.ids.has(item.directory),
                      ),
                      ...scanned.unreadable,
                    ],
              ),
            );
          const nextProjects = mergeNavigationProjects(
            navigationState.current.projects,
            next,
            full ? undefined : requested.ids,
          );
          navigationState.current.projects = nextProjects;
          setProjects(nextProjects);
          if (
            changedHome ||
            (revision === sidebarRevision.current && !reorderCount.current)
          ) {
            setOrganization((current) => retainEqual(current, sidebar));
            navigationState.current.organization = sidebar;
          }
          setNavigationUpdating(false);
          performance.clearMarks("showai:navigation-current");
          performance.mark("showai:navigation-current");
          try {
            writeNavigationCache(localStorage, {
              home: appInfo.home,
              projects: nextProjects,
              organization: sidebar,
            });
          } catch (error) {
            console.warn("Could not cache the project list", error);
          }
          // Folders come with the scan; only pages are read per project.
          const nextContents = await Promise.all(
            next.map(async (project) => ({
              project,
              pages: await desktop.invoke<PageSummary[]>("pages:list", {
                projectId: project.id,
                expectedHome: appInfo.home,
              }),
            })),
          );
          if (generation !== libraryGeneration.current) return;
          setContents((current) =>
            refreshedContents(current, nextContents, {
              full,
              ids: requested.ids,
            }),
          );
        } catch (error) {
          // A failed scoped read must remain pending when another change asks for a retry.
          mergeNavigationScope(navigationScope.current, requested);
          // The failure is reported; the list must not look like it is still loading.
          setNavigationUpdating(false);
          throw error;
        }
      }),
    [],
  );
  const refresh = useCallback(
    (change?: DesktopChange) => {
      queueNavigationScope(navigationScope.current, change);
      return refreshNavigation().then(
        (value) => {
          resolveProblem(LOAD_LIBRARY);
          return value;
        },
        (error: unknown) => {
          throw labelProblem(error, {
            action: operation("op.loadLibrary"),
            key: LOAD_LIBRARY,
          });
        },
      );
    },
    [refreshNavigation, resolveProblem],
  );
  /** Confirms an operation by reading only the projects it changed. */
  const refreshProjects = (
    projectIds: string[],
    options?: { sidebar?: boolean; pageIds?: string[] },
  ) =>
    info?.home
      ? refresh(libraryChange(info.home, projectIds, options))
      : refresh();
  useEffect(() => {
    if (!info || sidebarHome.current !== info.home) return;
    localStorage.setItem(
      sidebarExpansionKey(info.home),
      JSON.stringify({
        projects: expandedProjects,
        folders: expandedFolders,
        collapsedSections,
      }),
    );
  }, [info?.home, expandedProjects, expandedFolders, collapsedSections]);
  function expandFolderPath(items: FolderMetadata[], parentId: string | null) {
    const expanded: Record<string, boolean> = {};
    while (parentId && !expanded[parentId]) {
      expanded[parentId] = true;
      parentId = items.find((item) => item.id === parentId)?.parentId ?? null;
    }
    setExpandedFolders((current) => ({ ...current, ...expanded }));
  }
  async function toggleProject(id: string) {
    if (!expandedProjects[id]) await loadProjectContents(id);
    setExpandedProjects((current) => ({ ...current, [id]: !current[id] }));
  }
  function folderPreferences(
    projectId: string,
    parentId: string | null,
  ): DirectoryPreferences {
    const current = contents[projectId];
    const saved =
      parentId === null
        ? projects.find((item) => item.id === projectId)
        : current?.folders.find((item) => item.id === parentId);
    let preferences: DirectoryPreferences = saved ?? {};
    for (const move of pendingReorders.filter(
      (move) =>
        move.home === info?.home &&
        move.projectId === projectId &&
        move.parentId === parentId,
    )) {
      const entries = directoryEntries(
        current?.folders ?? [],
        current?.pages ?? [],
      ).filter((item) => item.parentId === parentId);
      if (
        !entries.some((item) => item.id === move.id) ||
        (move.relativeId &&
          !entries.some((item) => item.id === move.relativeId))
      )
        continue;
      preferences = {
        sortBy: "manual",
        manualOrder: placeSidebarItem(
          sortDirectoryItems(
            entries,
            preferences,
            savedOrganization.entryOrder?.[projectId],
          ).map((item) => item.id),
          move.id,
          move.relativeId,
          move.placement,
        ),
      };
    }
    return preferences;
  }
  const projectTarget = (item: ProjectSummary): LibraryTarget => ({
    kind: "project",
    projectId: item.id,
    id: item.id,
    title: item.name,
    icon: item.icon,
    pinned: !!item.pinned,
    parentId: null,
  });
  const folderTarget = (
    item: FolderMetadata,
    projectId: string,
  ): LibraryTarget => ({
    kind: "folder",
    projectId,
    id: item.id,
    title: item.name,
    icon: item.icon,
    pinned: !!item.pinned,
    parentId: item.parentId ?? null,
  });
  const pageTarget = (item: PageSummary, projectId: string): LibraryTarget => ({
    kind: "page",
    projectId,
    id: item.id,
    title: item.title || tc("untitled"),
    icon: item.icon,
    pinned: !!item.favorite,
    parentId: item.parentId ?? null,
    ...(item.agentCreated
      ? {
          agentCreated: item.agentCreated.label
            ? writerName(item.agentCreated.label)
            : "Agent",
        }
      : {}),
  });
  return {
    navigationUpdating,
    info,
    setInfo,
    capabilities,
    externalChangesAvailable,
    projects,
    setProjects,
    unreadableProjects,
    dismissedUnreadable,
    setDismissedUnreadable,
    savedOrganization,
    setOrganization,
    organization,
    pendingReorders,
    setPendingReorders,
    reorderQueue,
    sidebarRevision,
    reorderCount,
    syncOverview,
    projectSyncMarker,
    savedContents,
    setContents,
    setPendingLibraryMove,
    contents,
    expandedProjects,
    setExpandedProjects,
    expandedFolders,
    setExpandedFolders,
    collapsedSections,
    setCollapsedSections,
    sidebarHome,
    libraryHistory,
    historyBusy,
    refreshLibraryHistory,
    rememberLibraryChange,
    undoLibraryRef,
    loadProjectContents,
    refresh,
    refreshProjects,
    expandFolderPath,
    toggleProject,
    folderPreferences,
    projectTarget,
    folderTarget,
    pageTarget,
  };
}

export type LibraryState = ReturnType<typeof useLibraryState>;
