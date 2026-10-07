import { useState, type KeyboardEvent } from "react";
import {
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  Undo2,
  Redo2,
} from "../ui/icons";
import {
  LibraryContextMenu,
  type LibraryContextMenuItem,
} from "../studio/LibraryNavigation";

export interface EditorControls {
  documentId: string;
  surfaceId: string;
  name: string;
  kind: "page" | "board";
  nested: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  setIcon: () => void;
  wrap: (kind: "page" | "board") => void;
}

export function EditorHistoryButtons({
  controls,
  className = "studio-icon",
}: {
  controls: EditorControls | null;
  className?: string;
}) {
  const historyKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !controls ||
      event.nativeEvent.isComposing ||
      !(event.metaKey || event.ctrlKey) ||
      event.altKey
    )
      return;
    const key = event.key.toLowerCase();
    if (key !== "z" && key !== "y") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey || key === "y") controls.redo();
    else controls.undo();
  };
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="撤销操作"
        title="撤销 ⌘Z / Ctrl+Z"
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={historyKey}
        disabled={!controls?.canUndo}
        onClick={() => controls?.undo()}
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        className={className}
        aria-label="重做操作"
        title="重做 ⇧⌘Z / Ctrl+Shift+Z"
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={historyKey}
        disabled={!controls?.canRedo}
        onClick={() => controls?.redo()}
      >
        <Redo2 size={15} />
      </button>
    </>
  );
}

export function containerMenuItems(
  controls: EditorControls,
  includeIcon = true,
): LibraryContextMenuItem[] {
  const target = controls.nested ? `「${controls.name}」` : "";
  return [
    ...(includeIcon
      ? [
          {
            label: target ? `设置${target}图标…` : "设置图标…",
            icon: <FileText size={15} />,
            onSelect: controls.setIcon,
          },
        ]
      : []),
    {
      label: target ? `将${target}放入 Board` : "放入 Board",
      icon: <LayoutDashboard size={15} />,
      onSelect: () => controls.wrap("board"),
    },
    {
      label: target ? `将${target}放入 Page` : "放入 Page",
      icon: <FileText size={15} />,
      onSelect: () => controls.wrap("page"),
    },
  ];
}

export function EditorContainerMenu({
  controls,
}: {
  controls: EditorControls;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="studio-icon"
        aria-label="容器操作"
        title="容器操作"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <MoreHorizontal size={15} />
      </button>
      {anchor && (
        <LibraryContextMenu
          anchor={anchor}
          label={`${controls.name}的容器操作`}
          onClose={() => setAnchor(null)}
          items={containerMenuItems(controls)}
        />
      )}
    </>
  );
}
