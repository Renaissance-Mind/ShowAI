import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowUpRight,
  Blocks,
  Check,
  ChevronRight,
  FileDiff,
  Folder,
  FolderOpen,
  History,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Undo2,
  Upload,
} from "../../ui/icons";
import type {
  CatalogReadOptions,
  CompiledComponent,
} from "../../contract/types";
import type { SearchResult } from "../../core/library-index";
import { upgradeResource } from "../../document/containers.mjs";
import { desktop } from "../../host/bridge";
import { useLocale, useTranslator } from "../../i18n/react";
import assistantMessages from "../../i18n/messages/assistant";
import commonMessages from "../../i18n/messages/common";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import syncMessages from "../../i18n/messages/sync";
import PageIcon from "../../components/PageIcon";
import ExpandableSearch from "../../components/ExpandableSearch";
import { EditorHistoryButtons } from "../../surface/EditorControls";
import { CommentsToggle } from "../../comments/CommentsPanel";
import type { LibraryTarget } from "../LibraryNavigation";
import ProjectIcon from "../ProjectIcon";
import {
  ImportComponentAction,
  SaveTemplateAction,
} from "../CatalogManagement";
import { SaveStatusMark, focusSaveBanner } from "../SaveProblem";
import { LibrarySearchResults } from "../RecoveryDialogs";
import { useBuiltinDocFolders } from "../BuiltinDocs";
import { builtinDocs, DOCS_HOME } from "../builtin-docs";
import { clickDisposition } from "../open-target";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { CatalogState } from "./useCatalogState";
import type { CatalogActions } from "./useCatalogActions";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";
import type { DirectoryState } from "./useDirectory";
import type { StudioRouter } from "./useStudioRouter";
import type { PageActions } from "./usePageActions";
import type { LibraryMoves } from "./useLibraryMoves";
import type { StudioWorkbench } from "./useStudioWorkspace";
import {
  operation,
  type AssistantControl,
  type LoadedTemplate,
  type PageState,
} from "./types";

/** The bar above the content: where the workbench is, search, and the view's actions. */
export function StudioTopbar({
  feedback: { report, action },
  library,
  route,
  catalog,
  catalogActions: { viewComponent, catalogManager },
  dialogs: { setDialog },
  menus: {
    showMenu,
    setViewMenu,
    viewIcon,
    directoryView,
    exportSiteButton,
    setExportMenu,
  },
  directory: {
    syncReadOnly,
    selectedMarker,
    pages,
    project,
    currentFolder,
    visibleEntries,
    pageSelection,
    breadcrumbFolders,
  },
  router: {
    settleOpenPage,
    openProject,
    openPage,
    openTarget,
    openTargetClick,
    openDoc,
  },
  pageActions: { busy, importPage, activePageTarget },
  moves: { replayLibraryChange },
  page,
  workbench: { heading, docMeta },
  assistant: { assistantOpen, changeAssistantOpen },
  externalChangeCount,
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  route: RouteState;
  catalog: CatalogState;
  catalogActions: CatalogActions;
  dialogs: DialogControl;
  menus: MenuState;
  directory: DirectoryState;
  router: StudioRouter;
  pageActions: PageActions;
  moves: LibraryMoves;
  page: PageState;
  workbench: StudioWorkbench;
  assistant: AssistantControl;
  externalChangeCount: number;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const ta = useTranslator(assistantMessages);
  const tn = useTranslator(navigationMessages);
  const ts = useTranslator(syncMessages);
  const locale = useLocale();
  const {
    navigationUpdating,
    info,
    capabilities,
    externalChangesAvailable,
    projects,
    contents,
    syncOverview,
    libraryHistory,
    historyBusy,
    loadProjectContents,
    projectTarget,
    folderTarget,
    pageTarget,
  } = library;
  const {
    view,
    docPage,
    selectedProject,
    setSelectedProject,
    selectedFolder,
    setSelectedFolder,
    query,
    setQuery,
    searchLibrary,
    setSearchLibrary,
    setRevealNode,
    editorControls,
    catalogScrollRef,
    selectedRef,
  } = route;
  const {
    showTemplateVersions,
    setShowTemplateVersions,
    catalogScope,
    setCatalogScope,
    componentProject,
    setComponentProject,
    componentProjectRef,
    componentFilter,
    setComponentFilter,
    componentSourceTabs,
    setComponentCategory,
    catalogQueries,
    setCatalogQueries,
    loadCatalog,
  } = catalog;
  const docFolders = useBuiltinDocFolders(
    view === "docs" ? (docPage?.id ?? null) : null,
  );
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
      ? clickDisposition(event, info?.platform === "darwin")
      : "current";
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
  return (
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
                      setDialog({
                        type: "externalConflict",
                        id: page.conflictId,
                      });
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
          {document.documentElement.dataset.native === "ios" &&
            (view === "project" || view === "projects") && (
              <>
                <button
                  className="studio-icon"
                  aria-label={t("libraryUndo")}
                  title={t("libraryUndo")}
                  disabled={
                    historyBusy.current || !libraryHistory.current.next(false)
                  }
                  onClick={() =>
                    void replayLibraryChange(false).catch((error) =>
                      report(error, { action: operation("op.undoLibrary") }),
                    )
                  }
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="studio-icon"
                  aria-label={t("libraryRedo")}
                  title={t("libraryRedo")}
                  disabled={
                    historyBusy.current || !libraryHistory.current.next(true)
                  }
                  onClick={() =>
                    void replayLibraryChange(true).catch((error) =>
                      report(error, { action: operation("op.redoLibrary") }),
                    )
                  }
                >
                  <Redo2 size={16} />
                </button>
              </>
            )}
          {view === "project" && (
            <button
              className="studio-button"
              disabled={!visibleEntries.length}
              aria-pressed={pageSelection.active}
              onClick={() =>
                pageSelection.active
                  ? pageSelection.clear()
                  : pageSelection.start()
              }
            >
              <Check size={15} />
              {t("selectPages")}
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
              {capabilities.revealFiles && (
                <button
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
                </button>
              )}
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
              {capabilities.exportSite && (
                <button
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
                </button>
              )}
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
}
