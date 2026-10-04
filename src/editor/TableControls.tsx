import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { TableMap } from "@tiptap/pm/tables";
import {
  AlignmentButtons,
  type TableAlignment,
} from "../components/blocks/TableAlignment";
import { alignDocumentTable, tableAlignmentValue } from "./table-alignment";

import {
  useTableHover,
  tableControlPositions,
} from "../components/blocks/table-hover";

const acceptDocumentTable = (table: HTMLTableElement) =>
  !table.closest(".document-widget");

export function TableControls({ editor }: { editor: Editor }) {
  const [, refresh] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const { target, setTarget, owner } = useTableHover(editor.view.dom, {
    keepOpen: menuOpen,
    accept: acceptDocumentTable,
    onDismiss: () => setMenuOpen(false),
  });
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
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
  const positions = tableControlPositions(target, 128);
  const prepareSelection = () => {
    const { $from } = editor.state.selection;
    const inTarget = Array.from(
      { length: $from.depth },
      (_, index) => index + 1,
    ).some(
      (depth) =>
        $from.node(depth).type.name === "table" &&
        $from.before(depth) === position,
    );
    if (!inTarget)
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.near(editor.state.doc.resolve(position + 3)),
        ),
      );
  };
  const runAction = (action: () => void) => {
    prepareSelection();
    action();
    setMenuOpen(false);
  };
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
        data-table-controls-owner={owner}
        style={positions.global}
      >
        <AlignmentButtons
          scope="表格"
          value={tableAlignmentValue(table, null)}
          onChange={(value) => align(null, value)}
        />
        {!target.context && (
          <button
            className="document-table-menu-trigger"
            type="button"
            aria-label="表格操作"
            title="表格操作"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              prepareSelection();
              setMenuOpen(!menuOpen);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        {menuOpen && !target.context && (
          <div
            className="document-table-menu"
            role="menu"
            aria-label="表格操作菜单"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().addRowAfter().run();
                })
              }
            >
              <Plus size={14} />
              添加行
            </button>
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().addColumnAfter().run();
                })
              }
            >
              <Plus size={14} />
              添加列
            </button>
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().toggleHeaderRow().run();
                })
              }
            >
              切换表头
            </button>
            <button
              role="menuitem"
              disabled={!editor.can().mergeCells()}
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().mergeCells().run();
                })
              }
            >
              合并单元格
            </button>
            <button
              role="menuitem"
              disabled={!editor.can().splitCell()}
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().splitCell().run();
                })
              }
            >
              拆分单元格
            </button>
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().deleteRow().run();
                })
              }
            >
              删除行
            </button>
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().deleteColumn().run();
                })
              }
            >
              删除列
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() =>
                runAction(() => {
                  editor.chain().focus().deleteTable().run();
                  setTarget(null);
                })
              }
            >
              <Trash2 size={14} />
              删除表格
            </button>
          </div>
        )}
      </div>
      {column !== null && !target.context && (
        <div
          className="document-table-controls table-column-alignment"
          data-table-controls-owner={owner}
          style={positions.column}
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
