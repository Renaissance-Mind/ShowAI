import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { TableCellsMerge, TableCellsSplit, X } from "lucide-react";
import {
  documentTableActionMeta,
  documentTableSelection,
} from "./table-selection";

/** Shared actions for the selection and context menu slots. */
export function TableSelectionActions({
  editor,
  context = false,
  onAction,
}: {
  editor: Editor;
  context?: boolean;
  onAction?: () => void;
}) {
  const selected = documentTableSelection(editor.state);
  if (!selected && !context && !editor.can().splitCell()) return null;
  const run = (command: "mergeCells" | "splitCell") => {
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor
      .chain()
      .setMeta(documentTableActionMeta, true)
      .focus()
      [command]()
      .run();
    onAction?.();
  };
  return (
    <>
      {!context && <span className="toolbar-divider" aria-hidden="true" />}
      <div
        className="editor-table-actions"
        role="group"
        aria-label="单元格操作"
      >
        {selected && (
          <span className="editor-menu-status" role="status">
            {selected.rows === 1 && selected.columns === 1
              ? "按住 Shift 点击另一单元格"
              : `已选 ${selected.rows} 行 × ${selected.columns} 列`}
          </span>
        )}
        {(
          [
            ["mergeCells", "合并单元格", TableCellsMerge],
            ["splitCell", "拆分单元格", TableCellsSplit],
          ] as const
        ).map(([command, label, Icon]) => (
          <button
            key={command}
            type="button"
            className="editor-tool"
            role={context ? "menuitem" : undefined}
            aria-label={label}
            title={label}
            disabled={!editor.can()[command]()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(command)}
          >
            <Icon size={16} />
            {context && <span>{label}</span>}
          </button>
        ))}
        {!context && selected && (
          <button
            type="button"
            className="editor-tool"
            aria-label="取消单元格选择"
            title="取消单元格选择"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              editor.view.dispatch(
                editor.state.tr.setSelection(
                  TextSelection.near(editor.state.selection.$from),
                ),
              );
              editor.view.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
    </>
  );
}
