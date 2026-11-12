import { useRef, useState } from "react";
import { Grid2X2, LayoutGrid, LayoutList } from "../../../ui/icons";
import type { ProjectGroup } from "../../../core/model";
import type {
  LibraryContextMenuItem,
  LibraryMenuPoint,
  LibraryTarget,
} from "../../LibraryNavigation";
import { useTranslator } from "../../../i18n/react";
import studioMessages from "../../../i18n/messages/studio";

/** Which workbench menu is open and where, and how the directory lays out its entries. */
export function useMenuState() {
  const t = useTranslator(studioMessages);
  const [groupMenu, setGroupMenu] = useState<{
    group: ProjectGroup;
    anchor: HTMLElement;
  } | null>(null);
  const [directoryView, setDirectoryView] = useState<
    "list" | "small" | "medium" | "large"
  >(() => {
    const saved = localStorage.getItem("showai:directory-view");
    return saved === "small" || saved === "medium" || saved === "large"
      ? saved
      : "list";
  });
  const [viewMenu, setViewMenu] = useState<HTMLElement | null>(null);
  const viewOptions = ["list", "small", "medium", "large"] as const;
  const viewIcon = (mode: typeof directoryView) =>
    mode === "list" ? (
      <LayoutList size={16} />
    ) : mode === "small" ? (
      <LayoutGrid size={16} />
    ) : (
      <Grid2X2 size={mode === "large" ? 20 : 16} />
    );
  const chooseDirectoryView = (mode: typeof directoryView) => {
    setDirectoryView(mode);
    localStorage.setItem("showai:directory-view", mode);
  };
  const directoryViewControl = (): LibraryContextMenuItem => ({
    label: t("directoryView"),
    icon: <LayoutGrid size={15} />,
    control: (
      <div
        className="directory-view-switch"
        role="group"
        aria-label={t("directoryView")}
      >
        {viewOptions.map((mode) => (
          <button
            key={mode}
            type="button"
            title={t(`view.${mode}`)}
            aria-label={t(`view.${mode}`)}
            aria-pressed={directoryView === mode}
            onClick={() => chooseDirectoryView(mode)}
          >
            {viewIcon(mode)}
          </button>
        ))}
      </div>
    ),
  });
  const [contextMenu, setContextMenu] = useState<{
    target: LibraryTarget;
    anchor: HTMLElement;
    point?: LibraryMenuPoint;
    pageTools?: boolean;
    creationOnly?: boolean;
    /** The directory's selected entries, acted on together. */
    selection?: boolean;
  } | null>(null);
  const [projectsMenu, setProjectsMenu] = useState<HTMLElement | null>(null);
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [exportMenu, setExportMenu] = useState<HTMLElement | null>(null);
  const exportSiteButton = useRef<HTMLButtonElement>(null);
  const [pageExportMenu, setPageExportMenu] = useState<HTMLElement | null>(
    null,
  );
  /** A sidebar or directory page whose Export menu is open; else the open page. */
  const [exportTarget, setExportTarget] = useState<LibraryTarget | null>(null);
  const showMenu = (
    target: LibraryTarget,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
    pageTools = false,
    creationOnly = false,
    selection = false,
  ) =>
    setContextMenu((current) =>
      !point && current?.anchor === anchor && current.target.id === target.id
        ? null
        : { target, anchor, point, pageTools, creationOnly, selection },
    );
  return {
    groupMenu,
    setGroupMenu,
    directoryView,
    viewMenu,
    setViewMenu,
    viewOptions,
    viewIcon,
    chooseDirectoryView,
    directoryViewControl,
    contextMenu,
    setContextMenu,
    projectsMenu,
    setProjectsMenu,
    newMenu,
    setNewMenu,
    exportMenu,
    setExportMenu,
    exportSiteButton,
    pageExportMenu,
    setPageExportMenu,
    exportTarget,
    setExportTarget,
    showMenu,
  };
}

export type MenuState = ReturnType<typeof useMenuState>;
