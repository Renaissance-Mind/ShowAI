import { clientIsMac, isDeleteShortcut } from "./keyboard-shortcuts";
import { memo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pin,
} from "../ui/icons";
import "./library-row.css";
import PageIcon from "../components/PageIcon";
import ProjectIcon from "./ProjectIcon";
import type { LibraryMenuPoint } from "./LibraryContextMenu";
import { useLibraryDrag } from "./LibraryDrag";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import sidebarMessages from "../i18n/messages/sidebar";

export type LibraryTarget =
  | {
      kind: "project";
      icon?: string;
      projectId: string;
      id: string;
      title: string;
      pinned: boolean;
      parentId: null;
    }
  | {
      kind: "folder" | "page";
      projectId: string;
      id: string;
      title: string;
      pinned: boolean;
      parentId: string | null;
      icon?: string;
      /** Writer name when an Agent created this page and it has not been opened. */
      agentCreated?: string;
    };

export interface LibraryRowProps {
  target: LibraryTarget;
  active?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: (target: LibraryTarget, event: MouseEvent<HTMLButtonElement>) => void;
  onMenu: (
    target: LibraryTarget,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) => void;
  /** F2 renames and Delete (⌘⌫ on macOS) deletes the focused row. */
  onCommand?: (target: LibraryTarget, command: "rename" | "delete") => void;
  /** Short status after the title, e.g. a project's sync state. */
  marker?: { label: string; title?: string; tone?: "warning" | "muted" };
  /** Project is connected to cloud sync, independently of transient sync errors. */
  cloud?: boolean;
}

function LibraryRowView({
  target,
  active = false,
  expanded = false,
  onToggle,
  onOpen,
  onMenu,
  onCommand,
  marker,
  cloud,
}: LibraryRowProps) {
  const t = useTranslator(sidebarMessages);
  const tc = useTranslator(commonMessages);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drag = useLibraryDrag();
  const title =
    target.title.trim() ||
    (target.kind === "page"
      ? tc("untitledPage")
      : target.kind === "folder"
        ? t("newFolder")
        : t("untitledProject"));
  const Icon =
    target.kind === "page" ? FileText : expanded ? FolderOpen : Folder;
  const openKeyboardMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      onCommand &&
      (event.key === "F2" || isDeleteShortcut(event, clientIsMac()))
    ) {
      event.preventDefault();
      event.stopPropagation();
      onCommand(target, event.key === "F2" ? "rename" : "delete");
      return;
    }
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (menuButton.current) onMenu(target, menuButton.current);
  };

  return (
    <div
      {...drag?.row(target, expanded, onToggle)}
      className={`studio-tree-row${active ? " active" : ""}`}
      data-kind={target.kind}
      data-library-id={target.id}
      data-pinned={target.pinned || undefined}
      onKeyDown={openKeyboardMenu}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (menuButton.current)
          onMenu(target, menuButton.current, {
            x: event.clientX,
            y: event.clientY,
          });
      }}
    >
      {onToggle ? (
        <button
          type="button"
          className="studio-tree-chevron"
          aria-label={t(expanded ? "collapseItem" : "expandItem", { title })}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      ) : (
        <span className="studio-tree-chevron" aria-hidden="true" />
      )}
      <button
        type="button"
        className="studio-tree-main"
        aria-current={active ? "page" : undefined}
        title={title}
        onClick={(event) => onOpen(target, event)}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            onOpen(target, event);
          }
        }}
      >
        {target.kind === "project" ? (
          <ProjectIcon value={target.icon} expanded={expanded} cloud={cloud} />
        ) : target.kind === "page" || target.icon ? (
          <PageIcon value={target.icon} size={15} />
        ) : (
          <Icon size={15} aria-hidden="true" />
        )}
        <span className="studio-tree-title">{title}</span>
        {"agentCreated" in target && target.agentCreated !== undefined && (
          <span
            className="agent-created-mark"
            role="img"
            aria-label={t("agentCreatedBy", { name: target.agentCreated })}
            title={t("agentCreatedBy", { name: target.agentCreated })}
          >
            {t("agentCreated")}
          </span>
        )}
        {marker && (
          <span
            className={`studio-tree-marker is-${marker.tone ?? "muted"}`}
            title={marker.title}
          >
            {marker.label}
          </span>
        )}
        {target.pinned && (
          <span className="studio-tree-pin-slot">
            <Pin
              size={11}
              className="studio-tree-pin"
              aria-label={t("pinned")}
              role="img"
            />
          </span>
        )}
      </button>
      <button
        ref={menuButton}
        type="button"
        className="studio-row-menu"
        aria-label={t("itemActions", { title })}
        aria-haspopup="menu"
        aria-expanded={false}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenu(target, event.currentTarget);
        }}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

const sameTarget = (a: LibraryTarget, b: LibraryTarget) =>
  a === b ||
  (a.kind === b.kind &&
    a.id === b.id &&
    a.projectId === b.projectId &&
    a.title === b.title &&
    a.icon === b.icon &&
    a.pinned === b.pinned &&
    a.parentId === b.parentId &&
    ("agentCreated" in a ? a.agentCreated : undefined) ===
      ("agentCreated" in b ? b.agentCreated : undefined));

/** Targets are rebuilt with each navigation render; rows compare their fields. */
export const LibraryRow = memo(
  LibraryRowView,
  (previous, next) =>
    sameTarget(previous.target, next.target) &&
    previous.active === next.active &&
    previous.expanded === next.expanded &&
    previous.onToggle === next.onToggle &&
    previous.marker?.label === next.marker?.label &&
    previous.marker?.title === next.marker?.title &&
    previous.onOpen === next.onOpen &&
    previous.onMenu === next.onMenu &&
    previous.onCommand === next.onCommand,
);

export {
  LibraryContextMenu,
  LibraryMenuControl,
  type LibraryContextMenuItem,
  type LibraryContextMenuProps,
  type LibraryMenuPoint,
} from "./LibraryContextMenu";
