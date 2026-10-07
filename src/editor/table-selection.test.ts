import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import {
  CellSelection,
  mergeCells,
  splitCell,
  tableEditing,
  TableMap,
} from "@tiptap/pm/tables";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createExtensions } from "./extensions";
import {
  documentTableSelection,
  restoreDocumentTableCellSelection,
  selectDocumentTableCells,
} from "./table-selection";
import { PageContent } from "../portable/PageContent";
import { validateDocument } from "../portable/validation.mjs";

const schema = getSchema(createExtensions());
function initial() {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("Before")),
      schema.nodes.table.create(
        null,
        Array.from({ length: 3 }, (_, row) =>
          schema.nodes.tableRow.create(
            null,
            Array.from({ length: 3 }, (_, col) =>
              schema.nodes[row === 0 ? "tableHeader" : "tableCell"].create(
                { id: `cell-${row}-${col}`, colwidth: [100 + col * 20] },
                schema.nodes.paragraph.create(
                  null,
                  schema.text(`${row},${col}`),
                ),
              ),
            ),
          ),
        ),
      ),
    ]),
    plugins: [history(), tableEditing()],
  });
}
const tablePosition = 8;
const tableAt = (state: EditorState) => state.doc.nodeAt(tablePosition)!;
function select(state: EditorState, row: number, col: number) {
  const map = TableMap.get(tableAt(state));
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(
        state.doc,
        tablePosition + 1 + map.map[row * map.width + col] + 2,
      ),
    ),
  );
}

describe("document table cell selection and merging", () => {
  it.each(["row", "column"] as const)(
    "selects and merges a whole %s from its current cell",
    (scope) => {
      let state = select(initial(), 1, 1);
      const original = state.doc.toJSON();
      state = state.apply(
        selectDocumentTableCells(state, tablePosition, scope)!,
      );
      expect(documentTableSelection(state)).toEqual({
        tablePosition,
        rows: scope === "row" ? 1 : 3,
        columns: scope === "column" ? 1 : 3,
      });
      expect(
        mergeCells(state, (tr) => {
          state = state.applyTransaction(tr).state;
        }),
      ).toBe(true);
      const map = TableMap.get(tableAt(state));
      expect(map.problems).toBeNull();
      const merged = tableAt(state).nodeAt(map.map[scope === "row" ? 3 : 1])!;
      expect(merged.attrs).toMatchObject({
        rowspan: scope === "column" ? 3 : 1,
        colspan: scope === "row" ? 3 : 1,
        colwidth: scope === "row" ? [100, 120, 140] : [120],
      });
      expect(
        undo(state, (tr) => {
          state = state.applyTransaction(tr).state;
        }),
      ).toBe(true);
      expect(state.doc.toJSON()).toEqual(original);
    },
  );

  it("merges a rectangular region, retains every cell's content and widths, and round-trips through validation and HTML", () => {
    let state = initial();
    const map = TableMap.get(tableAt(state));
    state = state.apply(
      state.tr.setSelection(
        CellSelection.create(
          state.doc,
          tablePosition + 1 + map.map[3],
          tablePosition + 1 + map.map[7],
        ),
      ),
    );
    expect(documentTableSelection(state)).toMatchObject({
      rows: 2,
      columns: 2,
    });
    expect(
      mergeCells(state, (tr) => {
        state = state.applyTransaction(tr).state;
      }),
    ).toBe(true);
    expect(TableMap.get(tableAt(state)).problems).toBeNull();
    const merged = tableAt(state).child(1).firstChild!;
    expect(merged.attrs).toMatchObject({
      rowspan: 2,
      colspan: 2,
      colwidth: [100, 120],
    });
    expect(merged.textContent).toBe("1,01,12,02,1");
    const document = validateDocument({
      id: "merged",
      title: "Merged",
      content: JSON.parse(JSON.stringify(state.doc.toJSON())),
    });
    const loaded = schema.nodeFromJSON(document.content);
    expect(loaded.toJSON()).toEqual(state.doc.toJSON());
    const html = renderToStaticMarkup(
      createElement(PageContent, { content: document.content }),
    );
    expect(html).toMatch(/<td[^>]*colSpan="2"[^>]*rowSpan="2"/);
    expect(
      splitCell(state, (tr) => {
        state = state.applyTransaction(tr).state;
      }),
    ).toBe(true);
    expect(TableMap.get(tableAt(state)).problems).toBeNull();
    expect(tableAt(state).child(1).childCount).toBe(3);
    expect(tableAt(state).child(2).childCount).toBe(3);
    expect(tableAt(state).child(1).firstChild!.textContent).toBe(
      merged.textContent,
    );
  });

  it("starts a range at the current cell, and falls back to the requested table when the cursor is outside it", () => {
    let state = select(initial(), 2, 2);
    state = state.apply(
      selectDocumentTableCells(state, tablePosition, "cell")!,
    );
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(documentTableSelection(state)).toMatchObject({
      rows: 1,
      columns: 1,
    });
    expect(state.selection.$from.parent.textContent).toBe("2,2");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1)),
    );
    expect(documentTableSelection(state)).toBeNull();
    state = state.apply(selectDocumentTableCells(state, tablePosition, "row")!);
    expect(
      (state.selection as CellSelection).$anchorCell.nodeAfter!.textContent,
    ).toBe("0,0");
    expect(selectDocumentTableCells(state, 0, "row")).toBeNull();
  });

  it("restores selection by cell IDs after content normalization or blocks inserted before the table", () => {
    const state = initial();
    const map = TableMap.get(tableAt(state));
    const selection = CellSelection.create(
      state.doc,
      tablePosition + 1 + map.map[3],
      tablePosition + 1 + map.map[7],
    );
    const updated = state.tr.insert(
      0,
      schema.nodes.paragraph.create(null, schema.text("New block")),
    ).doc;
    const restored = restoreDocumentTableCellSelection(updated, selection)!;
    expect(restored.$anchorCell.nodeAfter!.attrs.id).toBe("cell-1-0");
    expect(restored.$headCell.nodeAfter!.attrs.id).toBe("cell-2-1");
    expect(restored.$anchorCell.pos).toBeGreaterThan(selection.$anchorCell.pos);
    expect(
      documentTableSelection(
        EditorState.create({ doc: updated, selection: restored }),
      ),
    ).toMatchObject({ rows: 2, columns: 2 });
    const withoutTable = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(),
    );
    expect(
      restoreDocumentTableCellSelection(withoutTable, selection),
    ).toBeNull();
    const acrossTables = schema.nodes.doc.create(null, [
      schema.nodes.table.create(
        null,
        schema.nodes.tableRow.create(null, selection.$anchorCell.nodeAfter!),
      ),
      schema.nodes.table.create(
        null,
        schema.nodes.tableRow.create(null, selection.$headCell.nodeAfter!),
      ),
    ]);
    expect(
      restoreDocumentTableCellSelection(acrossTables, selection),
    ).toBeNull();
  });
});
