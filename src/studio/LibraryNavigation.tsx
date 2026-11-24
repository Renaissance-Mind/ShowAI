import {
  clientIsMac,
  isContextMenuShortcut,
  isDeleteShortcut,
  isRenameShortcut,
} from "./keyboard-shortcuts";
import { memo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { Folder, FolderOpen, MoreHorizontal, Pin } from "../ui/icons";
import "./library-row.css";
import PageIcon from "../components/PageIcon";
import ProjectIcon from "./ProjectIcon";
import type { LibraryMenuPoint } from "../ui/LibraryContextMenu";
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
      agentCreated?: string;
    };

export interface LibraryRowProps {
  target: LibraryTarget;
  active?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: (target: LibraryTarget, event: MouseEvent<HTMLButtonElement>) => void;
  onMenu?: (
    target: LibraryTarget,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) => void;
  onCommand?: (target: LibraryTarget, command: "rename" | "delete") => void;
  onUnpin?: (target: LibraryTarget) => void;
  marker?: { label: string; title?: string; tone?: "warning" | "muted" };
  cloud?: boolean;
  prefetch?: boolean;
}

function LibraryRowView({
  target,
  active = false,
  expanded = false,
  onToggle,
  onOpen,
  onMenu,
  onCommand,
  onUnpin,
  marker,
  cloud,
  prefetch = true,
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
  const FolderIcon = expanded ? FolderOpen : Folder;
  const icon =
    target.kind === "project" ? (
      <ProjectIcon
        value={expanded ? undefined : target.icon}
        size={15}
        expanded={expanded}
        cloud={cloud}
      />
    ) : target.kind === "folder" ? (
      <PageIcon
        value={target.icon}
        size={15}
        fallback={<FolderIcon size={15} strokeWidth={1.7} aria-hidden="true" />}
      />
    ) : (
      <PageIcon value={target.icon} size={15} />
    );
  const openKeyboardMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    const mac = clientIsMac();
    const renaming = isRenameShortcut(event, mac);
    if (onCommand && (renaming || isDeleteShortcut(event, mac))) {
      event.preventDefault();
      event.stopPropagation();
      onCommand(target, renaming ? "rename" : "delete");
      return;
    }
    if (!onMenu || !isContextMenuShortcut(event, mac)) return;
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
        if (!onMenu) return;
        event.preventDefault();
        event.stopPropagation();
        if (menuButton.current)
          onMenu(target, menuButton.current, {
            x: event.clientX,
            y: event.clientY,
          });
      }}
    >
      {onToggle && (
        <button
          type="button"
          className="studio-tree-folder-toggle"
          aria-label={t(expanded ? "collapseItem" : "expandItem", { title })}
          title={t(expanded ? "collapseItem" : "expandItem", { title })}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {icon}
        </button>
      )}
      <button
        type="button"
        className="studio-tree-main"
        aria-current={active ? "page" : undefined}
        title={title}
        data-open-page={
          prefetch && target.kind === "page" ? target.id : undefined
        }
        data-open-project={
          prefetch && target.kind === "page" ? target.projectId : undefined
        }
        onClick={(event) => onOpen(target, event)}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            onOpen(target, event);
          }
        }}
      >
        {!onToggle && icon}
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
            {!onUnpin && (
              <Pin
                size={11}
                className="studio-tree-pin"
                aria-label={t("pinned")}
                role="img"
              />
            )}
          </span>
        )}
      </button>
      {target.pinned && onUnpin && (
        <button
          type="button"
          className="studio-tree-unpin"
          aria-label={t("unpinItem", { title })}
          title={t("unpinItem", { title })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onUnpin(target);
          }}
        >
          <Pin size={11} aria-hidden="true" />
        </button>
      )}
      {onMenu && (
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
      )}
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

export const LibraryRow = memo(
  LibraryRowView,
  (previous, next) =>
    sameTarget(previous.target, next.target) &&
    previous.active === next.active &&
    previous.expanded === next.expanded &&
    previous.cloud === next.cloud &&
    previous.prefetch === next.prefetch &&
    previous.onToggle === next.onToggle &&
    previous.marker?.label === next.marker?.label &&
    previous.marker?.title === next.marker?.title &&
    previous.onOpen === next.onOpen &&
    previous.onMenu === next.onMenu &&
    previous.onUnpin === next.onUnpin &&
    previous.onCommand === next.onCommand,
);

export {
  LibraryContextMenu,
  LibraryMenuControl,
  type LibraryContextMenuItem,
  type LibraryContextMenuProps,
  type LibraryMenuPoint,
} from "../ui/LibraryContextMenu";
