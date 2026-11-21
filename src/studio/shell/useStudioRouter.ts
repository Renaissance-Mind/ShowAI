import { browserSearch, codexWorkbench, openCodexPageTab } from "../../browser/codex-workbench";
import { findVisibleBlock, flashBlocks } from "../ExternalChangeNotice";
import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { DesktopInfo } from "../../host/protocol";
import { desktop } from "../../host/bridge";
import {
  PACKAGING_EVENT,
  type PackagingRequest,
} from "../../datasets/packaging-request";
import { FIND_COMPONENT_EVENT } from "../../components/blocks/ComponentStatus";
import {
  NAVIGATE_EVENT,
  parsePageLink,
  type NavigationDetail,
  type NavigationModifiers,
  type NavigationTarget,
} from "../../document/page-link.mjs";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import studioMessages from "../../i18n/messages/studio";
import type { LibraryTarget } from "../LibraryNavigation";
import { LatestRequest } from "../latest-request";
import { readNavigationCache } from "../navigation-cache";
import { revealSidebarRow } from "../sidebar-locate";
import {
  clickDisposition,
  libraryEntry,
  type OpenDisposition,
} from "../open-target";
import { detourReturnOffset } from "../workspace-tabs";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { CatalogState } from "./useCatalogState";
import type { MenuState } from "./menus/useMenuState";
import {
  DraftHeld,
  operation,
  type PageState,
  type View,
  type WorkspaceTabs,
} from "./types";

export function useStudioRouter({
  feedback: { report, draftHeld, action },
  library: {
    info,
    setInfo,
    capabilities,
    projects,
    setProjects,
    setOrganization,
    organization,
    syncOverview,
    contents,
    setExpandedProjects,
    setCollapsedSections,
    loadProjectContents,
    refresh,
    expandFolderPath,
    pageTarget,
  },
  route: {
    receivingInvite,
    setSyncNavigationKey,
    setSyncRequest,
    workspaceReady,
    setWorkspaceReady,
    setRouting,
    routingRef,
    setDocPage,
    docTitle,
    selectedProject,
    setSelectedProject,
    setSelectedFolder,
    view,
    setView,
    setSettingsSection,
    setQuery,
    setRevealNode,
    setEditorControls,
    selectedRef,
  },
  catalog: { catalogLoaded, setCatalogQueries, loadCatalog },
  menus: { setContextMenu },
  page,
  workspaceRef,
}: {
  feedback: Pick<StudioFeedback, "report" | "draftHeld" | "action">;
  library: Pick<
    LibraryState,
    | "info"
    | "setInfo"
    | "capabilities"
    | "projects"
    | "setProjects"
    | "setOrganization"
    | "organization"
    | "syncOverview"
    | "contents"
    | "setExpandedProjects"
    | "setCollapsedSections"
    | "loadProjectContents"
    | "refresh"
    | "expandFolderPath"
    | "pageTarget"
  >;
  route: Pick<
    RouteState,
    | "receivingInvite"
    | "setSyncNavigationKey"
    | "setSyncRequest"
    | "workspaceReady"
    | "setWorkspaceReady"
    | "setRouting"
    | "routingRef"
    | "setDocPage"
    | "docTitle"
    | "selectedProject"
    | "setSelectedProject"
    | "setSelectedFolder"
    | "view"
    | "setView"
    | "setSettingsSection"
    | "setQuery"
    | "setRevealNode"
    | "setEditorControls"
    | "selectedRef"
  >;
  catalog: Pick<
    CatalogState,
    "catalogLoaded" | "setCatalogQueries" | "loadCatalog"
  >;
  menus: Pick<MenuState, "setContextMenu">;
  page: PageState;
  workspaceRef: RefObject<WorkspaceTabs>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const revealGeneration = useRef(0);
  const locateTarget = useRef(locateAssistantTarget);
  locateTarget.current = locateAssistantTarget;
  useEffect(() => () => { revealGeneration.current++; }, []);
  useEffect(() => {
    const host = window as Window & { showaiPendingInvite?: string };
    const receive = (event?: Event) => {
      const link =
        event instanceof CustomEvent ? event.detail : host.showaiPendingInvite;
      if (typeof link !== "string" || !link || receivingInvite.current) return;
      receivingInvite.current = true;
      void (async () => {
        await settleOpenPage();
        localStorage.setItem("showai:pending-invitation", link);
        delete host.showaiPendingInvite;
        setSyncRequest(undefined);
        setSettingsSection("projects");
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
    const open = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          projectId?: string;
          pageId?: string;
          blockId?: string;
        }>
      ).detail;
      if (!detail?.pageId) return;
      void locateTarget.current(detail.pageId, detail.blockId ? [detail.blockId] : [], detail.projectId, true).catch(report);
    };
    window.addEventListener("showai:open-page", open);
    return () => window.removeEventListener("showai:open-page", open);
  });
  useEffect(() => {
    const packaging = (event: Event) => {
      const detail = (event as CustomEvent<PackagingRequest>).detail;
      const binding = detail && syncOverview.bindings.get(detail.projectId);
      if (!binding || binding.role === "viewer" || binding.status === "revoked")
        return;
      event.preventDefault();
      void (async () => {
        await settleOpenPage();
        setSyncRequest({
          projectId: detail.projectId,
          intent: "packaging",
          focus: detail.itemId,
          key: Date.now(),
        });
        setSettingsSection("projects");
        await navigate("settings");
      })().catch(report);
    };
    window.addEventListener(PACKAGING_EVENT, packaging);
    return () => window.removeEventListener(PACKAGING_EVENT, packaging);
  });
  useEffect(() => {
    const request = (event: Event) => {
      const detail = (event as CustomEvent<NavigationDetail>).detail;
      if (!detail?.target) return;
      event.preventDefault();
      void followPageLink(detail.target, detail.modifiers).catch(report);
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button > 1) return;
      const anchor = event
        .composedPath()
        .find(
          (entry): entry is HTMLAnchorElement =>
            entry instanceof HTMLAnchorElement && entry.hasAttribute("href"),
        );
      const target = anchor && parsePageLink(anchor.getAttribute("href"));
      if (!target) return;
      if (
        anchor.hasAttribute("data-database-record") &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      )
        return;
      event.preventDefault();
      if (anchor.isContentEditable) return;
      void followPageLink(target, event).catch(report);
    };
    window.addEventListener(NAVIGATE_EVENT, request);
    document.addEventListener("click", click, true);
    document.addEventListener("auxclick", click, true);
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, request);
      document.removeEventListener("click", click, true);
      document.removeEventListener("auxclick", click, true);
    };
  });
  useEffect(() => {
    const find = (event: Event) => {
      const query = (event as CustomEvent<{ query?: string }>).detail?.query;
      if (typeof query !== "string") return;
      setCatalogQueries((current) => ({ ...current, components: query }));
      void navigate("components").catch(report);
    };
    window.addEventListener(FIND_COMPONENT_EVENT, find);
    return () => window.removeEventListener(FIND_COMPONENT_EVENT, find);
  });
  const initialized = useRef(false);
  async function saveOpenPage() {
    if (!(await page.flush())) throw new DraftHeld(t("resolveDraftFirst"));
  }
  async function settleOpenPage() {
    if (!(await page.flushOrDefer()))
      throw new DraftHeld(t("resolveDraftFirst"));
  }
  async function settlePages(
    projectId: string,
    touches: (pageId: string, parentId: string | null) => boolean,
  ) {
    const active = page.sessions.getSnapshot().active;
    for (const item of page.sessions.retained()) {
      if (item.projectId !== projectId || !touches(item.pageId, item.parentId))
        continue;
      const saved =
        item.session === active
          ? await page.flush()
          : await item.session.flush();
      if (!saved) throw new DraftHeld(t("resolveDraftFirst"));
    }
  }
  function forgetDeleted(
    projectId: string,
    gone: { project?: boolean; folders?: Set<string>; pages?: Set<string> },
  ) {
    const workspace = workspaceRef.current;
    const pageGone = (pageId: string | null, parentId?: string | null) =>
      !!gone.project ||
      (!!pageId && !!gone.pages?.has(pageId)) ||
      (!!parentId && !!gone.folders?.has(parentId));
    for (const item of page.sessions.retained())
      if (item.projectId === projectId && pageGone(item.pageId, item.parentId))
        page.sessions.forgetPage(item.projectId, item.pageId);
    workspace.prune(
      (location) =>
        location.projectId === projectId &&
        (location.view === "page"
          ? pageGone(location.pageId)
          : location.view === "project" &&
            (!!gone.project ||
              (!!location.folderId && !!gone.folders?.has(location.folderId)))),
    );
  }
  function relocateMoved(
    projectId: string,
    moved: { folders: Set<string>; pages: Set<string> },
    destination: string,
  ) {
    const workspace = workspaceRef.current;
    if (projectId === destination) return;
    workspace.relocate(
      (location) =>
        location.projectId === projectId &&
        (location.view === "page"
          ? !!location.pageId && moved.pages.has(location.pageId)
          : location.view === "project" &&
            !!location.folderId &&
            moved.folders.has(location.folderId)),
      destination,
    );
  }
  const openPageId = page.draft?.id;
  useEffect(() => {
    const workspace = workspaceRef.current;
    const listed = new Map<string, Set<string>>();
    workspace.prune((location) => {
      if (
        location.view !== "page" ||
        !location.projectId ||
        !location.pageId ||
        (location.projectId === page.projectId &&
          location.pageId === openPageId)
      )
        return false;
      const pages = contents[location.projectId]?.pages;
      if (!pages) return false;
      let ids = listed.get(location.projectId);
      if (!ids)
        listed.set(
          location.projectId,
          (ids = new Set(pages.map((item) => item.id))),
        );
      return !ids.has(location.pageId);
    });
  }, [contents, openPageId]);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const workspace = workspaceRef.current;
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
      const params = browserSearch();
      const projectId = params.get("project"),
        pageId = params.get("page"),
        folderId = params.get("folder"),
        block = params.get("block"),
        blocks = block ? [block] : (params.get("blocks") ?? "").split(",").filter(Boolean);
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
            if (blocks.length) revealPageBlocks(blocks, codexWorkbench()?.mode === "thread");
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
  const routes = useRef<{
    navigate: (next: View, current: () => boolean) => Promise<void>;
    openProject: (
      id: string,
      folderId: string | null,
      current: () => boolean,
    ) => Promise<boolean>;
    openPage: (
      id: string,
      projectId: string | null,
      current: () => boolean,
    ) => Promise<boolean>;
    openDoc: (
      id: string,
      hash: string,
      current: () => boolean,
    ) => Promise<boolean>;
  }>(null!);
  const router = useRef<LatestRequest>(null!);
  router.current ??= new LatestRequest({
    start: () => {
      routingRef.current = true;
      setRouting(true);
    },
    settle: () => {
      routingRef.current = false;
      setRouting(false);
    },
  });
  function navigate(next: View) {
    const workspace = workspaceRef.current;
    return router.current.run(undefined, (current) => {
      workspace.rememberScroll();
      return routes.current.navigate(next, current);
    });
  }
  function openProject(id: string, folderId: string | null = null) {
    const workspace = workspaceRef.current;
    return router.current.run(false, (current) => {
      workspace.rememberScroll();
      return routes.current.openProject(id, folderId, current);
    });
  }
  function opensInCodexTab(projectId: string, pageId: string) {
    return codexWorkbench()?.mode === "thread" && view === "page" && !!page.draft &&
      (page.projectId !== projectId || page.draft.id !== pageId);
  }
  function openPage(id: string, projectId = selectedProject) {
    if (projectId && opensInCodexTab(projectId, id))
      return openCodexPageTab({ projectId, pageId: id });
    const workspace = workspaceRef.current;
    return router.current.run(false, (current) => {
      workspace.rememberScroll();
      return routes.current.openPage(id, projectId, current);
    });
  }
  async function navigateNow(next: View, latest: () => boolean) {
    if (!(await page.leave())) {
      draftHeld();
      return;
    }
    if (!latest()) return;
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
  }
  async function openProjectNow(
    id: string,
    folderId: string | null,
    latest: () => boolean,
  ) {
    if (!(await page.leave())) return draftHeld();
    if (!latest()) return false;
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
  }
  async function followPageLink(
    target: NavigationTarget,
    modifiers?: NavigationModifiers,
  ) {
    const projectId = target.projectId ?? page.projectId ?? selectedProject;
    const pageId = target.pageId ?? page.draft?.id;
    if (!projectId || !pageId) return;
    const ids = target.blockIds;
    if (opensInCodexTab(projectId, pageId)) {
      await openCodexPageTab({ projectId, pageId, blockId: ids[0] });
      return;
    }
    const disposition = modifiers
      ? clickDisposition(modifiers, info?.platform === "darwin")
      : "current";
    if (disposition === "window" && capabilities.windows) {
      await desktop.openWindow(
        {
          projectId,
          pageId,
          ...(ids.length ? { blocks: ids.join(",") } : {}),
        },
        page.flush,
      );
      return;
    }
    if (disposition !== "current" && disposition !== "window") {
      const summary = contents[projectId]?.pages.find(
        (item) => item.id === pageId,
      );
      const opened = await openTarget(
        summary
          ? pageTarget(summary, projectId)
          : {
              kind: "page",
              projectId,
              id: pageId,
              title: tc("untitled"),
              pinned: false,
              parentId: null,
            },
        disposition,
      );
      if (!opened) return;
    }
    await locateAssistantTarget(pageId, ids, projectId);
  }
  async function locateAssistantTarget(
    pageId: string,
    ids: string[],
    projectId = page.projectId ?? selectedProject,
    animate = false,
  ) {
    if (projectId && opensInCodexTab(projectId, pageId)) {
      await openCodexPageTab({ projectId, pageId, blockId: ids[0] });
      return;
    }
    const generation = ++revealGeneration.current;
    if (
      (view !== "page" || page.draft?.id !== pageId || page.projectId !== projectId) &&
      !(await openPage(pageId, projectId))
    )
      return;
    if (generation === revealGeneration.current) revealPageBlocks(ids, animate);
  }
  function revealPageBlocks(ids: string[], animate: boolean) {
    if (!ids.length) return;
    const generation = ++revealGeneration.current;
    const existing = findVisibleBlock(document.querySelector(".studio-main"), ids[0]);
    if (!animate || !existing || existing.closest("[data-board-id]")) setRevealNode(ids[0]);
    const deadline = performance.now() + 4000;
    const reveal = () => {
      if (generation !== revealGeneration.current) return;
      const scope = document.querySelector<HTMLElement>(".studio-main");
      const first = findVisibleBlock(scope, ids[0]);
      if (!first) {
        if (performance.now() < deadline) window.setTimeout(reveal, 80);
        return;
      }
      if (!first.closest(".page-surface") || (animate && !first.closest("[data-board-id]"))) {
        first.scrollIntoView({
          block: first.getBoundingClientRect().height > (scope?.clientHeight ?? innerHeight) ? "start" : "center",
          inline: "nearest",
          behavior: animate && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant",
        });
      }
      flashBlocks(scope, ids, 1600);
    };
    requestAnimationFrame(reveal);
  }
  async function openPageNow(
    id: string,
    projectId: string | null,
    latest: () => boolean,
  ) {
    const workspace = workspaceRef.current;
    if (!projectId) return false;
    const show = await page.prepare(projectId, id);
    if (!show) return page.status === "error" ? draftHeld() : false;
    if (!latest()) return false;
    if (show(workspace.activeId)) {
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
  }
  async function openTarget(
    target: LibraryTarget,
    disposition: OpenDisposition = "current",
  ) {
    const workspace = workspaceRef.current;
    if (!workspaceReady) return false;
    await workspace.settled();
    if (
      (!capabilities.tabs && disposition !== "window") ||
      (!capabilities.windows && disposition === "window")
    )
      disposition = "current";
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
    if (disposition !== "current") return workspace.open(libraryEntry(target));
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
  async function openDoc(
    id: string,
    hash = "",
    disposition: OpenDisposition = "current",
  ) {
    const workspace = workspaceRef.current;
    if (!workspaceReady) return false;
    await workspace.settled();
    const meta = docTitle(id);
    if (
      capabilities.tabs &&
      (disposition === "tab" || disposition === "foreground-tab")
    )
      return workspace.open({
        location: {
          view: "docs",
          projectId: null,
          folderId: null,
          pageId: id,
        },
        title: meta.title,
        icon: meta.icon,
        scrollTop: 0,
      });
    return router.current.run(false, (current) => {
      workspace.rememberScroll();
      return routes.current.openDoc(id, hash, current);
    });
  }
  async function openDocNow(id: string, hash: string, latest: () => boolean) {
    if (!(await page.leave())) return draftHeld();
    if (!latest()) return false;
    setContextMenu(null);
    setQuery("");
    selectedRef.current = null;
    setSelectedProject(null);
    setSelectedFolder(null);
    setEditorControls(null);
    setDocPage({ id, hash });
    setView("docs");
    return true;
  }
  routes.current = {
    navigate: navigateNow,
    openProject: openProjectNow,
    openPage: openPageNow,
    openDoc: openDocNow,
  };
  async function locateCurrentPage() {
    const projectId = page.projectId;
    const current = page.draft;
    if (view !== "page" || !projectId || !current) return;
    const loaded =
      contents[projectId] ?? (await loadProjectContents(projectId));
    const parentId =
      current.parentId ??
      loaded.pages.find((item) => item.id === current.id)?.parentId ??
      null;
    const project = projects.find((item) => item.id === projectId);
    const groupId =
      project && !project.pinned
        ? organization.projectGroups[projectId]
        : undefined;
    flushSync(() => {
      setExpandedProjects((state) => ({ ...state, [projectId]: true }));
      expandFolderPath(loaded.folders, parentId);
      if (groupId)
        setCollapsedSections((state) => ({ ...state, [groupId]: false }));
    });
    const target = { projectId, pageId: current.id };
    if (!revealSidebarRow(document, target))
      requestAnimationFrame(() => revealSidebarRow(document, target));
  }
  async function leaveDetour() {
    const workspace = workspaceRef.current;
    const tab = workspace.tabs.find((item) => item.id === workspace.activeId);
    const offset = tab ? detourReturnOffset(tab) : null;
    if (offset === null) await navigate("projects");
    else await workspace.step(offset);
  }
  const openProjectManagement = action(async () => {
    await settleOpenPage();
    setSyncRequest({ projectId: "", intent: "manage", key: Date.now() });
    setSettingsSection("projects");
    await navigate("settings");
  });
  return {
    saveOpenPage,
    settleOpenPage,
    settlePages,
    forgetDeleted,
    relocateMoved,
    navigate,
    openProject,
    openPage,
    followPageLink,
    locateAssistantTarget,
    openTarget,
    openTargetClick,
    openDoc,
    locateCurrentPage,
    leaveDetour,
    openProjectManagement,
  };
}

export type StudioRouter = ReturnType<typeof useStudioRouter>;
