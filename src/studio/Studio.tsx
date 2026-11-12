import RemoteMcpApprovalDialog from "./RemoteMcpApprovalDialog";
import MergeDialog from "./MergeDialog";
import { trackDesktopPreviewActivity } from "./preview-work";
import accountFlowMessages from "../i18n/messages/accountFlow";
import {
  withCreatedFolder,
  withLibraryEntry,
} from "./navigation-refresh";
import { ComponentLibraryContext } from "../components/ComponentLibrary";
import { useAppearancePreference } from "../design/appearance-preference";
import { upgradeResource } from "../document/containers.mjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  AtSign,
  Link2,
  AppWindow,
  Blocks,
  Settings2,
  Search,
  FolderInput,
  FolderMinus,
  Globe,
  Package,
  PanelsTopLeft,
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Undo2,
  Redo2,
  Plus,
  History,
  Upload,
  X,
  ArchiveRestore,
  Cloud,
  EyeOff,
  FileDiff,
  Keyboard,
  LifeBuoy,
  Presentation,
  TriangleAlert,
} from "../ui/icons";
import type {
  ProjectSummary,
  FolderMetadata,
  SidebarOrganization,
} from "../core/model";
import type {
  DesktopInfo,
} from "../host/protocol";
import type {
  CompiledComponent,
  CatalogReadOptions,
  ComponentSource,
} from "../contract/types";
import { PageWorkspace } from "./PageWorkspace";
import DatabaseRecordPeek from "./DatabaseRecordPeek";
import { useDatabaseRecordPeek } from "./useDatabaseRecordPeek";
import {
  EditorHistoryButtons,
  containerMenuItems,
} from "../surface/EditorControls";
import { desktop } from "../host/bridge";
import { usePage } from "./usePage";
import {
  LibraryRow,
  LibraryContextMenu,
  type LibraryMenuPoint,
  type LibraryRowProps,
  type LibraryTarget,
} from "./LibraryNavigation";
import Dialog from "../ui/Dialog";
import ImportDialog from "./ImportDialog";
import {
  PackagingDialog,
} from "./PackagingDialog";
import PageThumbnail from "./PageThumbnail";
import FolderThumbnail from "./FolderThumbnail";
import {
  BatchPagesDialog,
  DirectorySelectionBar,
} from "./DirectoryPageSelection";
import PageIcon from "../components/PageIcon";
import ProjectIcon from "./ProjectIcon";
import PageIconDialog from "../components/PageIconDialog";
import ExpandableSearch from "../components/ExpandableSearch";
import ProjectSidebar from "./ProjectSidebar";
import {
  LibraryDragContext,
} from "./LibraryDrag";
import {
  sortDirectoryItems,
} from "../core/directory-sort";
import SidebarNavigation from "./SidebarNavigation";
import TemplateNavigation from "./TemplateNavigation";
import {
  latestTemplateVersions,
  templateHasPage,
} from "./template-catalog-model";
import TemplateThumbnail from "./TemplateThumbnail";
import RecentPages, { type RecentPage } from "./RecentPages";
import QuickJump from "./quick-jump/QuickJump";
import Welcome from "./Welcome";
import PluginUpdateNotice from "./PluginUpdateNotice";
import AppUpdateNotice from "./AppUpdateNotice";
import { useAppUpdate } from "./useAppUpdate";
import {
  BuiltinDocPage,
  DocsNavigation,
  useBuiltinDocFolders,
} from "./BuiltinDocs";
import {
  builtinDocs,
  DOCS_HOME,
  WELCOME_DOC,
} from "./builtin-docs";
import { useSampleProject } from "./sample-project";
import AutoHideSidebar from "./AutoHideSidebar";
import {
  DiscardDraftDialog,
  SaveFailureBanner,
  SaveStatusMark,
  focusSaveBanner,
} from "./SaveProblem";
import { largestBlock } from "./save-problem";
import syncMessages from "../i18n/messages/sync";
import WorkspaceTabs, { WorkspaceHistory } from "./WorkspaceTabs";
import { WorkspaceSwipeNavigation } from "./WorkspaceSwipeNavigation";
import {
  clickDisposition,
} from "./open-target";
import navigationMessages from "../i18n/messages/navigation";
import {
  DeletedItemsDialog,
  HiddenProjectsDialog,
  ShortcutsDialog,
} from "./LibraryNavigationDialogs";
import {
  clientIsMac,
  formatShortcut,
  isDeleteShortcut,
} from "./keyboard-shortcuts";
import findMessages from "../i18n/messages/find";
import { FindBar } from "./find/FindBar";
import { useFind } from "./find/useFind";
import { useWindowFullscreen } from "./useWindowFullscreen";
import { ComponentCatalog, ComponentNavigation } from "./ComponentCatalog";
import { TemplateDialog, ComponentDialog } from "./CatalogDialogs";
import {
  ImportComponentAction,
  SaveTemplateAction,
} from "./CatalogManagement";
import "./studio.css";
import {
  NoticeStack,
  ProblemNotice,
  ToastViewport,
  describeError,
  bindProblemActions,
  configureProblemRedaction,
  configureProblemPlatform,
  revealLabel,
} from "../problems";
import feedbackMessages from "../i18n/messages/feedback";
import {
  LibrarySearchResults,
  ExternalConflictDialog,
  WorkspaceConflictsDialog,
} from "./RecoveryDialogs";
import type { SearchResult } from "../core/library-index";
import LibraryMigrationDialog from "./LibraryMigrationDialog";
import {
  SettingsNavigation,
  SettingsPanel,
} from "./Settings";
import {
  getLocale,
} from "../i18n";
import { useLocale, useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";
import assistantMessages from "../i18n/messages/assistant";
import pageSessionMessages from "../i18n/messages/pageSession";
import {
  ExternalChangeNotice,
  flashBlocks,
  locateBlocks,
} from "./ExternalChangeNotice";
import { authorName } from "./external-change";
import AssistantWorkbench from "./assistant/AssistantWorkbench";
import { CommentsPanel, CommentsToggle } from "../comments/CommentsPanel";
import {
  DeleteDialog,
  FolderDialog,
  MoveProjectDialog,
  NameDialog,
  ProjectDialog,
} from "./shell/LibraryDialogs";
import {
  operation,
  type AssistantControl,
  type LoadedTemplate,
  type WorkspaceTabs as Workspace,
} from "./shell/types";
import { useStudioFeedback } from "./shell/useStudioFeedback";
import { useLibraryState, useLibraryUpdates } from "./shell/useLibraryState";
import { useRouteState } from "./shell/useRouteState";
import { useCatalogState } from "./shell/useCatalogState";
import { useDialogState, useSaveConflictDialog } from "./shell/useDialogState";
import { useMenuState } from "./shell/menus/useMenuState";
import { useDirectory } from "./shell/useDirectory";
import { useStudioRouter } from "./shell/useStudioRouter";
import { usePageActions } from "./shell/usePageActions";
import { useLibraryEdits } from "./shell/useLibraryEdits";
import { useLibraryMoves } from "./shell/useLibraryMoves";
import { useCatalogActions } from "./shell/useCatalogActions";
import { useStudioWorkspace } from "./shell/useStudioWorkspace";
import { useMenuItems } from "./shell/menus/useMenuItems";
import { useStudioCommands } from "./shell/commands";


const recentLoading = <div className="studio-welcome" aria-busy="true" />;

function shortDate(value: string) {
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
function Scope({ value }: { value: string }) {
  const t = useTranslator(studioMessages);
  const key = (
    {
      builtin: "scope.builtin",
      global: "scope.global",
      published: "scope.published",
      user: "scope.global",
      project: "scope.project",
    } as const
  )[value];
  return <span className="studio-tag">{key ? t(key) : value}</span>;
}

export default function Studio() {
  useEffect(() => {
    trackDesktopPreviewActivity();
  }, []);
  const accountFlow = useTranslator(accountFlowMessages);
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const tfind = useTranslator(findMessages);
  const ta = useTranslator(assistantMessages);
  const tn = useTranslator(navigationMessages);
  const tfeedback = useTranslator(feedbackMessages);
  const tps = useTranslator(pageSessionMessages);
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void desktop
          .invoke("sync:wake")
          .catch((error) => console.error("Sync wake failed", error));
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, []);
  const windowFullscreen = useWindowFullscreen();
  const feedback = useStudioFeedback();
  const {
    toasts,
    setNotice,
    problemQueue,
    notifyWithUndo,
    report,
    action,
  } = feedback;
  const library = useLibraryState(feedback);
  const {
    navigationUpdating,
    info,
    setInfo,
    capabilities,
    externalChangesAvailable,
    projects,
    unreadableProjects,
    dismissedUnreadable,
    setDismissedUnreadable,
    savedOrganization,
    organization,
    pendingReorders,
    syncOverview,
    projectSyncMarker,
    setContents,
    contents,
    expandedProjects,
    setExpandedProjects,
    expandedFolders,
    setExpandedFolders,
    collapsedSections,
    setCollapsedSections,
    libraryHistory,
    historyBusy,
    loadProjectContents,
    refresh,
    refreshProjects,
    toggleProject,
    folderPreferences,
    projectTarget,
    folderTarget,
    pageTarget,
  } = library;
  const route = useRouteState({ info, capabilities });
  const {
    syncNavigationKey,
    syncRequest,
    setSyncRequest,
    feedbackRequest,
    workspaceReady,
    routing,
    docPage,
    showDocs,
    docTitle,
    selectedProject,
    setSelectedProject,
    selectedFolder,
    setSelectedFolder,
    view,
    settingsSection,
    setSettingsSection,
    query,
    setQuery,
    searchLibrary,
    setSearchLibrary,
    deferredQuery,
    revealNode,
    setRevealNode,
    editorControls,
    setEditorControls,
    handleRevealHandled,
    catalogScrollRef,
    selectedRef,
  } = route;
  const locale = useLocale();
  const ts = useTranslator(syncMessages);
  const appUpdate = useAppUpdate();
  const catalog = useCatalogState(route);
  const {
    catalogLoading,
    showTemplateVersions,
    setShowTemplateVersions,
    templateType,
    setTemplateType,
    catalogScope,
    setCatalogScope,
    componentProject,
    setComponentProject,
    componentProjectRef,
    componentFilter,
    setComponentFilter,
    componentSourceTabs,
    componentCategory,
    setComponentCategory,
    catalogQueries,
    setCatalogQueries,
    componentGroups,
    loadCatalog,
    catalogTemplates,
    visibleTemplates,
  } = catalog;
  const dialogs = useDialogState();
  const { dialog, setDialog, dialogRef, closeDialog } = dialogs;
  const menus = useMenuState();
  const {
    groupMenu,
    setGroupMenu,
    directoryView,
    viewMenu,
    setViewMenu,
    viewOptions,
    viewIcon,
    chooseDirectoryView,
    contextMenu,
    setContextMenu,
    projectsMenu,
    setProjectsMenu,
    newMenu,
    setNewMenu,
    exportMenu,
    setExportMenu,
    exportSiteButton,
    pageExportMenu,
    setPageExportMenu,
    exportTarget,
    setExportTarget,
    showMenu,
  } = menus;
  const [externalChangeCount, setExternalChangeCount] = useState(0);
  const [assistantPrefill, setAssistantPrefill] = useState<{
    key: string;
    pageId: string;
    text: string;
  } | null>(null);
  const appearance = useAppearancePreference();
  const page = usePage(info?.home);
  // Built-in docs are read-only pages: find works there without replace.
  const findKey =
    view === "page" && page.draft
      ? page.draft.id
      : view === "docs" && docPage && docPage.id !== WELCOME_DOC
        ? `docs:${docPage.id}`
        : null;
  const find = useFind({
    available: () => !!findKey && !dialogRef.current,
    mac: clientIsMac(),
  });
  const findPage = useCallback(
    () =>
      [
        ...(catalogScrollRef.current?.querySelectorAll<HTMLElement>(
          ".surface-editor-shell",
        ) ?? []),
      ].find((shell) => shell.getClientRects().length > 0) ?? null,
    [],
  );
  const { deferConflict } = useSaveConflictDialog({
    route,
    page,
    dialogs,
    feedback,
  });

  useEffect(() => {
    configureProblemRedaction(info?.home ? { library: info.home } : {});
  }, [info?.home]);
  useEffect(() => configureProblemPlatform(info?.platform), [info?.platform]);
  const directory = useDirectory({ library, route, dialogs, menus });
  const {
    syncReadOnly,
    selectedMarker,
    pages,
    fileDrop,
    setFileDrop,
    project,
    recent,
    currentFolder,
    visibleEntries,
    folderThumbnailEntries,
    pageSelection,
    directoryMarquee,
    breadcrumbFolders,
  } = directory;
  // The tabs come later: the router and actions read them when they run.
  const workspaceRef = useRef<Workspace>(null!);
  const router = useStudioRouter({
    feedback,
    library,
    route,
    catalog,
    menus,
    page,
    workspaceRef,
  });
  const {
    settleOpenPage,
    navigate,
    openProject,
    openPage,
    locateAssistantTarget,
    openTarget,
    openTargetClick,
    openDoc,
    locateCurrentPage,
    leaveDetour,
    openProjectManagement,
  } = router;
  // A library the App just created gets its sample project once.
  const sampleProject = useSampleProject(
    info && capabilities.manageLibrary ? info.home : null,
    refresh,
    report,
  );
  useLibraryUpdates({ feedback, library, route, catalog, page });
  const pageActions = usePageActions({
    feedback,
    library,
    route,
    dialogs,
    menus,
    directory,
    router,
    page,
    workspaceRef,
  });
  const {
    importPlan,
    setImportPlan,
    packagingDecision,
    busy,
    exportReceipt,
    setExportReceipt,
    handleActiveSurfaceChange,
    copyPageReference,
    copyPageLink,
    beginNewPage,
    createPage,
    createLinkedPage,
    renameLinkedPage,
    runSaveLocalCopy,
    keepDraftAsCopy,
    createPageForAgent,
    importPage,
    importFinished,
    exportSite,
    activePageTarget,
    duplicatePage,
    runCreation,
    beginPageIcon,
    addBlock,
    importDroppedFiles,
  } = pageActions;
  const edits = useLibraryEdits({
    feedback,
    library,
    route,
    dialogs,
    menus,
    router,
    page,
  });
  const {
    beginRename,
    libraryKeyCommand,
    beginDelete,
    moveProject,
    updateTarget,
    deleteTarget,
    unpinTarget,
  } = edits;
  const moves = useLibraryMoves({
    feedback,
    library,
    route,
    dialogs,
    menus,
    directory,
    router,
    edits,
    page,
  });
  const {
    replayLibraryChange,
    libraryDrag,
    beginBatchPages,
    applyBatchPages,
  } = moves;
  const catalogActions = useCatalogActions({
    library,
    route,
    catalog,
    dialogs,
    router,
    page,
  });
  const { viewComponent, catalogManager, pickerLibrary } = catalogActions;
  const workbench = useStudioWorkspace({
    feedback,
    library,
    route,
    catalog,
    menus,
    directory,
    page,
    workspaceRef,
  });
  const { workspace, docMeta, heading, workspaceEntry } = workbench;


  useEffect(() => {
    document.title =
      view === "page" && page.draft
        ? `${page.draft.title || tc("untitled")} — ShowAI`
        : view === "docs" && docPage
          ? `${docTitle(docPage.id).title} — ShowAI`
          : "ShowAI";
  }, [view, page.draft?.title, tc, docPage?.id]);
  // External edits are listed only while some are waiting for a decision.
  useEffect(() => {
    if (!externalChangesAvailable || dialog) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void desktop.invoke<unknown[]>("workspace:conflicts").then(
        (items) => {
          if (active) setExternalChangeCount(items.length);
        },
        (error) => console.error("Could not read external file changes", error),
      );
    load();
    const unsubscribe = desktop.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 600);
    });
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", load);
    };
  }, [externalChangesAvailable, !!dialog, info?.home]);

  function showDirectoryCreationMenu(
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) {
    if (!project || (selectedFolder && !currentFolder)) return;
    showMenu(
      currentFolder
        ? folderTarget(currentFolder, project.id)
        : projectTarget(project),
      anchor,
      point,
      false,
      true,
    );
  }
  // Each folder's sorted rows, computed once per project when its contents,
  // order or pending reorders change rather than on every workbench render.
  const sidebarChildren = useMemo(() => {
    const cache = new Map<string, Map<string | null, LibraryTarget[]>>();
    return (projectId: string, parentId: string | null): LibraryTarget[] => {
      let byParent = cache.get(projectId);
      if (!byParent) {
        byParent = new Map();
        cache.set(projectId, byParent);
        const current = contents[projectId];
        const folderIds = new Set(current?.folders.map((item) => item.id));
        const groups = new Map<
          string | null,
          (Parameters<typeof sortDirectoryItems>[0][number] & {
            target: LibraryTarget;
          })[]
        >();
        const add = (
          parent: string | null,
          item: Parameters<typeof sortDirectoryItems>[0][number] & {
            target: LibraryTarget;
          },
        ) => {
          const group = groups.get(parent);
          if (group) group.push(item);
          else groups.set(parent, [item]);
        };
        for (const item of current?.folders ?? [])
          add(item.parentId ?? null, {
            ...item,
            target: folderTarget(item, projectId),
          });
        for (const item of current?.pages ?? [])
          add(item.parentId && folderIds.has(item.parentId) ? item.parentId : null, {
            ...item,
            name: item.title || tc("untitled"),
            pinned: item.favorite,
            target: pageTarget(item, projectId),
          });
        for (const [parent, items] of groups)
          byParent.set(
            parent,
            sortDirectoryItems(
              items,
              folderPreferences(projectId, parent),
              organization.entryOrder?.[projectId],
            ).map((item) => item.target),
          );
      }
      return byParent.get(parentId) ?? [];
    };
  }, [contents, projects, pendingReorders, organization, savedOrganization, info?.home, tc]);
  function renderChildren(
    projectId: string,
    parentId: string | null = null,
    depth = 0,
  ): ReactNode {
    if (depth > 30) return null;
    if (!contents[projectId]) return null;
    const targets = sidebarChildren(projectId, parentId);
    return targets.map((target) => (
      <div key={target.id}>
        <LibraryRow
          target={target}
          active={
            selectedProject === projectId &&
            (target.kind === "page"
              ? view === "page" && page.draft?.id === target.id
              : view === "project" && selectedFolder === target.id)
          }
          expanded={
            target.kind === "folder" ? !!expandedFolders[target.id] : undefined
          }
          onToggle={
            target.kind === "folder"
              ? rowToggle("folder", target.id)
              : undefined
          }
          onOpen={openRow}
          onMenu={showRowMenu}
          onCommand={rowCommand}
        />
        {target.kind === "folder" && expandedFolders[target.id] && (
          <div className="studio-tree-children">
            {renderChildren(projectId, target.id, depth + 1)}
          </div>
        )}
      </div>
    ));
  }
  /** Page templates create a page here; workflow templates hand a prompt to an agent. */
  function templateDialogActions(record: LoadedTemplate, owner?: string) {
    const projectId =
      owner ??
      selectedProject ??
      (componentProject !== "all" ? componentProject : null);
    return {
      ...(templateHasPage(record)
        ? {
            createUnavailable: !projectId || contentCreationDisabled,
            onCreatePage: async () => {
              if (!projectId) return;
              await createPage(record.id, record, undefined, {
                projectId,
                parentId: projectId === selectedProject ? selectedFolder : null,
              });
            },
          }
        : {}),
      onCopyPrompt: (prompt: string) =>
        desktop.invoke<void>("clipboard:write", { text: prompt }),
    };
  }
  const loading = !info && !problemQueue.problems.length;
  // A sample project the person removed is never offered again.
  const seededSamples =
    sampleProject.samples?.state === "seeded" ? sampleProject.samples : null;
  const sampleProjectId =
    seededSamples &&
    projects.some(
      (item) => item.id === seededSamples.projectId && !item.archived,
    )
      ? seededSamples.projectId
      : null;
  // The welcome stays until the library has pages outside the sample project;
  // it waits for the first page list so existing libraries never flash it.
  const welcoming =
    workspaceReady &&
    !!info &&
    !recent.some((item) => item.projectId !== sampleProjectId);
  const docFolders = useBuiltinDocFolders(
    view === "docs" ? (docPage?.id ?? null) : null,
  );
  const studioRoot = useRef<HTMLDivElement>(null);
  // A page starts loading when the pointer rests on a link to it or presses
  // it, so opening it does not wait for the read.
  useEffect(() => {
    let timer = 0;
    const link = (event: PointerEvent) => {
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-open-page]")
          : null;
      return element?.dataset.openProject && element.dataset.openPage
        ? { projectId: element.dataset.openProject, pageId: element.dataset.openPage }
        : null;
    };
    const over = (event: PointerEvent) => {
      clearTimeout(timer);
      const target = link(event);
      if (target)
        timer = window.setTimeout(
          () => page.sessions.prefetch(target.projectId, target.pageId),
          80,
        );
    };
    const out = () => clearTimeout(timer);
    const down = (event: PointerEvent) => {
      clearTimeout(timer);
      const target = link(event);
      if (target) page.sessions.prefetch(target.projectId, target.pageId);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down);
    };
  }, [page.sessions]);
  const recordPeek = useDatabaseRecordPeek({
    sessions: page.sessions,
    home: info?.home,
    tabId: workspace.activeId,
    hostProjectId: page.projectId,
    hostPageId: page.draft?.id,
    visible: view === "page" && !!page.draft,
    blocked: busy || routing || !!dialog,
    report,
    openFullPage: (pageId, projectId) => openPage(pageId, projectId),
  });
  const assistantOpen = workspace.assistantOpen;
  const changeAssistantOpen = (open: boolean) =>
    workspace.setAssistantOpen(open, workspace.activeId);
  // A new App opens on the first-run page of its documentation, once per window,
  // while the library has no pages of its own; restored sessions and page links win.
  const launchedWelcome = useRef(false);
  useEffect(() => {
    if (!workspaceReady || !info || launchedWelcome.current) return;
    const launch = workspace.launchState();
    if (!launch) return;
    launchedWelcome.current = true;
    const params = new URLSearchParams(location.search);
    if (
      launch !== "new" ||
      !welcoming ||
      !showDocs ||
      view !== "projects" ||
      params.has("project") ||
      params.has("invite")
    )
      return;
    void openDoc(WELCOME_DOC).catch(report);
  }, [workspaceReady, info, welcoming, showDocs, view, routing]);
  const assistant: AssistantControl = {
    assistantOpen,
    changeAssistantOpen,
    setAssistantPrefill,
  };
  const menuItems = useMenuItems({
    feedback,
    library,
    route,
    dialogs,
    menus,
    directory,
    pageActions,
    edits,
    moves,
    workspace,
  });
  const {
    creationMenuItems,
    pageExportMenuItems,
    newMenuItems,
    directorySortMenuItems,
    projectOrderMenuItems,
  } = menuItems;
  const commands = useStudioCommands({
    feedback,
    library,
    route,
    dialogs,
    menus,
    router,
    pageActions,
    menuItems,
    page,
    workspace,
    find,
    appearance,
    assistant,
  });
  const { helpDoc, openFeedback, quickJumpCommands } = commands;
  // An external write just installed into the open page: outline what changed.
  const externalChange = view === "page" ? page.externalChange : undefined;
  useEffect(() => {
    if (externalChange?.fresh)
      flashBlocks(catalogScrollRef.current, externalChange.blockIds);
  }, [externalChange]);
  // Opening a page an Agent created clears its 「Agent 新建」 mark.
  const openedPage =
    view === "page" && page.projectId && page.draft
      ? { projectId: page.projectId, pageId: page.draft.id }
      : null;
  const openedAgentPage =
    openedPage &&
    contents[openedPage.projectId]?.pages.some(
      (item) => item.id === openedPage.pageId && item.agentCreated,
    )
      ? openedPage
      : null;
  useEffect(() => {
    if (!openedAgentPage) return;
    const { projectId, pageId } = openedAgentPage;
    void desktop
      .invoke("pages:markSeen", { projectId, pageId })
      .then(() =>
        setContents((current) =>
          current[projectId]
            ? {
                ...current,
                [projectId]: {
                  ...current[projectId],
                  pages: current[projectId].pages.map((item) =>
                    item.id === pageId
                      ? { ...item, agentCreated: undefined }
                      : item,
                  ),
                },
              }
            : current,
        ),
      )
      .catch(report);
  }, [openedAgentPage?.projectId, openedAgentPage?.pageId, report]);

  function searchTarget(result: SearchResult): LibraryTarget | undefined {
    const match = result.path.match(
      /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
    );
    if (match) {
      const item = contents[match[1]]?.pages.find(
        (item) => item.id === match[2],
      );
      return item ? pageTarget(item, match[1]) : undefined;
    }
    if (result.kind === "project") {
      const item = projects.find((item) => item.id === result.projectId);
      return item ? projectTarget(item) : undefined;
    }
  }
  async function openSearchResult(
    result: SearchResult,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    const target = searchTarget(result);
    const disposition = capabilities.tabs
      ? clickDisposition(event, info?.platform === "darwin") : "current";
    if (target && disposition !== "current") {
      event.preventDefault();
      if (
        (await openTarget(target, disposition)) &&
        (disposition === "tab" || disposition === "foreground-tab")
      )
        setRevealNode(result.blockId);
      return;
    }
    const scope = result.projectId
      ? "project"
      : result.path.startsWith("packages/published/")
        ? "published"
        : "global";
    const match = result.path.match(
      /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
    );
    if (match) {
      if (await openPage(match[2], match[1])) setRevealNode(result.blockId);
    } else if (result.kind === "project" && result.projectId) {
      await openProject(result.projectId);
    } else if (result.kind === "component" || result.kind === "source") {
      const packageMatch = result.path.match(
        /(?:^|\/)components\/([^/]+)\/([^/]+)\//,
      );
      if (!packageMatch) throw new Error(t("noComponentVersion"));
      const custom = await desktop.invoke<CompiledComponent>("components:get", {
        id: packageMatch[1],
        version: packageMatch[2],
        projectId: result.projectId ?? undefined,
        scope,
      });
      await viewComponent({
        ...custom,
        projectId: result.projectId ?? undefined,
      });
    } else if (result.kind === "template") {
      const packageMatch = result.path.match(
        /(?:^|\/)templates\/([^/]+)\/([^/]+)\//,
      );
      if (!packageMatch) throw new Error(t("noTemplateVersion"));
      const record = await desktop.invoke<LoadedTemplate>("templates:get", {
        id: packageMatch[1],
        version: packageMatch[2],
        projectId: result.projectId ?? undefined,
        scope,
      });
      setDialog({
        type: "template",
        record,
        projectId: result.projectId ?? undefined,
      });
    }
  }

  const contentCreationDisabled =
    !workspaceReady ||
    routing ||
    workspace.switching ||
    busy ||
    !!syncReadOnly ||
    (!!selectedFolder && !currentFolder);
  const carriesFiles = (event: DragEvent) =>
    event.dataTransfer.types.includes("Files");
  // Files dropped on the directory view import like 「添加内容 → 导入文件…」.
  const directoryFileDrop =
    view === "project" && project && !contentCreationDisabled
      ? {
          "data-file-drop": true,
          onDragOver: (event: DragEvent) => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setFileDrop(true);
          },
          onDragLeave: (event: DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setFileDrop(false);
          },
          onDrop: (event: DragEvent) => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            setFileDrop(false);
            void importDroppedFiles([...event.dataTransfer.files]).catch(
              report,
            );
          },
        }
      : {};
  // Stable row handlers let memoized LibraryRows skip unrelated Studio renders.
  const rowHandlers = useRef({
    openTargetClick,
    showMenu,
    toggleProject,
    libraryKeyCommand,
    unpinTarget,
    pageTarget,
  });
  rowHandlers.current = {
    openTargetClick,
    showMenu,
    toggleProject,
    libraryKeyCommand,
    unpinTarget,
    pageTarget,
  };
  const openRecent = useCallback(
    (item: RecentPage, event: ReactMouseEvent<HTMLButtonElement>) =>
      rowHandlers.current.openTargetClick(
        rowHandlers.current.pageTarget(item, item.projectId),
        event,
      ),
    [],
  );
  const showRecentMenu = useCallback(
    (item: RecentPage, anchor: HTMLElement, point?: LibraryMenuPoint) =>
      rowHandlers.current.showMenu(
        rowHandlers.current.pageTarget(item, item.projectId),
        anchor,
        point,
      ),
    [],
  );
  const recentCommand = useCallback(
    (item: RecentPage, command: "rename" | "delete") =>
      rowHandlers.current.libraryKeyCommand(
        rowHandlers.current.pageTarget(item, item.projectId),
        command,
      ),
    [],
  );
  const beginProject = useCallback(() => setDialog({ type: "project" }), []);
  const rowCommand = useCallback<NonNullable<LibraryRowProps["onCommand"]>>(
    (target, command) => rowHandlers.current.libraryKeyCommand(target, command),
    [],
  );
  const unpinRow = useCallback<NonNullable<LibraryRowProps["onUnpin"]>>(
    (target) => rowHandlers.current.unpinTarget(target),
    [],
  );
  const openRow = useCallback<LibraryRowProps["onOpen"]>(
    (target, event) => rowHandlers.current.openTargetClick(target, event),
    [],
  );
  const showRowMenu = useCallback<LibraryRowProps["onMenu"]>(
    (target, anchor, point) =>
      rowHandlers.current.showMenu(target, anchor, point),
    [],
  );
  const rowToggles = useRef(new Map<string, () => void>());
  const rowToggle = (kind: "project" | "folder", id: string) => {
    const key = `${kind}:${id}`;
    let toggle = rowToggles.current.get(key);
    if (!toggle) {
      toggle =
        kind === "project"
          ? () => void rowHandlers.current.toggleProject(id).catch(report)
          : () =>
              setExpandedFolders((current) => ({
                ...current,
                [id]: !current[id],
              }));
      rowToggles.current.set(key, toggle);
    }
    return toggle;
  };
  const welcomeView = (
    <Welcome
      info={info}
      samples={sampleProjectId ? sampleProject.samples : null}
      preparing={sampleProject.preparing}
      onOpenSample={(projectId, pageId, event) => {
        const item = contents[projectId]?.pages.find(
          (entry) => entry.id === pageId,
        );
        openTargetClick(
          item
            ? pageTarget(item, projectId)
            : {
                kind: "page",
                projectId,
                id: pageId,
                title: tc("untitled"),
                pinned: false,
                parentId: null,
              },
          event,
        );
      }}
      onOpenAgentSettings={() => {
        setSettingsSection("agent");
        void navigate("settings").catch(report);
      }}
      onStartPrompt={
        sampleProjectId
          ? async (text) => {
              // Only the built-in Agent can take it: write it on a new page of the sample project.
              const pageId = await createPage("blank", undefined, "page", {
                projectId: sampleProjectId,
                parentId: null,
              });
              if (!pageId) return;
              setAssistantPrefill({ key: crypto.randomUUID(), pageId, text });
              changeAssistantOpen(true);
            }
          : undefined
      }
      onOpenPluginSettings={() => {
        setSettingsSection("plugins");
        void navigate("settings").catch(report);
      }}
      onCreateProject={() => setDialog({ type: "project" })}
    />
  );
  const sidebarNavigation = (
    <SidebarNavigation
      current={
        view === "projects"
          ? "recent"
          : view === "templates" ||
              view === "components" ||
              view === "settings"
            ? view
            : null
      }
      onSelect={(section) =>
        void navigate(section === "recent" ? "projects" : section).catch(report)
      }
    />
  );

  const sidebarContent = (
    <LibraryDragContext.Provider value={libraryDrag.bindings}>
      {(view === "templates" ||
        view === "components" ||
        view === "settings") && (
        <button
          className="studio-sidebar-back"
          aria-label={tn("backToPrevious")}
          title={tn("backToPrevious")}
          disabled={routing || workspace.switching}
          onClick={action(leaveDetour)}
        >
          <ArrowLeft size={17} strokeWidth={1.7} aria-hidden="true" />
          <span>{tc("back")}</span>
        </button>
      )}
      {view === "settings" ? (
        <SettingsNavigation
          section={settingsSection}
          onSelect={setSettingsSection}
          platform={info?.platform}
        />
      ) : view === "templates" ? (
        <TemplateNavigation
          templates={catalogTemplates}
          active={templateType}
          onSelect={(type) => {
            setTemplateType(type);
            catalogScrollRef.current?.scrollTo({ top: 0 });
          }}
        />
      ) : view === "components" ? (
        <ComponentNavigation
          groups={componentGroups}
          active={componentCategory}
          onSelect={(category) => {
            setComponentCategory(category);
            catalogScrollRef.current?.scrollTo({ top: 0 });
          }}
        />
      ) : (
        <ProjectSidebar
          projects={projects}
          organization={organization}
          selectedProject={selectedProject}
          collapsed={collapsedSections}
          setCollapsed={setCollapsedSections}
          onCreate={(groupId) => setDialog({ type: "project", groupId })}
          onNew={(anchor) =>
            setNewMenu((current) => (current === anchor ? null : anchor))
          }
          onMenu={(anchor) =>
            setProjectsMenu((current) => (current === anchor ? null : anchor))
          }
          onManage={openProjectManagement}
          onGroupMenu={(group, anchor) => setGroupMenu({ group, anchor })}
          unreadable={unreadableProjects.map((item) => (
            <button
              key={item.directory}
              type="button"
              className="studio-unreadable-project"
              title={item.message}
              onClick={() => {
                setDismissedUnreadable((current) =>
                  current.filter((directory) => directory !== item.directory),
                );
                requestAnimationFrame(() =>
                  document
                    .getElementById(`unreadable-${item.directory}`)
                    ?.focus(),
                );
              }}
            >
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{t("unreadableProject", { name: item.directory })}</span>
            </button>
          ))}
          docs={
            showDocs ? (
              <DocsNavigation
                activeId={view === "docs" ? (docPage?.id ?? null) : null}
                onOpen={(id, event) => {
                  event.preventDefault();
                  void openDoc(
                    id,
                    "",
                    clickDisposition(event, info?.platform === "darwin"),
                  ).catch(report);
                }}
              />
            ) : undefined
          }
          renderProject={(item) => (
            <div key={item.id}>
              <LibraryRow
                target={projectTarget(item)}
                marker={projectSyncMarker(item.id)}
                cloud={syncOverview.bindings.has(item.id)}
                active={
                  selectedProject === item.id &&
                  view === "project" &&
                  !selectedFolder
                }
                expanded={!!expandedProjects[item.id]}
                onToggle={rowToggle("project", item.id)}
                onOpen={openRow}
                onMenu={showRowMenu}
                onCommand={rowCommand}
                onUnpin={unpinRow}
              />
              {expandedProjects[item.id] && (
                <div className="studio-tree-children">
                  {renderChildren(item.id)}
                </div>
              )}
            </div>
          )}
        />
      )}
      {sidebarNavigation}
    </LibraryDragContext.Provider>
  );
  const topbar = (
    <div className="studio-topbar">
      {navigationUpdating && (
        <span className="studio-navigation-updating" role="status">
          {t("updatingProjects")}
        </span>
      )}
      {syncOverview.unavailable && (
        <span
          className="studio-navigation-updating studio-sync-unavailable"
          role="status"
          title={ts("marker.statusUnavailableDetail", {
            count: syncOverview.failures,
            error: syncOverview.lastError,
          })}
        >
          {ts("marker.statusUnavailable")}
        </span>
      )}
      {view === "settings" ||
      view === "projects" ||
      view === "templates" ||
      view === "components" ? (
        <h1 className="studio-topbar-title">
          {view === "projects" ? (
            <History size={17} aria-hidden="true" />
          ) : view === "templates" ? (
            <LayoutTemplate size={17} aria-hidden="true" />
          ) : view === "components" ? (
            <Blocks size={17} aria-hidden="true" />
          ) : (
            <Settings2 size={17} aria-hidden="true" />
          )}
          <span>{heading}</span>
        </h1>
      ) : (
        <div className="studio-breadcrumb">
          {selectedProject && (
            <button
              onClick={(event) =>
                project && openTargetClick(projectTarget(project), event)
              }
            >
              <ProjectIcon
                value={project?.icon}
                size={17}
                cloud={syncOverview.bindings.has(selectedProject)}
              />
              <span>{project?.name ?? t("heading.project")}</span>
              {selectedMarker && (
                <span
                  className={`studio-tree-marker is-${selectedMarker.tone}`}
                  title={selectedMarker.title}
                >
                  {selectedMarker.label}
                </span>
              )}
            </button>
          )}
          {breadcrumbFolders.map((item) => (
            <span className="studio-breadcrumb-folder" key={item.id}>
              <ChevronRight size={13} />
              <button
                onClick={(event) =>
                  openTargetClick(folderTarget(item, selectedProject!), event)
                }
              >
                <PageIcon
                  value={item.icon}
                  size={16}
                  fallback={<Folder size={16} />}
                />
                <span>{item.name}</span>
              </button>
            </span>
          ))}
          {view === "docs" && docMeta && (
            <>
              <button onClick={action(() => openDoc(DOCS_HOME))}>
                <PageIcon value={builtinDocs(locale).icon} size={17} />
                <span>{builtinDocs(locale).name}</span>
              </button>
              {docFolders.map((name) => (
                <span className="studio-breadcrumb-folder" key={name}>
                  <ChevronRight size={13} />
                  <span>{name}</span>
                </span>
              ))}
              <ChevronRight size={13} />
              <PageIcon value={docMeta.icon} size={18} />
              <span className="studio-breadcrumb-current">{docMeta.title}</span>
            </>
          )}
          {view === "page" && (
            <>
              <ChevronRight size={13} />
              <PageIcon value={page.draft?.icon} size={18} />
              <input
                className="studio-page-title-input"
                aria-label={t("pageTitle")}
                disabled={!page.draft}
                readOnly={syncReadOnly ?? page.record?.readOnly}
                placeholder={tc("untitled")}
                value={page.draft?.title ?? ""}
                maxLength={1000}
                onChange={(event) =>
                  page.edit({
                    ...upgradeResource(page.draft!),
                    title: event.target.value.replaceAll("\n", ""),
                  })
                }
              />
              {page.draft && (
                <SaveStatusMark
                  sessions={page.sessions}
                  onShowProblem={() => {
                    if (focusSaveBanner()) return;
                    if (page.conflictId)
                      setDialog({ type: "externalConflict", id: page.conflictId });
                  }}
                />
              )}
            </>
          )}
        </div>
      )}
      {view === "components" && (
        <nav
          ref={componentSourceTabs}
          className="studio-filter-tabs component-source-tabs"
          data-indicator=""
          aria-label={t("componentSource")}
        >
          {(
            [
              ["all", "filter.all"],
              ["builtin", "filter.builtin"],
              ["custom", "filter.custom"],
            ] as const
          ).map(([filter, label]) => (
            <button
              key={filter}
              className={componentFilter === filter ? "active" : ""}
              aria-pressed={componentFilter === filter}
              onClick={() => {
                setComponentFilter(filter);
                setComponentCategory(null);
                catalogScrollRef.current?.scrollTo({
                  top: 0,
                  behavior: "instant",
                });
              }}
            >
              {t(label)}
            </button>
          ))}
        </nav>
      )}

      <div className="studio-header-actions">
        {view === "templates" && (
          <div className="studio-library-toolbar catalog-scope-controls">
            <label>
              {t("catalogProjectLabel")}
              <select
                aria-label={t("catalogProject")}
                value={selectedProject ?? ""}
                onChange={(event) => {
                  const id = event.target.value;
                  void (async () => {
                    await settleOpenPage();
                    selectedRef.current = id || null;
                    setSelectedProject(id || null);
                    setSelectedFolder(null);
                    if (id) await loadProjectContents(id);
                    await loadCatalog();
                  })().catch(report);
                }}
              >
                <option value="">{t("chooseProject")}</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {view === "templates" && (
              <label>
                {t("catalogScopeLabel")}
                <select
                  aria-label={t("catalogScope")}
                  value={catalogScope ?? "all"}
                  onChange={(event) =>
                    setCatalogScope(
                      event.target.value as CatalogReadOptions["scope"],
                    )
                  }
                >
                  <option value="all">{t("filter.all")}</option>
                  <option value="project">{t("scope.project")}</option>
                  <option value="global">{t("scope.global")}</option>
                  <option value="published">{t("scope.published")}</option>
                  <option value="builtin">{t("scope.builtin")}</option>
                </select>
              </label>
            )}
            <label className="catalog-version-toggle">
              <input
                type="checkbox"
                checked={showTemplateVersions}
                onChange={(event) =>
                  setShowTemplateVersions(event.target.checked)
                }
              />
              {t("showAllVersions")}
            </label>
          </div>
        )}
        {(view === "components" || view === "templates") && (
          <label className="catalog-list-search">
            <Search size={16} />
            <input
              aria-label={
                view === "components"
                  ? t("searchComponents")
                  : t("searchTemplates")
              }
              placeholder={
                view === "components"
                  ? t("searchComponents")
                  : t("searchTemplates")
              }
              value={catalogQueries[view]}
              onChange={(event) =>
                setCatalogQueries((current) => ({
                  ...current,
                  [view]: event.target.value,
                }))
              }
            />
          </label>
        )}
        {externalChangesAvailable && externalChangeCount > 0 && (
          <button
            className="studio-icon studio-icon-count"
            aria-label={tn("externalChangesCount", {
              count: externalChangeCount,
            })}
            title={tn("externalChangesCount", { count: externalChangeCount })}
            onClick={() => setDialog({ type: "workspaceConflicts" })}
          >
            <FileDiff size={16} aria-hidden="true" />
            <span className="studio-icon-badge" aria-hidden="true">
              {externalChangeCount > 99 ? "99+" : externalChangeCount}
            </span>
          </button>
        )}
        {(view === "projects" ||
          view === "project" ||
          info?.libraryVersion === 2) &&
          view !== "components" &&
          view !== "templates" && (
            <ExpandableSearch
              key={`${view}:${selectedProject}:${selectedFolder}`}
              label={
                !searchLibrary && view === "projects"
                  ? t("searchRecentPages")
                  : !searchLibrary && view === "project"
                    ? t("searchPages")
                    : t("searchLibrary")
              }
              value={query}
              onChange={setQuery}
            >
              {info?.libraryVersion === 2 && (
                <>
                  {(view === "projects" || view === "project") && (
                    <nav
                      className="studio-search-scopes"
                      aria-label={t("searchScope")}
                    >
                      <button
                        aria-pressed={!searchLibrary}
                        onClick={() => setSearchLibrary(false)}
                      >
                        {view === "projects"
                          ? t("searchScope.recent")
                          : t("searchScope.project")}
                      </button>
                      <button
                        aria-pressed={searchLibrary}
                        onClick={() => setSearchLibrary(true)}
                      >
                        {t("searchScope.library")}
                      </button>
                    </nav>
                  )}
                  {searchLibrary ||
                  (view !== "projects" && view !== "project") ? (
                    <LibrarySearchResults
                      query={query}
                      onOpen={openSearchResult}
                      onMenu={(result, anchor, point) => {
                        const target = searchTarget(result);
                        if (target) showMenu(target, anchor, point);
                      }}
                    />
                  ) : null}
                </>
              )}
            </ExpandableSearch>
          )}
        <div className="studio-section-actions studio-topbar-view-actions">
          {document.documentElement.dataset.native === "ios" && (view === "project" || view === "projects") && (
            <>
              <button className="studio-icon" aria-label={t("libraryUndo")} title={t("libraryUndo")}
                disabled={historyBusy.current || !libraryHistory.current.next(false)}
                onClick={() => void replayLibraryChange(false).catch((error) =>
                  report(error, { action: operation("op.undoLibrary") }),
                )}><Undo2 size={16} /></button>
              <button className="studio-icon" aria-label={t("libraryRedo")} title={t("libraryRedo")}
                disabled={historyBusy.current || !libraryHistory.current.next(true)}
                onClick={() => void replayLibraryChange(true).catch((error) =>
                  report(error, { action: operation("op.redoLibrary") }),
                )}><Redo2 size={16} /></button>
            </>
          )}
          {view === "project" && (
            <button
              className="studio-button"
              disabled={!visibleEntries.length}
              aria-pressed={pageSelection.active}
              onClick={() =>
                pageSelection.active ? pageSelection.clear() : pageSelection.start()
              }
            >
              <Check size={15} />{t("selectPages")}
            </button>
          )}
          {view === "project" && (
            <button
              className="studio-icon"
              aria-label={t("directoryView")}
              title={t("directoryView")}
              aria-haspopup="menu"
              onClick={(event) => setViewMenu(event.currentTarget)}
            >
              {viewIcon(directoryView)}
            </button>
          )}
          {view === "projects" && (
            <button
              className="studio-icon"
              onClick={() => setDialog({ type: "project" })}
              aria-label={t("newProject")}
              title={t("newProject")}
            >
              <Plus size={15} />
            </button>
          )}
          {view === "project" && project && (
            <>
              {capabilities.revealFiles && <button
                className="studio-icon"
                aria-label={t("revealProjectFolder")}
                title={t("revealProjectFolder")}
                onClick={action(() =>
                  desktop.invoke("fs:reveal", {
                    projectId: selectedProject,
                  }),
                )}
              >
                <FolderOpen size={16} />
              </button>}
              <button
                className="studio-icon"
                onClick={() =>
                  void importPage().catch((error) =>
                    report(error, { action: operation("op.importPage") }),
                  )
                }
                aria-label={tc("import")}
                title={tc("import")}
              >
                <Upload size={15} />
              </button>
              {capabilities.exportSite && <button
                ref={exportSiteButton}
                className="studio-icon"
                disabled={!pages.length || busy}
                aria-haspopup="menu"
                onClick={(event) => {
                  const anchor = event.currentTarget;
                  setExportMenu((current) =>
                    current === anchor ? null : anchor,
                  );
                }}
                aria-label={t("exportSite")}
                title={t("exportSite")}
              >
                <ArrowUpRight size={15} />
              </button>}
              <button
                className="studio-icon"
                aria-label={t("folderActions")}
                aria-haspopup="menu"
                onClick={(event) =>
                  showMenu(
                    currentFolder
                      ? folderTarget(currentFolder, project.id)
                      : projectTarget(project),
                    event.currentTarget,
                  )
                }
              >
                <MoreHorizontal size={18} />
              </button>
            </>
          )}
          {view === "components" && (
            <>
              <label className="component-project-picker">
                {t("componentProjectLabel")}
                <select
                  aria-label={t("catalogProject")}
                  value={componentProject}
                  onChange={(event) => {
                    const id = event.target.value;
                    void (async () => {
                      await settleOpenPage();
                      componentProjectRef.current = id;
                      setComponentProject(id);
                      if (id !== "all") {
                        selectedRef.current = id;
                        setSelectedProject(id);
                        setSelectedFolder(null);
                      }
                    })().catch(report);
                  }}
                >
                  <option value="all">{t("allProjects")}</option>
                  {projects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {catalogManager && (
                <ImportComponentAction manager={catalogManager} />
              )}
            </>
          )}
          {view === "templates" && catalogManager && (
            <SaveTemplateAction manager={catalogManager} />
          )}
        </div>
        {view === "page" && page.draft && (
          <>
            <EditorHistoryButtons
              controls={
                editorControls?.documentId === page.draft.id
                  ? editorControls
                  : null
              }
            />
            <CommentsToggle
              documentId={page.draft.id}
              onOpen={() => changeAssistantOpen(false)}
            />
            <button
              className={`studio-icon studio-icon-labeled${assistantOpen ? " is-active" : ""}`}
              aria-pressed={assistantOpen}
              title={ta("panel.toggle")}
              onClick={() => changeAssistantOpen(!assistantOpen)}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>{ta("panel.button")}</span>
            </button>
            <button
              className="studio-icon"
              aria-label={t("pageActions")}
              aria-haspopup="menu"
              onClick={(event) => {
                const target = activePageTarget();
                if (target)
                  showMenu(target, event.currentTarget, undefined, true);
              }}
            >
              <MoreHorizontal size={18} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <ComponentLibraryContext.Provider value={pickerLibrary}>
      <div
        ref={studioRoot}
        className={`studio ${view === "templates" || view === "components" ? "catalog-view" : ""} ${view === "templates" ? "templates-view" : ""} ${view === "components" ? "components-view" : ""}`}
        data-navigation-state={navigationUpdating ? "updating" : "current"}
        data-window-fullscreen={windowFullscreen}
        data-native-titlebar={
          info?.platform === "darwin" && info.mode !== "browser"
            ? "mac"
            : undefined
        }
      >
        {info && info.mode !== "browser" && capabilities.remoteApprovals && (
          <RemoteMcpApprovalDialog />
        )}
        <WorkspaceSwipeNavigation
          rootRef={studioRoot}
          busy={
            workspace.switching ||
            routing ||
            !workspaceReady ||
            !!dialog ||
            !capabilities.tabs
          }
          canBack={workspace.canBack}
          canForward={workspace.canForward}
          locationKey={`${info?.home}:${workspace.activeId}:${JSON.stringify(workspaceEntry.location)}`}
          onStep={(offset) => void workspace.step(offset).catch(report)}
        />
        <AutoHideSidebar
          enabled={view === "page" && !!page.draft}
          compactOverlay={view === "settings" && settingsSection === "sync"}
          mobileBoardKey={
            view === "page" && page.draft?.content.attrs?.kind === "board"
              ? page.draft.id
              : undefined
          }
          onMobileBack={() => {
            if (selectedProject)
              void openProject(selectedProject, selectedFolder).catch(report);
          }}
          interactionHeld={
            !!dialog ||
            libraryDrag.dragging ||
            !!projectsMenu ||
            !!newMenu ||
            !!groupMenu ||
            !!contextMenu?.anchor.closest(".studio-sidebar")
          }
          switchingTab={workspace.switching || routing}
          navigation={sidebarContent}
          canLocate={
            view === "page" &&
            !!page.draft &&
            !routing &&
            !workspace.switching &&
            projects.some((item) => item.id === page.projectId)
          }
          onLocate={() => void locateCurrentPage().catch(report)}
          history={
            <WorkspaceHistory
              busy={
                workspace.switching || routing || !workspaceReady || !!dialog
              }
              canBack={workspace.canBack}
              canForward={workspace.canForward}
              onStep={(offset) => void workspace.step(offset).catch(report)}
            />
          }
          topbar={
            <WorkspaceTabs
              tabs={workspace.tabs}
              activeId={workspace.activeId}
              busy={
                workspace.switching || routing || !workspaceReady || !!dialog
              }
              onSelect={(id) => void workspace.select(id).catch(report)}
              onClose={(id) => void workspace.close(id).catch(report)}
              onAdd={() => void workspace.add().catch(report)}
              onMove={workspace.move}
              shortcutHint={info?.mode !== "browser"}
            />
          }
        >
          <AssistantWorkbench
            enabled={view === "page" && !!page.draft}
            open={assistantOpen}
            onOpenChange={changeAssistantOpen}
            projectId={view === "page" && page.draft ? page.projectId : null}
            pageId={view === "page" ? (page.draft?.id ?? null) : null}
            pageTitle={page.draft?.title}
            flush={page.flush}
            onLocate={locateAssistantTarget}
            onReference={(target) => {
              const projectId = page.projectId;
              if (projectId)
                void copyPageReference(projectId, target).catch(report);
            }}
            onOpenSettings={() => {
              setSettingsSection("agent");
              void navigate("settings").catch(report);
            }}
            prefill={assistantPrefill}
            onPrefillUsed={() => setAssistantPrefill(null)}
            onExported={(path) =>
              setExportReceipt({ message: t("conversationExported"), path })
            }
          >
          <main
            className={`studio-main${recordPeek.view ? " has-record-peek" : ""}`}
            id="studio-tab-panel"
            role="tabpanel"
            aria-labelledby={`workspace-tab-${workspace.activeId}`}
          >
            {topbar}
            {view === "project" && pageSelection.active && (
              <DirectorySelectionBar
                selection={pageSelection}
                total={visibleEntries.length}
                onMove={() => beginBatchPages("move")}
                onDelete={() => beginBatchPages("delete")}
              />
            )}
            <div
              ref={directoryMarquee.overlayRef}
              className="studio-directory-marquee"
              hidden
              aria-hidden="true"
            />
            <NoticeStack>
            {problemQueue.problems.map((entry) => (
              <ProblemNotice
                key={`problem-${entry.id}`}
                data-priority={3}
                problem={entry.problem}
                count={entry.count}
                reportable={entry.problem.code !== "LOCKED"}
                actions={bindProblemActions(entry.problem.actions, {
                  // Repeating the operation replaces this notice.
                  ...Object.fromEntries(
                    Object.entries({ ...entry.handlers, retry: entry.retry })
                      .filter(([, handler]) => handler)
                      .map(([id, handler]) => [
                        id,
                        () => {
                          problemQueue.dismiss(entry.id);
                          handler!();
                        },
                      ]),
                  ),
                  reload: () => window.location.reload(),
                  librarySpace: capabilities.manageLibrary
                    ? () => {
                        setSettingsSection("general");
                        void navigate("settings").catch(report);
                      }
                    : undefined,
                })}
                onDismiss={() => problemQueue.dismiss(entry.id)}
              />
            ))}
            {syncOverview.expired.map((entry) => (
              <div
                key={`expired-${entry.connectionId}`}
                className="studio-conflict"
                role="alert"
                data-priority={3}
              >
                <div>
                  <strong>{ts("loginExpired.title")}</strong>
                  <p>
                    {ts("loginExpired.body", {
                      names: entry.projectIds
                        .map(
                          (id) =>
                            `「${projects.find((item) => item.id === id)?.name ?? id}」`,
                        )
                        .join(""),
                    })}
                  </p>
                </div>
                <button
                  onClick={action(async () => {
                    setSyncRequest({
                      projectId: entry.projectIds[0],
                      intent: "signIn",
                      key: Date.now(),
                    });
                    setSettingsSection("sync");
                    await navigate("settings");
                  })}
                >
                  {ts("loginExpired.action")}
                </button>
              </div>
            ))}
            {(view === "page" || view === "project") &&
              selectedProject &&
              syncReadOnly && (
                <div className="studio-conflict" role="status" data-priority={2}>
                  <p>
                    {ts(
                      syncOverview.bindings.get(selectedProject)?.status ===
                        "revoked"
                        ? "readOnly.revokedBanner"
                        : "readOnly.banner",
                      { name: project?.name ?? "" },
                    )}
                  </p>
                  {view === "page" && page.draft && (
                    <button onClick={runSaveLocalCopy}>
                      {ts("readOnly.copy")}
                    </button>
                  )}
                </div>
              )}
            {unreadableProjects
              .filter((item) => !dismissedUnreadable.includes(item.directory))
              .map((item) => (
                <div
                  key={`unreadable-${item.directory}`}
                  id={`unreadable-${item.directory}`}
                  tabIndex={-1}
                  data-priority={2}
                >
                  <ProblemNotice
                    problem={{
                      ...describeError(item, {
                        action: t("readProject"),
                        object: item.directory,
                      }),
                      title: t("unreadableProject", { name: item.directory }),
                      cause: t("unreadableProjectCause"),
                    }}
                    tone="warning"
                    actions={[
                      {
                        label: revealLabel(info?.platform),
                        onSelect: () =>
                          void desktop
                            .invoke("library:reveal", { path: item.path })
                            .catch(report),
                      },
                    ]}
                    onDismiss={() =>
                      setDismissedUnreadable((current) => [
                        ...current,
                        item.directory,
                      ])
                    }
                  />
                </div>
              ))}
            {page.backgroundIssues
              .filter((issue) => issue.kind === "retire")
              .map((issue) => (
                <div
                  key={`retire-${issue.projectId}:${issue.pageId}`}
                  className="studio-conflict"
                  role="alert"
                  data-priority={3}
                >
                  <div>
                    <strong>{t("retireIssueTitle", { title: issue.title })}</strong>
                    <p>{t("retireIssueBody", { error: issue.error })}</p>
                  </div>
                  <button
                    onClick={action(() =>
                      openPage(issue.pageId, issue.projectId),
                    )}
                  >
                    {t("openPageAgain")}
                  </button>
                </div>
              ))}
            {page.backgroundIssues.some((issue) => issue.kind !== "retire") && (
              <div className="studio-conflict" role="alert" data-priority={3}>
                <p>{t("backgroundSaveIssue")}</p>
                {page.backgroundIssues
                  .filter((issue) => issue.kind !== "retire")
                  .map((issue) => (
                  <button
                    key={`${issue.projectId}:${issue.pageId}`}
                    onClick={action(() =>
                      openPage(issue.pageId, issue.projectId),
                    )}
                  >
                    {t("viewIssue", { title: issue.title })}
                  </button>
                ))}
              </div>
            )}
            {view === "page" && page.draftNotice && !page.error && (
              <div className="studio-conflict" role="status" data-priority={1}>
                <p>{page.draftNotice}</p>
              </div>
            )}
            {view === "page" &&
              !!page.record?.retainedSyncConflicts?.length && (
                <div className="studio-conflict" role="status" data-priority={2}>
                  <p>{t("retainedSyncConflict")}</p>
                  {page.record.retainedSyncConflicts
                    .flatMap((item) => item.variants)
                    .filter((variant) => variant.pageId !== page.draft?.id)
                    .map((variant) => (
                      <button
                        key={variant.pageId}
                        onClick={action(() => openPage(variant.pageId))}
                      >
                        {t("viewOtherVariant", {
                          account: variant.source.account,
                          device: variant.source.deviceId.slice(0, 8),
                        })}
                      </button>
                    ))}
                </div>
              )}
            {view === "page" && page.error && page.status !== "conflict" && (
              <SaveFailureBanner
                data-priority={4}
                state={{
                  error: page.error,
                  failure: page.failure,
                  dirty: page.dirty,
                  draftDurable: page.draftDurable,
                  title: page.draft?.title,
                }}
                platform={info?.platform}
                onRetry={action(page.retry)}
                onKeepCopy={action(keepDraftAsCopy)}
                onLibrarySpace={
                  capabilities.manageLibrary
                    ? () => {
                        setSettingsSection("general");
                        void navigate("settings").catch(report);
                      }
                    : undefined
                }
                onReveal={(path) =>
                  void desktop.invoke("library:reveal", { path }).catch(report)
                }
                onLocateLargest={() => {
                  const id = largestBlock(page.draft?.content);
                  if (id && page.draft) void locateAssistantTarget(page.draft.id, [id]);
                }}
                // Without unsaved edits, loading the file loses nothing.
                onDiscard={
                  page.dirty
                    ? () => setDialog({ type: "discardDraft" })
                    : action(page.acceptResolution)
                }
              />
            )}
            {view === "page" && page.error && page.status === "conflict" && (
              <div
                className="studio-conflict studio-save-conflict"
                role="alert"
                tabIndex={-1}
                data-priority={4}
              >
                <div>
                  <strong>{t("saveConflictTitle")}</strong>
                  <p>{page.error}</p>
                </div>
                <>
                    {page.reviewingConflict && (
                      <button onClick={action(page.retry)}>
                        {t("saveAgain")}
                      </button>
                    )}
                    {page.conflictId ? (
                      <button
                        onClick={action(async () => {
                          await page.retainDraft();
                          setDialog({
                            type: "externalConflict",
                            id: page.conflictId!,
                          });
                        })}
                      >
                        {t("resolveExternal")}
                      </button>
                    ) : page.mergeBase && page.draft && selectedProject ? (
                      <button
                        onClick={action(async () => {
                          await page.retainDraft();
                          setDialog({
                            type: "merge",
                            projectId: selectedProject,
                            document: structuredClone(page.draft!),
                            baseRevision: page.mergeBase!,
                          });
                        })}
                      >
                        {t("compareAndMerge")}
                      </button>
                    ) : (
                      <button onClick={action(keepDraftAsCopy)}>
                        {t("keepAsCopy")}
                      </button>
                    )}
                    <button
                      className="is-destructive"
                      onClick={() => setDialog({ type: "discardDraft" })}
                    >
                      {t("discardAndLoad")}
                    </button>
                </>
              </div>
            )}
            {view === "page" && !!page.availableDrafts.length && (
              <div className="studio-conflict" role="status" data-priority={2}>
                <p>{t("draftsAvailable")}</p>
                {page.availableDrafts.map((item) => (
                  <button
                    key={item.id}
                    onClick={action(() => page.recoverDraft(item.id))}
                  >
                    {t("restoreDraft", {
                        time: new Date(item.savedAt).toLocaleString(
                          getLocale(),
                        ),
                    })}
                  </button>
                ))}
              </div>
            )}
            </NoticeStack>
            {externalChange && (
              <ExternalChangeNotice
                key={`external-${externalChange.id}`}
                change={externalChange}
                onLocate={() =>
                  locateBlocks(catalogScrollRef.current, externalChange.blockIds)
                }
                onUndo={action(async () => {
                  const name = authorName(externalChange.author);
                  const outcome = await page.undoExternalChange();
                  if (outcome === "merged")
                    setNotice(tps("external.undone", { name }), {
                      kind: "success",
                    });
                  else if (outcome === "conflict")
                    setNotice(tps("external.undoConflict"), { kind: "warning" });
                })}
                onDismiss={action(page.dismissExternalChange)}
              />
            )}
            {find.request && findKey && (
              <div className="find-bar-anchor">
                <FindBar
                  key={findKey}
                  request={find.request}
                  page={findPage}
                  readOnly={
                    view === "docs" ||
                    !!syncReadOnly ||
                    !!page.record?.readOnly
                  }
                  onClose={find.close}
                  onReveal={setRevealNode}
                />
              </div>
            )}
            <div
              ref={catalogScrollRef}
              tabIndex={view === "project" ? -1 : undefined}
              onKeyDown={(event) => {
                if (
                  view !== "project" || dialog ||
                  (event.target as HTMLElement).closest(
                    "input,textarea,[contenteditable=true]",
                  )
                ) return;
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === "a"
                ) {
                  event.preventDefault();
                  pageSelection.selectAll();
                } else if (
                  pageSelection.ids.length &&
                  isDeleteShortcut(event, clientIsMac())
                ) {
                  event.preventDefault();
                  beginBatchPages("delete");
                }
              }}
              onPointerDown={directoryMarquee.onPointerDown}
              onClickCapture={directoryMarquee.onClickCapture}
              className={`studio-scroll${(view === "page" && page.draft) || (view === "docs" && docPage && docPage.id !== WELCOME_DOC) ? " has-page-surface" : ""}`}
                onContextMenu={(event) => {
                  if (event.defaultPrevented || view !== "project" || !project)
                    return;
                  if ((event.target as HTMLElement).closest("button,input,a"))
                    return;
                  event.preventDefault();
                  showMenu(
                    currentFolder
                      ? folderTarget(currentFolder, project.id)
                      : projectTarget(project),
                    event.currentTarget,
                    { x: event.clientX, y: event.clientY },
                    false,
                    false,
                    pageSelection.ids.length > 0,
                  );
                }}
            >
              <PageWorkspace
                sessions={page.sessions}
                visible={view === "page" && !!page.draft}
                readOnly={syncReadOnly}
                revealId={revealNode}
                onControlsChange={setEditorControls}
                onActiveSurfaceChange={handleActiveSurfaceChange}
                onRevealHandled={handleRevealHandled}
                linkablePages={contents}
                onCopyLink={(target) => void copyPageLink(target).catch(report)}
                onCreateLinkedPage={createLinkedPage}
                onRenameLinkedPage={renameLinkedPage}
                onOpenRecord={recordPeek.open}
                onCloseRecord={recordPeek.closeSource}
                recordPeek={recordPeek.state}
                onEditIcon={action(async () => {
                  const target = activePageTarget();
                  if (target) await beginPageIcon(target);
                })}
              />
              {loading && (
                <div className="studio-loading">
                  <Loader2 size={24} className="studio-spin" />
                </div>
              )}
              {view === "settings" ? (
                <SettingsPanel
                  key={syncNavigationKey}
                  section={settingsSection}
                    syncRequest={syncRequest}
                    onOpenProject={async (id) => {
                      await refreshProjects([id], { sidebar: true });
                      await openProject(id);
                    }}
                  info={info}
                  appearance={appearance.preference}
                  theme={appearance.theme}
                  onAppearanceChange={appearance.setPreference}
                  onMigrate={() => setDialog({ type: "migration" })}
                  onOpenShortcuts={() => setDialog({ type: "shortcuts" })}
                  feedbackRequest={feedbackRequest}
                  onOpenDocs={() => void helpDoc("").catch(report)}
                  onOpenFaq={() =>
                    void helpDoc("agent-troubleshooting").catch(report)
                  }
                  onChooseHome={action(async () => {
                    if (!(await page.prepareClose())) return;
                    const next = await desktop.invoke<DesktopInfo | null>(
                      "settings:chooseHome",
                    );
                    if (next) {
                      await page.clear();
                      setInfo(next);
                      setSelectedProject(null);
                      selectedRef.current = null;
                      setSelectedFolder(null);
                      setContents({});
                      setExpandedProjects({});
                      setExpandedFolders({});
                      await refresh();
                      await loadCatalog();
                      setNotice(t("librarySwitched"));
                    }
                  })}
                  onCopyHome={action(async () => {
                    if (!info) return;
                    await desktop.invoke("clipboard:write", {
                      text: info.home,
                    });
                    setNotice(t("libraryPathCopied"));
                  })}
                  onCopyConfig={action(async () => {
                    if (!info) return;
                    await desktop.invoke("clipboard:write", {
                      text: JSON.stringify(info.cli, null, 2),
                    });
                    setNotice(t("launchConfigCopied"));
                  })}
                />
              ) : view === "docs" && docPage ? (
                docPage.id === WELCOME_DOC ? (
                  <div className="studio-library">{welcomeView}</div>
                ) : (
                  <BuiltinDocPage
                    id={docPage.id}
                    hash={docPage.hash}
                    onOpenDoc={(id, hash, newTab) =>
                      void openDoc(id, hash, newTab ? "tab" : "current").catch(
                        report,
                      )
                    }
                  />
                )
              ) : view === "page" && page.draft ? null : (
                <div
                  className={`studio-library${view === "components" ? " studio-component-library" : ""}`}
                  {...directoryFileDrop}
                >
                  {fileDrop && view === "project" && project && (
                    <div className="studio-file-drop" role="status">
                      {t("dropImport", {
                        title: currentFolder?.name ?? project.name,
                      })}
                    </div>
                  )}
                  {view === "projects" && (
                    <RecentPages
                      pages={recent}
                      query={deferredQuery}
                      onOpen={openRecent}
                      onMenu={showRecentMenu}
                      onCommand={recentCommand}
                      onCreateProject={beginProject}
                      welcome={
                        !workspaceReady
                          ? recentLoading
                          : welcoming && !showDocs
                            ? welcomeView
                            : undefined
                      }
                    />
                  )}
                  {view === "project" && (
                    <>
                      {visibleEntries.length || !deferredQuery ? (
                          <div
                            className="studio-page-list"
                            data-view={directoryView}
                            data-selecting={pageSelection.active || undefined}
                          >
                          {visibleEntries.map(({ target, updatedAt, hash }) => (
                            <div
                              key={target.id}
                                {...(!pageSelection.active ? libraryDrag.bindings.row(target, false) : {})}
                                data-library-id={target.id}
                                data-selectable
                              className={`studio-page-list-row${pageSelection.ids.includes(target.id) ? " selected" : ""}`}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                const anchor =
                                  event.currentTarget.querySelector<HTMLElement>(
                                    ".studio-row-menu",
                                  );
                                if (anchor)
                                  showMenu(
                                    target,
                                    anchor,
                                    { x: event.clientX, y: event.clientY },
                                    false,
                                    false,
                                    pageSelection.ids.includes(target.id),
                                  );
                              }}
                              onKeyDown={(event) => {
                                const deleting = isDeleteShortcut(
                                  event,
                                  clientIsMac(),
                                );
                                if (deleting && pageSelection.ids.length) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  beginBatchPages("delete");
                                  return;
                                }
                                if (event.key === "F2" || deleting) {
                                  event.preventDefault();
                                  libraryKeyCommand(
                                    target,
                                    event.key === "F2" ? "rename" : "delete",
                                  );
                                  return;
                                }
                                if (
                                  event.key !== "ContextMenu" &&
                                  !(event.shiftKey && event.key === "F10")
                                )
                                  return;
                                event.preventDefault();
                                const anchor =
                                  event.currentTarget.querySelector<HTMLElement>(
                                    ".studio-row-menu",
                                  );
                                if (anchor) showMenu(target, anchor);
                              }}
                            >
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={pageSelection.ids.includes(target.id)}
                                aria-label={t("selectPage", { title: target.title })}
                                className="studio-page-checkbox"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => pageSelection.toggle(target.id, event.shiftKey)}
                              >
                                <Check size={12} strokeWidth={3} />
                              </button>
                                {directoryView !== "list" &&
                                  (target.kind === "page" ? (
                                    <PageThumbnail
                                      projectId={target.projectId}
                                      pageId={target.id}
                                      updatedAt={updatedAt}
                                      hash={hash}
                                    />
                                  ) : (
                                    <FolderThumbnail
                                      projectId={target.projectId}
                                      entries={folderThumbnailEntries(target.id)}
                                    />
                                  ))}
                              <button
                                className="studio-page-list-open"
                                data-open-page={
                                  target.kind === "page" ? target.id : undefined
                                }
                                data-open-project={
                                  target.kind === "page"
                                    ? target.projectId
                                    : undefined
                                }
                                onClick={(event) => {
                                  if (pageSelection.active)
                                    pageSelection.toggle(target.id, event.shiftKey);
                                  else openTargetClick(target, event);
                                }}
                                onAuxClick={(event) => {
                                  if (event.button === 1)
                                    openTargetClick(target, event);
                                }}
                              >
                                  {directoryView !== "list" && (
                                    <span className="studio-thumbnail-space" />
                                  )}
                                <span className="studio-page-list-icon">
                                  {target.kind === "folder" ? (
                                    <PageIcon
                                      value={target.icon}
                                      size={19}
                                      fallback={<Folder size={19} />}
                                    />
                                  ) : (
                                    <PageIcon
                                      value={
                                        target.kind === "page"
                                          ? target.icon
                                          : ""
                                      }
                                      size={19}
                                    />
                                  )}
                                </span>
                                <strong>{target.title}</strong>
                                {target.pinned && (
                                  <Pin size={12} aria-label={t("pinned")} />
                                )}
                                <time>{shortDate(updatedAt)}</time>
                              </button>
                              <button
                                className="studio-icon studio-row-menu"
                                aria-label={t("itemActions", {
                                  title: target.title,
                                })}
                                aria-haspopup="menu"
                                onClick={(event) =>
                                  showMenu(target, event.currentTarget)
                                }
                              >
                                <MoreHorizontal size={17} />
                              </button>
                            </div>
                          ))}
                          {!deferredQuery && !pageSelection.active && (
                            <div className="studio-page-list-row studio-page-list-add">
                              <button
                                type="button"
                                className="studio-page-list-open"
                                aria-label={t("addContentHint")}
                                aria-haspopup="menu"
                                title={t("addContentHint")}
                                disabled={contentCreationDisabled}
                                onClick={(event) =>
                                  showDirectoryCreationMenu(
                                    event.currentTarget,
                                    event.detail
                                      ? { x: event.clientX, y: event.clientY }
                                      : undefined,
                                  )
                                }
                              >
                                <Plus
                                  size={directoryView === "list" ? 18 : 28}
                                  strokeWidth={1.5}
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                      {!visibleEntries.length && (
                        <div className="studio-empty">
                          <FilePlus2 size={30} strokeWidth={1.2} />
                          <h2>
                            {deferredQuery
                              ? t("noMatchingContent")
                              : currentFolder
                                ? t("folderEmpty")
                                : t("projectEmpty")}
                          </h2>
                          {!deferredQuery && <p>{t("emptyHint")}</p>}
                          {!deferredQuery && project && (
                            <div
                              className="studio-empty-actions"
                              role="group"
                              aria-label={tn("emptyActions")}
                            >
                              <button
                                type="button"
                                className="studio-button"
                                disabled={contentCreationDisabled}
                                onClick={action(() =>
                                  createPage("blank", undefined, "page", {
                                    projectId: project.id,
                                    parentId: selectedFolder,
                                  }, true),
                                )}
                              >
                                <FileText size={15} aria-hidden="true" />
                                {tn("newPage")}
                              </button>
                              <button
                                type="button"
                                className="studio-button primary"
                                disabled={contentCreationDisabled}
                                onClick={action(() =>
                                  createPageForAgent({
                                    projectId: project.id,
                                    parentId: selectedFolder,
                                  }),
                                )}
                              >
                                <Sparkles size={15} aria-hidden="true" />
                                {tn("newPageForAgent")}
                              </button>
                              <button
                                type="button"
                                className="studio-button"
                                disabled={contentCreationDisabled}
                                onClick={action(() =>
                                  beginNewPage(project.id, selectedFolder),
                                )}
                              >
                                <LayoutTemplate size={15} aria-hidden="true" />
                                {tn("newFromTemplate")}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {view === "templates" && (
                    <>
                      <div className="studio-template-grid">
                        {visibleTemplates.map((item) => (
                          <button
                            className="studio-template-card studio-template-open"
                            key={`${item.scope}:${item.id}:${item.version}:${item.integrity}`}
                            aria-label={t("viewTemplate", {
                              name: item.name,
                              version: item.version,
                              scope: item.scope,
                            })}
                            aria-haspopup="dialog"
                            onClick={action(async () => {
                              const record =
                                await desktop.invoke<LoadedTemplate>(
                                  "templates:get",
                                  {
                                    id: item.id,
                                    version: item.version,
                                    scope: item.scope,
                                    integrity: item.integrity,
                                    ...(selectedProject
                                      ? { projectId: selectedProject }
                                      : {}),
                                  },
                                );
                              setDialog({
                                type: "template",
                                record,
                              });
                            })}
                          >
                            <TemplateThumbnail
                              item={item}
                              projectId={selectedProject ?? undefined}
                            />
                            <h2>{item.name}</h2>
                            <p>{item.description}</p>
                            <div className="template-card-metadata">
                              <Scope value={item.scope} />
                              <span>v{item.version}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {!visibleTemplates.length && (
                        <div className="studio-empty">
                          <LayoutTemplate size={30} strokeWidth={1.2} />
                          <h2>
                            {catalogQueries.templates
                              ? t("noMatchingTemplates")
                              : t("noTemplates")}
                          </h2>
                        </div>
                      )}
                    </>
                  )}
                  {view === "components" && (
                    <ComponentCatalog
                      groups={componentGroups}
                      loading={catalogLoading}
                      browser={
                        !!info && "mode" in info && info.mode === "browser"
                      }
                      showProjectNames={componentProject === "all"}
                      query={catalogQueries.components}
                      category={componentCategory}
                        onOpen={(item) =>
                          void viewComponent(item).catch(report)
                        }
                    />
                  )}
                </div>
              )}
            </div>
            {recordPeek.view && <DatabaseRecordPeek
              peek={recordPeek}
              sessions={page.sessions}
              linkablePages={contents}
              readOnly={syncOverview.markers.get(recordPeek.request?.projectId ?? "") === "readOnly"}
              report={report}
              onCopyLink={(target) => void copyPageLink(target).catch(report)}
              onCreateLinkedPage={createLinkedPage}
              onRenameLinkedPage={renameLinkedPage}
              onEditIcon={action(async () => {
                const request = recordPeek.request;
                const draft = recordPeek.view?.session.getSnapshot().draft;
                if (!request || !draft) return;
                await beginPageIcon({ kind: "page", projectId: request.projectId, id: draft.id,
                  title: draft.title, icon: draft.icon, pinned: !!draft.favorite, parentId: draft.parentId ?? null });
              })}
            />}
          </main>
          <CommentsPanel
            documentId={view === "page" ? (page.draft?.id ?? null) : null}
            assistantOpen={assistantOpen}
          />
          </AssistantWorkbench>
        </AutoHideSidebar>
        <AppUpdateNotice
          state={appUpdate.state}
          run={appUpdate.run}
          hidden={view === "settings" && settingsSection === "about"}
        />
        <PluginUpdateNotice
          home={
            info && info.mode !== "browser" && capabilities.localPlugins
              ? info.home
              : null
          }
          // Settings → Plugins and the welcome list the same hosts with their own actions.
          // A downloaded App update brings its own plugin, so it is offered after the restart.
          hidden={
            appUpdate.state?.phase === "ready" ||
            (view === "settings" && (settingsSection === "plugins" || settingsSection === "remote")) ||
            (view === "docs" && docPage?.id === WELCOME_DOC) ||
            (view === "projects" && workspaceReady && welcoming && !showDocs)
          }
          onOpenSettings={() => {
            setSettingsSection("plugins");
            void navigate("settings").catch(report);
          }}
        />
        <ToastViewport toasts={toasts.toasts} onDismiss={toasts.dismiss} />
        {exportReceipt && (
          <div className="studio-toast studio-export-receipt" role="status">
            <Check size={14} />
            <span className="studio-export-receipt-text">
              <span>{exportReceipt.message}</span>
              <code title={exportReceipt.path}>{exportReceipt.path}</code>
            </span>
            {capabilities.revealFiles && (
              <button
                type="button"
                onClick={action(async () => {
                  await desktop.invoke("export:reveal", {
                    path: exportReceipt.path,
                  });
                  setExportReceipt(null);
                })}
              >
                {revealLabel(info?.platform)}
              </button>
            )}
            <button
              type="button"
              className="studio-export-receipt-close"
              aria-label={tc("close")}
              onClick={() => setExportReceipt(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {pageExportMenu && (exportTarget || (view === "page" && page.draft)) && (
          <LibraryContextMenu
            anchor={pageExportMenu}
            label={t("exportMenuLabel")}
            onClose={() => {
              setPageExportMenu(null);
              setExportTarget(null);
            }}
            items={pageExportMenuItems(exportTarget ?? activePageTarget())}
          />
        )}
        {capabilities.exportSite && exportMenu && (
          <LibraryContextMenu
            anchor={exportMenu}
            label={t("siteExportMode")}
            onClose={() => setExportMenu(null)}
            items={[
              {
                label: t("exportOffline"),
                icon: <Package size={15} />,
                onSelect: () => void exportSite("bundled"),
              },
              {
                label: t("exportOnline"),
                icon: <Globe size={15} />,
                onSelect: () => void exportSite("remote"),
              },
            ]}
          />
        )}
        {projectsMenu && (
          <LibraryContextMenu
            anchor={projectsMenu}
            label={t("projectListActions")}
            onClose={() => setProjectsMenu(null)}
            items={[
              {
                label: accountFlow("projects.title"),
                icon: <FolderOpen size={15} />,
                onSelect: openProjectManagement,
              },
              {
                label: t("newProject"),
                icon: <FolderPlus size={15} />,
                onSelect: () => setDialog({ type: "project" }),
              },
              {
                label: t("newGroup"),
                icon: <FolderPlus size={15} />,
                onSelect: () => setDialog({ type: "group" }),
              },
              {
                label: tn("deletedItems"),
                icon: <ArchiveRestore size={15} />,
                separatorBefore: true,
                onSelect: () => setDialog({ type: "deletedItems" }),
              },
              {
                label: tn("hiddenProjects"),
                icon: <EyeOff size={15} />,
                onSelect: () => setDialog({ type: "hiddenProjects" }),
              },
              ...(externalChangesAvailable
                ? [
                    {
                      label: externalChangeCount
                        ? tn("externalChangesCount", {
                            count: externalChangeCount,
                          })
                        : tn("externalChanges"),
                      icon: <FileDiff size={15} />,
                      onSelect: () => setDialog({ type: "workspaceConflicts" }),
                    },
                  ]
                : []),
              {
                label: tn("keyboardShortcuts"),
                icon: <Keyboard size={15} />,
                onSelect: () => setDialog({ type: "shortcuts" }),
              },
              {
                label: tfeedback("helpAndFeedback"),
                icon: <LifeBuoy size={15} />,
                onSelect: () => openFeedback.current("about"),
              },
            ]}
          />
        )}
        {newMenu && (
          <LibraryContextMenu
            anchor={newMenu}
            label={tn("newMenu")}
            onClose={() => setNewMenu(null)}
            items={newMenuItems()}
          />
        )}
        {groupMenu && (
          <LibraryContextMenu
            anchor={groupMenu.anchor}
            label={t("groupActions", { name: groupMenu.group.name })}
            onClose={() => setGroupMenu(null)}
            items={[
              {
                label: t("newProject"),
                icon: <Plus size={15} />,
                onSelect: () =>
                  setDialog({ type: "project", groupId: groupMenu.group.id }),
              },
              {
                label: t("renameGroup"),
                icon: <Pencil size={15} />,
                onSelect: () =>
                  setDialog({ type: "group", group: groupMenu.group }),
              },
              {
                label: t("removeGroup"),
                icon: <Trash2 size={15} />,
                separatorBefore: true,
                onSelect: action(async () => {
                  await desktop.invoke("groups:remove", {
                    groupId: groupMenu.group.id,
                  });
                  await refreshProjects([], { sidebar: true });
                  setNotice(t("groupRemoved"));
                }),
              },
            ]}
          />
        )}
        {viewMenu && (
          <LibraryContextMenu
            anchor={viewMenu}
            label={t("directoryView")}
            onClose={() => setViewMenu(null)}
            items={viewOptions.map((mode) => ({
              label: t(`view.${mode}`),
              icon: viewIcon(mode),
              checked: directoryView === mode,
              onSelect: () => chooseDirectoryView(mode),
            }))}
          />
        )}
        {contextMenu && (
          <LibraryContextMenu
            anchor={contextMenu.anchor}
            portalRoot={
              contextMenu.anchor.closest<HTMLElement>(".expandable-search") ??
              undefined
            }
            point={contextMenu.point}
            label={
              contextMenu.selection
                ? t("pageSelectionActions")
                : contextMenu.creationOnly
                  ? t("addContent")
                  : t("itemActions", { title: contextMenu.target.title })
            }
            onClose={() => setContextMenu(null)}
            items={
              contextMenu.selection
                ? [
                    {
                      label: t("move"),
                      icon: <Folder size={15} />,
                      onSelect: () => beginBatchPages("move"),
                    },
                    {
                      label: tc("delete"),
                      icon: <Trash2 size={15} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => beginBatchPages("delete"),
                    },
                  ]
                : contextMenu.creationOnly
                ? creationMenuItems(contextMenu.target)
                : [
                    ...(capabilities.tabs && !contextMenu.pageTools ? [
                    {
                      label: t("openInNewTab"),
                      icon: <PanelsTopLeft size={15} />,
                      shortcut:
                        info?.platform === "darwin"
                          ? t("cmdClick")
                          : t("ctrlClick"),
                      disabled:
                        !workspaceReady || routing || workspace.switching,
                      onSelect: action(() =>
                        openTarget(contextMenu.target, "tab"),
                      ),
                    },
                    ] : []),
                    ...(capabilities.windows ? [
                    {
                      label: t("openInNewWindow"),
                      icon: <AppWindow size={15} />,
                      shortcut: t("shiftClick"),
                      disabled:
                        !workspaceReady || routing || workspace.switching,
                      onSelect: action(() =>
                        openTarget(contextMenu.target, "window"),
                      ),
                    },
                    ] : []),
                    ...(contextMenu.target.kind === "page"
                      ? [
                          {
                            // Like copying a link, for Agents outside ShowAI.
                            label: tc("copyReference"),
                            icon: <AtSign size={15} />,
                            onSelect: action(() =>
                              copyPageReference(contextMenu.target.projectId, {
                                kind: "page",
                                pageId: contextMenu.target.id,
                              }),
                            ),
                          },
                          {
                            label: tc("copyLink"),
                            icon: <Link2 size={15} />,
                            onSelect: action(() =>
                              copyPageLink({
                                projectId: contextMenu.target.projectId,
                                pageId: contextMenu.target.id,
                                blockIds: [],
                              }),
                            ),
                          },
                        ]
                      : []),
                    {
                      label: tc("rename"),
                      separatorBefore: true,
                      icon: <Pencil size={15} />,
                      shortcut: "F2",
                      onSelect: () => beginRename(contextMenu.target),
                    },
                    ...(contextMenu.target.kind === "page"
                      ? [
                          {
                            label: t("setIcon"),
                            icon: <FileText size={15} />,
                            onSelect:
                              contextMenu.pageTools &&
                              editorControls?.documentId ===
                                contextMenu.target.id &&
                              !editorControls.nested
                                ? editorControls.setIcon
                                : action(() =>
                                    beginPageIcon(contextMenu.target),
                                  ),
                          },
                        ]
                      : []),
                    {
                      label: contextMenu.target.pinned ? t("unpin") : t("pin"),
                      icon: contextMenu.target.pinned ? (
                        <PinOff size={15} />
                      ) : (
                        <Pin size={15} />
                      ),
                      onSelect: action(() =>
                        updateTarget(contextMenu.target, {
                          pinned: !contextMenu.target.pinned,
                        }),
                      ),
                    },
                    ...directorySortMenuItems(contextMenu.target),
                    ...projectOrderMenuItems(contextMenu.target),
                    ...(contextMenu.target.kind === "project"
                      ? [
                          ...(["sync", "share"] as const).map((intent) => ({
                            label: accountFlow(
                              intent === "share" ? "share" : "useOnDevices",
                            ),
                            icon:
                              intent === "share" ? (
                                <Globe size={15} />
                              ) : (
                                <Cloud size={15} />
                              ),
                            onSelect: action(async () => {
                              const projectId = contextMenu.target.projectId;
                              await settleOpenPage();
                              setSyncRequest({
                                projectId,
                                intent,
                                key: Date.now(),
                              });
                              setSettingsSection("sync");
                              await navigate("settings");
                            }),
                          })),
                          {
                            label: accountFlow("hide"),
                            icon: <EyeOff size={15} />,
                            onSelect: action(async () => {
                              const { projectId, title } = contextMenu.target;
                              await settleOpenPage();
                              await desktop.invoke("sync:projectVisibility", {
                                projectId,
                                visible: false,
                              });
                              if (selectedProject === projectId)
                                await navigate("projects");
                              await refreshProjects([projectId], { sidebar: true });
                              notifyWithUndo(
                                tn("hiddenNamed", { name: title }),
                                async () => {
                                  await desktop.invoke(
                                    "sync:projectVisibility",
                                    { projectId, visible: true },
                                  );
                                  await refreshProjects([projectId], {
                                    sidebar: true,
                                  });
                                  setNotice(tn("shownNamed", { name: title }));
                                },
                              );
                            }),
                          },
                          {
                            label: t("moveToGroup"),
                            icon: <Folder size={15} />,
                            onSelect: () =>
                              setDialog({
                                type: "moveProject",
                                projectId: contextMenu.target.projectId,
                              }),
                          },
                          ...(organization.projectGroups[
                            contextMenu.target.projectId
                          ]
                            ? [
                                {
                                  label: t("removeFromGroup"),
                                  icon: <FolderMinus size={15} />,
                                  onSelect: action(() =>
                                    moveProject(
                                      contextMenu.target.projectId,
                                      null,
                                    ),
                                  ),
                                },
                              ]
                            : []),
                        ]
                      : []),
                    ...(contextMenu.pageTools &&
                    editorControls?.documentId === contextMenu.target.id
                      ? containerMenuItems(
                          editorControls,
                          editorControls.nested,
                        ).map((item, index) => ({
                          ...item,
                          separatorBefore:
                            item.separatorBefore ||
                            (editorControls.nested && index === 0),
                        }))
                      : []),
                    ...(contextMenu.pageTools
                      ? [
                          {
                            label: tfind("bar"),
                            icon: <Search size={15} />,
                            shortcut: formatShortcut("Mod+F", clientIsMac()),
                            onSelect: () => {
                              setContextMenu(null);
                              find.run(
                                syncReadOnly || page.record?.readOnly
                                  ? "open"
                                  : "replace",
                              );
                            },
                          },
                        ]
                      : []),
                    ...(contextMenu.target.kind === "page"
                      ? [
                          {
                            label: t("duplicatePage"),
                            icon: <Copy size={15} />,
                            separatorBefore: !contextMenu.pageTools,
                            onSelect: action(() =>
                              duplicatePage(contextMenu.target),
                            ),
                          },
                          {
                            label: t("exportMenu"),
                            icon: <ArrowUpRight size={15} />,
                            onSelect: () => {
                              setExportTarget(
                                contextMenu.pageTools
                                  ? null
                                  : contextMenu.target,
                              );
                              setPageExportMenu(contextMenu.anchor);
                            },
                          },
                          ...(contextMenu.pageTools && capabilities.revealFiles
                            ? [
                                {
                                  label: t("revealPageFile"),
                                  icon: <FolderOpen size={15} />,
                                  onSelect: action(() =>
                                    desktop.invoke("fs:reveal", {
                                      projectId: contextMenu.target.projectId,
                                      pageId: contextMenu.target.id,
                                    }),
                                  ),
                                },
                              ]
                            : []),
                        ]
                      : []),
                    ...(contextMenu.target.kind === "page" ||
                    contextMenu.target.kind === "folder"
                      ? [
                          {
                            label: t("moveTo"),
                            icon: <FolderInput size={15} />,
                            onSelect: () => {
                              setContextMenu(null);
                              setDialog({
                                type: "batchPages",
                                operation: "move",
                                targets: [contextMenu.target],
                              });
                            },
                          },
                        ]
                      : []),
                    {
                      label: tc("delete"),
                      icon: <Trash2 size={15} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => beginDelete(contextMenu.target),
                    },
                  ]
            }
          />
        )}
        {importPlan && (
          <ImportDialog
            plan={importPlan.plan}
            destination={importPlan.destination}
            onFinished={importFinished}
            onOpen={(pageId) => {
              const target = importPlan.plan.target.projectId;
              setImportPlan(null);
              void openPage(pageId, target).catch(report);
            }}
            onClose={() => setImportPlan(null)}
          />
        )}
        {packagingDecision && (
          <PackagingDialog
            plan={packagingDecision.plan}
            purpose="export"
            onDecide={packagingDecision.decide}
          />
        )}
        {dialog?.type === "pageIcon" && (
          <PageIconDialog
            value={dialog.value}
            onClose={closeDialog}
            onSave={async (icon) => {
              const retained = page.sessions.sessionFor(dialog.target.projectId, dialog.target.id);
              if (retained) {
                retained.edit({ icon });
                if (!(await retained.flush()))
                  throw new Error(t("iconKeptInDraft"));
              } else {
                const { target } = dialog;
                const before = target.icon ?? "";
                setContents((current) =>
                  withLibraryEntry(current, { ...target, kind: "page" }, { icon }),
                );
                closeDialog();
                try {
                  await desktop.invoke("pages:save", {
                    projectId: target.projectId,
                    pageId: target.id,
                    baseHash: dialog.record.hash,
                    baseRevision: dialog.record.revision,
                    document: { ...dialog.record.document, icon },
                  });
                } catch (reason) {
                  setContents((current) =>
                    withLibraryEntry(
                      current,
                      { ...target, kind: "page" },
                      { icon: before },
                    ),
                  );
                  report(reason, { action: operation("op.setIcon"), object: target.title });
                  return;
                }
              }
              await refreshProjects([dialog.target.projectId]);
            }}
          />
        )}
        {dialog?.type === "migration" && info && (
          <LibraryMigrationDialog
            home={info.home}
            beforePrepare={page.flush}
            onClose={closeDialog}
            onActivated={async () => {
              setInfo(await desktop.invoke<DesktopInfo>("app:info"));
              await page.reload();
              await refresh();
              await loadCatalog();
              setNotice(t("libraryUpgraded"));
            }}
          />
        )}
        {dialog?.type === "merge" && (
          <MergeDialog
            {...dialog}
            pageId={dialog.document.id}
            onClose={closeDialog}
            onDismiss={deferConflict}
            onEdit={page.prepareResolution}
            onDiscard={page.acceptResolution}
            onMerged={async () => {
              await page.acceptResolution();
              await refreshProjects([dialog.projectId]);
              setNotice(t("mergeSaved"));
            }}
          />
        )}
        {dialog?.type === "externalConflict" && (
          <ExternalConflictDialog
            id={dialog.id}
            saveFailure={dialog.saveFailure}
            draftDocument={
              dialog.saveFailure ? (page.draft ?? undefined) : undefined
            }
            onEdit={(document) =>
              page.prepareExternalResolution(document, dialog.id)
            }
            projectId={selectedProject ?? undefined}
            onPackageRecovered={async (result) => {
              await refresh();
              const ref = result.package,
                target = result.draft.projectId;
              if (ref.kind === "component") {
                const custom = await desktop.invoke<CompiledComponent>(
                  "components:get",
                  {
                    id: ref.id,
                    version: ref.version,
                    scope: ref.scope,
                    projectId: ref.projectId,
                  },
                );
                setDialog({ type: "component", custom, projectId: target });
              } else {
                const record = await desktop.invoke<LoadedTemplate>(
                  "templates:get",
                  {
                    id: ref.id,
                    version: ref.version,
                    scope: ref.scope,
                    projectId: ref.projectId,
                  },
                );
                setDialog({ type: "template", record, projectId: target });
              }
              setNotice(t("externalKeptAsDraft"), { kind: "warning" });
            }}
            onClose={closeDialog}
            onDismiss={deferConflict}
            onResolved={async () => {
              await page.acceptResolution();
              await refresh();
              setNotice(t("externalResolved"));
            }}
          />
        )}
        {capabilities.externalChanges && dialog?.type === "workspaceConflicts" && (
          <WorkspaceConflictsDialog
            projectId={selectedProject}
            onClose={closeDialog}
            onSelect={(id) => setDialog({ type: "externalConflict", id })}
          />
        )}
        {dialog?.type === "group" && (
          <NameDialog
            title={dialog.group ? t("renameGroup") : t("newGroup")}
            inputLabel={t("groupName")}
            initialValue={dialog.group?.name}
            onClose={closeDialog}
            onSave={async (name) => {
              const sidebar = await desktop.invoke<SidebarOrganization>(
                dialog.group ? "groups:rename" : "groups:create",
                {
                  name,
                  ...(dialog.group ? { groupId: dialog.group.id } : {}),
                },
              );
              if (dialog.projectId)
                await moveProject(dialog.projectId, sidebar.groups.at(-1)!.id);
              await refreshProjects([], { sidebar: true });
              setDialog(null);
            }}
          />
        )}
        {dialog?.type === "moveProject" && (
          <MoveProjectDialog
            groups={organization.groups}
            currentGroup={organization.projectGroups[dialog.projectId] ?? ""}
            onClose={closeDialog}
            onCreate={() =>
              setDialog({ type: "group", projectId: dialog.projectId })
            }
            onSave={async (groupId) => {
              await moveProject(dialog.projectId, groupId);
              setDialog(null);
            }}
          />
        )}
        {dialog?.type === "folder" && (
          <FolderDialog
            folder={dialog.target}
            onClose={closeDialog}
            onSave={async (name, icon) => {
              if (dialog.target) {
                await updateTarget(
                  dialog.target,
                  { name, icon },
                  { close: closeDialog },
                );
                return;
              }
              await settleOpenPage();
              const folder = await desktop.invoke<FolderMetadata>(
                "folders:create",
                {
                  projectId: dialog.projectId,
                  parentId: dialog.parentId,
                  name,
                  ...(icon ? { icon } : {}),
                },
              );
              setContents((current) =>
                withCreatedFolder(current, dialog.projectId, folder),
              );
              setExpandedFolders((current) => ({
                ...current,
                ...(dialog.parentId ? { [dialog.parentId]: true } : {}),
              }));
              setDialog(null);
              await openProject(dialog.projectId, folder.id);
              await refreshProjects([dialog.projectId]);
            }}
          />
        )}
        {dialog?.type === "rename" && (
          <NameDialog
            title={tc("rename")}
            inputLabel={t("name")}
            initialValue={dialog.target.title}
            onClose={closeDialog}
            onSave={async (name) => {
              await updateTarget(dialog.target, { name }, { close: closeDialog });
            }}
          />
        )}
        {dialog?.type === "batchPages" && (
          <BatchPagesDialog
            operation={dialog.operation}
            targets={dialog.targets}
            projects={projects}
            onClose={closeDialog}
            onApply={applyBatchPages}
          />
        )}
        {dialog?.type === "deletedItems" && (
          <DeletedItemsDialog
            onClose={closeDialog}
            onRestored={async (target) => {
              await refreshProjects([target.projectId], { sidebar: true });
              setNotice(tn("restoredNamed", { title: target.title }));
            }}
            onPurged={async (targets) => {
              await refreshProjects(
                [...new Set(targets.map((target) => target.projectId))],
                { sidebar: true },
              );
              setNotice(
                targets.length === 1
                  ? tn("purgedNamed", { title: targets[0].title })
                  : tn("purgedCount", { count: targets.length }),
              );
            }}
          />
        )}
        {dialog?.type === "hiddenProjects" && (
          <HiddenProjectsDialog
            onClose={closeDialog}
            onShown={async (shown) => {
              await refresh();
              setNotice(tn("shownNamed", { name: shown.name }));
            }}
          />
        )}
        {dialog?.type === "quickJump" && (
          <QuickJump
            projects={projects}
            pages={contents}
            commands={quickJumpCommands()}
            editor={
              view === "page" &&
              page.draft &&
              editorControls?.documentId === page.draft.id
                ? editorControls
                : undefined
            }
            openDirectory={openProject}
            onClose={closeDialog}
            onError={report}
          />
        )}
        {dialog?.type === "shortcuts" && (
          <ShortcutsDialog
            browser={info?.mode === "browser"}
            tabs={capabilities.tabs}
            windows={capabilities.windows}
            onClose={closeDialog}
          />
        )}
        {dialog?.type === "discardDraft" && (
          <DiscardDraftDialog
            editedAt={page.draft?.updatedAt}
            onClose={closeDialog}
            onConfirm={page.acceptResolution}
          />
        )}
        {dialog?.type === "delete" && (
          <DeleteDialog
            target={dialog.target}
            onClose={closeDialog}
            onDelete={async () => {
              await deleteTarget(dialog.target, { close: closeDialog });
            }}
          />
        )}
        {dialog?.type === "project" && (
          <ProjectDialog
            project={dialog.project}
            onClose={closeDialog}
            onSave={async (name, icon) => {
              if (dialog.project) {
                await updateTarget(
                  projectTarget(dialog.project),
                  { name, icon },
                  { close: closeDialog },
                );
                return;
              }
              const result = await desktop.invoke<ProjectSummary>(
                "projects:create",
                { name, icon },
              );
              setDialog(null);
              if (dialog.groupId) await moveProject(result.id, dialog.groupId);
              // The creation receipt is not a navigation summary (no dates or
              // pages), so the sidebar gets the project from a scoped refresh.
              await refreshProjects([result.id], { sidebar: true });
              await openProject(result.id);
              if (dialog.then)
                await runCreation(dialog.then, {
                  projectId: result.id,
                  parentId: null,
                });
            }}
          />
        )}
        {dialog?.type === "newPage" && (
          <Dialog title={t("newPage")} onClose={closeDialog}>
            <div className="studio-template-picker">
              <button
                disabled={busy}
                aria-label={t("newPageAria")}
                onClick={() => void createPage("blank", undefined, "page", undefined, true)}
              >
                <span>
                  <FileText size={21} />
                </span>
                <div>
                  <strong>{t("blankPage")}</strong>
                </div>
                <ArrowUpRight size={16} />
              </button>
              <button
                aria-label={t("newBoardAria")}
                disabled={busy}
                onClick={() => void createPage("blank", undefined, "board", undefined, true)}
              >
                <span>
                  <Presentation size={21} />
                </span>
                <div>
                  <strong>{t("blankBoard")}</strong>
                </div>
                <ArrowUpRight size={16} />
              </button>
              {latestTemplateVersions(dialog.templates)
                .filter((item) => item.id !== "blank" && templateHasPage(item))
                .map((item) => (
                  <button
                    key={`${item.scope}:${item.id}:${item.version}:${item.integrity}`}
                    disabled={busy}
                    onClick={() => void createPage(item.id, item)}
                  >
                    <span>
                      {item.id === "blank" ? (
                        <FileText size={21} />
                      ) : (
                        <LayoutTemplate size={21} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {item.id === "blank" ? t("blankPage") : item.name}
                      </strong>
                      <p>{item.description}</p>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            </div>
          </Dialog>
        )}
        {dialog?.type === "template" && (
          <TemplateDialog
            key={`${dialog.record.id}:${dialog.record.version}:${dialog.record.scope}:${dialog.record.integrity}`}
            record={dialog.record}
            components={dialog.record.components ?? []}
            onClose={closeDialog}
            {...templateDialogActions(dialog.record, dialog.projectId)}
            manager={catalogManager}
            owner={dialog.projectId ?? selectedProject ?? undefined}
          />
        )}
        {dialog?.type === "component" && (
          <ComponentDialog
            key={
              dialog.custom
                ? `${dialog.custom.id}@${dialog.custom.version}:${dialog.custom.scope}:${dialog.custom.integrity}`
                : dialog.builtin?.kind
            }
            builtin={dialog.builtin}
            custom={dialog.custom}
            loadSource={capabilities.componentSource ? () =>
              desktop.invoke<ComponentSource>(
                "components:source",
                dialog.builtin
                  ? { scope: "builtin", id: dialog.builtin.kind }
                  : {
                      id: dialog.custom!.id,
                      version: dialog.custom!.version,
                      scope: dialog.custom!.scope,
                      integrity: dialog.custom!.integrity,
                      projectId: dialog.projectId,
                    },
              ) : undefined
            }
            canInsert={
              dialog.custom?.role !== "page-outline" &&
              !!page.draft &&
              page.projectId === selectedProject &&
              (dialog.custom?.scope !== "project" ||
                page.projectId === dialog.projectId)
            }
            insertPageTitle={page.draft?.title || tc("untitled")}
            insertUnavailable={dialog.custom?.role !== "page-outline"}
            onInsert={addBlock}
            onClose={closeDialog}
            manager={catalogManager}
            owner={dialog.projectId}
          />
        )}
      </div>
    </ComponentLibraryContext.Provider>
  );
}
