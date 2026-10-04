import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createExtensions } from "./extensions";
import { alignDocumentTable, tableAlignmentValue } from "./table-alignment";
import { PageContent } from "../portable/PageContent";
import { validateDocument } from "../portable/validation.mjs";

const schema = getSchema(createExtensions());
const cell = (text: string, header = false, attrs = {}) =>
  schema.nodes[header ? "tableHeader" : "tableCell"].create(
    attrs,
    schema.nodes.paragraph.create({ textAlign: "right" }, schema.text(text)),
  );
function initial() {
  const table = schema.nodes.table.create(null, [
    schema.nodes.tableRow.create(null, [
      cell("Name", true),
      cell("Count", true),
    ]),
    schema.nodes.tableRow.create(null, [cell("A"), cell("7")]),
  ]);
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [table]),
    plugins: [history()],
  });
}

describe("document table alignment", () => {
  it("aligns the entire logical column, clears conflicting text formatting, and undoes in one step", () => {
    let state = initial();
    const original = state.doc.toJSON();
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 4)),
    );
    const beforeSelection = state.selection.from;
    state = state.apply(alignDocumentTable(state, 0, 1, "center"));
    expect(state.selection.from).toBe(beforeSelection);
    const table = state.doc.firstChild!;
    expect(tableAlignmentValue(table, 0)).toBe("left");
    expect(tableAlignmentValue(table, 1)).toBe("center");
    expect(tableAlignmentValue(table, null)).toBeNull();
    expect(table.child(0).child(1).firstChild!.attrs.textAlign).toBeNull();
    expect(table.child(1).child(1).textContent).toBe("7");
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(original);
  });

  it("uniformly resets column overrides and retains alignment through serialization, validation and export", () => {
    let state = initial();
    state = state.apply(alignDocumentTable(state, 0, 1, "center"));
    state = state.apply(alignDocumentTable(state, 0, null, "right"));
    const document = validateDocument({
      id: "table-alignment",
      title: "对齐",
      content: JSON.parse(JSON.stringify(state.doc.toJSON())),
    });
    const reloaded = schema.nodeFromJSON(document.content);
    expect(tableAlignmentValue(reloaded.firstChild!, 0)).toBe("right");
    expect(tableAlignmentValue(reloaded.firstChild!, 1)).toBe("right");
    const html = renderToStaticMarkup(
      createElement(PageContent, { content: document.content }),
    );
    expect(html.match(/<t[dh][^>]*text-align:right/g)).toHaveLength(4);
    expect(html).not.toContain("table-alignment-buttons");
  });

  it("updates cells spanning the selected column only once, preserving spans and widths", () => {
    const table = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [
        cell("Merged", true, { colspan: 2, colwidth: [120, 180] }),
      ]),
      schema.nodes.tableRow.create(null, [cell("A"), cell("7")]),
    ]);
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [table]),
    });
    const updated = state.apply(alignDocumentTable(state, 0, 1, "center")).doc
      .firstChild!;
    expect(updated.child(0).firstChild!.attrs).toMatchObject({
      colspan: 2,
      colwidth: [120, 180],
      textAlign: "center",
    });
    expect(updated.child(1).firstChild!.attrs.textAlign).toBeNull();
    expect(tableAlignmentValue(updated, 1)).toBe("center");
  });
});
