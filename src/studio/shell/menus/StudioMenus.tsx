import {
  ArchiveRestore,
  EyeOff,
  FileDiff,
  FolderOpen,
  FolderPlus,
  Globe,
  Keyboard,
  LifeBuoy,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "../../../ui/icons";
import { desktop } from "../../../host/bridge";
import { useTranslator } from "../../../i18n/react";
import accountFlowMessages from "../../../i18n/messages/accountFlow";
import feedbackMessages from "../../../i18n/messages/feedback";
import navigationMessages from "../../../i18n/messages/navigation";
import studioMessages from "../../../i18n/messages/studio";
import { LibraryContextMenu } from "../../LibraryNavigation";
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
import type { StudioCommands } from "../commands";
import type { PageState, WorkspaceTabs } from "../types";
import type { MenuState } from "./useMenuState";
import type { MenuItems } from "./useMenuItems";
import { LibraryItemMenu } from "./LibraryItemMenu";

/** The workbench's anchored menus: export, the project list, New, groups, the directory view and items. */
export function StudioMenus({
  feedback,
  library,
  route,
  dialogs,
  menus,
  menuItems,
  directory,
  router,
  pageActions,
  edits,
  moves,
  commands: { openFeedback },
  page,
  workspace,
  find,
  externalChangeCount,
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
  commands: StudioCommands;
  page: PageState;
  workspace: WorkspaceTabs;
  find: ReturnType<typeof useFind>;
  externalChangeCount: number;
}) {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  const accountFlow = useTranslator(accountFlowMessages);
  const tfeedback = useTranslator(feedbackMessages);
  const { setNotice, action } = feedback;
  const { capabilities, externalChangesAvailable, refreshProjects } = library;
  const { view } = route;
  const { setDialog } = dialogs;
  const {
    groupMenu,
    setGroupMenu,
    directoryView,
    viewMenu,
    setViewMenu,
    viewOptions,
    viewIcon,
    chooseDirectoryView,
    projectsMenu,
    setProjectsMenu,
    newMenu,
    setNewMenu,
    exportMenu,
    setExportMenu,
    pageExportMenu,
    setPageExportMenu,
    exportTarget,
    setExportTarget,
  } = menus;
  const { pageExportMenuItems, newMenuItems } = menuItems;
  const { openProjectManagement } = router;
  const { exportSite, activePageTarget } = pageActions;
  return (
    <>
      {pageExportMenu && (exportTarget || (view === "page" && page.draft)) && (
        <LibraryContextMenu
          anchor={pageExportMenu}
          label={t("exportMenuLabel")}
          onClose={() => {
            setPageExportMenu(null);
            setExportTarget(null);
          }}
          items={pageExportMenuItems(exportTarget ?? activePageTarget())}
        />
      )}
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
              label: accountFlow("projects.title"),
              icon: <FolderOpen size={15} />,
              onSelect: openProjectManagement,
            },
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
            {
              label: tn("deletedItems"),
              icon: <ArchiveRestore size={15} />,
              separatorBefore: true,
              onSelect: () => setDialog({ type: "deletedItems" }),
            },
            {
              label: tn("hiddenProjects"),
              icon: <EyeOff size={15} />,
              onSelect: () => setDialog({ type: "hiddenProjects" }),
            },
            ...(externalChangesAvailable
              ? [
                  {
                    label: externalChangeCount
                      ? tn("externalChangesCount", {
                          count: externalChangeCount,
                        })
                      : tn("externalChanges"),
                    icon: <FileDiff size={15} />,
                    onSelect: () => setDialog({ type: "workspaceConflicts" }),
                  },
                ]
              : []),
            {
              label: tn("keyboardShortcuts"),
              icon: <Keyboard size={15} />,
              onSelect: () => setDialog({ type: "shortcuts" }),
            },
            {
              label: tfeedback("helpAndFeedback"),
              icon: <LifeBuoy size={15} />,
              onSelect: () => openFeedback.current("about"),
            },
          ]}
        />
      )}
      {newMenu && (
        <LibraryContextMenu
          anchor={newMenu}
          label={tn("newMenu")}
          onClose={() => setNewMenu(null)}
          items={newMenuItems()}
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
                await refreshProjects([], { sidebar: true });
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
      <LibraryItemMenu
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
        page={page}
        workspace={workspace}
        find={find}
      />
    </>
  );
}
