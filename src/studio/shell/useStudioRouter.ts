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

/**
 * Moves the workbench between views, projects, pages and documentation, one
 * request at a time, and follows page links and requests from components.
 */
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
  /** The workspace tabs are created after the router; functions read them when they run. */
  workspaceRef: RefObject<WorkspaceTabs>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
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
  useEffect(() => {
    // A bound block's packaging action: a project that syncs lists what
    // synchronization carries; without sync the block's dialog holds the choice.
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
        setSettingsSection("sync");
        await navigate("settings");
      })().catch(report);
    };
    window.addEventListener(PACKAGING_EVENT, packaging);
    return () => window.removeEventListener(PACKAGING_EVENT, packaging);
  });
  useEffect(() => {
    // Page links in content and the Agent panel, and navigation requests from components.
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
      // Database records handle a plain click through their optional host bridge.
      // Modified clicks keep the same tab/window behavior as other page links.
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
      // A plain click inside an editor places the caret; the editor follows its links on ⌘-click.
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
    // A missing component's status card searches the component library for it.
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
  /** Before an action on the open page itself: it must be saved, conflict or not. */
  async function saveOpenPage() {
    if (!(await page.flush())) throw new DraftHeld(t("resolveDraftFirst"));
  }
  /**
   * Before an action elsewhere: a page waiting on a save conflict keeps its
   * draft and banner, and the action goes ahead.
   */
  async function settleOpenPage() {
    if (!(await page.flushOrDefer()))
      throw new DraftHeld(t("resolveDraftFirst"));
  }
  /**
   * Saves every retained page an operation on library items touches; one
   * that cannot save (a conflict, a failed write) holds the operation.
   */
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
  /** Retires the editors of deleted pages and drops them from every tab's history. */
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
  /** History entries follow pages and folders moved to another project. */
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
  // Pages deleted elsewhere, by an Agent or another window, leave every
  // tab's history; the page on screen keeps its entry.
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
  // Navigation runs one request at a time; a click made meanwhile wins over
  // the one still loading, and runs as soon as it settles.
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
  function openPage(id: string, projectId = selectedProject) {
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
  /** Open a linked page here, in a tab or a window, and show the linked content. */
  async function followPageLink(
    target: NavigationTarget,
    modifiers?: NavigationModifiers,
  ) {
    const projectId = target.projectId ?? page.projectId ?? selectedProject;
    const pageId = target.pageId ?? page.draft?.id;
    if (!projectId || !pageId) return;
    const ids = target.blockIds;
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
  /** Open the page an Agent turn worked on and highlight the blocks it named. */
  async function locateAssistantTarget(
    pageId: string,
    ids: string[],
    projectId = page.projectId ?? selectedProject,
  ) {
    if (
      (page.draft?.id !== pageId || page.projectId !== projectId) &&
      !(await openPage(pageId, projectId))
    )
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
      // Board reveal already moves its camera. DOM scrolling would move the
      // native overlay independently of that camera and can blank the canvas.
      if (!found[0]?.closest(".page-surface"))
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
  async function openPageNow(
    id: string,
    projectId: string | null,
    latest: () => boolean,
  ) {
    const workspace = workspaceRef.current;
    if (!projectId) return false;
    const show = await page.prepare(projectId, id);
    if (!show) return page.status === "error" ? draftHeld() : false;
    // A newer click is waiting; it opens next and this page is not shown.
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
    // A tab switch in flight finishes first; this click then opens in its tab.
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
  /** Built-in documentation opens like a page: in this tab, or a new one on a modified click. */
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
  /** Scroll the navigation to the open page, expanding whatever hides it. */
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
    // The row is measured right after this, so the tree expands synchronously.
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
  /** Back from templates, components or settings returns to where the person was. */
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
    setSettingsSection("sync");
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
