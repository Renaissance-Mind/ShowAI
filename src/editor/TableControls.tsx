import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import {
  AlignmentButtons,
  type TableAlignment,
} from "../components/blocks/TableAlignment";
import { alignDocumentTable, tableAlignmentValue } from "./table-alignment";

interface Target {
  table: HTMLTableElement;
  cell: HTMLTableCellElement | null;
  context: { left: number; top: number } | null;
}

export function TableControls({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [, refresh] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };
  const hide = () => {
    keep();
    hideTimer.current = setTimeout(
      () =>
        setTarget((value) =>
          value?.context ||
          document.activeElement?.closest(".document-table-controls")
            ? value
            : null,
        ),
      160,
    );
  };

  useEffect(() => {
    const root = editor.view.dom;
    const find = (event: Event) => {
      const element = event.target as Element;
      const table = element.closest?.("table");
      if (
        !(table instanceof HTMLTableElement) ||
        table.closest(".document-widget")
      )
        return null;
      const cell = element.closest("td, th") as HTMLTableCellElement | null;
      return {
        table,
        cell: cell?.parentElement === table.rows[0] ? cell : null,
        context: null,
      };
    };
    const hover = (event: Event) => {
      keep();
      const next = find(event);
      setTarget((previous) =>
        previous?.context ||
        (previous?.table === next?.table && previous?.cell === next?.cell)
          ? previous
          : next,
      );
    };
    const context = (event: MouseEvent) => {
      const next = find(event);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget({
        ...next,
        cell: null,
        context: {
          left: Math.min(event.clientX, window.innerWidth - 200),
          top: Math.min(event.clientY, window.innerHeight - 50),
        },
      });
    };
    const dismiss = (event: Event) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Escape")
        return;
      if (
        event.type === "pointerdown" &&
        (event.target as Element).closest?.(".document-table-controls")
      )
        return;
      setTarget(null);
    };
    const update = () => refresh((value) => value + 1);
    const transaction = () => {
      if (editor.view.composing) return;
      update();
    };
    root.addEventListener("mousemove", hover);
    root.addEventListener("focusin", hover);
    root.addEventListener("mouseleave", hide);
    root.addEventListener("contextmenu", context);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.addEventListener("blur", dismiss);
    editor.on("transaction", transaction);
    return () => {
      keep();
      root.removeEventListener("mousemove", hover);
      root.removeEventListener("focusin", hover);
      root.removeEventListener("mouseleave", hide);
      root.removeEventListener("contextmenu", context);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("blur", dismiss);
      editor.off("transaction", transaction);
    };
  }, [editor]);

  if (!target || !target.table.isConnected || !editor.isEditable) return null;
  // Resolve DOM to current document positions after edits, undo, and table movement.
  const resolved = editor.state.doc.resolve(
    editor.view.posAtDOM(target.table, 0),
  );
  let depth = resolved.depth;
  while (depth > 0 && resolved.node(depth).type.name !== "table") depth--;
  if (!depth) return null;
  const table = resolved.node(depth);
  const position = resolved.before(depth);
  let column: number | null = null;
  if (target.cell?.isConnected) {
    const cellPosition = editor.view.posAtDOM(target.cell, 0);
    const cellResolved = editor.state.doc.resolve(cellPosition);
    let cellDepth = cellResolved.depth;
    while (
      cellDepth > depth &&
      !["tableCell", "tableHeader"].includes(
        cellResolved.node(cellDepth).type.name,
      )
    )
      cellDepth--;
    if (cellDepth > depth)
      column = TableMap.get(table).findCell(
        cellResolved.before(cellDepth) - position - 1,
      ).left;
  }
  const rect = target.table.getBoundingClientRect();
  const cellRect = target.cell?.getBoundingClientRect();
  const align = (col: number | null, value: TableAlignment) => {
    editor.view.dispatch(
      alignDocumentTable(editor.state, position, col, value),
    );
    if (target.context) {
      setTarget(null);
      editor.view.focus();
    }
  };
  return createPortal(
    <>
      <div
        className="document-table-controls table-global-alignment"
        role={target.context ? "dialog" : undefined}
        aria-label="表格对齐设置"
        style={
          target.context ?? {
            left: Math.max(
              8,
              Math.min(rect.right - 190, window.innerWidth - 198),
            ),
            top: Math.max(8, rect.top - 32),
          }
        }
        onMouseEnter={keep}
        onFocus={keep}
        onMouseLeave={hide}
      >
        <span>整个表格</span>
        <AlignmentButtons
          scope="整个表格"
          value={tableAlignmentValue(table, null)}
          onChange={(value) => align(null, value)}
        />
      </div>
      {column !== null && cellRect && !target.context && (
        <div
          className="document-table-controls table-column-alignment"
          style={{
            left: Math.max(
              8,
              Math.min(cellRect.right - 91, window.innerWidth - 99),
            ),
            top: cellRect.top + 3,
          }}
          onMouseEnter={keep}
          onFocus={keep}
          onMouseLeave={hide}
        >
          <AlignmentButtons
            scope={`第 ${column + 1} 列`}
            value={tableAlignmentValue(table, column)}
            onChange={(value) => align(column, value)}
          />
        </div>
      )}
    </>,
    document.body,
  );
}
