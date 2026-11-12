import type { DragEvent } from "react";
import { LayoutTemplate, Loader2 } from "../../ui/icons";
import type { DesktopInfo } from "../../host/protocol";
import { desktop } from "../../host/bridge";
import type { useAppearancePreference } from "../../design/appearance-preference";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import studioMessages from "../../i18n/messages/studio";
import { PageWorkspace } from "../PageWorkspace";
import type { useDatabaseRecordPeek } from "../useDatabaseRecordPeek";
import TemplateThumbnail from "../TemplateThumbnail";
import RecentPages from "../RecentPages";
import Welcome from "../Welcome";
import { BuiltinDocPage } from "../BuiltinDocs";
import { WELCOME_DOC } from "../builtin-docs";
import type { useSampleProject } from "../sample-project";
import { SettingsPanel } from "../Settings";
import { ComponentCatalog } from "../ComponentCatalog";
import { clientIsMac, isDeleteShortcut } from "../keyboard-shortcuts";
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
import type { LibraryEdits } from "./useLibraryEdits";
import type { LibraryMoves } from "./useLibraryMoves";
import type { StudioCommands } from "./commands";
import type { LibraryRows } from "./StudioSidebar";
import { DirectoryView } from "./DirectoryView";
import type { AssistantControl, LoadedTemplate, PageState } from "./types";

const recentLoading = <div className="studio-welcome" aria-busy="true" />;

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

/**
 * The scrolling content of the workbench: the open page, settings,
 * documentation, recent pages, the open directory and the catalogs.
 */
export function StudioViews({
  feedback,
  library,
  route,
  catalog,
  catalogActions: { viewComponent },
  dialogs: { dialog, setDialog },
  menus,
  directory,
  router,
  pageActions,
  edits,
  moves,
  rows: { openRecent, showRecentMenu, recentCommand, beginProject },
  page,
  commands: { helpDoc },
  appearance,
  recordPeek,
  welcome: { sampleProject, sampleProjectId, welcoming },
  assistant: { changeAssistantOpen, setAssistantPrefill },
  contentCreationDisabled,
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
  edits: LibraryEdits;
  moves: LibraryMoves;
  rows: LibraryRows;
  page: PageState;
  commands: StudioCommands;
  appearance: ReturnType<typeof useAppearancePreference>;
  recordPeek: ReturnType<typeof useDatabaseRecordPeek>;
  welcome: {
    sampleProject: ReturnType<typeof useSampleProject>;
    sampleProjectId: string | null;
    welcoming: boolean;
  };
  assistant: AssistantControl;
  contentCreationDisabled: boolean;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const { setNotice, report, action, problemQueue } = feedback;
  const {
    info,
    setInfo,
    contents,
    setContents,
    setExpandedProjects,
    setExpandedFolders,
    refresh,
    refreshProjects,
    folderTarget,
    projectTarget,
    pageTarget,
  } = library;
  const {
    syncNavigationKey,
    syncRequest,
    feedbackRequest,
    workspaceReady,
    docPage,
    showDocs,
    setSelectedProject,
    setSelectedFolder,
    view,
    settingsSection,
    setSettingsSection,
    deferredQuery,
    revealNode,
    setEditorControls,
    handleRevealHandled,
    catalogScrollRef,
    selectedRef,
    selectedProject,
  } = route;
  const {
    catalogLoading,
    componentProject,
    componentCategory,
    catalogQueries,
    componentGroups,
    loadCatalog,
    visibleTemplates,
  } = catalog;
  const { showMenu } = menus;
  const {
    syncReadOnly,
    fileDrop,
    setFileDrop,
    project,
    recent,
    currentFolder,
    pageSelection,
    directoryMarquee,
  } = directory;
  const { navigate, openProject, openDoc, openTargetClick } = router;
  const {
    handleActiveSurfaceChange,
    copyPageLink,
    createPage,
    createLinkedPage,
    renameLinkedPage,
    activePageTarget,
    beginPageIcon,
    importDroppedFiles,
  } = pageActions;
  const { beginBatchPages } = moves;
  const loading = !info && !problemQueue.problems.length;
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
  return (
    <div
      ref={catalogScrollRef}
      tabIndex={view === "project" ? -1 : undefined}
      onKeyDown={(event) => {
        if (
          view !== "project" ||
          dialog ||
          (event.target as HTMLElement).closest(
            "input,textarea,[contenteditable=true]",
          )
        )
          return;
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
        if (event.defaultPrevented || view !== "project" || !project) return;
        if ((event.target as HTMLElement).closest("button,input,a")) return;
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
          onOpenFaq={() => void helpDoc("agent-troubleshooting").catch(report)}
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
              void openDoc(id, hash, newTab ? "tab" : "current").catch(report)
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
            <DirectoryView
              feedback={feedback}
              library={library}
              route={route}
              menus={menus}
              directory={directory}
              router={router}
              pageActions={pageActions}
              edits={edits}
              moves={moves}
              contentCreationDisabled={contentCreationDisabled}
            />
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
                      const record = await desktop.invoke<LoadedTemplate>(
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
              browser={!!info && "mode" in info && info.mode === "browser"}
              showProjectNames={componentProject === "all"}
              query={catalogQueries.components}
              category={componentCategory}
              onOpen={(item) => void viewComponent(item).catch(report)}
            />
          )}
        </div>
      )}
    </div>
  );
}
