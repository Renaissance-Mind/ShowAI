import {
  AppWindow,
  ArrowUpRight,
  AtSign,
  Cloud,
  Copy,
  EyeOff,
  FileText,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  Globe,
  Link2,
  PanelsTopLeft,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
} from "../../../ui/icons";
import { desktop } from "../../../host/bridge";
import { containerMenuItems } from "../../../surface/EditorControls";
import { useTranslator } from "../../../i18n/react";
import accountFlowMessages from "../../../i18n/messages/accountFlow";
import commonMessages from "../../../i18n/messages/common";
import findMessages from "../../../i18n/messages/find";
import navigationMessages from "../../../i18n/messages/navigation";
import studioMessages from "../../../i18n/messages/studio";
import { LibraryContextMenu } from "../../LibraryNavigation";
import { clientIsMac, formatShortcut } from "../../keyboard-shortcuts";
import type { useFind } from "../../find/useFind";
import type { StudioFeedback } from "../useStudioFeedback";
import type { LibraryState } from "../useLibraryState";
import type { RouteState } from "../useRouteState";
import type { DialogControl } from "../useDialogState";
import type { DirectoryState } from "../useDirectory";
import type { StudioRouter } from "../useStudioRouter";
import type { PageActions } from "../usePageActions";
import type { LibraryEdits } from "../useLibraryEdits";
import type { LibraryMoves } from "../useLibraryMoves";
import type { PageState, WorkspaceTabs } from "../types";
import type { MenuState } from "./useMenuState";
import type { MenuItems } from "./useMenuItems";

/** The menu of one library item, the directory's selection, or what can be added to a directory. */
export function LibraryItemMenu({
  feedback: { notifyWithUndo, setNotice, action },
  library: { info, capabilities, organization, refreshProjects },
  route: {
    workspaceReady,
    routing,
    selectedProject,
    setSyncRequest,
    setSettingsSection,
    editorControls,
  },
  dialogs: { setDialog },
  menus: { contextMenu, setContextMenu, setExportTarget, setPageExportMenu },
  menuItems: {
    creationMenuItems,
    directorySortMenuItems,
    projectOrderMenuItems,
  },
  directory: { syncReadOnly },
  router: { settleOpenPage, navigate, openTarget },
  pageActions: {
    copyPageReference,
    copyPageLink,
    duplicatePage,
    beginPageIcon,
  },
  edits: { beginRename, beginDelete, updateTarget, moveProject },
  moves: { beginBatchPages },
  page,
  workspace,
  find,
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  route: RouteState;
  dialogs: DialogControl;
  menus: MenuState;
  menuItems: MenuItems;
  directory: DirectoryState;
  router: StudioRouter;
  pageActions: PageActions;
  edits: LibraryEdits;
  moves: LibraryMoves;
  page: PageState;
  workspace: WorkspaceTabs;
  find: ReturnType<typeof useFind>;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const tn = useTranslator(navigationMessages);
  const tfind = useTranslator(findMessages);
  const accountFlow = useTranslator(accountFlowMessages);
  if (!contextMenu) return null;
  return (
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
                ...(capabilities.tabs && !contextMenu.pageTools
                  ? [
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
                    ]
                  : []),
                ...(capabilities.windows
                  ? [
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
                    ]
                  : []),
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
                            : action(() => beginPageIcon(contextMenu.target)),
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
                              await desktop.invoke("sync:projectVisibility", {
                                projectId,
                                visible: true,
                              });
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
                                moveProject(contextMenu.target.projectId, null),
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
                            contextMenu.pageTools ? null : contextMenu.target,
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
  );
}
