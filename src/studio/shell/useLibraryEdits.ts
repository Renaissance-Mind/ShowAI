import type { DirectorySortBy } from "../../core/model";
import { desktop } from "../../host/bridge";
import { useTranslator } from "../../i18n/react";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import type { LibraryTarget } from "../LibraryNavigation";
import type { RestoreTarget } from "../LibraryNavigationDialogs";
import type { LibraryChange } from "../library-history";
import type { LoadedPage } from "../usePage";
import {
  folderSubtree,
  withLibraryEntry,
  withoutLibraryEntries,
  withProjectFields,
  type LibraryEntryFields,
} from "../navigation-refresh";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";
import type { StudioRouter } from "./useStudioRouter";
import { DraftHeld, operation, type PageState } from "./types";

/** Renaming, re-iconing, pinning, sorting, grouping and deleting library items. */
export function useLibraryEdits({
  feedback: { report, notifyWithUndo },
  library: {
    info,
    projects,
    setProjects,
    contents,
    setContents,
    reorderQueue,
    rememberLibraryChange,
    undoLibraryRef,
    refreshProjects,
  },
  route: {
    selectedFolder,
    setSelectedProject,
    setSelectedFolder,
    setView,
    selectedRef,
  },
  dialogs: { setDialog, dialogRef },
  menus: { setContextMenu },
  router: { saveOpenPage, settlePages, forgetDeleted },
  page,
}: {
  feedback: Pick<StudioFeedback, "report" | "notifyWithUndo">;
  library: Pick<
    LibraryState,
    | "info"
    | "projects"
    | "setProjects"
    | "contents"
    | "setContents"
    | "reorderQueue"
    | "rememberLibraryChange"
    | "undoLibraryRef"
    | "refreshProjects"
  >;
  route: Pick<
    RouteState,
    | "selectedFolder"
    | "setSelectedProject"
    | "setSelectedFolder"
    | "setView"
    | "selectedRef"
  >;
  dialogs: Pick<DialogControl, "setDialog" | "dialogRef">;
  menus: Pick<MenuState, "setContextMenu">;
  router: Pick<StudioRouter, "saveOpenPage" | "settlePages" | "forgetDeleted">;
  page: PageState;
}) {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  // A deletion's toast reverses it through the library history.
  const undoLibraryChange = (entry: LibraryChange) =>
    undoLibraryRef.current(entry);
  function beginRename(target: LibraryTarget) {
    const currentProject =
      target.kind === "project"
        ? projects.find((item) => item.id === target.projectId)
        : undefined;
    setDialog(
      currentProject
        ? { type: "project", project: currentProject }
        : target.kind === "folder"
          ? {
              type: "folder",
              projectId: target.projectId,
              parentId: target.parentId,
              target,
            }
          : { type: "rename", target },
    );
  }
  /** F2 and Delete on a focused sidebar or folder row. */
  function libraryKeyCommand(
    target: LibraryTarget,
    command: "rename" | "delete",
  ) {
    if (dialogRef.current) return;
    setContextMenu(null);
    if (command === "rename") beginRename(target);
    else beginDelete(target);
  }
  /** A page is deleted at once with Undo in the toast; a folder or project is confirmed first. */
  function beginDelete(target: LibraryTarget) {
    setContextMenu(null);
    if (target.kind === "page")
      void deleteTarget(target).catch((error) =>
        report(error, { action: operation("op.delete"), object: target.title }),
      );
    else setDialog({ type: "delete", target });
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
    await refreshProjects([target.projectId], { sidebar: true });
  }
  async function moveProject(projectId: string, groupId: string | null) {
    await desktop.invoke("projects:group", { projectId, groupId });
    await refreshProjects([projectId], { sidebar: true });
  }
  /** The name, icon and pin an item has in loaded navigation, to undo a change. */
  function currentFields(target: LibraryTarget): LibraryEntryFields {
    if (target.kind === "project") {
      const item = projects.find((project) => project.id === target.projectId);
      return {
        name: item?.name ?? target.title,
        icon: item?.icon ?? "",
        pinned: !!item?.pinned,
      };
    }
    const loaded = contents[target.projectId];
    if (target.kind === "folder") {
      const item = loaded?.folders.find((folder) => folder.id === target.id);
      return {
        name: item?.name ?? target.title,
        icon: item?.icon ?? "",
        pinned: !!item?.pinned,
      };
    }
    const item = loaded?.pages.find((entry) => entry.id === target.id);
    return {
      name: item?.title ?? target.title,
      icon: item?.icon ?? "",
      pinned: !!item?.favorite,
    };
  }
  /** Shows a name, icon or pin change in the sidebar at once; the returned function takes it back. */
  function showFields(target: LibraryTarget, fields: LibraryEntryFields) {
    const before = currentFields(target);
    const apply = (values: LibraryEntryFields) => {
      if (target.kind === "project")
        setProjects((current) =>
          withProjectFields(current, target.projectId, values),
        );
      else
        setContents((current) =>
          withLibraryEntry(
            current,
            {
              kind: target.kind as "page" | "folder",
              projectId: target.projectId,
              id: target.id,
            },
            values,
          ),
        );
    };
    apply(fields);
    return () =>
      apply(
        Object.fromEntries(
          Object.keys(fields).map((key) => [
            key,
            before[key as keyof LibraryEntryFields],
          ]),
        ) as LibraryEntryFields,
      );
  }
  /**
   * Renames, re-icons or pins one item. The sidebar shows the change and the
   * dialog closes before the library confirms it; a failure takes the change
   * back and is reported. A page being edited takes the change in its editor.
   */
  async function updateTarget(
    target: LibraryTarget,
    change: { name?: string; icon?: string; pinned?: boolean },
    options: { close?: () => void; record?: boolean } = {},
  ) {
    const retained =
      target.kind === "page"
        ? page.sessions.sessionFor(target.projectId, target.id)
        : undefined;
    const active = page.sessions.getSnapshot().active;
    // A page with unsaved edits saves them first; a conflict there needs a decision.
    if (retained === active && retained) await saveOpenPage();
    else if (retained && !(await retained.flush()))
      throw new DraftHeld(t("resolveDraftFirst"));
    const before = currentFields(target);
    const revert = showFields(target, change);
    options.close?.();
    try {
      if (retained) {
        retained.edit({
          ...(change.name !== undefined ? { title: change.name } : {}),
          ...(change.icon !== undefined ? { icon: change.icon } : {}),
          ...(change.pinned !== undefined ? { favorite: change.pinned } : {}),
        });
        if (!(await (retained === active ? page.flush() : retained.flush())))
          throw new DraftHeld(t("resolveDraftFirst"));
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
    } catch (error) {
      revert();
      report(error, {
        action: operation(change.name !== undefined ? "op.rename" : "op.pin"),
        object: target.title,
      });
      return false;
    }
    if (change.name !== undefined && options.record !== false)
      rememberLibraryChange({
        kind: "rename",
        target: { ...target, title: change.name },
        before: {
          name: before.name,
          ...(change.icon !== undefined ? { icon: before.icon } : {}),
        },
        after: {
          name: change.name,
          ...(change.icon !== undefined ? { icon: change.icon } : {}),
        },
      });
    await refreshProjects([target.projectId], {
      sidebar: target.kind === "project",
    });
    return true;
  }
  /** Ids a deletion removes: the page, the folder with everything in it, or the whole project. */
  function deletionScope(target: LibraryTarget): {
    project?: boolean;
    folders: Set<string>;
    pages: Set<string>;
  } {
    if (target.kind === "project")
      return { project: true, folders: new Set(), pages: new Set() };
    if (target.kind === "page")
      return { folders: new Set(), pages: new Set([target.id]) };
    return folderSubtree(contents, target.projectId, target.id);
  }
  /**
   * Deletes one item. Pages it holds that are open anywhere save first; their
   * editors close, their tab history falls back, and the item leaves the
   * sidebar before the library confirms. Deleting archives, so the toast and
   * Cmd+Z restore it.
   */
  async function deleteTarget(
    target: LibraryTarget,
    options: { close?: () => void; record?: boolean; notify?: boolean } = {},
  ) {
    const home = info?.home;
    const gone = deletionScope(target);
    const touches = (pageId: string, parentId: string | null) =>
      !!gone.project ||
      gone.pages.has(pageId) ||
      (!!parentId && gone.folders.has(parentId));
    await settlePages(target.projectId, touches);
    const closePage =
      page.projectId === target.projectId &&
      !!page.draft &&
      touches(page.draft.id, page.draft.parentId ?? null);
    const currentRecord =
      target.kind === "page"
        ? await desktop.invoke<LoadedPage>("pages:get", {
            projectId: target.projectId,
            pageId: target.id,
          })
        : null;
    if (closePage && !(await page.clear()))
      throw new DraftHeld(t("resolveDraftFirst"));
    const previousProjects = projects;
    const previousContents = contents[target.projectId];
    if (target.kind === "project")
      setProjects((current) =>
        current.filter((item) => item.id !== target.projectId),
      );
    else
      setContents((current) =>
        withoutLibraryEntries(
          current,
          target.projectId,
          new Set([...gone.folders, ...gone.pages]),
        ),
      );
    options.close?.();
    setContextMenu(null);
    const insideDeleted = (folderId: string | null) =>
      !!folderId && gone.folders.has(folderId);
    if (target.kind === "project" && selectedRef.current === target.projectId) {
      setSelectedProject(null);
      selectedRef.current = null;
      setSelectedFolder(null);
      setView("projects");
    } else if (
      selectedRef.current === target.projectId &&
      (closePage || insideDeleted(selectedFolder))
    ) {
      setSelectedFolder(
        target.kind === "folder"
          ? target.parentId
          : insideDeleted(selectedFolder)
            ? null
            : (page.draft?.parentId ?? selectedFolder),
      );
      setView("project");
    }
    try {
      await desktop.invoke(
        `${target.kind === "project" ? "projects" : target.kind === "folder" ? "folders" : "pages"}:remove`,
        {
          ...(home ? { expectedHome: home } : {}),
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
    } catch (error) {
      if (target.kind === "project") setProjects(previousProjects);
      else if (previousContents)
        setContents((current) => ({
          ...current,
          [target.projectId]: previousContents,
        }));
      report(error, { action: operation("op.delete"), object: target.title });
      return false;
    }
    forgetDeleted(target.projectId, gone);
    const entry: LibraryChange = { kind: "delete", targets: [target] };
    if (options.record !== false) rememberLibraryChange(entry);
    if (options.notify !== false)
      notifyWithUndo(tn("deletedNamed", { title: target.title }), () =>
        undoLibraryChange(entry),
      );
    await refreshProjects([target.projectId], {
      sidebar: target.kind === "project",
    });
    return true;
  }
  const restoreTargetOf = (target: LibraryTarget): RestoreTarget =>
    target.kind === "project"
      ? { kind: "project", projectId: target.projectId, title: target.title }
      : {
          kind: target.kind,
          projectId: target.projectId,
          id: target.id,
          title: target.title,
        };
  const unpinTarget = (target: LibraryTarget) => {
    void updateTarget(target, { pinned: false }).catch(report);
  };
  return {
    beginRename,
    libraryKeyCommand,
    beginDelete,
    changeDirectorySort,
    moveProject,
    updateTarget,
    deletionScope,
    deleteTarget,
    restoreTargetOf,
    unpinTarget,
  };
}

export type LibraryEdits = ReturnType<typeof useLibraryEdits>;
