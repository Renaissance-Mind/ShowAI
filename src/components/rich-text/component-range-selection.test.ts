import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, Selection } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { Mapping } from "@tiptap/pm/transform";
import { createExtensions } from "./extensions";
import { ComponentRangeSelection } from "./component-range-selection";
import { pageEditorNodes } from "../../surface/PageEditorNodes";
import { edgeVelocity } from "../../surface/text-selection";

const schema = getSchema([...createExtensions(), ...pageEditorNodes]);
const paragraph = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
function fixture(atomOnly = false) {
  const atom = schema.nodes.widget.create({
    id: "metric",
    kind: "metrics",
    data: { title: "Metric", items: [] },
  });
  return schema.nodes.doc.create(
    null,
    atomOnly ? [atom] : [paragraph("ABCDE"), atom, paragraph("FGHIJ")],
  );
}

describe("component boundary selections", () => {
  it.each([false, true])(
    "deletes the atom and only selected characters in either direction (%s)",
    (backward) => {
      const doc = fixture();
      // First paragraph is 0..7, widget 7..8, next paragraph 8..15.
      const selection = ComponentRangeSelection.create(
        doc,
        backward ? 11 : 7,
        backward ? 7 : 11,
      );
      const state = EditorState.create({ doc, selection });
      const result = state.apply(state.tr.deleteSelection());
      expect(result.doc.textContent).toBe("ABCDEHIJ");
      expect(
        result.doc
          .toJSON()
          .content.some((node: { type: string }) => node.type === "widget"),
      ).toBe(false);
    },
  );
  it("includes the end component without absorbing the adjacent text", () => {
    const doc = fixture();
    const state = EditorState.create({
      doc,
      selection: ComponentRangeSelection.create(doc, 3, 8),
    });
    const result = state.apply(state.tr.insertText("replacement"));
    expect(result.doc.textContent).toBe("ABreplacementFGHIJ");
    expect(
      result.doc
        .toJSON()
        .content.some((node: { type: string }) => node.type === "widget"),
    ).toBe(false);
  });
  it("replaces an atom-only document and restores it through real history", () => {
    const doc = fixture(true);
    let state = EditorState.create({
      doc,
      selection: ComponentRangeSelection.create(doc, 0, 1),
      plugins: [history()],
    });
    state = state.apply(state.tr.insertText("替换"));
    expect(state.doc.textContent).toBe("替换");
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(state.selection).toBeInstanceOf(ComponentRangeSelection);
    expect(
      redo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.textContent).toBe("替换");
  });
  it("retains component boundaries through serialization and mapping", () => {
    const doc = fixture();
    const selection = ComponentRangeSelection.create(doc, 7, 11);
    expect(Selection.fromJSON(doc, selection.toJSON()).eq(selection)).toBe(
      true,
    );
    expect(
      selection.getBookmark().map(new Mapping()).resolve(doc).eq(selection),
    ).toBe(true);
    const state = EditorState.create({ doc, selection });
    const tr = state.tr.insertText("X", 2);
    expect(tr.selection.from).toBe(8);
    expect(tr.selection.to).toBe(12);
  });
  it("preserves precise text endpoints across multiple components", () => {
    const doc = schema.nodes.doc.create(null, [
      paragraph("before"),
      schema.nodes.widget.create({ kind: "metrics" }),
      schema.nodes.pageModule.create({
        id: "nested",
        node: { type: "surface" },
      }),
      paragraph("after"),
    ]);
    const selection = ComponentRangeSelection.create(doc, 3, 14);
    const state = EditorState.create({ doc, selection });
    expect(state.apply(state.tr.insertText("X")).doc.textContent).toBe("beXer");
  });
});

describe("selection edge scrolling", () => {
  it("scrolls both directions, stops away from edges and caps out-of-bounds speed", () => {
    expect(edgeVelocity(0, 0, 600)).toBe(-18);
    expect(edgeVelocity(20, 0, 600)).toBe(-9);
    expect(edgeVelocity(300, 0, 600)).toBe(0);
    expect(edgeVelocity(580, 0, 600)).toBe(9);
    expect(edgeVelocity(900, 0, 600)).toBe(18);
    expect(edgeVelocity(0, 10, 10)).toBe(0);
  });
});
