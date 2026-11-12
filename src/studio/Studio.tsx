import RemoteMcpApprovalDialog from "./RemoteMcpApprovalDialog";
import MergeDialog from "./MergeDialog";
import { trackDesktopPreviewActivity } from "./preview-work";
import {
  withCreatedFolder,
  withLibraryEntry,
} from "./navigation-refresh";
import { ComponentLibraryContext } from "../components/ComponentLibrary";
import { useAppearancePreference } from "../design/appearance-preference";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  FileText,
  LayoutTemplate,
  Presentation,
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
  ComponentSource,
} from "../contract/types";
import DatabaseRecordPeek from "./DatabaseRecordPeek";
import { useDatabaseRecordPeek } from "./useDatabaseRecordPeek";
import { desktop } from "../host/bridge";
import { usePage } from "./usePage";
import Dialog from "../ui/Dialog";
import ImportDialog from "./ImportDialog";
import {
  PackagingDialog,
} from "./PackagingDialog";
import {
  BatchPagesDialog,
  DirectorySelectionBar,
} from "./DirectoryPageSelection";
import PageIconDialog from "../components/PageIconDialog";
import {
  latestTemplateVersions,
  templateHasPage,
} from "./template-catalog-model";
import QuickJump from "./quick-jump/QuickJump";
import PluginUpdateNotice from "./PluginUpdateNotice";
import AppUpdateNotice from "./AppUpdateNotice";
import { useAppUpdate } from "./useAppUpdate";
import {
  WELCOME_DOC,
} from "./builtin-docs";
import { useSampleProject } from "./sample-project";
import AutoHideSidebar from "./AutoHideSidebar";
import {
  DiscardDraftDialog,
} from "./SaveProblem";
import WorkspaceTabs, { WorkspaceHistory } from "./WorkspaceTabs";
import { WorkspaceSwipeNavigation } from "./WorkspaceSwipeNavigation";
import navigationMessages from "../i18n/messages/navigation";
import {
  DeletedItemsDialog,
  HiddenProjectsDialog,
  ShortcutsDialog,
} from "./LibraryNavigationDialogs";
import {
  clientIsMac,
} from "./keyboard-shortcuts";
import { FindBar } from "./find/FindBar";
import { useFind } from "./find/useFind";
import { useWindowFullscreen } from "./useWindowFullscreen";
import { TemplateDialog, ComponentDialog } from "./CatalogDialogs";
import "./studio.css";
import {
  ToastViewport,
  configureProblemRedaction,
  configureProblemPlatform,
} from "../problems";
import {
  ExternalConflictDialog,
  WorkspaceConflictsDialog,
} from "./RecoveryDialogs";
import LibraryMigrationDialog from "./LibraryMigrationDialog";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";
import {
  flashBlocks,
} from "./ExternalChangeNotice";
import AssistantWorkbench from "./assistant/AssistantWorkbench";
import { CommentsPanel } from "../comments/CommentsPanel";
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
import { StudioSidebar, useLibraryRows } from "./shell/StudioSidebar";
import { StudioTopbar } from "./shell/StudioTopbar";
import {
  ExportReceipt,
  StudioNotices,
  useExternalChangeCount,
} from "./shell/StudioNotices";
import { StudioViews } from "./shell/StudioViews";
import { StudioMenus } from "./shell/menus/StudioMenus";



export default function Studio() {
  useEffect(() => {
    trackDesktopPreviewActivity();
  }, []);
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const tn = useTranslator(navigationMessages);
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
  const { toasts, setNotice, report, action } = feedback;
  const library = useLibraryState(feedback);
  const {
    navigationUpdating,
    info,
    setInfo,
    capabilities,
    externalChangesAvailable,
    projects,
    organization,
    syncOverview,
    setContents,
    contents,
    setExpandedFolders,
    refresh,
    refreshProjects,
    projectTarget,
  } = library;
  const route = useRouteState({ info, capabilities });
  const {
    workspaceReady,
    routing,
    docPage,
    showDocs,
    docTitle,
    selectedProject,
    selectedFolder,
    view,
    settingsSection,
    setSettingsSection,
    setRevealNode,
    editorControls,
    catalogScrollRef,
  } = route;
  const appUpdate = useAppUpdate();
  const catalog = useCatalogState(route);
  const { componentProject, loadCatalog } = catalog;
  const dialogs = useDialogState();
  const { dialog, setDialog, dialogRef, closeDialog } = dialogs;
  const menus = useMenuState();
  const { groupMenu, contextMenu, projectsMenu, newMenu } = menus;
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
    recent,
    currentFolder,
    visibleEntries,
    pageSelection,
    directoryMarquee,
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
    openDoc,
    locateCurrentPage,
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
    setExportReceipt,
    copyPageReference,
    copyPageLink,
    createPage,
    createLinkedPage,
    renameLinkedPage,
    importFinished,
    runCreation,
    beginPageIcon,
    addBlock,
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
  const { moveProject, updateTarget, deleteTarget } = edits;
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
  const { libraryDrag, beginBatchPages, applyBatchPages } = moves;
  const catalogActions = useCatalogActions({
    library,
    route,
    catalog,
    dialogs,
    router,
    page,
  });
  const { catalogManager, pickerLibrary } = catalogActions;
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
  const { workspace, workspaceEntry } = workbench;


  useEffect(() => {
    document.title =
      view === "page" && page.draft
        ? `${page.draft.title || tc("untitled")} — ShowAI`
        : view === "docs" && docPage
          ? `${docTitle(docPage.id).title} — ShowAI`
          : "ShowAI";
  }, [view, page.draft?.title, tc, docPage?.id]);
  const externalChangeCount = useExternalChangeCount({
    available: externalChangesAvailable,
    dialogOpen: !!dialog,
    home: info?.home,
  });
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
  const { quickJumpCommands } = commands;
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

  const contentCreationDisabled =
    !workspaceReady ||
    routing ||
    workspace.switching ||
    busy ||
    !!syncReadOnly ||
    (!!selectedFolder && !currentFolder);
  const rows = useLibraryRows({
    feedback,
    library,
    dialogs,
    menus,
    router,
    edits,
  });
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
          navigation={
            <StudioSidebar
              feedback={feedback}
              library={library}
              route={route}
              catalog={catalog}
              dialogs={dialogs}
              menus={menus}
              router={router}
              moves={moves}
              rows={rows}
              page={page}
              workspace={workspace}
            />
          }
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
            <StudioTopbar
              feedback={feedback}
              library={library}
              route={route}
              catalog={catalog}
              catalogActions={catalogActions}
              dialogs={dialogs}
              menus={menus}
              directory={directory}
              router={router}
              pageActions={pageActions}
              moves={moves}
              page={page}
              workbench={workbench}
              assistant={assistant}
              externalChangeCount={externalChangeCount}
            />
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
            <StudioNotices
              feedback={feedback}
              library={library}
              route={route}
              dialogs={dialogs}
              directory={directory}
              router={router}
              pageActions={pageActions}
              page={page}
              externalChange={externalChange}
            />
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
            <StudioViews
              feedback={feedback}
              library={library}
              route={route}
              catalog={catalog}
              catalogActions={catalogActions}
              dialogs={dialogs}
              menus={menus}
              directory={directory}
              router={router}
              pageActions={pageActions}
              edits={edits}
              moves={moves}
              rows={rows}
              page={page}
              commands={commands}
              appearance={appearance}
              recordPeek={recordPeek}
              welcome={{ sampleProject, sampleProjectId, welcoming }}
              assistant={assistant}
              contentCreationDisabled={contentCreationDisabled}
            />
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
        <ExportReceipt
          feedback={feedback}
          library={library}
          pageActions={pageActions}
        />
        <StudioMenus
          feedback={feedback}
          library={library}
          route={route}
          dialogs={dialogs}
          menus={menus}
          menuItems={menuItems}
          directory={directory}
          router={router}
          pageActions={pageActions}
          edits={edits}
          moves={moves}
          commands={commands}
          page={page}
          workspace={workspace}
          find={find}
          externalChangeCount={externalChangeCount}
        />
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
