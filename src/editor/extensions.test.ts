import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { history, redo, undo } from "@tiptap/pm/history";
import {
  blockIdNodeTypes,
  blockIdPluginKey,
  createBlockIdPlugin,
  createExtensions,
} from "./extensions";

const schema = getSchema(createExtensions());

function paragraph(text: string, id: string | null = null) {
  return schema.nodes.paragraph.create(
    { id },
    text ? schema.text(text) : undefined,
  );
}

function ids(state: EditorState) {
  const result: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name !== "text") result.push(node.attrs.id);
  });
  return result;
}

describe("stable block IDs in the real editor schema", () => {
  it("preserves every supported node's ID through schema loading and JSON serialization", () => {
    for (const type of blockIdNodeTypes) {
      const node = schema.nodes[type].createAndFill({
        id: `existing-${type}`,
        ...(type === "image" ? { src: "https://example.com/image.png" } : {}),
      });
      expect(node, type).not.toBeNull();
      node!.check();
      const restored = schema.nodeFromJSON(node!.toJSON());
      expect(restored.attrs.id, type).toBe(`existing-${type}`);
      const rendered = schema.nodes[type].spec.toDOM!(restored);
      expect(JSON.stringify(rendered), type).toContain(
        `"data-block-id":"existing-${type}"`,
      );
    }
    expect(schema.nodes.text.spec.attrs?.id).toBeUndefined();
    expect(schema.nodes.doc.spec.attrs?.id).toBeUndefined();
  });

  it("fills missing IDs once at initial editable load without changing text or the caret", () => {
    let state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        paragraph("first"),
        paragraph("second", "kept"),
      ]),
      plugins: [createBlockIdPlugin(() => true)],
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3)),
    );
    const result = state.applyTransaction(
      state.tr.setMeta(blockIdPluginKey, true),
    );
    expect(result.transactions).toHaveLength(2);
    expect(result.state.selection.from).toBe(3);
    expect(result.state.doc.textContent).toBe("firstsecond");
    expect(ids(result.state)[0]).toMatch(/^[\da-f-]{36}$/);
    expect(ids(result.state)[1]).toBe("kept");
    const settled = result.state.applyTransaction(
      result.state.tr.setMeta(blockIdPluginKey, true),
    );
    expect(settled.transactions).toHaveLength(1);
    expect(ids(settled.state)).toEqual(ids(result.state));
  });

  it("renews copied subtree IDs while preserving the first occurrence", () => {
    const nested = schema.nodes.blockquote.create(
      { id: "quote" },
      paragraph("evidence", "text-block"),
    );
    let state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [nested]),
      plugins: [createBlockIdPlugin(() => true)],
    });
    state = state.applyTransaction(
      state.tr.insert(state.doc.content.size, nested),
    ).state;
    expect(ids(state).slice(0, 2)).toEqual(["quote", "text-block"]);
    expect(new Set(ids(state)).size).toBe(4);
    expect(ids(state).every(Boolean)).toBe(true);
  });

  it("does not mutate read-only pages or react to selection-only transactions", () => {
    let editable = false;
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [paragraph("text")]),
      plugins: [createBlockIdPlugin(() => editable)],
    });
    const unchanged = state.applyTransaction(
      state.tr.setMeta(blockIdPluginKey, true),
    );
    expect(unchanged.transactions).toHaveLength(1);
    expect(ids(unchanged.state)).toEqual([null]);
    editable = true;
    const selection = unchanged.state.applyTransaction(
      unchanged.state.tr.setSelection(
        TextSelection.create(unchanged.state.doc, 2),
      ),
    );
    expect(selection.transactions).toHaveLength(1);
    expect(ids(selection.state)).toEqual([null]);
    const enabled = selection.state.applyTransaction(
      selection.state.tr.setMeta("editableChanged", true),
    );
    expect(ids(enabled.state)[0]).toBeTruthy();
  });

  it("keeps IDs during text edits, splits duplicate IDs, and preserves node selections", () => {
    let state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [
        paragraph("abcdef", "original"),
        schema.nodes.widget.create({ kind: "chart", data: {} }),
      ]),
      plugins: [createBlockIdPlugin(() => true)],
    });
    state = state.applyTransaction(state.tr.insertText("X", 3)).state;
    expect(ids(state)[0]).toBe("original");
    const split = state.applyTransaction(state.tr.split(4)).state;
    expect(ids(split)[0]).toBe("original");
    expect(new Set(ids(split)).size).toBe(3);
    const widgetPosition = split.doc.content.size - 1;
    const selected = split.applyTransaction(
      split.tr
        .setSelection(NodeSelection.create(split.doc, widgetPosition))
        .setNodeAttribute(widgetPosition, "id", null),
    );
    expect(selected.state.selection).toBeInstanceOf(NodeSelection);
    expect(selected.state.selection.from).toBe(widgetPosition);
    expect(ids(selected.state).at(-1)).toBeTruthy();
  });

  it("does not add an ID-only undo step and maintains unique IDs after redo", () => {
    let state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, [paragraph("original", "first")]),
      plugins: [history(), createBlockIdPlugin(() => true)],
    });
    state = state.applyTransaction(
      state.tr.insert(state.doc.content.size, paragraph("copy", "first")),
    ).state;
    expect(ids(state)).toHaveLength(2);
    expect(
      undo(state, (transaction) => {
        state = state.applyTransaction(transaction).state;
      }),
    ).toBe(true);
    expect(ids(state)).toEqual(["first"]);
    expect(
      redo(state, (transaction) => {
        state = state.applyTransaction(transaction).state;
      }),
    ).toBe(true);
    expect(ids(state)[0]).toBe("first");
    expect(new Set(ids(state)).size).toBe(2);
  });
});
