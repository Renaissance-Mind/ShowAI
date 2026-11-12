import {
  useCallback,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ArrowLeft, TriangleAlert } from "../../ui/icons";
import { sortDirectoryItems } from "../../core/directory-sort";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import {
  LibraryRow,
  type LibraryMenuPoint,
  type LibraryRowProps,
  type LibraryTarget,
} from "../LibraryNavigation";
import { LibraryDragContext } from "../LibraryDrag";
import ProjectSidebar from "../ProjectSidebar";
import SidebarNavigation from "../SidebarNavigation";
import TemplateNavigation from "../TemplateNavigation";
import { ComponentNavigation } from "../ComponentCatalog";
import { SettingsNavigation } from "../Settings";
import { DocsNavigation } from "../BuiltinDocs";
import type { RecentPage } from "../RecentPages";
import { clickDisposition } from "../open-target";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { CatalogState } from "./useCatalogState";
import type { DialogControl } from "./useDialogState";
import type { MenuState } from "./menus/useMenuState";
import type { StudioRouter } from "./useStudioRouter";
import type { LibraryEdits } from "./useLibraryEdits";
import type { LibraryMoves } from "./useLibraryMoves";
import type { PageState, WorkspaceTabs } from "./types";

/**
 * Each folder's sorted sidebar rows and the row handlers. The handlers keep
 * one identity for the life of the workbench, so memoized rows skip renders
 * that do not concern them.
 */
export function useLibraryRows({
  feedback: { report },
  library: {
    info,
    projects,
    contents,
    pendingReorders,
    organization,
    savedOrganization,
    setExpandedFolders,
    toggleProject,
    folderPreferences,
    folderTarget,
    pageTarget,
  },
  dialogs: { setDialog },
  menus: { showMenu },
  router: { openTargetClick },
  edits: { libraryKeyCommand, unpinTarget },
}: {
  feedback: Pick<StudioFeedback, "report">;
  library: Pick<
    LibraryState,
    | "info"
    | "projects"
    | "contents"
    | "pendingReorders"
    | "organization"
    | "savedOrganization"
    | "setExpandedFolders"
    | "toggleProject"
    | "folderPreferences"
    | "folderTarget"
    | "pageTarget"
  >;
  dialogs: Pick<DialogControl, "setDialog">;
  menus: Pick<MenuState, "showMenu">;
  router: Pick<StudioRouter, "openTargetClick">;
  edits: Pick<LibraryEdits, "libraryKeyCommand" | "unpinTarget">;
}) {
  const tc = useTranslator(commonMessages);
  // Each folder's sorted rows, computed once per project when its contents,
  // order or pending reorders change rather than on every workbench render.
  const sidebarChildren = useMemo(() => {
    const cache = new Map<string, Map<string | null, LibraryTarget[]>>();
    return (projectId: string, parentId: string | null): LibraryTarget[] => {
      let byParent = cache.get(projectId);
      if (!byParent) {
        byParent = new Map();
        cache.set(projectId, byParent);
        const current = contents[projectId];
        const folderIds = new Set(current?.folders.map((item) => item.id));
        const groups = new Map<
          string | null,
          (Parameters<typeof sortDirectoryItems>[0][number] & {
            target: LibraryTarget;
          })[]
        >();
        const add = (
          parent: string | null,
          item: Parameters<typeof sortDirectoryItems>[0][number] & {
            target: LibraryTarget;
          },
        ) => {
          const group = groups.get(parent);
          if (group) group.push(item);
          else groups.set(parent, [item]);
        };
        for (const item of current?.folders ?? [])
          add(item.parentId ?? null, {
            ...item,
            target: folderTarget(item, projectId),
          });
        for (const item of current?.pages ?? [])
          add(
            item.parentId && folderIds.has(item.parentId)
              ? item.parentId
              : null,
            {
              ...item,
              name: item.title || tc("untitled"),
              pinned: item.favorite,
              target: pageTarget(item, projectId),
            },
          );
        for (const [parent, items] of groups)
          byParent.set(
            parent,
            sortDirectoryItems(
              items,
              folderPreferences(projectId, parent),
              organization.entryOrder?.[projectId],
            ).map((item) => item.target),
          );
      }
      return byParent.get(parentId) ?? [];
    };
  }, [
    contents,
    projects,
    pendingReorders,
    organization,
    savedOrganization,
    info?.home,
    tc,
  ]);
  // Stable row handlers let memoized LibraryRows skip unrelated Studio renders.
  const rowHandlers = useRef({
    openTargetClick,
    showMenu,
    toggleProject,
    libraryKeyCommand,
    unpinTarget,
    pageTarget,
  });
  rowHandlers.current = {
    openTargetClick,
    showMenu,
    toggleProject,
    libraryKeyCommand,
    unpinTarget,
    pageTarget,
  };
  const openRecent = useCallback(
    (item: RecentPage, event: ReactMouseEvent<HTMLButtonElement>) =>
      rowHandlers.current.openTargetClick(
        rowHandlers.current.pageTarget(item, item.projectId),
        event,
      ),
    [],
  );
  const showRecentMenu = useCallback(
    (item: RecentPage, anchor: HTMLElement, point?: LibraryMenuPoint) =>
      rowHandlers.current.showMenu(
        rowHandlers.current.pageTarget(item, item.projectId),
        anchor,
        point,
      ),
    [],
  );
  const recentCommand = useCallback(
    (item: RecentPage, command: "rename" | "delete") =>
      rowHandlers.current.libraryKeyCommand(
        rowHandlers.current.pageTarget(item, item.projectId),
        command,
      ),
    [],
  );
  const beginProject = useCallback(() => setDialog({ type: "project" }), []);
  const rowCommand = useCallback<NonNullable<LibraryRowProps["onCommand"]>>(
    (target, command) => rowHandlers.current.libraryKeyCommand(target, command),
    [],
  );
  const unpinRow = useCallback<NonNullable<LibraryRowProps["onUnpin"]>>(
    (target) => rowHandlers.current.unpinTarget(target),
    [],
  );
  const openRow = useCallback<LibraryRowProps["onOpen"]>(
    (target, event) => rowHandlers.current.openTargetClick(target, event),
    [],
  );
  const showRowMenu = useCallback<LibraryRowProps["onMenu"]>(
    (target, anchor, point) =>
      rowHandlers.current.showMenu(target, anchor, point),
    [],
  );
  const rowToggles = useRef(new Map<string, () => void>());
  const rowToggle = (kind: "project" | "folder", id: string) => {
    const key = `${kind}:${id}`;
    let toggle = rowToggles.current.get(key);
    if (!toggle) {
      toggle =
        kind === "project"
          ? () => void rowHandlers.current.toggleProject(id).catch(report)
          : () =>
              setExpandedFolders((current) => ({
                ...current,
                [id]: !current[id],
              }));
      rowToggles.current.set(key, toggle);
    }
    return toggle;
  };
  return {
    sidebarChildren,
    openRecent,
    showRecentMenu,
    recentCommand,
    beginProject,
    rowCommand,
    unpinRow,
    openRow,
    showRowMenu,
    rowToggle,
  };
}

export type LibraryRows = ReturnType<typeof useLibraryRows>;

/** The sidebar: the library tree, or the navigation of the catalog or settings view. */
export function StudioSidebar({
  feedback: { report, action },
  library,
  route,
  catalog,
  dialogs: { setDialog },
  menus: { setNewMenu, setProjectsMenu, setGroupMenu },
  router: { navigate, openDoc, leaveDetour, openProjectManagement },
  moves: { libraryDrag },
  rows: {
    sidebarChildren,
    openRow,
    showRowMenu,
    rowCommand,
    unpinRow,
    rowToggle,
  },
  page,
  workspace,
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  route: RouteState;
  catalog: CatalogState;
  dialogs: DialogControl;
  menus: MenuState;
  router: StudioRouter;
  moves: LibraryMoves;
  rows: LibraryRows;
  page: PageState;
  workspace: WorkspaceTabs;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const tn = useTranslator(navigationMessages);
  const {
    info,
    projects,
    organization,
    contents,
    unreadableProjects,
    setDismissedUnreadable,
    syncOverview,
    projectSyncMarker,
    expandedProjects,
    expandedFolders,
    collapsedSections,
    setCollapsedSections,
    projectTarget,
  } = library;
  const {
    view,
    routing,
    settingsSection,
    setSettingsSection,
    selectedProject,
    selectedFolder,
    showDocs,
    docPage,
    catalogScrollRef,
  } = route;
  const {
    catalogTemplates,
    templateType,
    setTemplateType,
    componentGroups,
    componentCategory,
    setComponentCategory,
  } = catalog;
  function renderChildren(
    projectId: string,
    parentId: string | null = null,
    depth = 0,
  ): ReactNode {
    if (depth > 30) return null;
    if (!contents[projectId]) return null;
    const targets = sidebarChildren(projectId, parentId);
    return targets.map((target) => (
      <div key={target.id}>
        <LibraryRow
          target={target}
          active={
            selectedProject === projectId &&
            (target.kind === "page"
              ? view === "page" && page.draft?.id === target.id
              : view === "project" && selectedFolder === target.id)
          }
          expanded={
            target.kind === "folder" ? !!expandedFolders[target.id] : undefined
          }
          onToggle={
            target.kind === "folder"
              ? rowToggle("folder", target.id)
              : undefined
          }
          onOpen={openRow}
          onMenu={showRowMenu}
          onCommand={rowCommand}
        />
        {target.kind === "folder" && expandedFolders[target.id] && (
          <div className="studio-tree-children">
            {renderChildren(projectId, target.id, depth + 1)}
          </div>
        )}
      </div>
    ));
  }
  const sidebarNavigation = (
    <SidebarNavigation
      current={
        view === "projects"
          ? "recent"
          : view === "templates" || view === "components" || view === "settings"
            ? view
            : null
      }
      onSelect={(section) =>
        void navigate(section === "recent" ? "projects" : section).catch(report)
      }
    />
  );
  return (
    <LibraryDragContext.Provider value={libraryDrag.bindings}>
      {(view === "templates" ||
        view === "components" ||
        view === "settings") && (
        <button
          className="studio-sidebar-back"
          aria-label={tn("backToPrevious")}
          title={tn("backToPrevious")}
          disabled={routing || workspace.switching}
          onClick={action(leaveDetour)}
        >
          <ArrowLeft size={17} strokeWidth={1.7} aria-hidden="true" />
          <span>{tc("back")}</span>
        </button>
      )}
      {view === "settings" ? (
        <SettingsNavigation
          section={settingsSection}
          onSelect={setSettingsSection}
          platform={info?.platform}
        />
      ) : view === "templates" ? (
        <TemplateNavigation
          templates={catalogTemplates}
          active={templateType}
          onSelect={(type) => {
            setTemplateType(type);
            catalogScrollRef.current?.scrollTo({ top: 0 });
          }}
        />
      ) : view === "components" ? (
        <ComponentNavigation
          groups={componentGroups}
          active={componentCategory}
          onSelect={(category) => {
            setComponentCategory(category);
            catalogScrollRef.current?.scrollTo({ top: 0 });
          }}
        />
      ) : (
        <ProjectSidebar
          projects={projects}
          organization={organization}
          selectedProject={selectedProject}
          collapsed={collapsedSections}
          setCollapsed={setCollapsedSections}
          onCreate={(groupId) => setDialog({ type: "project", groupId })}
          onNew={(anchor) =>
            setNewMenu((current) => (current === anchor ? null : anchor))
          }
          onMenu={(anchor) =>
            setProjectsMenu((current) => (current === anchor ? null : anchor))
          }
          onManage={openProjectManagement}
          onGroupMenu={(group, anchor) => setGroupMenu({ group, anchor })}
          unreadable={unreadableProjects.map((item) => (
            <button
              key={item.directory}
              type="button"
              className="studio-unreadable-project"
              title={item.message}
              onClick={() => {
                setDismissedUnreadable((current) =>
                  current.filter((directory) => directory !== item.directory),
                );
                requestAnimationFrame(() =>
                  document
                    .getElementById(`unreadable-${item.directory}`)
                    ?.focus(),
                );
              }}
            >
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{t("unreadableProject", { name: item.directory })}</span>
            </button>
          ))}
          docs={
            showDocs ? (
              <DocsNavigation
                activeId={view === "docs" ? (docPage?.id ?? null) : null}
                onOpen={(id, event) => {
                  event.preventDefault();
                  void openDoc(
                    id,
                    "",
                    clickDisposition(event, info?.platform === "darwin"),
                  ).catch(report);
                }}
              />
            ) : undefined
          }
          renderProject={(item) => (
            <div key={item.id}>
              <LibraryRow
                target={projectTarget(item)}
                marker={projectSyncMarker(item.id)}
                cloud={syncOverview.bindings.has(item.id)}
                active={
                  selectedProject === item.id &&
                  view === "project" &&
                  !selectedFolder
                }
                expanded={!!expandedProjects[item.id]}
                onToggle={rowToggle("project", item.id)}
                onOpen={openRow}
                onMenu={showRowMenu}
                onCommand={rowCommand}
                onUnpin={unpinRow}
              />
              {expandedProjects[item.id] && (
                <div className="studio-tree-children">
                  {renderChildren(item.id)}
                </div>
              )}
            </div>
          )}
        />
      )}
      {sidebarNavigation}
    </LibraryDragContext.Provider>
  );
}
