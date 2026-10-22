import MergeDialog from "./MergeDialog";
import type { ProjectSyncRequest } from "./SyncSettings";
import accountFlowMessages from "../i18n/messages/accountFlow";
import { coalescedTask } from "../lib/coalesced-task";
import {
  emptyNavigationScope,
  queueNavigationScope,
  mergeNavigationProjects,
  retainEqual,
  mergeNavigationScope,
  savedPageMoved,
  withSavedPage,
  withSavedProjectTime,
} from "./navigation-refresh";
import { readNavigationCache, writeNavigationCache } from "./navigation-cache";
import { applyLibraryMove, type LibraryContents } from "./library-move";
import { ComponentLibraryContext } from "../components/ComponentLibrary";
import { insertComponent } from "../surface/component-insertion";
import { findSurfaceNode } from "../surface/document.mjs";
import { upgradeResource } from "../surface/containers.mjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  AtSign,
  AppWindow,
  Blocks,
  Settings2,
  Search,
  CodeXml,
  Download,
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
  ListOrdered,
  LayoutList,
  LayoutGrid,
  Grid2X2,
  Undo2,
  Redo2,
  Plus,
  History,
  Upload,
} from "../ui/icons";
import type {
  ProjectSummary,
  PageSummary,
  FolderMetadata,
  ProjectGroup,
  SidebarOrganization,
  DirectoryPreferences,
  DirectorySortBy,
} from "../core/model";
import { orderSidebarProjects } from "../core/sidebar-order";
import type { DesktopInfo, DesktopChange } from "../desktop/bridge";
import type { ShowArtifact, ShowDocument } from "../types";
import type {
  BuiltinComponentMetadata,
  CompiledComponent,
  ComponentCategory,
  TemplateMetadata,
  TemplateRecord,
  CatalogReadOptions,
  ComponentSource,
} from "../components/custom/types";
import { PageWorkspace } from "./PageWorkspace";
import {
  EditorHistoryButtons,
  containerMenuItems,
  type EditorControls,
} from "../surface/EditorControls";
import { parseArtifact } from "../lib/artifact";
import { parseMarkdown } from "../lib/markdown";
import { newDocument } from "../lib/document";
import { desktop, errorMessage } from "./bridge";
import { workbenchCapabilities } from "./capabilities";
import { usePage, type LoadedPage } from "./usePage";
import {
  LibraryRow,
  LibraryContextMenu,
  type LibraryMenuPoint,
  type LibraryRowProps,
  type LibraryTarget,
  type LibraryContextMenuItem,
} from "./LibraryNavigation";
import Dialog from "./Dialog";
import {
  ExternalSnapshotDialog,
  type ExternalSnapshotReport,
} from "./ExternalSnapshotDialog";
import PageThumbnail from "./PageThumbnail";
import FolderThumbnail, { type FolderThumbnailEntry } from "./FolderThumbnail";
import {
  BatchPagesDialog,
  DirectorySelectionBar,
  useDirectoryPageSelection,
  useDirectoryMarquee,
  type PageDestination,
} from "./DirectoryPageSelection";
import PageIcon from "../components/PageIcon";
import PageIconDialog from "./PageIconDialog";
import ExpandableSearch from "../components/ExpandableSearch";
import ProjectSidebar from "./ProjectSidebar";
import {
  LibraryDragContext,
  useLibraryDragController,
  type LibraryDrop,
} from "./LibraryDrag";
import { placeSidebarItem } from "../core/sidebar-order";
import {
  directoryEntries,
  directorySortOptions,
  sortDirectoryItems,
} from "../core/directory-sort";
import { applySidebarReorder, type SidebarReorder } from "./sidebar-reorder";
import { readSidebarExpansion, sidebarExpansionKey } from "./sidebar-state";
import SidebarNavigation from "./SidebarNavigation";
import TemplateNavigation, {
  matchesTemplateType,
  type TemplateType,
} from "./TemplateNavigation";
import {
  latestTemplateVersions,
  templateHasPage,
} from "./template-catalog-model";
import TemplateThumbnail from "./TemplateThumbnail";
import RecentPages, { recentPages } from "./RecentPages";
import Welcome from "./Welcome";
import PluginUpdateNotice from "./PluginUpdateNotice";
import {
  BuiltinDocPage,
  DocsNavigation,
  useBuiltinDocFolders,
  useBuiltinDocTitle,
} from "./BuiltinDocs";
import {
  builtinDocs,
  DOCS_HOME,
  DOCS_VISIBLE_KEY,
  readDocsVisible,
  WELCOME_DOC,
} from "./builtin-docs";
import { useSampleProject } from "./sample-project";
import AutoHideSidebar from "./AutoHideSidebar";
import WorkspaceTabs, { WorkspaceHistory } from "./WorkspaceTabs";
import { useWorkspaceTabs } from "./useWorkspaceTabs";
import {
  clickDisposition,
  libraryEntry,
  type OpenDisposition,
} from "./open-target";
import type { WorkspaceEntry, WorkspaceView } from "./workspace-tabs";
import { tabShortcut, type TabCommand } from "../workbench/tab-shortcuts";
import { useWindowFullscreen } from "./useWindowFullscreen";
import { ComponentCatalog, ComponentNavigation } from "./ComponentCatalog";
import {
  groupComponents,
  type ComponentFilter,
  type CatalogComponent,
  type CatalogCustomComponent,
} from "../core/component-categories";
import { TemplateDialog, ComponentDialog } from "./CatalogDialogs";
import "./studio.css";
import {
  NoticeStack,
  ProblemNotice,
  ToastViewport,
  bindProblemActions,
  configureProblemRedaction,
  labelProblem,
  useProblemQueue,
  useToasts,
  type ReportOptions,
  type ToastOptions,
} from "./problems";
import errorMessages from "../i18n/messages/errors";
import { translator } from "../i18n";
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
  type SettingsSection,
} from "./Settings";
import { getLocale } from "../i18n";
import { useLocale, useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";
import assistantMessages from "../i18n/messages/assistant";
import AssistantWorkbench from "./assistant/AssistantWorkbench";
import { referenceHeading } from "./assistant/targets";
import type { AgentTarget } from "../agent-host/types";
import {
  formatReference,
  referenceVersion,
  type PageReference,
} from "../core/page-reference";
import { useSlidingIndicator } from "./useSlidingIndicator";
import {
  componentDisplayDescription,
  componentDisplayName,
} from "../components/component-display";

type View = WorkspaceView;
type Catalog = {
  builtin: BuiltinComponentMetadata[];
  custom: CatalogCustomComponent[];
};
type LoadedTemplate = TemplateRecord & {
  components?: CompiledComponent[];
  previewDocument?: ShowDocument;
};
type DialogState =
  | { type: "workspaceConflicts" }
  | { type: "migration" }
  | {
      type: "merge";
      projectId: string;
      document: ShowDocument;
      baseRevision: string;
      saveFailure?: boolean;
    }
  | { type: "externalConflict"; id: string; saveFailure?: boolean }
  | { type: "project"; project?: ProjectSummary; groupId?: string }
  | { type: "group"; group?: ProjectGroup; projectId?: string }
  | { type: "moveProject"; projectId: string }
  | {
      type: "batchPages";
      operation: "move" | "delete";
      targets: LibraryTarget[];
    }
  | {
      type: "newPage";
      projectId: string;
      parentId: string | null;
      templates: TemplateMetadata[];
    }
  | {
      type: "folder";
      projectId: string;
      parentId: string | null;
      /** Present when editing an existing folder's name and icon. */
      target?: LibraryTarget;
    }
  | {
      type: "pageIcon";
      target: LibraryTarget;
      value: string;
      record: LoadedPage;
    }
  | { type: "rename"; target: LibraryTarget }
  | { type: "delete"; target: LibraryTarget }
  | {
      type: "template";
      record: LoadedTemplate;
      projectId?: string;
    }
  | {
      type: "component";
      projectId?: string;
      builtin?: BuiltinComponentMetadata;
      custom?: CompiledComponent;
    }
  | null;

/** Operation names for problem titles; read the locale on each call. */
const operation = translator(errorMessages);
const LOAD_LIBRARY = "loadLibrary";

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
  const receivingInvite = useRef(false);
  const [syncNavigationKey, setSyncNavigationKey] = useState(0);
  const accountFlow = useTranslator(accountFlowMessages);
  const [syncRequest, setSyncRequest] = useState<ProjectSyncRequest>();
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const ta = useTranslator(assistantMessages);
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
  const [navigationUpdating, setNavigationUpdating] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [routing, setRouting] = useState(false);
  const routingRef = useRef(false);
  const catalogLoaded = useRef(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const windowFullscreen = useWindowFullscreen();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const capabilities = workbenchCapabilities(info?.platform);
  // Built-in documentation; the website workbench publishes its own instead.
  const [docPage, setDocPage] = useState<{ id: string; hash: string } | null>(
    null,
  );
  const [docsVisible, setDocsVisible] = useState(readDocsVisible);
  const docsAvailable = !!info && info.builtinDocs !== false;
  const showDocs = docsAvailable && docsVisible;
  const changeDocsVisible = useCallback((visible: boolean) => {
    setDocsVisible(visible);
    if (visible) localStorage.removeItem(DOCS_VISIBLE_KEY);
    else localStorage.setItem(DOCS_VISIBLE_KEY, "hidden");
  }, []);
  const docTitle = useBuiltinDocTitle();
  const locale = useLocale();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
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
      }),
    [],
  );
  const [groupMenu, setGroupMenu] = useState<{
    group: ProjectGroup;
    anchor: HTMLElement;
  } | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [syncReadOnly, setSyncReadOnly] = useState<boolean | undefined>();
  useEffect(() => {
    let active = true;
    setSyncReadOnly(undefined);
    const refreshPermission = async () => {
      const state = await desktop.invoke<{
        projects: { projectId: string; role: string; status: string }[];
      }>("sync:status");
      const connection = state.projects.find(
        (project) => project.projectId === selectedProject,
      );
      if (active)
        setSyncReadOnly(
          connection?.role === "viewer" || connection?.status === "revoked",
        );
    };
    void refreshPermission().catch((error) =>
      console.error("Could not update project sync permissions", error),
    );
    const timer = setInterval(() => {
      void refreshPermission().catch((error) =>
        console.error("Could not update project sync permissions", error),
      );
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedProject, info?.home]);
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
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
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
  const pages = selectedProject ? (contents[selectedProject]?.pages ?? []) : [];
  const folders = selectedProject
    ? (contents[selectedProject]?.folders ?? [])
    : [];
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(location.search).has("invite")
      ? "settings"
      : "projects",
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
    new URLSearchParams(location.search).has("invite") || !capabilities.manageLibrary
      ? "sync" : "general",
  );
  useEffect(() => {
    const host = window as Window & { showaiPendingInvite?: string };
    const receive = (event?: Event) => {
      const link =
        event instanceof CustomEvent ? event.detail : host.showaiPendingInvite;
      if (typeof link !== "string" || !link || receivingInvite.current) return;
      receivingInvite.current = true;
      void (async () => {
        if (!(await page.flush())) return;
        localStorage.setItem("showai:pending-invitation", link);
        delete host.showaiPendingInvite;
        setSyncRequest(undefined);
        setSettingsSection("sync");
        setSyncNavigationKey((value) => value + 1);
        await navigate("settings");
      })()
        .catch(report)
        .finally(() => {
          receivingInvite.current = false;
        });
    };
    window.addEventListener("showai:invitation", receive);
    receive();
    return () => window.removeEventListener("showai:invitation", receive);
  });
  useEffect(() => {
    // The shared data dialog lists the pages using it; opening one reveals the block.
    const open = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          projectId?: string;
          pageId?: string;
          blockId?: string;
        }>
      ).detail;
      if (!detail?.pageId) return;
      void openPage(detail.pageId, detail.projectId).then((opened) => {
        if (opened && detail.blockId) setRevealNode(detail.blockId);
      });
    };
    window.addEventListener("showai:open-page", open);
    return () => window.removeEventListener("showai:open-page", open);
  });
  const [templates, setTemplates] = useState<TemplateMetadata[]>([]);
  const [showTemplateVersions, setShowTemplateVersions] = useState(false);
  const [templateType, setTemplateType] = useState<TemplateType>("all");
  const [catalog, setCatalog] = useState<Catalog>({ builtin: [], custom: [] });
  const [catalogScope, setCatalogScope] =
    useState<CatalogReadOptions["scope"]>("all");
  const catalogScopeRef = useRef(catalogScope);
  catalogScopeRef.current = catalogScope;
  const [query, setQuery] = useState("");
  const [searchLibrary, setSearchLibrary] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  useEffect(() => {
    setSearchLibrary(false);
    setQuery("");
  }, [view]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [snapshotDecision, setSnapshotDecision] = useState<{
    report: ExternalSnapshotReport;
    decide: (embed: boolean) => void;
  } | null>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const toasts = useToasts();
  const { show: showToast, clear: clearToasts } = toasts;
  /** L1 toast; an empty message clears transient toasts. */
  const setNotice = useCallback(
    (message: string, options?: ToastOptions) => {
      if (message) showToast(message, options);
      else clearToasts();
    },
    [showToast, clearToasts],
  );
  const problemQueue = useProblemQueue();
  const [busy, setBusy] = useState(false);
  const [revealNode, setRevealNode] = useState<string | null>(null);
  const [editorControls, setEditorControls] = useState<EditorControls | null>(
    null,
  );
  const activeSurface = useRef<{ pageId: string; surfaceId: string } | null>(
    null,
  );
  const [directoryView, setDirectoryView] = useState<
    "list" | "small" | "medium" | "large"
  >(() => {
    const saved = localStorage.getItem("showai:directory-view");
    return saved === "small" || saved === "medium" || saved === "large"
      ? saved
      : "list";
  });
  const [viewMenu, setViewMenu] = useState<HTMLElement | null>(null);
  const viewOptions = ["list", "small", "medium", "large"] as const;
  const viewIcon = (mode: typeof directoryView) =>
    mode === "list" ? (
      <LayoutList size={16} />
    ) : mode === "small" ? (
      <LayoutGrid size={16} />
    ) : (
      <Grid2X2 size={mode === "large" ? 20 : 16} />
    );
  const chooseDirectoryView = (mode: typeof directoryView) => {
    setDirectoryView(mode);
    localStorage.setItem("showai:directory-view", mode);
  };
  const directoryViewControl = (): LibraryContextMenuItem => ({
    label: t("directoryView"),
    icon: <LayoutGrid size={15} />,
    control: (
      <div
        className="directory-view-switch"
        role="group"
        aria-label={t("directoryView")}
      >
        {viewOptions.map((mode) => (
          <button
            key={mode}
            type="button"
            title={t(`view.${mode}`)}
            aria-label={t(`view.${mode}`)}
            aria-pressed={directoryView === mode}
            onClick={() => chooseDirectoryView(mode)}
          >
            {viewIcon(mode)}
          </button>
        ))}
      </div>
    ),
  });
  const [contextMenu, setContextMenu] = useState<{
    target: LibraryTarget;
    anchor: HTMLElement;
    point?: LibraryMenuPoint;
    pageTools?: boolean;
    creationOnly?: boolean;
  } | null>(null);
  const [projectsMenu, setProjectsMenu] = useState<HTMLElement | null>(null);
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("showai:appearance");
    return saved
      ? saved === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [componentProject, setComponentProject] = useState("all");
  const componentProjectRef = useRef(componentProject);
  componentProjectRef.current = componentProject;
  const [componentFilter, setComponentFilter] =
    useState<ComponentFilter>("all");
  const componentSourceTabs = useSlidingIndicator<HTMLElement>(componentFilter);
  const [componentCategory, setComponentCategory] =
    useState<ComponentCategory | null>(null);
  const [catalogQueries, setCatalogQueries] = useState({
    components: "",
    templates: "",
  });
  const componentGroups = useMemo(
    () =>
      groupComponents(catalog, componentFilter).map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.name} ${item.description} ${componentDisplayName(item)} ${componentDisplayDescription(item)}`
            .toLowerCase()
            .includes(catalogQueries.components.toLowerCase()),
        ),
      })),
    [catalog, componentFilter, catalogQueries.components],
  );
  const catalogScrollRef = useRef<HTMLDivElement>(null);
  const page = usePage(info?.home);
  const activePageId = page.draft?.id;
  const handleActiveSurfaceChange = useCallback(
    (surfaceId: string) => {
      if (activePageId)
        activeSurface.current = { pageId: activePageId, surfaceId };
    },
    [activePageId],
  );
  const handleRevealHandled = useCallback(() => setRevealNode(null), []);
  const shownSaveFailure = useRef("");
  useEffect(() => {
    if (
      view !== "page" ||
      page.status !== "conflict" ||
      page.reviewingConflict ||
      !page.draft ||
      !selectedProject
    )
      return;
    const key = JSON.stringify([
      selectedProject,
      page.draft.id,
      page.conflictId,
      page.mergeBase,
      page.error,
      page.saveFailureAttempt,
    ]);
    if (shownSaveFailure.current === key) return;
    shownSaveFailure.current = key;
    if (page.conflictId)
      setDialog({
        type: "externalConflict",
        id: page.conflictId,
        saveFailure: true,
      });
    else if (page.mergeBase)
      setDialog({
        type: "merge",
        projectId: selectedProject,
        document: structuredClone(page.draft),
        baseRevision: page.mergeBase,
        saveFailure: true,
      });
  }, [
    view,
    selectedProject,
    page.status,
    page.reviewingConflict,
    page.draft,
    page.conflictId,
    page.mergeBase,
    page.error,
    page.saveFailureAttempt,
  ]);
  const project = projects.find((item) => item.id === selectedProject);
  const selectedRef = useRef(selectedProject);
  selectedRef.current = selectedProject;
  const selectedFolderRef = useRef(selectedFolder);
  selectedFolderRef.current = selectedFolder;
  const initialized = useRef(false);
  const closeDialog = useCallback(() => setDialog(null), []);

  const { report: queueProblem, resolve: resolveProblem } = problemQueue;
  /**
   * Shows a failed operation in the problem queue. Pass the operation name
   * (`{ action: te("op.exportSite") }`) so the title says what failed; a
   * later success of the same operation clears it via resolveProblem.
   */
  const report = useCallback(
    (error: unknown, options?: ReportOptions) => queueProblem(error, options),
    [queueProblem],
  );
  useEffect(() => {
    configureProblemRedaction(info?.home ? { library: info.home } : {});
  }, [info?.home]);
  useEffect(() => {
    if (view !== "page") return;
    const refreshPage = () => {
      void page.reloadCurrent().catch(report);
    };
    const key = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) refreshPage();
      }
    };
    const unsubscribe = desktop.onRefreshPage(refreshPage);
    window.addEventListener("keydown", key, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", key, true);
    };
  }, [view, page.reloadCurrent, report]);
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
  const navigationState = useRef({ projects, organization: savedOrganization });
  navigationState.current = { projects, organization: savedOrganization };
  const refreshNavigation = useMemo(
    () =>
      coalescedTask(async () => {
        const requested = navigationScope.current;
        navigationScope.current = emptyNavigationScope();
        try {
          const revision = sidebarRevision.current;
          const appInfo = await desktop.invoke<DesktopInfo>("app:info");
          const scope = { expectedHome: appInfo.home };
          const changedHome = sidebarHome.current !== appInfo.home;
          const full = requested.all || changedHome;
          const [next, sidebar] = await Promise.all([
            full || requested.ids.size
              ? desktop.invoke<ProjectSummary[]>("projects:list", {
                  ...scope,
                  ...(full ? {} : { projectIds: [...requested.ids] }),
                })
              : Promise.resolve([] as ProjectSummary[]),
            full || requested.sidebar
              ? desktop.invoke<SidebarOrganization>("sidebar:get", scope)
              : Promise.resolve(navigationState.current.organization),
          ]);
          if (
            (await desktop.invoke<DesktopInfo>("app:info")).home !==
            appInfo.home
          )
            return;
          if (changedHome) {
            const saved = readSidebarExpansion(appInfo.home);
            sidebarHome.current = appInfo.home;
            expandedRef.current = saved.projects;
            setExpandedProjects(saved.projects);
            setExpandedFolders(saved.folders);
            setCollapsedSections(saved.collapsedSections);
          }
          setInfo((current) => retainEqual(current, appInfo));
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
          const nextContents = await Promise.all(
            next.map(async (item) => {
              const scope = { projectId: item.id, expectedHome: appInfo.home };
              const [pages, folders] = await Promise.all([
                desktop.invoke<PageSummary[]>("pages:list", scope),
                expandedRef.current[item.id] || item.id === selectedRef.current
                  ? desktop.invoke<FolderMetadata[]>("folders:list", scope)
                  : Promise.resolve(undefined),
              ]);
              return { id: item.id, pages, folders };
            }),
          );
          if (
            (await desktop.invoke<DesktopInfo>("app:info")).home !==
            appInfo.home
          )
            return;
          setContents((current) => {
            const updated = full ? {} : { ...current };
            for (const id of requested.ids) delete updated[id];
            for (const { id, pages, folders } of nextContents)
              updated[id] = retainEqual(current[id], {
                pages,
                folders: folders ?? current[id]?.folders ?? [],
              });
            return retainEqual(current, updated);
          });
        } catch (error) {
          // A failed scoped read must remain pending when another change asks for a retry.
          mergeNavigationScope(navigationScope.current, requested);
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
  // A library the App just created gets its sample project once.
  const sampleProject = useSampleProject(
    info && capabilities.manageLibrary ? info.home : null,
    refresh,
    report,
  );
  const loadCatalog = useMemo(
    () => {
      const load = coalescedTask(async () => {
        const id = selectedRef.current;
        const requestedScope = catalogScopeRef.current;
        const scope = {
          ...(id ? { projectId: id } : {}),
          scope: requestedScope,
        };
        const requestedProject = componentProjectRef.current;
        const loadComponents = async (): Promise<CatalogComponent[]> => {
          if (requestedProject !== "all") {
            const project = (
              await desktop.invoke<ProjectSummary[]>("projects:list")
            ).find((item) => item.id === requestedProject);
            if (!project) {
              componentProjectRef.current = "all";
              setComponentProject("all");
              return [];
            }
            const items = await desktop.invoke<CatalogComponent[]>(
              "components:list",
              { projectId: requestedProject, scope: "all" },
            );
            return items.map((item) =>
              !("kind" in item) && item.scope === "project"
                ? {
                    ...item,
                    projectId: requestedProject,
                    projectName: project?.name,
                  }
                : item,
            );
          }
          const [shared, allProjects] = await Promise.all([
            desktop.invoke<CatalogComponent[]>("components:list", {
              scope: "all",
            }),
            desktop.invoke<ProjectSummary[]>("projects:list"),
          ]);
          const local = await Promise.all(
            allProjects.map(async (project) => {
              const items = await desktop.invoke<CatalogCustomComponent[]>(
                "components:list",
                { projectId: project.id, scope: "project" },
              );
              return items.map((item) => ({
                ...item,
                projectId: project.id,
                projectName: project.name,
              }));
            }),
          );
          return [...shared, ...local.flat()];
        };
        const [nextTemplates, nextCatalog] = await Promise.all([
          desktop.invoke<TemplateMetadata[]>("templates:list", scope),
          loadComponents(),
        ]);
        if (
          selectedRef.current !== id ||
          catalogScopeRef.current !== requestedScope ||
          componentProjectRef.current !== requestedProject
        )
          return;
        catalogLoaded.current = true;
        setTemplates(nextTemplates);
        setCatalog({
          builtin: nextCatalog.filter(
            (item): item is BuiltinComponentMetadata => "kind" in item,
          ),
          custom: nextCatalog.filter(
            (item): item is CatalogCustomComponent => !("kind" in item),
          ),
        });
      });
      return async () => {
        setCatalogLoading(true);
        try {
          await load();
        } finally {
          setCatalogLoading(false);
        }
      };
    },
    [],
  );

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      const appInfo = await desktop.invoke<DesktopInfo>("app:info");
      setInfo(appInfo);
      try {
        const cached = readNavigationCache(localStorage, appInfo.home);
        if (cached) {
          setProjects(cached.projects);
          setOrganization(cached.organization);
          performance.clearMarks("showai:navigation-cached");
          performance.mark("showai:navigation-cached");
        }
      } catch (error) {
        console.warn("Could not read the project list cache", error);
      }
      const verification = refresh();
      const params = new URLSearchParams(location.search);
      const projectId = params.get("project"),
        pageId = params.get("page"),
        folderId = params.get("folder"),
        blocks = (params.get("blocks") ?? "").split(",").filter(Boolean);
      // Restore saved navigation before expanding the explicit launch target.
      await verification;
      if (projectId) {
        selectedRef.current = projectId;
        setSelectedProject(projectId);
        setExpandedProjects((current) => ({ ...current, [projectId]: true }));
        const loaded = await loadProjectContents(projectId);
        if (pageId) {
          if (await page.open(projectId, pageId, workspace.activeId)) {
            setView("page");
            void loadCatalog().catch(report);
            // A reference link opens here; show what it points at.
            if (blocks.length) void locateAssistantTarget(pageId, blocks);
          }
          const parentId =
            loaded.pages.find((item) => item.id === pageId)?.parentId ?? null;
          setSelectedFolder(parentId);
          expandFolderPath(loaded.folders, parentId);
        } else {
          if (folderId && !loaded.folders.some((item) => item.id === folderId))
            throw new Error(t("folderMissing"));
          setSelectedFolder(folderId);
          expandFolderPath(loaded.folders, folderId);
          setView("project");
        }
      }
      setWorkspaceReady(true);
    })().catch(report);
  }, [refresh, loadCatalog, page, report]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let queued = emptyNavigationScope(),
      catalog = false;
    const unsubscribe = desktop.onChange((change) => {
      queueNavigationScope(queued, change);
      catalog ||= !!change.catalog;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const work = queued,
          reloadCatalog = catalog;
        queued = emptyNavigationScope();
        catalog = false;
        if (work.all || work.sidebar || work.ids.size)
          void refresh({
            type: "files",
            home: change.home,
            all: work.all,
            sidebar: work.sidebar,
            projectIds: [...work.ids],
          }).catch(report);
        if ((work.all || reloadCatalog) && catalogLoaded.current)
          void loadCatalog().catch(report);
      }, 250);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh, loadCatalog, report]);
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  // The host no longer echoes this window's own saves, so apply them here.
  useEffect(
    () =>
      page.sessions.subscribeSaved((projectId, record) => {
        if (savedPageMoved(contentsRef.current, projectId, record)) {
          void refresh({
            type: "files",
            home: info?.home ?? "",
            projectIds: [projectId],
          }).catch(report);
          return;
        }
        setContents((current) => withSavedPage(current, projectId, record));
        setProjects((current) =>
          withSavedProjectTime(current, projectId, record.document.updatedAt),
        );
      }),
    [page.sessions, refresh, report, info?.home],
  );
  useEffect(() => {
    if (["components", "templates"].includes(view) || catalogLoaded.current)
      void loadCatalog().catch(report);
  }, [
    view === "components" || view === "templates",
    catalogScope,
    componentProject,
    loadCatalog,
    report,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("showai:appearance", dark ? "dark" : "light");
  }, [dark]);
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
  useEffect(() => {
    document.title =
      view === "page" && page.draft
        ? `${page.draft.title || tc("untitled")} — ShowAI`
        : view === "docs" && docPage
          ? `${docTitle(docPage.id).title} — ShowAI`
          : "ShowAI";
  }, [view, page.draft?.title, tc, docPage?.id]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (selectedRef.current)
          void beginNewPage(
            selectedRef.current,
            selectedFolderRef.current,
          ).catch(report);
        else setDialog({ type: "project" });
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  async function navigate(next: View) {
    if (routingRef.current) return;
    workspace.rememberScroll();
    routingRef.current = true;
    setRouting(true);
    try {
      if (!(await page.leave())) {
        setView("page");
        return;
      }
      setContextMenu(null);
      setQuery("");
      setView(next);
      if (next === "projects") {
        setSelectedProject(null);
        selectedRef.current = null;
        setSelectedFolder(null);
        await refresh();
      }
      if (next === "templates" || next === "components") await loadCatalog();
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  }
  async function openProject(id: string, folderId: string | null = null) {
    if (routingRef.current) return false;
    workspace.rememberScroll();
    routingRef.current = true;
    setRouting(true);
    try {
      if (!(await page.leave())) {
        setView("page");
        return false;
      }
      selectedRef.current = id;
      setSelectedProject(id);
      setSelectedFolder(folderId);
      setExpandedProjects((current) => ({ ...current, [id]: true }));
      setQuery("");
      setView("project");
      setContextMenu(null);
      const loaded = await loadProjectContents(id);
      expandFolderPath(loaded.folders, folderId);
      if (catalogLoaded.current) void loadCatalog().catch(report);
      return true;
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  }
  /** Open the page an Agent turn worked on and highlight the blocks it named. */
  /** Save the page as shown, then copy a reference pinned to that version. */
  async function copyPageReference(projectId: string, target: AgentTarget) {
    const pageId = target.pageId;
    if (!pageId) return;
    const workspaceState = page.sessions.getSnapshot();
    const session = workspaceState.views
      .map((view) => view.session)
      .find((item) => {
        const state = item.getSnapshot();
        return state.projectId === projectId && state.draft?.id === pageId;
      });
    // An open page saves first; the active one also finishes native ink input.
    const saved = !session
      ? true
      : session === workspaceState.active
        ? await page.flush()
        : await session.flush();
    if (!saved) throw new Error(ta("panel.saveFirst"));
    const record = session?.getSnapshot().record;
    if (session && record?.document.id !== pageId)
      throw new Error(ta("pageReference.pageChanged"));
    const reference = await desktop.invoke<PageReference>("pages:reference", {
      projectId,
      pageId,
      target,
      ...(record ? { expectedHash: record.hash } : {}),
    });
    await desktop.invoke("clipboard:write", {
      text: formatReference(reference, referenceHeading(ta, reference)),
    });
    setNotice(
      ta("pageReference.copied", { version: referenceVersion(reference) }),
    );
  }
  async function locateAssistantTarget(pageId: string, ids: string[]) {
    const projectId = page.projectId ?? selectedProject;
    if (page.draft?.id !== pageId && !(await openPage(pageId, projectId)))
      return;
    if (ids[0]) setRevealNode(ids[0]);
    // Editors own their DOM attributes, so the highlight is a separate overlay.
    // A page that is still opening gets a moment to render its content.
    const started = Date.now();
    const flash = () => {
      const scope = document.querySelector(".studio-main");
      const found = ids
        .map((id) =>
          scope?.querySelector(
            `[data-surface-id="${CSS.escape(id)}"],[data-block-id="${CSS.escape(id)}"]`,
          ),
        )
        .filter((element): element is Element => !!element);
      if (!found.length && Date.now() - started < 3000) {
        window.setTimeout(flash, 160);
        return;
      }
      found[0]?.scrollIntoView({ block: "center" });
      for (const element of found) {
        const rect = element.getBoundingClientRect();
        const box = document.createElement("div");
        box.className = "assistant-flash";
        Object.assign(box.style, {
          left: `${rect.left - 4}px`,
          top: `${rect.top - 4}px`,
          width: `${rect.width + 8}px`,
          height: `${rect.height + 8}px`,
        });
        document.body.append(box);
        window.setTimeout(() => box.remove(), 1600);
      }
    };
    window.setTimeout(flash, 240);
  }
  async function openPage(id: string, projectId = selectedProject) {
    if (routingRef.current) return false;
    workspace.rememberScroll();
    routingRef.current = true;
    setRouting(true);
    try {
      if (!projectId) return false;
      if (await page.open(projectId, id, workspace.activeId)) {
        selectedRef.current = projectId;
        setSelectedProject(projectId);
        setExpandedProjects((current) => ({ ...current, [projectId]: true }));
        setView("page");
        const loaded = contents[projectId];
        const parentId =
          page.sessions.getSnapshot().active?.getSnapshot().draft?.parentId ??
          loaded?.pages.find((item) => item.id === id)?.parentId ??
          null;
        setSelectedFolder(parentId);
        expandFolderPath(loaded?.folders ?? [], parentId);
        setView("page");
        performance.clearMarks("showai:page-visible");
        performance.mark("showai:page-visible");
        if (!loaded) void loadProjectContents(projectId).catch(report);
        setContextMenu(null);
        return true;
      }
      return false;
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  }
  async function openTarget(
    target: LibraryTarget,
    disposition: OpenDisposition = "current",
  ) {
    if (!workspaceReady || routingRef.current || workspace.switching)
      return false;
    if ((!capabilities.tabs && disposition !== "window") ||
        (!capabilities.windows && disposition === "window")) disposition = "current";
    if (disposition === "window") {
      return desktop.openWindow(
        {
          projectId: target.projectId,
          ...(target.kind === "page" ? { pageId: target.id } : {}),
          ...(target.kind === "folder" ? { folderId: target.id } : {}),
        },
        page.flush,
      );
    }
    if (disposition !== "current")
      return workspace.open(libraryEntry(target));
    return target.kind === "page"
      ? openPage(target.id, target.projectId)
      : openProject(
          target.projectId,
          target.kind === "folder" ? target.id : null,
        );
  }
  function openTargetClick(
    target: LibraryTarget,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    void openTarget(
      target,
      clickDisposition(event, info?.platform === "darwin"),
    ).catch((error) =>
      report(error, { action: operation("op.open"), object: target.title }),
    );
  }
  /** Built-in documentation opens like a page: in this tab, or a new one on a modified click. */
  async function openDoc(
    id: string,
    hash = "",
    disposition: OpenDisposition = "current",
  ) {
    if (!workspaceReady || routingRef.current || workspace.switching)
      return false;
    const meta = docTitle(id);
    if (
      capabilities.tabs &&
      (disposition === "tab" || disposition === "foreground-tab")
    )
      return workspace.open(
        {
          location: {
            view: "docs",
            projectId: null,
            folderId: null,
            pageId: id,
          },
          title: meta.title,
          icon: meta.icon,
          scrollTop: 0,
        },
      );
    workspace.rememberScroll();
    routingRef.current = true;
    setRouting(true);
    try {
      if (!(await page.leave())) {
        setView("page");
        return false;
      }
      setContextMenu(null);
      setQuery("");
      selectedRef.current = null;
      setSelectedProject(null);
      setSelectedFolder(null);
      setEditorControls(null);
      setDocPage({ id, hash });
      setView("docs");
      return true;
    } finally {
      routingRef.current = false;
      setRouting(false);
    }
  }
  async function beginNewPage(projectId: string, parentId: string | null) {
    const choices = await desktop.invoke<TemplateMetadata[]>("templates:list", {
      projectId,
    });
    setContextMenu(null);
    setDialog({ type: "newPage", projectId, parentId, templates: choices });
  }
  function expandFolderPath(items: FolderMetadata[], parentId: string | null) {
    const expanded: Record<string, boolean> = {};
    while (parentId && !expanded[parentId]) {
      expanded[parentId] = true;
      parentId = items.find((item) => item.id === parentId)?.parentId ?? null;
    }
    setExpandedFolders((current) => ({ ...current, ...expanded }));
  }
  async function createPage(
    templateId = "blank",
    template?: TemplateMetadata,
    kind?: "page" | "board",
    directory?: { projectId: string; parentId: string | null },
  ) {
    const projectId =
      directory?.projectId ??
      (dialog?.type === "newPage" ? dialog.projectId : selectedProject);
    const parentId = directory
      ? directory.parentId
      : dialog?.type === "newPage"
        ? dialog.parentId
        : selectedFolder;
    if (!projectId) return;
    if (!(await page.flush())) {
      setDialog(null);
      setView("page");
      return;
    }
    setBusy(true);
    try {
      const created = await desktop.invoke<LoadedPage>("pages:create", {
        projectId,
        parentId,
        templateId,
        kind,
        templateVersion: template?.version,
        templateScope: template?.scope,
        templateIntegrity: template?.integrity,
      });
      await page.open(
        projectId,
        created.document.id,
        workspace.activeId,
        created,
      );
      selectedRef.current = projectId;
      setSelectedProject(projectId);
      setSelectedFolder(parentId);
      setExpandedProjects((current) => ({ ...current, [projectId]: true }));
      setDialog(null);
      setView("page");
      await refresh();
    } catch (reason) {
      report(reason, { action: operation("op.createPage") });
    } finally {
      setBusy(false);
    }
  }
  async function importPage() {
    if (!selectedProject) return;
    if (!(await page.flush())) return;
    const file = await desktop.invoke<{ name: string; content: string } | null>(
      "dialog:openPage",
    );
    if (!file) return;
    let artifact: ShowArtifact;
    if (/\.(md|markdown|txt)$/i.test(file.name)) {
      const document = newDocument(file.name.replace(/\.[^.]+$/, ""));
      document.content = parseMarkdown(file.content);
      artifact = { format: "showai", version: 1, document };
    } else if (/\.html?$/i.test(file.name)) {
      const dom = new DOMParser().parseFromString(file.content, "text/html");
      artifact = parseArtifact(
        dom.getElementById("showai-data")?.textContent ?? "",
      );
    } else artifact = parseArtifact(file.content);
    const imported = await desktop.invoke<LoadedPage>("pages:import", {
      projectId: selectedProject,
      parentId: selectedFolder,
      artifact,
    });
    await openPage(imported.document.id, selectedProject);
    setView("page");
    await refresh();
    setNotice(t("pageImported"));
  }
  /**
   * Data read from files outside the library is embedded as a snapshot only
   * after the person sees its size: "embed", undefined (none) or null (cancel).
   */
  async function externalDataChoice(
    projectId: string,
    pageId?: string,
  ): Promise<"embed" | undefined | null> {
    const report = await desktop.invoke<ExternalSnapshotReport>(
      "export:analyze",
      { projectId, ...(pageId ? { pageId } : {}) },
    );
    if (!report.datasets.length) return undefined;
    const embed = await new Promise<boolean>((decide) =>
      setSnapshotDecision({ report, decide }),
    );
    setSnapshotDecision(null);
    return embed ? "embed" : null;
  }
  async function exportPage(
    format: "html" | "json" | "inline",
    components: "bundled" | "remote" = "bundled",
    presentation?: "spatial" | "reading",
    reader?: "bundled" | "cdn",
  ) {
    if (!selectedProject || !page.draft || !(await page.flush())) return;
    setBusy(true);
    setContextMenu(null);
    try {
      const externalData = await externalDataChoice(
        selectedProject,
        page.draft.id,
      );
      if (externalData === null) return;
      const result = await desktop.invoke<{ path: string } | null>(
        "export:page",
        {
          projectId: selectedProject,
          pageId: page.draft.id,
          format,
          components,
          presentation,
          reader,
          ...(externalData ? { externalData } : {}),
        },
      );
      resolveProblem(operation("op.exportPage"));
      if (result) setNotice(t("pageExported"));
    } catch (reason) {
      report(reason, {
        action: operation("op.exportPage"),
        retry: () => void exportPage(format, components, presentation, reader),
        handlers: {
          chooseLocation: () =>
            void exportPage(format, components, presentation, reader),
        },
      });
    } finally {
      setBusy(false);
    }
  }
  async function exportSite(components: "bundled" | "remote" = "bundled") {
    if (!selectedProject || !(await page.flush())) return;
    setBusy(true);
    try {
      const externalData = await externalDataChoice(selectedProject);
      if (externalData === null) return;
      const result = await desktop.invoke<{ path: string } | null>(
        "export:site",
        {
          projectId: selectedProject,
          components,
          ...(externalData ? { externalData } : {}),
        },
      );
      resolveProblem(operation("op.exportSite"));
      if (result)
        setNotice(
          components === "remote"
            ? t("siteExportedRemote")
            : t("siteExportedBundled"),
        );
    } catch (reason) {
      report(reason, {
        action: operation("op.exportSite"),
        retry: () => void exportSite(components),
        handlers: { chooseLocation: () => void exportSite(components) },
      });
    } finally {
      setBusy(false);
    }
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
  });
  const activePageTarget = (): LibraryTarget | null =>
    page.draft && page.projectId
      ? {
          kind: "page",
          projectId: page.projectId,
          id: page.draft.id,
          title: page.draft.title || tc("untitled"),
          icon: page.draft.icon,
          pinned: page.draft.favorite,
          parentId: page.draft.parentId,
        }
      : null;
  const showMenu = (
    target: LibraryTarget,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
    pageTools = false,
    creationOnly = false,
  ) =>
    setContextMenu((current) =>
      !point && current?.anchor === anchor && current.target.id === target.id
        ? null
        : { target, anchor, point, pageTools, creationOnly },
    );
  function creationMenuItems(target: LibraryTarget): LibraryContextMenuItem[] {
    const directory = {
      projectId: target.projectId,
      parentId: target.kind === "folder" ? target.id : target.parentId,
    };
    return [
      {
        label: t("create.folder"),
        icon: <FolderPlus size={15} />,
        onSelect: () => setDialog({ type: "folder", ...directory }),
      },
      {
        label: t("create.page"),
        icon: <FileText size={15} />,
        onSelect: action(() =>
          createPage("blank", undefined, "page", directory),
        ),
      },
      {
        label: t("create.board"),
        icon: <LayoutTemplate size={15} />,
        onSelect: action(() =>
          createPage("blank", undefined, "board", directory),
        ),
      },
    ];
  }
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
  async function beginPageIcon(target: LibraryTarget) {
    if (!(await page.flush())) return;
    const record = await desktop.invoke<LoadedPage>("pages:get", {
      projectId: target.projectId,
      pageId: target.id,
    });
    setDialog({
      type: "pageIcon",
      target,
      value: record.document.icon,
      record,
    });
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
  async function changeDirectorySort(
    target: LibraryTarget,
    sortBy: DirectorySortBy,
  ) {
    await reorderQueue.current;
    await desktop.invoke("directory:sort", {
      expectedHome: info?.home,
      projectId: target.projectId,
      parentId: target.kind === "folder" ? target.id : null,
      sortBy,
    });
    await refresh();
  }
  function directorySortMenuItems(
    target: LibraryTarget,
  ): LibraryContextMenuItem[] {
    if (target.kind === "page") return [];
    const preferences = folderPreferences(
      target.projectId,
      target.kind === "folder" ? target.id : null,
    );
    const sortBy = preferences.sortBy ?? "updatedAt";
    const options: { value: DirectorySortBy }[] = [
      ...directorySortOptions,
      ...(sortBy === "manual" || preferences.manualOrder?.length
        ? [{ value: "manual" as const }]
        : []),
    ];
    return [
      directoryViewControl(),
      ...options.map((option, index) => ({
      label: t(`sort.${option.value}`),
      checked: option.value === sortBy,
      icon:
        option.value === sortBy ? (
          <Check size={15} />
        ) : (
          <ListOrdered size={15} />
        ),
      separatorBefore: index === 0,
      onSelect: action(() => changeDirectorySort(target, option.value)),
      })),
    ];
  }
  async function moveProject(projectId: string, groupId: string | null) {
    await desktop.invoke("projects:group", { projectId, groupId });
    await refresh();
  }
  function projectOrderMenuItems(target: LibraryTarget) {
    if (target.kind !== "project") return [];
    const sectionFor = (item: ProjectSummary) =>
      item.pinned
        ? "pinned"
        : (organization.projectGroups[item.id] ?? "projects");
    const project = projects.find((item) => item.id === target.id);
    if (!project) return [];
    const sectionId = sectionFor(project);
    const siblings = orderSidebarProjects(
      projects,
      organization.projectOrder,
    ).filter((item) => sectionFor(item) === sectionId);
    const index = siblings.findIndex((item) => item.id === target.id);
    return ([-1, 1] as const).map((direction) => ({
      label: t(direction < 0 ? "moveProjectUp" : "moveProjectDown"),
      icon: direction < 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />,
      disabled: !siblings[index + direction] || movingLibrary.current,
      onSelect: action(() =>
        dropLibraryItem({
          source: target,
          sectionId,
          relativeId: siblings[index + direction]?.id,
          placement: direction < 0 ? "before" : "after",
        }),
      ),
    }));
  }
  const movingLibrary = useRef(false);
  const libraryUndo = useRef<{ undo: LibraryDrop; redo: LibraryDrop }[]>([]);
  const libraryRedo = useRef<{ undo: LibraryDrop; redo: LibraryDrop }[]>([]);
  const historyBusy = useRef(false);
  const [, refreshLibraryHistory] = useState(0);
  function inverseLibraryDrop(drop: LibraryDrop): LibraryDrop {
    const source = drop.source;
    const siblings =
      source.kind === "project"
        ? orderSidebarProjects(projects, organization.projectOrder)
            .filter(
              (item) =>
                (item.pinned
                  ? "pinned"
                  : (organization.projectGroups[item.id] ?? "projects")) ===
                (source.pinned
                  ? "pinned"
                  : (organization.projectGroups[source.id] ?? "projects")),
            )
            .map((item) => item.id)
        : sortDirectoryItems(
            directoryEntries(
              contents[source.projectId]?.folders ?? [],
              contents[source.projectId]?.pages ?? [],
            ).filter((item) => item.parentId === source.parentId),
            folderPreferences(source.projectId, source.parentId),
            organization.entryOrder?.[source.projectId],
          ).map((item) => item.id);
    const index = siblings.indexOf(source.id);
    const next = siblings[index + 1],
      previous = siblings[index - 1];
    return {
      source:
        source.kind === "project"
          ? source
          : {
              ...source,
              projectId: drop.projectId ?? source.projectId,
              parentId: drop.parentId ?? null,
            },
      projectId: source.projectId,
      parentId: source.parentId,
      sectionId:
        source.kind === "project"
          ? source.pinned
            ? "pinned"
            : (organization.projectGroups[source.id] ?? "projects")
          : undefined,
      relativeId: next ?? previous,
      placement: next ? "before" : "after",
    };
  }
  async function replayLibraryMove(redo: boolean) {
    if (historyBusy.current || movingLibrary.current) return;
    const from = redo ? libraryRedo.current : libraryUndo.current;
    const to = redo ? libraryUndo.current : libraryRedo.current;
    const entry = from.at(-1);
    if (!entry) return;
    historyBusy.current = true;
    refreshLibraryHistory((value) => value + 1);
    try {
      if (await dropLibraryItem(redo ? entry.redo : entry.undo, false)) {
        from.pop();
        to.push(entry);
      }
    } finally {
      historyBusy.current = false;
      refreshLibraryHistory((value) => value + 1);
    }
  }
  const replayLibraryRef = useRef(replayLibraryMove);
  replayLibraryRef.current = replayLibraryMove;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z")
        return;
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,[contenteditable=true],.page-surface"))
        return;
      if (
        !target.closest(".studio-sidebar,.studio-library,.studio-topbar") &&
        view !== "project" &&
        view !== "projects"
      )
        return;
      const stack = event.shiftKey ? libraryRedo.current : libraryUndo.current;
      if (!stack.length) return;
      event.preventDefault();
      event.stopPropagation();
      void replayLibraryRef.current(event.shiftKey).catch((error) =>
        report(error, {
          action: operation(event.shiftKey ? "op.redoMove" : "op.undoMove"),
        }),
      );
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [view]);
  function reorderLibraryItem(drop: LibraryDrop) {
    const source = drop.source;
    const current = contents[source.projectId];
    const home = info?.home;
    if (!current || !home) return Promise.resolve(false);
    const siblings = sortDirectoryItems(
      directoryEntries(current.folders, current.pages).filter(
        (item) => item.parentId === source.parentId,
      ),
      folderPreferences(source.projectId, source.parentId),
      organization.entryOrder?.[source.projectId],
    ).map((item) => item.id);
    const token = ++sidebarRevision.current;
    reorderCount.current++;
    setPendingReorders((pending) => [
      ...pending,
      {
        token,
        home,
        projectId: source.projectId,
        parentId: source.parentId,
        id: source.id,
        siblings,
        relativeId: drop.relativeId,
        placement: drop.placement,
      },
    ]);
    const result = reorderQueue.current.then(async () => {
      let failed = false;
      try {
        const saved = await desktop.invoke<SidebarOrganization>(
          "sidebar:moveEntry",
          {
            expectedHome: home,
            reorderOnly: true,
            kind: source.kind,
            projectId: source.projectId,
            destinationProjectId: source.projectId,
            id: source.id,
            parentId: source.parentId,
            relativeId: drop.relativeId,
            placement: drop.placement,
          },
        );
        if (sidebarHome.current === home) {
          setOrganization(saved);
          await refresh();
          setNotice(t("moved"));
        }
      } catch (error) {
        failed = true;
        report(error, { action: operation("op.move") });
      } finally {
        sidebarRevision.current++;
        reorderCount.current--;
        setPendingReorders((pending) =>
          pending.filter((move) => move.token !== token),
        );
        if (failed && sidebarHome.current === home)
          void refresh().catch(report);
      }
      return !failed;
    });
    reorderQueue.current = result.then(() => {});
    return result;
  }
  async function dropLibraryItem(drop: LibraryDrop, recordHistory = true) {
    if (movingLibrary.current) return false;
    const inverse = recordHistory ? inverseLibraryDrop(drop) : null;
    const remember = () => {
      if (!inverse) return;
      libraryUndo.current.push({ undo: inverse, redo: drop });
      if (libraryUndo.current.length > 100) libraryUndo.current.shift();
      libraryRedo.current = [];
      refreshLibraryHistory((value) => value + 1);
    };
    if (
      drop.source.kind !== "project" &&
      drop.source.projectId === drop.projectId &&
      drop.source.parentId === drop.parentId
    ) {
      const success = await reorderLibraryItem(drop);
      if (success) remember();
      return success;
    }
    const home = info?.home;
    if (!home) return false;
    movingLibrary.current = true;
    setNotice("");
    const source = drop.source;
    const activePage =
      source.kind === "page" &&
      page.projectId === source.projectId &&
      page.draft?.id === source.id;
    const crossProject =
      source.kind !== "project" && source.projectId !== drop.projectId;
    const reopen = activePage && crossProject;
    const token = ++sidebarRevision.current;
    reorderCount.current++;
    const change: DesktopChange = {
      type: "files",
      home,
      sidebar: true,
      projectIds: [
        ...new Set([source.projectId, drop.projectId ?? source.projectId]),
      ],
      ...(source.kind === "page" ? { pageIds: [source.id] } : {}),
    };
    if (source.kind !== "project") {
      setPendingLibraryMove({ home, drop });
      setExpandedProjects((current) => ({
        ...current,
        [drop.projectId!]: true,
      }));
      if (drop.parentId)
        setExpandedFolders((current) => ({
          ...current,
          [drop.parentId!]: true,
        }));
      const preferences = folderPreferences(
        drop.projectId!,
        drop.parentId ?? null,
      );
      if (drop.relativeId || preferences.sortBy === "manual") {
        const destination = contents[drop.projectId!];
        const siblings = sortDirectoryItems(
          directoryEntries(
            destination?.folders ?? [],
            destination?.pages ?? [],
          ).filter((item) => item.parentId === (drop.parentId ?? null)),
          preferences,
          organization.entryOrder?.[drop.projectId!],
        ).map((item) => item.id);
        setPendingReorders((pending) => [
          ...pending,
          {
            token,
            home,
            projectId: drop.projectId!,
            parentId: drop.parentId,
            id: source.id,
            siblings,
            relativeId: drop.relativeId,
            placement: drop.placement,
          },
        ]);
      }
    }
    let moved = false;
    let cleared = false;
    try {
      await reorderQueue.current;
      if (source.kind !== "project" && !(await page.flush())) {
        setView("page");
        return false;
      }
      if (crossProject && !(await page.sessions.flushAll())) return false;
      if (source.kind === "project") {
        const saved = await desktop.invoke<SidebarOrganization>(
          "sidebar:moveProject",
          {
            expectedHome: home,
            projectId: source.id,
            sectionId: drop.sectionId,
            relativeId: drop.relativeId,
            placement: drop.placement,
          },
        );
        if (sidebarHome.current === home) setOrganization(saved);
        if (drop.sectionId)
          setCollapsedSections((current) => ({
            ...current,
            [drop.sectionId!]: false,
          }));
      } else {
        const record =
          source.kind === "page"
            ? await desktop.invoke<LoadedPage>("pages:get", {
                expectedHome: home,
                projectId: source.projectId,
                pageId: source.id,
              })
            : null;
        if (reopen && !(await page.clear())) return false;
        cleared = reopen;
        const saved = await desktop.invoke<SidebarOrganization>(
          "sidebar:moveEntry",
          {
            expectedHome: home,
            kind: source.kind,
            projectId: source.projectId,
            id: source.id,
            destinationProjectId: drop.projectId,
            parentId: drop.parentId,
            relativeId: drop.relativeId,
            placement: drop.placement,
            baseHash: record?.hash,
            baseRevision: record?.revision,
          },
        );
        moved = true;
        if (sidebarHome.current === home) setOrganization(saved);
        if (crossProject) page.sessions.forgetPage(source.projectId, source.id);
        else if (source.kind === "page") page.sessions.invalidate(change);
        if (activePage && !crossProject)
          setSelectedFolder(drop.parentId ?? null);
      }
      moved = true;
      remember();
      if (reopen) await openPage(source.id, drop.projectId!);
      // Confirm only the affected projects; unrelated libraries can be large.
      await refresh(change);
      return true;
    } catch (error) {
      if (reopen && cleared)
        await openPage(
          source.id,
          moved ? drop.projectId! : source.projectId,
        ).catch(report);
      report(error, { action: operation("op.move") });
      return moved;
    } finally {
      if (moved && source.kind !== "project" && sidebarHome.current === home)
        setContents((current) => applyLibraryMove(current, drop));
      setPendingLibraryMove(null);
      setPendingReorders((pending) =>
        pending.filter((move) => move.token !== token),
      );
      sidebarRevision.current++;
      reorderCount.current--;
      movingLibrary.current = false;
      if (moved && sidebarHome.current === home)
        setNotice(
          t("moved"),
          inverse
            ? {
                action: {
                  label: operation("toast.undo"),
                  onSelect: () =>
                    void replayLibraryRef.current(false).catch((error) =>
                      report(error, { action: operation("op.undoMove") }),
                    ),
                },
              }
            : undefined,
        );
    }
  }
  const libraryDrag = useLibraryDragController({
    sectionFor: (id) =>
      projects.find((item) => item.id === id)?.pinned
        ? "pinned"
        : (organization.projectGroups[id] ?? "projects"),
    parentFor: (projectId, id) =>
      contents[projectId]?.folders.find((item) => item.id === id)?.parentId ??
      null,
    onDrop: (drop) => dropLibraryItem(drop),
    onStart: () => {
      setContextMenu(null);
      setProjectsMenu(null);
      setGroupMenu(null);
    },
  });
  async function updateTarget(
    target: LibraryTarget,
    change: { name?: string; icon?: string; pinned?: boolean },
  ) {
    if (!(await page.flush())) {
      setView("page");
      return false;
    }
    if (
      target.kind === "page" &&
      page.draft?.id === target.id &&
      page.projectId === target.projectId
    ) {
      page.edit({
        ...(change.name !== undefined ? { title: change.name } : {}),
        ...(change.pinned !== undefined ? { favorite: change.pinned } : {}),
      });
      if (!(await page.flush())) return false;
    } else if (target.kind === "page") {
      const record = await desktop.invoke<LoadedPage>("pages:get", {
        projectId: target.projectId,
        pageId: target.id,
      });
      await desktop.invoke(
        change.name !== undefined ? "pages:rename" : "pages:pin",
        {
          projectId: target.projectId,
          pageId: target.id,
          baseHash: record.hash,
          baseRevision: record.revision,
          ...(change.name !== undefined
            ? { title: change.name }
            : { pinned: change.pinned }),
        },
      );
    } else {
      await desktop.invoke(
        `${target.kind === "project" ? "projects" : "folders"}:${change.name !== undefined ? "rename" : "pin"}`,
        {
          projectId: target.projectId,
          ...(target.kind === "folder" ? { folderId: target.id } : {}),
          ...change,
        },
      );
    }
    await refresh();
    return true;
  }
  async function deleteTarget(target: LibraryTarget) {
    if (!(await page.flush())) {
      setDialog(null);
      setView("page");
      return;
    }
    const owning = contents[target.projectId];
    const insideFolder = (parentId: string | null): boolean => {
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (parentId === target.id) return true;
        visited.add(parentId);
        parentId =
          owning?.folders.find((item) => item.id === parentId)?.parentId ??
          null;
      }
      return false;
    };
    const closePage =
      page.projectId === target.projectId &&
      (target.kind === "project" ||
        (target.kind === "page" && page.draft?.id === target.id) ||
        (target.kind === "folder" &&
          insideFolder(page.draft?.parentId ?? null)));
    const currentRecord =
      target.kind === "page"
        ? await desktop.invoke<LoadedPage>("pages:get", {
            projectId: target.projectId,
            pageId: target.id,
          })
        : null;
    if (closePage && !(await page.clear())) return;
    await desktop.invoke(
      `${target.kind === "project" ? "projects" : target.kind === "folder" ? "folders" : "pages"}:remove`,
      {
        projectId: target.projectId,
        ...(target.kind === "folder" ? { folderId: target.id } : {}),
        ...(currentRecord
          ? {
              pageId: target.id,
              baseHash: currentRecord.hash,
              baseRevision: currentRecord.revision,
            }
          : {}),
      },
    );
    setDialog(null);
    setContextMenu(null);
    if (target.kind === "project" && selectedRef.current === target.projectId) {
      setSelectedProject(null);
      selectedRef.current = null;
      setSelectedFolder(null);
      setView("projects");
    } else if (
      selectedRef.current === target.projectId &&
      (closePage || (target.kind === "folder" && insideFolder(selectedFolder)))
    ) {
      setSelectedFolder(
        target.kind === "folder" ? target.parentId : selectedFolder,
      );
      setView("project");
    }
    await refresh();
    setNotice(t("deleted"));
  }
  function renderChildren(
    projectId: string,
    parentId: string | null = null,
    depth = 0,
  ): ReactNode {
    if (depth > 30) return null;
    const current = contents[projectId];
    if (!current) return null;
    const folderIds = new Set(current.folders.map((item) => item.id));
    const targets = sortDirectoryItems(
      [
        ...current.folders
          .filter((item) => (item.parentId ?? null) === parentId)
          .map((item) => ({ ...item, target: folderTarget(item, projectId) })),
        ...current.pages
          .filter(
            (item) =>
              (item.parentId && folderIds.has(item.parentId)
                ? item.parentId
                : null) === parentId,
          )
          .map((item) => ({
            ...item,
            name: item.title || tc("untitled"),
            pinned: item.favorite,
            target: pageTarget(item, projectId),
          })),
      ],
      folderPreferences(projectId, parentId),
      organization.entryOrder?.[projectId],
    ).map((item) => item.target);
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
        />
        {target.kind === "folder" && expandedFolders[target.id] && (
          <div className="studio-tree-children">
            {renderChildren(projectId, target.id, depth + 1)}
          </div>
        )}
      </div>
    ));
  }
  async function addBlock(kind: string, data: Record<string, unknown>) {
    if (
      !page.draft ||
      !page.projectId ||
      page.projectId !== selectedRef.current
    ) {
      setNotice(t("openPageFirst"), { kind: "warning" });
      return;
    }
    const source = upgradeResource(page.draft);
    const owner =
      activeSurface.current?.pageId === source.id
        ? findSurfaceNode(source, activeSurface.current.surfaceId)?.node
        : undefined;
    const destination =
      owner && ["surface", "region"].includes(owner.type ?? "")
        ? owner
        : source.content;
    const inserted = insertComponent(source, destination.attrs!.id, kind, data);
    const nodeId = inserted.nodeId;
    page.edit(inserted.document);
    if (!(await page.flush())) return;
    setDialog(null);
    setRevealNode(nodeId);
    setSelectedProject(page.projectId);
    selectedRef.current = page.projectId;
    setView("page");
  }
  async function viewComponent(
    item: CatalogComponent,
    expectedDialog?: Exclude<DialogState, null>,
  ) {
    const owner =
      !("kind" in item) && item.projectId
        ? item.projectId
        : componentProjectRef.current !== "all"
          ? componentProjectRef.current
          : undefined;
    if ("kind" in item) {
      setDialog({ type: "component", builtin: item, projectId: owner });
      return;
    }
    const custom = await desktop.invoke<CompiledComponent>("components:get", {
      id: item.id,
      version: item.version,
      scope: item.scope,
      integrity: item.integrity,
      ...(owner ? { projectId: owner } : {}),
    });
    if (!expectedDialog || dialogRef.current === expectedDialog)
      setDialog({ type: "component", custom, projectId: owner });
  }

  const pickerLibrary = useMemo(
    () => ({
      list: () =>
        desktop.invoke<CatalogComponent[]>("components:list", {
          projectId: selectedProject ?? undefined,
          scope: "all",
        }),
      read: (item: CatalogCustomComponent) =>
        desktop.invoke<CompiledComponent>("components:get", {
          id: item.id,
          version: item.version,
          integrity: item.integrity,
          scope: item.scope,
          projectId: selectedProject ?? undefined,
        }),
    }),
    [selectedProject],
  );
  const loading = !info && !problemQueue.problems.length;
  const recent = useMemo(
    () => recentPages(projects, contents),
    [projects, contents],
  );
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
  const catalogTemplates = (
    showTemplateVersions ? templates : latestTemplateVersions(templates)
  )
    .slice()
    .sort((a, b) => {
      const priority = (item: TemplateMetadata) =>
        item.scope === "project"
          ? -3
          : item.workflow && item.id !== "system-presentation"
            ? -2
            : item.id === "system-presentation"
              ? 2
              : 0;
      return priority(a) - priority(b);
    });
  const visibleTemplates = catalogTemplates.filter(
    (item) =>
      matchesTemplateType(item, templateType) &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(catalogQueries.templates.toLowerCase()),
  );
  const folderIds = new Set(folders.map((item) => item.id));
  const currentFolder = folders.find((item) => item.id === selectedFolder);
  const filteredPages = pages.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) &&
      (query ||
        (item.parentId && folderIds.has(item.parentId)
          ? item.parentId
          : null) === selectedFolder),
  );
  const filteredFolders = folders.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (query || (item.parentId ?? null) === selectedFolder),
  );
  const visibleEntries = sortDirectoryItems(
    [
      ...filteredFolders.map((item) => ({
        target: folderTarget(item, selectedProject!),
        name: item.name,
        pinned: item.pinned,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      ...filteredPages.map((item) => ({
        target: pageTarget(item, selectedProject!),
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
      .map(({ kind, id, updatedAt }) => ({ kind, id, updatedAt }));
  }
  const pageSelection = useDirectoryPageSelection(
    JSON.stringify([info?.home, view, selectedProject, selectedFolder, query]),
    visibleEntries.map((item) => item.id),
  );
  const directoryMarquee = useDirectoryMarquee(
    pageSelection,
    JSON.stringify([info?.home, view, selectedProject, selectedFolder, query]),
    view === "project" && !dialog,
  );
  const selectedPageTargets = visibleEntries
    .filter((item) => pageSelection.ids.includes(item.id))
    .map((item) => item.target);
  function beginBatchPages(operation: "move" | "delete") {
    if (!selectedPageTargets.length) return;
    setContextMenu(null);
    setDialog({ type: "batchPages", operation, targets: selectedPageTargets });
  }
  async function applyBatchPages(destination?: PageDestination) {
    if (dialog?.type !== "batchPages" || movingLibrary.current) return;
    const { operation, targets } = dialog;
    const home = info?.home;
    let completed = 0;
    const done = new Set<string>();
    movingLibrary.current = true;
    try {
      await reorderQueue.current;
      if (!(await page.flush()) || !(await page.sessions.flushAll())) {
        setDialog(null);
        setView("page");
        return;
      }
      const folderIds = new Set(
        targets.filter((target) => target.kind === "folder").map((target) => target.id),
      );
      const insideSelectedFolder = (
        projectId: string | null,
        parentId: string | null,
      ) => {
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
          if (folderIds.has(parentId)) return true;
          seen.add(parentId);
          parentId =
            contents[projectId ?? ""]?.folders.find(
              (item) => item.id === parentId,
            )?.parentId ?? null;
        }
        return false;
      };
      const openInsideFolder = insideSelectedFolder(
        page.projectId,
        page.draft?.parentId ?? null,
      );
      if (
        targets.some(
          (target) =>
            target.projectId === page.projectId && target.id === page.draft?.id,
        ) ||
        (operation === "delete" && openInsideFolder)
      ) {
        if (!(await page.clear())) return;
      }
      // Pages go first so a page inside a selected folder is handled before its folder.
      for (const target of [
        ...targets.filter((target) => target.kind === "page"),
        ...targets.filter((target) => target.kind === "folder"),
      ]) {
        if (target.kind === "folder") {
          if (operation === "delete")
            await desktop.invoke("folders:remove", {
              expectedHome: home,
              projectId: target.projectId,
              folderId: target.id,
            });
          else {
            if (!destination)
              throw new Error("A destination is required to move folders.");
            await desktop.invoke("sidebar:moveEntry", {
              expectedHome: home,
              kind: "folder",
              projectId: target.projectId,
              id: target.id,
              destinationProjectId: destination.projectId,
              parentId: destination.parentId,
              placement: "after",
            });
          }
          completed++;
          done.add(target.id);
          pageSelection.remove(target.id);
          continue;
        }
        const record = await desktop.invoke<LoadedPage>("pages:get", {
          expectedHome: home,
          projectId: target.projectId,
          pageId: target.id,
        });
        if (operation === "delete") {
          await desktop.invoke("pages:remove", {
            expectedHome: home,
            projectId: target.projectId,
            pageId: target.id,
            baseHash: record.hash,
            baseRevision: record.revision,
          });
        } else {
          if (!destination)
            throw new Error("A destination is required to move pages.");
          await desktop.invoke("sidebar:moveEntry", {
            expectedHome: home,
            kind: "page",
            projectId: target.projectId,
            id: target.id,
            destinationProjectId: destination.projectId,
            parentId: destination.parentId,
            placement: "after",
            baseHash: record.hash,
            baseRevision: record.revision,
          });
        }
        completed++;
        done.add(target.id);
        page.sessions.forgetPage(target.projectId, target.id);
        pageSelection.remove(target.id);
      }
      if (destination) {
        setExpandedProjects((current) => ({
          ...current,
          [destination.projectId]: true,
        }));
        if (destination.parentId)
          setExpandedFolders((current) => ({
            ...current,
            [destination.parentId!]: true,
          }));
      }
      pageSelection.clear();
      setDialog(null);
      if (
        operation === "delete" &&
        insideSelectedFolder(selectedProject, selectedFolder)
      )
        setSelectedFolder(null);
      setNotice(
        t(operation === "move" ? "pagesMoved" : "pagesDeleted", {
          count: completed,
        }),
      );
    } catch (reason) {
      setDialog((current) =>
        current?.type === "batchPages"
          ? {
              ...current,
              targets: targets.filter((target) => !done.has(target.id)),
            }
          : current,
      );
      throw new Error(
        t("batchPageFailed", {
          completed,
          remaining: targets.length - completed,
          error: errorMessage(reason),
        }),
      );
    } finally {
      movingLibrary.current = false;
      await refresh().catch(report);
    }
  }
  const docFolders = useBuiltinDocFolders(
    view === "docs" ? (docPage?.id ?? null) : null,
  );
  const docMeta = view === "docs" && docPage ? docTitle(docPage.id) : null;
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
      const loaded = target.projectId ? contents[target.projectId] : null;
      if (target.view === "page" && target.projectId && target.pageId) {
        if (!(await page.open(target.projectId, target.pageId, tabId)))
          return false;
      } else if (!(await page.clear())) return false;
      selectedRef.current = target.projectId;
      setSelectedProject(target.projectId);
      const folderId =
        target.view === "page"
          ? (page.sessions.getSnapshot().active?.getSnapshot().draft
              ?.parentId ??
            loaded?.pages.find((item) => item.id === target.pageId)?.parentId ??
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
      setQuery("");
      setSearchLibrary(false);
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
    },
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
  useEffect(() => {
    if (!capabilities.tabs) return;
    const command = (command: TabCommand) => {
      if (dialogRef.current || !workspaceReady || routingRef.current) return;
      const index = workspace.tabs.findIndex(
        (tab) => tab.id === workspace.activeId,
      );
      const operation =
        command === "new"
          ? workspace.add
          : command === "close"
            ? () => workspace.close()
            : () =>
                workspace.select(
                  workspace.tabs[
                    (index +
                      (command === "next" ? 1 : workspace.tabs.length - 1)) %
                      workspace.tabs.length
                  ].id,
                );
      void operation().catch(report);
    };
    const key = (event: KeyboardEvent) => {
      const shortcut = tabShortcut(event);
      if (!shortcut || event.defaultPrevented || dialogRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) command(shortcut);
    };
    const unsubscribe = desktop.onTabCommand(command);
    window.addEventListener("keydown", key, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", key, true);
    };
  }, [workspace, workspaceReady, report, capabilities.tabs]);
  const action = (operation: () => Promise<unknown>) => () => {
    void operation().catch(report);
  };

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
      if (!(await openTarget(target, disposition)))
        throw new Error(t("resolveDraftFirst"));
      if (disposition === "tab" || disposition === "foreground-tab")
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
      if (!(await openPage(match[2], match[1])))
        throw new Error(t("resolveDraftFirst"));
      setRevealNode(result.blockId);
    } else if (result.kind === "project" && result.projectId) {
      if (!(await openProject(result.projectId)))
        throw new Error(t("resolveDraftFirst"));
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

    setQuery("");
    setSearchRevision((revision) => revision + 1);
  }

  const contentCreationDisabled =
    !workspaceReady ||
    routing ||
    workspace.switching ||
    busy ||
    !!syncReadOnly ||
    (!!selectedFolder && !currentFolder);
  // Stable row handlers let memoized LibraryRows skip unrelated Studio renders.
  const rowHandlers = useRef({ openTargetClick, showMenu, toggleProject });
  rowHandlers.current = { openTargetClick, showMenu, toggleProject };
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
      onOpenPluginSettings={() => {
        setSettingsSection("plugins");
        void navigate("settings").catch(report);
      }}
      onCreateProject={() => setDialog({ type: "project" })}
    />
  );
  const sidebarNavigation = (
    <SidebarNavigation
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
          aria-label={t("backToRecent")}
          onClick={action(() => navigate("projects"))}
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
          onAddContent={
            (view === "project" || view === "page") && project
              ? showDirectoryCreationMenu
              : undefined
          }
          addDisabled={contentCreationDisabled}
          onMenu={(anchor) =>
            setProjectsMenu((current) => (current === anchor ? null : anchor))
          }
          onGroupMenu={(group, anchor) => setGroupMenu({ group, anchor })}
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
                active={
                  selectedProject === item.id &&
                  view === "project" &&
                  !selectedFolder
                }
                expanded={!!expandedProjects[item.id]}
                onToggle={rowToggle("project", item.id)}
                onOpen={openRow}
                onMenu={showRowMenu}
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
              <PageIcon
                value={project?.icon}
                size={17}
                fallback={<Folder size={17} />}
              />
              <span>{project?.name ?? t("heading.project")}</span>
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
        {view === "project" && project && (
          <button
            type="button"
            className="studio-icon"
            aria-label={t("addContentHint")}
            aria-haspopup="menu"
            title={t("addContent")}
            disabled={contentCreationDisabled}
            onClick={(event) => showDirectoryCreationMenu(event.currentTarget)}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
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
                    if (!(await page.flush())) return;
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
        {capabilities.externalChanges && info?.libraryVersion === 2 && (
          <>
            <button
              className="studio-icon"
              aria-label={t("viewExternalChanges")}
              title={t("viewExternalChanges")}
              onClick={() => setDialog({ type: "workspaceConflicts" })}
            >
              <FolderOpen size={16} />
            </button>
          </>
        )}
        {(view === "projects" ||
          view === "project" ||
          info?.libraryVersion === 2) &&
          view !== "components" &&
          view !== "templates" && (
            <ExpandableSearch
              key={`${view}:${selectedProject}:${selectedFolder}:${searchRevision}`}
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
                disabled={historyBusy.current || !libraryUndo.current.length}
                onClick={() => void replayLibraryMove(false).catch((error) =>
                  report(error, { action: operation("op.undoMove") }),
                )}><Undo2 size={16} /></button>
              <button className="studio-icon" aria-label={t("libraryRedo")} title={t("libraryRedo")}
                disabled={historyBusy.current || !libraryRedo.current.length}
                onClick={() => void replayLibraryMove(true).catch((error) =>
                  report(error, { action: operation("op.redoMove") }),
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
                      if (!(await page.flush())) return;
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
            </>
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
            {capabilities.revealFiles && <button
              className="studio-icon"
              aria-label={t("revealPageFile")}
              title={t("revealPageFile")}
              onClick={action(() =>
                desktop.invoke("fs:reveal", {
                  projectId: selectedProject,
                  pageId: page.draft!.id,
                }),
              )}
            >
              <FolderOpen size={16} />
            </button>}
            <button
              className="studio-icon"
              aria-label={tc("export")}
              title={t("exportPage")}
              disabled={busy}
              onClick={() => void exportPage("html")}
            >
              <ArrowUpRight size={14} />
            </button>
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
        className={`studio ${view === "templates" || view === "components" ? "catalog-view" : ""} ${view === "templates" ? "templates-view" : ""} ${view === "components" ? "components-view" : ""}`}
        data-navigation-state={navigationUpdating ? "updating" : "current"}
        data-window-fullscreen={windowFullscreen}
        data-native-titlebar={
          info?.platform === "darwin" && info.mode !== "browser"
            ? "mac"
            : undefined
        }
      >
        <AutoHideSidebar
          enabled={view === "page" && !!page.draft}
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
            !!groupMenu ||
            !!contextMenu?.anchor.closest(".studio-sidebar")
          }
          switchingTab={workspace.switching || routing}
          navigation={sidebarContent}
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
          >
          <main
            className="studio-main"
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
            {!!page.backgroundIssues.length && (
              <div className="studio-conflict" role="alert" data-priority={3}>
                <p>{t("backgroundSaveIssue")}</p>
                {page.backgroundIssues.map((issue) => (
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
            {view === "page" && page.error && (
              <div className="studio-conflict" role="alert" data-priority={4}>
                <div>
                  <strong>
                    {page.status === "conflict"
                      ? t("saveConflictTitle")
                      : t("saveProblemTitle")}
                  </strong>
                  <p>{page.error}</p>
                </div>
                {page.status !== "conflict" && (
                  <button
                    onClick={action(async () => {
                      const copy = await page.keepCopy();
                      if (copy) {
                        await refresh();
                        setNotice(t("draftKeptAsCopy"));
                      }
                    })}
                  >
                    {t("keepAsCopy")}
                  </button>
                )}
                {page.status === "conflict" ? (
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
                    ) : null}
                    <button onClick={action(page.acceptResolution)}>
                      {t("discardAndLoad")}
                    </button>
                  </>
                ) : (
                    <button onClick={action(page.retry)}>
                      {t("retrySave")}
                    </button>
                )}
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
                      await refresh();
                      await openProject(id);
                    }}
                  info={info}
                  dark={dark}
                  onDarkChange={setDark}
                  onMigrate={() => setDialog({ type: "migration" })}
                  docsVisible={docsVisible}
                  onDocsVisibleChange={
                    docsAvailable ? changeDocsVisible : undefined
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
                >
                  {view === "projects" && (
                    <RecentPages
                      pages={recent}
                      query={query}
                      onOpen={(item, event) =>
                          openTargetClick(
                            pageTarget(item, item.projectId),
                            event,
                          )
                      }
                      onMenu={(item, anchor, point) =>
                        showMenu(
                          pageTarget(item, item.projectId),
                          anchor,
                          point,
                        )
                      }
                      onCreateProject={() => setDialog({ type: "project" })}
                      welcome={
                        !workspaceReady ? (
                          <div className="studio-welcome" aria-busy="true" />
                        ) : welcoming && !showDocs ? (
                          welcomeView
                        ) : undefined
                      }
                    />
                  )}
                  {view === "project" && (
                    <>
                      {visibleEntries.length || !query ? (
                          <div
                            className="studio-page-list"
                            data-view={directoryView}
                            data-selecting={pageSelection.active || undefined}
                          >
                          {visibleEntries.map(({ target, updatedAt }) => (
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
                                  showMenu(target, anchor, {
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                              }}
                              onKeyDown={(event) => {
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
                                    />
                                  ) : (
                                    <FolderThumbnail
                                      projectId={target.projectId}
                                      entries={folderThumbnailEntries(target.id)}
                                    />
                                  ))}
                              <button
                                className="studio-page-list-open"
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
                          {!query && !pageSelection.active && (
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
                            {query
                              ? t("noMatchingContent")
                              : currentFolder
                                ? t("folderEmpty")
                                : t("projectEmpty")}
                          </h2>
                          {!query && <p>{t("emptyHint")}</p>}
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
          </main>
          </AssistantWorkbench>
        </AutoHideSidebar>
        <PluginUpdateNotice
          home={
            info && info.mode !== "browser" && capabilities.localPlugins
              ? info.home
              : null
          }
          // Settings → Plugins and the welcome list the same hosts with their own actions.
          hidden={
            (view === "settings" && settingsSection === "plugins") ||
            (view === "docs" && docPage?.id === WELCOME_DOC) ||
            (view === "projects" && workspaceReady && welcoming && !showDocs)
          }
          onOpenSettings={() => {
            setSettingsSection("plugins");
            void navigate("settings").catch(report);
          }}
        />
        <ToastViewport toasts={toasts.toasts} onDismiss={toasts.dismiss} />
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
                label: t("newProject"),
                icon: <FolderPlus size={15} />,
                onSelect: () => setDialog({ type: "project" }),
              },
              {
                label: t("newGroup"),
                icon: <FolderPlus size={15} />,
                onSelect: () => setDialog({ type: "group" }),
              },
            ]}
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
                  await refresh();
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
              contextMenu.creationOnly
                ? t("addContent")
                : t("itemActions", { title: contextMenu.target.title })
            }
            onClose={() => setContextMenu(null)}
            items={
              contextMenu.creationOnly
                ? creationMenuItems(contextMenu.target)
                : [
                    ...(capabilities.tabs ? [
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
                            label: ta("pageReference.copyPage"),
                            icon: <AtSign size={15} />,
                            onSelect: action(() =>
                              copyPageReference(contextMenu.target.projectId, {
                                kind: "page",
                                pageId: contextMenu.target.id,
                              }),
                            ),
                          },
                        ]
                      : []),
                    {
                      label: tc("rename"),
                      separatorBefore: true,
                      icon: <Pencil size={15} />,
                      onSelect: () => {
                        const currentProject =
                          contextMenu.target.kind === "project"
                            ? projects.find(
                                (item) =>
                                  item.id === contextMenu.target.projectId,
                              )
                            : undefined;
                        setDialog(
                          currentProject
                            ? { type: "project", project: currentProject }
                            : contextMenu.target.kind === "folder"
                              ? {
                                  type: "folder",
                                  projectId: contextMenu.target.projectId,
                                  parentId: contextMenu.target.parentId,
                                  target: contextMenu.target,
                                }
                              : { type: "rename", target: contextMenu.target },
                        );
                      },
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
                                <Upload size={15} />
                              ),
                            onSelect: action(async () => {
                              const projectId = contextMenu.target.projectId;
                              if (!(await page.flush())) return;
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
                            icon: <FolderMinus size={15} />,
                            onSelect: action(async () => {
                              if (!(await page.flush())) return;
                              await desktop.invoke("sync:projectVisibility", {
                                projectId: contextMenu.target.projectId,
                                visible: false,
                              });
                              if (
                                selectedProject === contextMenu.target.projectId
                              )
                                await navigate("projects");
                              await refresh();
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
                            label: t("duplicatePage"),
                            icon: <Copy size={15} />,
                            onSelect: action(async () => {
                              if (!(await page.flush())) return;
                              const result = await desktop.invoke<LoadedPage>(
                                "pages:duplicate",
                                {
                                  projectId: contextMenu.target.projectId,
                                  pageId: contextMenu.target.id,
                                },
                              );
                              await openPage(
                                result.document.id,
                                contextMenu.target.projectId,
                              );
                              await refresh();
                            }),
                          },
                          {
                            label: tc("downloadSource"),
                            icon: <Download size={15} />,
                            onSelect: () => void exportPage("json"),
                          },
                          ...(capabilities.advancedPageExport ? [
                          {
                            label: t("exportWithPublished"),
                            icon: <Globe size={15} />,
                            onSelect: () => void exportPage("html", "remote"),
                          },
                          {
                            label: t("exportSnippet"),
                            icon: <CodeXml size={15} />,
                            onSelect: () => void exportPage("inline"),
                          },
                          {
                            label: t("exportReading"),
                            icon: <ArrowUpRight size={15} />,
                            onSelect: () =>
                              void exportPage("html", "bundled", "reading"),
                          },
                          {
                            label: t("exportOnlinePage"),
                            icon: <Globe size={15} />,
                            onSelect: () =>
                              void exportPage(
                                "html",
                                "bundled",
                                "reading",
                                "cdn",
                              ),
                          },
                          ] : []),
                        ]
                      : []),
                    {
                      label: tc("delete"),
                      icon: <Trash2 size={15} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () =>
                        setDialog({
                          type: "delete",
                          target: contextMenu.target,
                        }),
                    },
                  ]
            }
          />
        )}
        {snapshotDecision && (
          <ExternalSnapshotDialog
            report={snapshotDecision.report}
            onDecide={snapshotDecision.decide}
          />
        )}
        {dialog?.type === "pageIcon" && (
          <PageIconDialog
            value={dialog.value}
            onClose={closeDialog}
            onSave={async (icon) => {
              if (
                page.draft?.id === dialog.target.id &&
                page.projectId === dialog.target.projectId
              ) {
                page.edit({ icon });
                if (!(await page.flush()))
                  throw new Error(t("iconKeptInDraft"));
              } else {
                await desktop.invoke("pages:save", {
                  projectId: dialog.target.projectId,
                  pageId: dialog.target.id,
                  baseHash: dialog.record.hash,
                  baseRevision: dialog.record.revision,
                  document: { ...dialog.record.document, icon },
                });
              }
              await refresh();
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
            onEdit={page.prepareResolution}
            onDiscard={page.acceptResolution}
            onMerged={async () => {
              await page.acceptResolution();
              await refresh();
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
            onResolved={async () => {
              await page.acceptResolution();
              await refresh();
              setNotice(t("externalResolved"));
            }}
          />
        )}
        {capabilities.externalChanges && dialog?.type === "workspaceConflicts" && (
          <WorkspaceConflictsDialog
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
              await refresh();
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
                if (await updateTarget(dialog.target, { name, icon }))
                  setDialog(null);
                return;
              }
              if (!(await page.flush())) return;
              const folder = await desktop.invoke<FolderMetadata>(
                "folders:create",
                {
                  projectId: dialog.projectId,
                  parentId: dialog.parentId,
                  name,
                  ...(icon ? { icon } : {}),
                },
              );
              setExpandedFolders((current) => ({
                ...current,
                ...(dialog.parentId ? { [dialog.parentId]: true } : {}),
              }));
              await openProject(dialog.projectId, folder.id);
              await refresh();
              setDialog(null);
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
              if (await updateTarget(dialog.target, { name })) setDialog(null);
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
        {dialog?.type === "delete" && (
          <DeleteDialog
            target={dialog.target}
            onClose={closeDialog}
            onDelete={() => deleteTarget(dialog.target)}
          />
        )}
        {dialog?.type === "project" && (
          <ProjectDialog
            project={dialog.project}
            onClose={closeDialog}
            onSave={async (name, icon) => {
              const result = dialog.project
                ? await desktop.invoke<ProjectSummary>("projects:rename", {
                    projectId: dialog.project.id,
                    name,
                    icon,
                  })
                : await desktop.invoke<ProjectSummary>("projects:create", {
                    name,
                    icon,
                  });
              if (dialog.groupId) await moveProject(result.id, dialog.groupId);
              await refresh();
              if (!dialog.project) await openProject(result.id);
              setDialog(null);
            }}
          />
        )}
        {dialog?.type === "newPage" && (
          <Dialog title={t("newPage")} onClose={closeDialog}>
            <div className="studio-template-picker">
              <button
                disabled={busy}
                aria-label={t("newPageAria")}
                onClick={() => void createPage("blank", undefined, "page")}
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
                onClick={() => void createPage("blank", undefined, "board")}
              >
                <span>
                  <LayoutTemplate size={21} />
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
            onInsert={addBlock}
            onClose={closeDialog}
          />
        )}
      </div>
    </ComponentLibraryContext.Provider>
  );
}

function MoveProjectDialog({
  groups,
  currentGroup,
  onClose,
  onCreate,
  onSave,
}: {
  groups: ProjectGroup[];
  currentGroup: string;
  onClose: () => void;
  onCreate: () => void;
  onSave: (groupId: string | null) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [groupId, setGroupId] = useState(currentGroup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={t("moveToGroupTitle")} onClose={onClose}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          void onSave(groupId || null)
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {t("group")}
          <select
            aria-label={t("targetGroup")}
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">{t("ungrouped")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <button className="studio-button" type="button" onClick={onCreate}>
          <Plus size={15} />
          {t("newGroup")}
        </button>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" type="button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button className="studio-button primary" disabled={busy}>
            {busy && <Loader2 size={14} className="studio-spin" />}
            {t("move")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function NameDialog({
  title,
  inputLabel,
  initialValue = "",
  onClose,
  onSave,
}: {
  title: string;
  inputLabel: string;
  initialValue?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const tc = useTranslator(commonMessages);
  const [name, setName] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          setError("");
          void onSave(name.trim())
            .catch((reason) => setError(errorMessage(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {inputLabel}
          <input
            aria-label={inputLabel}
            value={name}
            maxLength={1000}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" type="button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            className="studio-button primary"
            disabled={!name.trim() || busy}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {initialValue ? tc("save") : tc("create")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  target,
  onClose,
  onDelete,
}: {
  target: LibraryTarget;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title={t(
        target.kind === "project"
          ? "deleteProject"
          : target.kind === "folder"
            ? "deleteFolder"
            : "deletePage",
      )}
      onClose={onClose}
    >
      <div className="studio-form">
        <p className="studio-delete-description">
          {t("deleteConfirm", { title: target.title })}
          {target.kind !== "page" && t("deleteChildren")}
        </p>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            className="studio-button danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDelete()
                .catch((reason) => setError(errorMessage(reason)))
                .finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {tc("delete")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}

function ProjectDialog({
  project,
  onClose,
  onSave,
}: {
  project?: ProjectSummary;
  onClose: () => void;
  onSave: (name: string, icon: string) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const f = useTranslator(accountFlowMessages);
  const [locationName, setLocationName] = useState("");
  const [locationError, setLocationError] = useState("");
  useEffect(() => {
    if (project) return;
    void desktop
      .invoke<{
        defaultConnectionId: string | null;
        connections: { id: string; name: string; user: { name: string } }[];
      }>("sync:status")
      .then((status) => {
        const connection = status.connections.find(
          (item) => item.id === status.defaultConnectionId,
        );
        setLocationName(
          connection
            ? `${connection.name} · ${connection.user.name}`
            : f("localLocation"),
        );
      })
      .catch((reason) => setLocationError(errorMessage(reason)));
  }, [project]);
  return (
    <DirectoryDialog
      title={project ? t("projectSettings") : t("newProjectTitle")}
      inputLabel={t("projectName")}
      placeholder={t("projectNamePlaceholder")}
      iconButtonLabel={t("setProjectIcon")}
      iconDialogTitle={t("projectIcon")}
      submitLabel={project ? tc("save") : t("createProject")}
      initialName={project?.name}
      initialIcon={project?.icon}
      onClose={onClose}
      onSave={onSave}
    >
      {!project && (
        <p className={locationError ? "studio-form-error" : "settings-help"}>
          {locationError ||
            (locationName && f("savingTo", { name: locationName }))}
        </p>
      )}
    </DirectoryDialog>
  );
}

function FolderDialog({
  folder,
  onClose,
  onSave,
}: {
  folder?: LibraryTarget;
  onClose: () => void;
  onSave: (name: string, icon: string) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  return (
    <DirectoryDialog
      title={folder ? t("folderSettings") : t("newFolder")}
      inputLabel={t("folderName")}
      iconButtonLabel={t("setFolderIcon")}
      iconDialogTitle={t("folderIcon")}
      submitLabel={folder ? tc("save") : tc("create")}
      initialName={folder?.title}
      initialIcon={folder?.icon}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

/** Projects and folders share one name-and-icon form with a folder glyph fallback. */
function DirectoryDialog({
  title,
  inputLabel,
  placeholder,
  iconButtonLabel,
  iconDialogTitle,
  submitLabel,
  initialName = "",
  initialIcon = "",
  onClose,
  onSave,
  children,
}: {
  children?: ReactNode;
  title: string;
  inputLabel: string;
  placeholder?: string;
  iconButtonLabel: string;
  iconDialogTitle: string;
  submitLabel: string;
  initialName?: string;
  initialIcon?: string;
  onClose: () => void;
  onSave: (name: string, icon: string) => Promise<void>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState(initialIcon);
  const [choosingIcon, setChoosingIcon] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Dialog title={title} onClose={onClose}>
        <form
          className="studio-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            setError("");
            void onSave(name.trim(), icon)
              .catch((reason) => setError(errorMessage(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            {t("name")}
            <input
              aria-label={inputLabel}
              placeholder={placeholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={1000}
            />
          </label>
          <button
            type="button"
            className="studio-button studio-project-icon-choice"
            disabled={busy}
            onClick={() => setChoosingIcon(true)}
            aria-label={iconButtonLabel}
          >
            <PageIcon value={icon} size={28} fallback={<Folder size={28} />} />
            <span>{t("setIconButton")}</span>
          </button>
          {children}
          {error && (
            <p className="studio-form-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button type="button" className="studio-button" onClick={onClose}>
              {tc("cancel")}
            </button>
            <button
              className="studio-button primary"
              disabled={!name.trim() || busy}
            >
              {busy ? <Loader2 size={15} className="studio-spin" /> : null}
              {submitLabel}
            </button>
          </footer>
        </form>
      </Dialog>
      {choosingIcon && (
        <PageIconDialog
          title={iconDialogTitle}
          value={icon}
          fallback={<Folder size={56} />}
          onClose={() => setChoosingIcon(false)}
          onSave={async (next) => {
            setIcon(next);
          }}
        />
      )}
    </>
  );
}
