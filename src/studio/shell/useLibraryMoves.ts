import { useEffect, useRef } from "react";
import type { SidebarOrganization } from "../../core/model";
import type { DesktopChange } from "../../host/protocol";
import { orderSidebarProjects } from "../../core/sidebar-order";
import {
  directoryEntries,
  sortDirectoryItems,
} from "../../core/directory-sort";
import { desktop, errorMessage } from "../../host/bridge";
import { useTranslator } from "../../i18n/react";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import type { LibraryTarget } from "../LibraryNavigation";
import { restoreItem } from "../LibraryNavigationDialogs";
import { useLibraryDragController, type LibraryDrop } from "../LibraryDrag";
import type { PageDestination } from "../DirectoryPageSelection";
import {
  reverseMoves,
  type LibraryChange,
  type LibraryPlace,
} from "../library-history";
import { applyLibraryMove } from "../library-move";
import { folderSubtree } from "../navigation-refresh";
import type { LoadedPage } from "../usePage";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";
import type { DirectoryState } from "./useDirectory";
import type { StudioRouter } from "./useStudioRouter";
import type { LibraryEdits } from "./useLibraryEdits";
import { DraftHeld, operation, type PageState } from "./types";

/**
 * Moving library items by dragging, by Move to… and in batches, and the
 * library's undo and redo.
 */
export function useLibraryMoves({
  feedback: { setNotice, report, notifyWithUndo },
  library: {
    info,
    projects,
    organization,
    setOrganization,
    contents,
    setContents,
    setPendingLibraryMove,
    setPendingReorders,
    reorderQueue,
    sidebarRevision,
    reorderCount,
    sidebarHome,
    setExpandedProjects,
    setExpandedFolders,
    setCollapsedSections,
    libraryHistory,
    historyBusy,
    refreshLibraryHistory,
    rememberLibraryChange,
    undoLibraryRef,
    refresh,
    refreshProjects,
    folderPreferences,
  },
  route: { view, selectedProject, selectedFolder, setSelectedFolder },
  dialogs: { dialog, setDialog },
  menus: { setContextMenu, setProjectsMenu, setGroupMenu },
  directory: { pageSelection, selectedPageTargets },
  router: { settlePages, forgetDeleted, relocateMoved, openPage },
  edits: { updateTarget, deletionScope, deleteTarget, restoreTargetOf },
  page,
}: {
  feedback: Pick<StudioFeedback, "setNotice" | "report" | "notifyWithUndo">;
  library: Pick<
    LibraryState,
    | "info"
    | "projects"
    | "organization"
    | "setOrganization"
    | "contents"
    | "setContents"
    | "setPendingLibraryMove"
    | "setPendingReorders"
    | "reorderQueue"
    | "sidebarRevision"
    | "reorderCount"
    | "sidebarHome"
    | "setExpandedProjects"
    | "setExpandedFolders"
    | "setCollapsedSections"
    | "libraryHistory"
    | "historyBusy"
    | "refreshLibraryHistory"
    | "rememberLibraryChange"
    | "undoLibraryRef"
    | "refresh"
    | "refreshProjects"
    | "folderPreferences"
  >;
  route: Pick<
    RouteState,
    "view" | "selectedProject" | "selectedFolder" | "setSelectedFolder"
  >;
  dialogs: Pick<DialogControl, "dialog" | "setDialog">;
  menus: Pick<MenuState, "setContextMenu" | "setProjectsMenu" | "setGroupMenu">;
  directory: Pick<DirectoryState, "pageSelection" | "selectedPageTargets">;
  router: Pick<
    StudioRouter,
    "settlePages" | "forgetDeleted" | "relocateMoved" | "openPage"
  >;
  edits: Pick<
    LibraryEdits,
    "updateTarget" | "deletionScope" | "deleteTarget" | "restoreTargetOf"
  >;
  page: PageState;
}) {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  const movingLibrary = useRef(false);
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
  /** Carries out one direction of a recorded change; true when the library took it. */
  async function applyLibraryChange(entry: LibraryChange, redo: boolean) {
    switch (entry.kind) {
      case "move":
        return dropLibraryItem(redo ? entry.redo : entry.undo, false);
      case "rename":
        return updateTarget(entry.target, redo ? entry.after : entry.before, {
          record: false,
        });
      case "batchMove":
        return moveLibraryEntries(reverseMoves(entry.moves, redo));
      case "delete": {
        if (redo) {
          for (const target of entry.targets)
            if (
              !(await deleteTarget(target, {
                record: false,
                notify: entry.targets.length === 1,
              }))
            )
              return false;
          if (entry.targets.length > 1)
            setNotice(t("pagesDeleted", { count: entry.targets.length }));
          return true;
        }
        for (const target of entry.targets)
          await restoreItem(restoreTargetOf(target));
        await refreshProjects(
          entry.targets.map((target) => target.projectId),
          {
            sidebar: entry.targets.some((target) => target.kind === "project"),
          },
        );
        setNotice(
          entry.targets.length === 1
            ? tn("restoredNamed", { title: entry.targets[0].title })
            : tn("pagesRestored", { count: entry.targets.length }),
        );
        return true;
      }
    }
  }
  async function replayLibraryChange(redo: boolean) {
    if (historyBusy.current || movingLibrary.current) return;
    const entry = libraryHistory.current.next(redo);
    if (!entry) return;
    historyBusy.current = true;
    refreshLibraryHistory((value) => value + 1);
    try {
      if (await applyLibraryChange(entry, redo))
        libraryHistory.current.replayed(entry, redo);
    } finally {
      historyBusy.current = false;
      refreshLibraryHistory((value) => value + 1);
    }
  }
  /** A toast's Undo reverses its own change, even after later ones were made. */
  async function undoLibraryChange(entry: LibraryChange) {
    if (libraryHistory.current.next(false) === entry)
      return replayLibraryChange(false);
    if (historyBusy.current || movingLibrary.current) return;
    if (await applyLibraryChange(entry, false))
      libraryHistory.current.replayed(entry, false);
    refreshLibraryHistory((value) => value + 1);
  }
  const replayLibraryRef = useRef(replayLibraryChange);
  replayLibraryRef.current = replayLibraryChange;
  // Deleting a row leaves focus on the body; the last place the person
  // worked in decides whether Undo then belongs to the library.
  const libraryLast = useRef(false);
  useEffect(() => {
    const libraryAreas = ".studio-sidebar,.studio-library,.studio-topbar";
    const place = (event: Event) => {
      libraryLast.current = !!(event.target as Element).closest?.(libraryAreas);
    };
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z")
        return;
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,[contenteditable=true],.page-surface"))
        return;
      if (
        !target.closest(libraryAreas) &&
        view !== "project" &&
        view !== "projects" &&
        !(target === document.body && libraryLast.current)
      )
        return;
      if (!libraryHistory.current.next(event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      void replayLibraryRef.current(event.shiftKey).catch((error) =>
        report(error, {
          action: operation(
            event.shiftKey ? "op.redoLibrary" : "op.undoLibrary",
          ),
        }),
      );
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", place, true);
    window.addEventListener("focusin", place, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", place, true);
      window.removeEventListener("focusin", place, true);
    };
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
          await refreshProjects([source.projectId], { sidebar: true });
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
          void refreshProjects([source.projectId], { sidebar: true }).catch(
            report,
          );
      }
      return !failed;
    });
    reorderQueue.current = result.then(() => {});
    return result;
  }
  async function dropLibraryItem(drop: LibraryDrop, recordHistory = true) {
    if (movingLibrary.current) return false;
    const inverse = recordHistory ? inverseLibraryDrop(drop) : null;
    const entry: LibraryChange | null = inverse
      ? { kind: "move", undo: inverse, redo: drop }
      : null;
    const remember = () => {
      if (entry) rememberLibraryChange(entry);
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
      // Pages that move save first; other pages, even one in a conflict, stay as they are.
      if (source.kind !== "project") {
        const moving =
          source.kind === "page"
            ? { folders: new Set<string>(), pages: new Set([source.id]) }
            : folderSubtree(contents, source.projectId, source.id);
        await settlePages(
          source.projectId,
          (pageId, parentId) =>
            moving.pages.has(pageId) ||
            (!!parentId && moving.folders.has(parentId)),
        );
      }
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
        if (reopen && !(await page.clear()))
          throw new DraftHeld(t("resolveDraftFirst"));
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
        if (crossProject) {
          page.sessions.forgetPage(source.projectId, source.id);
          relocateMoved(
            source.projectId,
            deletionScope(source),
            drop.projectId!,
          );
        } else if (source.kind === "page") page.sessions.invalidate(change);
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
          entry
            ? {
                action: {
                  label: operation("toast.undo"),
                  onSelect: () =>
                    void undoLibraryChange(entry).catch((error) =>
                      report(error, { action: operation("op.undoLibrary") }),
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
  function beginBatchPages(operation: "move" | "delete") {
    if (!selectedPageTargets.length) return;
    setContextMenu(null);
    setDialog({ type: "batchPages", operation, targets: selectedPageTargets });
  }
  /** Moves one folder or page; a moved page's editor closes, as its location changed. */
  async function moveLibraryEntry(
    target: LibraryTarget,
    destination: LibraryPlace,
  ) {
    const home = info?.home;
    const record =
      target.kind === "page"
        ? await desktop.invoke<LoadedPage>("pages:get", {
            expectedHome: home,
            projectId: target.projectId,
            pageId: target.id,
          })
        : null;
    await desktop.invoke("sidebar:moveEntry", {
      expectedHome: home,
      kind: target.kind,
      projectId: target.projectId,
      id: target.id,
      destinationProjectId: destination.projectId,
      parentId: destination.parentId,
      placement: "after",
      ...(record
        ? { baseHash: record.hash, baseRevision: record.revision }
        : {}),
    });
    if (target.kind === "page")
      page.sessions.forgetPage(target.projectId, target.id);
    relocateMoved(
      target.projectId,
      deletionScope(target),
      destination.projectId,
    );
  }
  /**
   * Saves the open pages several library items hold, and closes the open page
   * when it is one of them. Other pages, even one in a conflict, stay as they are.
   */
  async function settleTargets(targets: LibraryTarget[]) {
    const scopes = targets.map((target) => ({
      target,
      scope: deletionScope(target),
    }));
    const touches = (
      projectId: string,
      pageId: string,
      parentId: string | null,
    ) =>
      scopes.some(
        ({ target, scope }) =>
          target.projectId === projectId &&
          (scope.pages.has(pageId) ||
            (!!parentId && scope.folders.has(parentId))),
      );
    for (const projectId of new Set(targets.map((target) => target.projectId)))
      await settlePages(projectId, (pageId, parentId) =>
        touches(projectId, pageId, parentId),
      );
    if (
      page.projectId &&
      page.draft &&
      touches(page.projectId, page.draft.id, page.draft.parentId ?? null) &&
      !(await page.clear())
    )
      throw new DraftHeld(t("resolveDraftFirst"));
    return scopes;
  }
  /** Undo and redo of Move to…: each item goes back to (or again to) its place. */
  async function moveLibraryEntries(
    moves: { target: LibraryTarget; destination: LibraryPlace }[],
  ) {
    if (movingLibrary.current) return false;
    movingLibrary.current = true;
    const projectIds = new Set<string>();
    try {
      await reorderQueue.current;
      await settleTargets(moves.map((move) => move.target));
      for (const move of [
        ...moves.filter((move) => move.target.kind === "page"),
        ...moves.filter((move) => move.target.kind === "folder"),
      ]) {
        await moveLibraryEntry(move.target, move.destination);
        projectIds.add(move.target.projectId);
        projectIds.add(move.destination.projectId);
      }
      setNotice(t("pagesMoved", { count: moves.length }));
      return true;
    } finally {
      movingLibrary.current = false;
      if (projectIds.size)
        await refreshProjects([...projectIds], { sidebar: true }).catch(report);
    }
  }
  async function applyBatchPages(destination?: PageDestination) {
    if (dialog?.type !== "batchPages" || movingLibrary.current) return;
    const { operation, targets } = dialog;
    const home = info?.home;
    let completed = 0;
    const done = new Set<string>();
    const projectIds = new Set(targets.map((target) => target.projectId));
    if (destination) projectIds.add(destination.projectId);
    movingLibrary.current = true;
    try {
      await reorderQueue.current;
      const scopes = await settleTargets(targets);
      const insideSelectedFolder = (folderId: string | null) =>
        !!folderId &&
        scopes.some(
          ({ target, scope }) =>
            target.projectId === selectedProject && scope.folders.has(folderId),
        );
      // Pages go first so a page inside a selected folder is handled before its folder.
      for (const target of [
        ...targets.filter((target) => target.kind === "page"),
        ...targets.filter((target) => target.kind === "folder"),
      ]) {
        if (operation === "move") {
          if (!destination)
            throw new Error("A destination is required to move pages.");
          await moveLibraryEntry(target, destination);
        } else if (target.kind === "folder")
          await desktop.invoke("folders:remove", {
            expectedHome: home,
            projectId: target.projectId,
            folderId: target.id,
          });
        else {
          const record = await desktop.invoke<LoadedPage>("pages:get", {
            expectedHome: home,
            projectId: target.projectId,
            pageId: target.id,
          });
          await desktop.invoke("pages:remove", {
            expectedHome: home,
            projectId: target.projectId,
            pageId: target.id,
            baseHash: record.hash,
            baseRevision: record.revision,
          });
        }
        if (operation === "delete")
          forgetDeleted(target.projectId, deletionScope(target));
        completed++;
        done.add(target.id);
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
      if (operation === "delete" && insideSelectedFolder(selectedFolder))
        setSelectedFolder(null);
      const message = t(operation === "move" ? "pagesMoved" : "pagesDeleted", {
        count: completed,
      });
      if (operation === "delete") {
        const entry: LibraryChange = { kind: "delete", targets };
        rememberLibraryChange(entry);
        notifyWithUndo(message, () => undoLibraryChange(entry));
      } else {
        const entry: LibraryChange = {
          kind: "batchMove",
          moves: targets.map((target) => ({
            target,
            from: { projectId: target.projectId, parentId: target.parentId },
            to: destination!,
          })),
        };
        rememberLibraryChange(entry);
        notifyWithUndo(message, () => undoLibraryChange(entry));
      }
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
      await refreshProjects([...projectIds], { sidebar: true }).catch(report);
    }
  }
  undoLibraryRef.current = undoLibraryChange;
  return {
    movingLibrary,
    replayLibraryChange,
    dropLibraryItem,
    libraryDrag,
    beginBatchPages,
    applyBatchPages,
  };
}

export type LibraryMoves = ReturnType<typeof useLibraryMoves>;
