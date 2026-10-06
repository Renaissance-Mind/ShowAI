import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { createExtensions } from "./extensions";
import { clearWidgetSelection } from "./widget-selection";

const schema = getSchema(createExtensions());
const widget = () =>
  schema.nodes.widget.create({
    kind: "g2-bar",
    data: { datasets: { main: [] } },
  });
test("blank clicks leave an atom selection without editing chart data or selecting the adjacent chart", () => {
  const doc = schema.nodes.doc.create(null, [
    widget(),
    widget(),
    schema.nodes.paragraph.create(),
  ]);
  const state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, 0),
  });
  const transaction = clearWidgetSelection(state)!;
  expect(transaction.docChanged).toBe(false);
  expect(transaction.selection).toBeInstanceOf(TextSelection);
  expect(transaction.selection.empty).toBe(true);
  expect(transaction.doc.eq(doc)).toBe(true);
});
test("a page containing only charts can deselect without inserting a paragraph", () => {
  const doc = schema.nodes.doc.create(null, [widget(), widget()]);
  const state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, 0),
  });
  const transaction = clearWidgetSelection(state)!;
  expect(transaction.docChanged).toBe(false);
  expect(transaction.selection).toBeInstanceOf(GapCursor);
  expect(transaction.selection.empty).toBe(true);
});
test("ordinary text selections remain available to formatting controls", () => {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text("text")),
  ]);
  expect(
    clearWidgetSelection(
      EditorState.create({ doc, selection: TextSelection.create(doc, 2) }),
    ),
  ).toBeNull();
});
