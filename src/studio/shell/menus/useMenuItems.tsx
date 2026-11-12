import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  AtSign,
  BookOpen,
  Check,
  CodeXml,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  FolderPlus,
  Globe,
  Link2,
  ListOrdered,
  Presentation,
  Sparkles,
  Upload,
} from "../../../ui/icons";
import type { DirectorySortBy, ProjectSummary } from "../../../core/model";
import { orderSidebarProjects } from "../../../core/sidebar-order";
import { directorySortOptions } from "../../../core/directory-sort";
import { useTranslator } from "../../../i18n/react";
import commonMessages from "../../../i18n/messages/common";
import navigationMessages from "../../../i18n/messages/navigation";
import studioMessages from "../../../i18n/messages/studio";
import type {
  LibraryContextMenuItem,
  LibraryTarget,
} from "../../LibraryNavigation";
import { newMenuDestination, type CreationChoice } from "../../new-menu";
import type { StudioFeedback } from "../useStudioFeedback";
import type { LibraryState } from "../useLibraryState";
import type { RouteState } from "../useRouteState";
import type { DialogControl } from "../useDialogState";
import type { DirectoryState } from "../useDirectory";
import type { PageActions } from "../usePageActions";
import type { LibraryEdits } from "../useLibraryEdits";
import type { LibraryMoves } from "../useLibraryMoves";
import type { MenuState } from "./useMenuState";
import type { WorkspaceTabs } from "../types";

/** Menu entries shared by the workbench menus, the native menu and quick jump. */
export function useMenuItems({
  feedback: { action },
  library: {
    capabilities,
    projects,
    organization,
    syncOverview,
    folderPreferences,
    projectTarget,
    folderTarget,
  },
  route: { view, selectedFolder, workspaceReady, routing },
  dialogs: { setDialog },
  menus: { directoryViewControl },
  directory: { project, currentFolder },
  pageActions: {
    busy,
    exportPage,
    copyPageLink,
    copyPageReference,
    activePageTarget,
    runCreation,
  },
  edits: { changeDirectorySort },
  moves: { movingLibrary, dropLibraryItem },
  workspace,
}: {
  feedback: Pick<StudioFeedback, "action">;
  library: Pick<
    LibraryState,
    | "capabilities"
    | "projects"
    | "organization"
    | "syncOverview"
    | "folderPreferences"
    | "projectTarget"
    | "folderTarget"
  >;
  route: Pick<
    RouteState,
    "view" | "selectedFolder" | "workspaceReady" | "routing"
  >;
  dialogs: Pick<DialogControl, "setDialog">;
  menus: Pick<MenuState, "directoryViewControl">;
  directory: Pick<DirectoryState, "project" | "currentFolder">;
  pageActions: Pick<
    PageActions,
    | "busy"
    | "exportPage"
    | "copyPageLink"
    | "copyPageReference"
    | "activePageTarget"
    | "runCreation"
  >;
  edits: Pick<LibraryEdits, "changeDirectorySort">;
  moves: Pick<LibraryMoves, "movingLibrary" | "dropLibraryItem">;
  workspace: Pick<WorkspaceTabs, "switching">;
}) {
  const t = useTranslator(studioMessages);
  const tc = useTranslator(commonMessages);
  const tn = useTranslator(navigationMessages);
  /**
   * Content that can be created in a project or folder. Without a target, each
   * entry first opens the new-project dialog and then creates in that project.
   */
  function creationMenuItems(
    target: LibraryTarget | null,
  ): LibraryContextMenuItem[] {
    const directory = target && {
      projectId: target.projectId,
      parentId: target.kind === "folder" ? target.id : target.parentId,
    };
    const select = (choice: CreationChoice) =>
      directory
        ? action(() => runCreation(choice, directory))
        : () => setDialog({ type: "project", then: choice });
    return [
      {
        label: t("create.folder"),
        icon: <FolderPlus size={15} />,
        command: "new.folder",
        onSelect: select("folder"),
      },
      {
        label: t("create.page"),
        icon: <FileText size={15} />,
        command: "new.page",
        onSelect: select("page"),
      },
      {
        label: t("create.board"),
        icon: <Presentation size={15} />,
        command: "new.board",
        onSelect: select("board"),
      },
      {
        label: tn("newPageForAgent"),
        icon: <Sparkles size={15} />,
        command: "new.agentPage",
        onSelect: select("agentPage"),
      },
      {
        label: t("create.fromTemplate"),
        icon: <FilePlus2 size={15} />,
        separatorBefore: true,
        command: "new.template",
        onSelect: select("template"),
      },
      {
        label: t("create.import"),
        icon: <Upload size={15} />,
        command: "new.import",
        onSelect: select("import"),
      },
    ];
  }
  /** The grouped export menu shared by the top-bar ↗ button and the page 「…」 menu. */
  function pageExportMenuItems(
    target = activePageTarget(),
  ): LibraryContextMenuItem[] {
    const exported = target && {
      projectId: target.projectId,
      pageId: target.id,
    };
    const common = t("exportGroup.common"),
      agents = t("exportGroup.agents"),
      advanced = t("exportGroup.advanced");
    return [
      {
        group: common,
        label: t("exportHtml"),
        command: "export.html",
        description: t("exportHtmlDetail"),
        icon: <ArrowUpRight size={15} />,
        disabled: busy,
        onSelect: () =>
          void exportPage("html", "bundled", undefined, undefined, exported),
      },
      {
        group: common,
        label: t("exportPdf"),
        command: "export.pdf",
        icon: <FileDown size={15} />,
        disabled: busy,
        onSelect: () =>
          void exportPage("pdf", "bundled", undefined, undefined, exported),
      },
      ...(capabilities.advancedPageExport
        ? [
            {
              group: common,
              label: t("exportReadingShort"),
              command: "export.reading",
              description: t("exportReadingDetail"),
              icon: <BookOpen size={15} />,
              disabled: busy,
              onSelect: () =>
                void exportPage(
                  "html",
                  "bundled",
                  "reading",
                  undefined,
                  exported,
                ),
            },
            {
              group: agents,
              label: t("exportSnippetShort"),
              command: "export.snippet",
              description: t("exportSnippetDetail"),
              icon: <CodeXml size={15} />,
              disabled: busy,
              onSelect: () =>
                void exportPage(
                  "inline",
                  "bundled",
                  undefined,
                  undefined,
                  exported,
                ),
            },
          ]
        : []),
      ...(target
        ? [
            {
              group: common,
              label: tc("copyLink"),
              command: "page.copyLink",
              description: t("copyPageLinkDetail"),
              icon: <Link2 size={15} />,
              onSelect: action(() =>
                copyPageLink({
                  projectId: target.projectId,
                  pageId: target.id,
                  blockIds: [],
                }),
              ),
            },
          ]
        : []),
      ...(target
        ? [
            {
              group: agents,
              label: tc("copyReference"),
              command: "page.copyReference",
              description: t("copyPageReferenceDetail"),
              icon: <AtSign size={15} />,
              onSelect: action(() =>
                copyPageReference(target.projectId, {
                  kind: "page",
                  pageId: target.id,
                }),
              ),
            },
          ]
        : []),
      ...(capabilities.advancedPageExport
        ? [
            {
              group: advanced,
              label: t("exportOnlinePageShort"),
              command: "export.online",
              description: t("exportOnlinePageDetail"),
              icon: <Globe size={15} />,
              disabled: busy,
              onSelect: () =>
                void exportPage("html", "bundled", "reading", "cdn", exported),
            },
            {
              group: advanced,
              label: t("exportWithPublished"),
              command: "export.published",
              description: t("exportWithPublishedDetail"),
              icon: <Globe size={15} />,
              disabled: busy,
              onSelect: () =>
                void exportPage(
                  "html",
                  "remote",
                  undefined,
                  undefined,
                  exported,
                ),
            },
          ]
        : []),
      {
        group: advanced,
        label: tc("downloadSource"),
        command: "export.source",
        description: t("downloadSourceDetail"),
        icon: <Download size={15} />,
        disabled: busy,
        onSelect: () =>
          void exportPage("json", "bundled", undefined, undefined, exported),
      },
    ];
  }
  /**
   * The sidebar's New menu: content, then a new project. Content goes to the
   * open writable project, else the most recently used writable project, else
   * a project created first.
   */
  function newMenuItems(): LibraryContextMenuItem[] {
    const readOnly = (id: string) =>
      syncOverview.markers.get(id) === "readOnly";
    const context =
      (view === "project" || view === "page") && project
        ? {
            projectId: project.id,
            target: currentFolder
              ? folderTarget(currentFolder, project.id)
              : projectTarget(project),
          }
        : null;
    const destination = newMenuDestination(context, projects, readOnly);
    const target =
      destination.kind === "context"
        ? destination.target
        : destination.kind === "recent"
          ? projectTarget(destination.project)
          : null;
    // A selected folder that is still loading would put content one level too high.
    const disabled =
      !workspaceReady ||
      routing ||
      workspace.switching ||
      busy ||
      (destination.kind === "context" && !!selectedFolder && !currentFolder);
    return [
      ...creationMenuItems(target).map((item) => ({ ...item, disabled })),
      {
        label: tn("newProject"),
        command: "new.project",
        icon: <FolderPlus size={15} />,
        separatorBefore: true,
        onSelect: () => setDialog({ type: "project" }),
      },
    ];
  }
  function directorySortMenuItems(
    target: LibraryTarget,
  ): LibraryContextMenuItem[] {
    if (target.kind === "page") return [];
    const preferences = folderPreferences(
      target.projectId,
      target.kind === "folder" ? target.id : null,
    );
    const sortBy = preferences.sortBy ?? "updatedAt";
    const options: { value: DirectorySortBy }[] = [
      ...directorySortOptions,
      ...(sortBy === "manual" || preferences.manualOrder?.length
        ? [{ value: "manual" as const }]
        : []),
    ];
    return [
      directoryViewControl(),
      ...options.map((option, index) => ({
        label: t(`sort.${option.value}`),
        checked: option.value === sortBy,
        icon:
          option.value === sortBy ? (
            <Check size={15} />
          ) : (
            <ListOrdered size={15} />
          ),
        separatorBefore: index === 0,
        onSelect: action(() => changeDirectorySort(target, option.value)),
      })),
    ];
  }
  function projectOrderMenuItems(target: LibraryTarget) {
    if (target.kind !== "project") return [];
    const sectionFor = (item: ProjectSummary) =>
      item.pinned
        ? "pinned"
        : (organization.projectGroups[item.id] ?? "projects");
    const project = projects.find((item) => item.id === target.id);
    if (!project) return [];
    const sectionId = sectionFor(project);
    const siblings = orderSidebarProjects(
      projects,
      organization.projectOrder,
    ).filter((item) => sectionFor(item) === sectionId);
    const index = siblings.findIndex((item) => item.id === target.id);
    return ([-1, 1] as const).map((direction) => ({
      label: t(direction < 0 ? "moveProjectUp" : "moveProjectDown"),
      icon: direction < 0 ? <ArrowUp size={15} /> : <ArrowDown size={15} />,
      disabled: !siblings[index + direction] || movingLibrary.current,
      onSelect: action(() =>
        dropLibraryItem({
          source: target,
          sectionId,
          relativeId: siblings[index + direction]?.id,
          placement: direction < 0 ? "before" : "after",
        }),
      ),
    }));
  }
  return {
    creationMenuItems,
    pageExportMenuItems,
    newMenuItems,
    directorySortMenuItems,
    projectOrderMenuItems,
  };
}

export type MenuItems = ReturnType<typeof useMenuItems>;
