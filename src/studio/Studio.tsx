import RemoteMcpApprovalDialog from "./RemoteMcpApprovalDialog";
import { trackDesktopPreviewActivity } from "./preview-work";
import { ComponentLibraryContext } from "../components/ComponentLibrary";
import { useAppearancePreference } from "../design/appearance-preference";
import { useCallback, useEffect, useRef, useState } from "react";
import DatabaseRecordPeek from "./DatabaseRecordPeek";
import { useDatabaseRecordPeek } from "./useDatabaseRecordPeek";
import { desktop } from "../host/bridge";
import { usePage } from "./usePage";
import { DirectorySelectionBar } from "./DirectoryPageSelection";
import PluginUpdateNotice from "./PluginUpdateNotice";
import AppUpdateNotice from "./AppUpdateNotice";
import { useAppUpdate } from "./useAppUpdate";
import { WELCOME_DOC } from "./builtin-docs";
import { useSampleProject } from "./sample-project";
import AutoHideSidebar from "./AutoHideSidebar";
import WorkspaceTabs, { WorkspaceHistory } from "./WorkspaceTabs";
import { WorkspaceSwipeNavigation } from "./WorkspaceSwipeNavigation";
import { clientIsMac } from "./keyboard-shortcuts";
import { FindBar } from "./find/FindBar";
import { useFind } from "./find/useFind";
import { useWindowFullscreen } from "./useWindowFullscreen";
import "./studio.css";
import {
  ToastViewport,
  configureProblemRedaction,
  configureProblemPlatform,
} from "../problems";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import studioMessages from "../i18n/messages/studio";
import { flashBlocks } from "./ExternalChangeNotice";
import AssistantWorkbench from "./assistant/AssistantWorkbench";
import { CommentsPanel } from "../comments/CommentsPanel";
import type {
  AssistantControl,
  WorkspaceTabs as Workspace,
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
import { StudioDialogs } from "./shell/StudioDialogs";

/**
 * The workbench. Each part lives in ./shell; this component calls their hooks
 * in order and places the parts on the page.
 */
export default function Studio() {
  useEffect(() => {
    trackDesktopPreviewActivity();
  }, []);
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
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
  const { toasts, report, action } = feedback;
  const library = useLibraryState(feedback);
  const {
    navigationUpdating,
    info,
    capabilities,
    externalChangesAvailable,
    projects,
    syncOverview,
    setContents,
    contents,
    refresh,
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
    catalogScrollRef,
  } = route;
  const appUpdate = useAppUpdate();
  const catalog = useCatalogState(route);
  const dialogs = useDialogState();
  const { dialog, dialogRef } = dialogs;
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
    busy,
    setExportReceipt,
    copyPageReference,
    copyPageLink,
    createLinkedPage,
    renameLinkedPage,
    beginPageIcon,
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
  const { libraryDrag, beginBatchPages } = moves;
  const catalogActions = useCatalogActions({
    library,
    route,
    catalog,
    dialogs,
    router,
    page,
  });
  const { pickerLibrary } = catalogActions;
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
        ? {
            projectId: element.dataset.openProject,
            pageId: element.dataset.openPage,
          }
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
              {recordPeek.view && (
                <DatabaseRecordPeek
                  peek={recordPeek}
                  sessions={page.sessions}
                  linkablePages={contents}
                  readOnly={
                    syncOverview.markers.get(
                      recordPeek.request?.projectId ?? "",
                    ) === "readOnly"
                  }
                  report={report}
                  onCopyLink={(target) =>
                    void copyPageLink(target).catch(report)
                  }
                  onCreateLinkedPage={createLinkedPage}
                  onRenameLinkedPage={renameLinkedPage}
                  onEditIcon={action(async () => {
                    const request = recordPeek.request;
                    const draft = recordPeek.view?.session.getSnapshot().draft;
                    if (!request || !draft) return;
                    await beginPageIcon({
                      kind: "page",
                      projectId: request.projectId,
                      id: draft.id,
                      title: draft.title,
                      icon: draft.icon,
                      pinned: !!draft.favorite,
                      parentId: draft.parentId ?? null,
                    });
                  })}
                />
              )}
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
            (view === "settings" &&
              (settingsSection === "plugins" ||
                settingsSection === "remote")) ||
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
        <StudioDialogs
          feedback={feedback}
          library={library}
          route={route}
          catalog={catalog}
          catalogActions={catalogActions}
          dialogs={dialogs}
          router={router}
          pageActions={pageActions}
          edits={edits}
          moves={moves}
          commands={commands}
          page={page}
          deferConflict={deferConflict}
          contentCreationDisabled={contentCreationDisabled}
        />
      </div>
    </ComponentLibraryContext.Provider>
  );
}
