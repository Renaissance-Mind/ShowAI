import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import {
  MoreHorizontal,
  Plus,
  Trash2,
  TableProperties,
  TableRowsSplit,
  TableColumnsSplit,
  SquareDashed,
} from "../../ui/icons";
import { TableMap } from "@tiptap/pm/tables";
import {
  AlignmentButtons,
  type TableAlignment,
} from "../blocks/TableAlignment";
import { alignDocumentTable, tableAlignmentValue } from "./table-alignment";
import { TableSelectionActions } from "./TableSelectionActions";
import {
  documentTableSelection,
  documentTableActionMeta,
  selectDocumentTableCells,
} from "./table-selection";

import { useTableHover, tableControlPositions } from "../blocks/table-hover";

const acceptDocumentTable = (table: HTMLTableElement) =>
  !table.closest(".document-widget");

export function TableControls({ editor }: { editor: Editor }) {
  const [, refresh] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const selected = documentTableSelection(editor.state);
  const { target, setTarget, owner } = useTableHover(editor.view.dom, {
    keepOpen: menuOpen,
    accept: acceptDocumentTable,
    onDismiss: () => setMenuOpen(false),
  });
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !documentTableSelection(editor.state) ||
        (!editor.view.hasFocus() &&
          document.activeElement
            ?.closest("[data-table-controls-owner]")
            ?.getAttribute("data-table-controls-owner") !== owner)
      )
        return;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.near(editor.state.selection.$from),
        ),
      );
      setMenuOpen(false);
      editor.view.focus();
    };
    editor.on("transaction", update);
    document.addEventListener("keydown", escape);
    return () => {
      editor.off("transaction", update);
      document.removeEventListener("keydown", escape);
    };
  }, [editor, owner]);

  if (!target || !target.table.isConnected || !editor.isEditable) return null;
  // An active selection menu owns this editor's actions; hover yields to it.
  if (
    !target.context &&
    (selected ||
      (editor.isFocused &&
        editor.state.selection instanceof TextSelection &&
        !editor.state.selection.empty))
  )
    return null;
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
  const menuAbove = positions.global.top > window.innerHeight / 2;
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
    // Structural actions should undo independently of recent typing/alignment.
    editor.view.dispatch(closeHistory(editor.state.tr));
    action();
    setMenuOpen(false);
  };
  const tableAction = () =>
    editor.chain().setMeta(documentTableActionMeta, true).focus();
  const select = (scope: "cell" | "row" | "column") =>
    runAction(() => {
      const transaction = selectDocumentTableCells(
        editor.state,
        position,
        scope,
      );
      if (transaction) editor.view.dispatch(transaction);
      editor.view.focus();
    });
  const align = (col: number | null, value: TableAlignment) => {
    editor.view.dispatch(
      alignDocumentTable(editor.state, position, col, value).setMeta(
        documentTableActionMeta,
        true,
      ),
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
        data-editor-menu-trigger={target.context ? "context" : "hover"}
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
        {(menuOpen || target.context) && (
          <div
            className="document-table-menu"
            role="menu"
            aria-label="表格操作菜单"
            style={{
              ...(menuAbove ? { top: "auto", bottom: "calc(100% + 4px)" } : {}),
              maxHeight: Math.max(
                120,
                menuAbove
                  ? positions.global.top - 12
                  : window.innerHeight - positions.global.top - 46,
              ),
              overflowY: "auto",
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  tableAction().addRowAfter().run();
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
                  tableAction().addColumnAfter().run();
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
                  tableAction().toggleHeaderRow().run();
                })
              }
            >
              <TableProperties size={14} aria-hidden="true" />
              切换表头
            </button>
            <button role="menuitem" onClick={() => select("cell")}>
              <SquareDashed size={14} aria-hidden="true" />
              选择单元格区域
            </button>
            <button role="menuitem" onClick={() => select("row")}>
              <TableRowsSplit size={14} aria-hidden="true" />
              选择当前行
            </button>
            <button role="menuitem" onClick={() => select("column")}>
              <TableColumnsSplit size={14} aria-hidden="true" />
              选择当前列
            </button>
            {target.context && (
              <TableSelectionActions
                editor={editor}
                context
                onAction={() => {
                  setTarget(null);
                  setMenuOpen(false);
                }}
              />
            )}
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  tableAction().deleteRow().run();
                })
              }
            >
              <TableRowsSplit size={14} aria-hidden="true" />
              删除行
            </button>
            <button
              role="menuitem"
              onClick={() =>
                runAction(() => {
                  tableAction().deleteColumn().run();
                })
              }
            >
              <TableColumnsSplit size={14} aria-hidden="true" />
              删除列
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() =>
                runAction(() => {
                  tableAction().deleteTable().run();
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
