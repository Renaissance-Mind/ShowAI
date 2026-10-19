import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { createExtensions } from "./extensions";
import { replaceTextRanges } from "./text-range-edit";
import { edgeVelocity } from "../../surface/text-selection";
const schema = getSchema(createExtensions());
const paragraph = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
function fixture() {
  return schema.nodes.doc.create(null, [
    paragraph("ABCDE"),
    schema.nodes.widget.create({
      id: "metric",
      kind: "metrics",
      data: { title: "Read only label", items: [] },
    }),
    paragraph("FGHIJ"),
  ]);
}
describe("cross-component character edits", () => {
  it("deletes selected characters while preserving the component and both text blocks", () => {
    const doc = fixture(),
      state = EditorState.create({ doc });
    const tr = replaceTextRanges(
      state,
      [
        { from: 3, to: 6 },
        { from: 9, to: 11 },
      ],
      "",
    )!;
    const next = state.apply(tr);
    expect(next.doc.textContent).toBe("ABHIJ");
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.child(1).eq(doc.child(1))).toBe(true);
    expect(next.doc.child(0).type.name).toBe("paragraph");
  });
  it("replaces only editable characters, keeping read-only data and restoring all text with one undo", () => {
    const doc = fixture();
    let state = EditorState.create({ doc, plugins: [history()] });
    state = state.apply(
      replaceTextRanges(
        state,
        [
          { from: 3, to: 6 },
          { from: 9, to: 11 },
        ],
        "替换",
      )!,
    );
    expect(state.doc.textContent).toBe("AB替换HIJ");
    expect(state.doc.child(1).eq(doc.child(1))).toBe(true);
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
  });
  it("leaves an empty paragraph and component intact rather than deleting structural nodes", () => {
    const doc = fixture(),
      state = EditorState.create({ doc });
    const next = state.apply(
      replaceTextRanges(
        state,
        [
          { from: 1, to: 6 },
          { from: 9, to: 14 },
        ],
        "",
      )!,
    );
    expect(next.doc.childCount).toBe(3);
    expect(next.doc.textContent).toBe("");
    expect(next.doc.child(1).eq(doc.child(1))).toBe(true);
  });
  it("rejects a range that would remove an intervening component", () => {
    const state = EditorState.create({ doc: fixture() });
    expect(() => replaceTextRanges(state, [{ from: 3, to: 11 }], "")).toThrow(
      "text edit",
    );
  });
  it("inserts the replacement once when a selection spans multiple editors", () => {
    const a = EditorState.create({
      doc: schema.nodes.doc.create(null, [paragraph("LEFT")]),
    });
    const b = EditorState.create({
      doc: schema.nodes.doc.create(null, [paragraph("RIGHT")]),
    });
    expect(
      a.apply(replaceTextRanges(a, [{ from: 3, to: 5 }], "X", true)!).doc
        .textContent,
    ).toBe("LEX");
    expect(
      b.apply(replaceTextRanges(b, [{ from: 1, to: 4 }], "X", false)!).doc
        .textContent,
    ).toBe("HT");
  });
  it("preserves pasted line breaks within the original text component", () => {
    const state = EditorState.create({ doc: fixture() });
    const next = state.apply(
      replaceTextRanges(state, [{ from: 1, to: 6 }], "line1\nline2")!,
    );
    expect(next.doc.child(0).child(1).type.name).toBe("hardBreak");
    expect(next.doc.child(1).eq(state.doc.child(1))).toBe(true);
    expect(() => next.doc.check()).not.toThrow();
  });
  it("deletes a selected hard break as text while retaining its paragraph", () => {
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("a"),
      schema.nodes.hardBreak.create(),
      schema.text("b"),
    ]);
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [paragraph]),
    });
    const next = state.apply(
      replaceTextRanges(state, [{ from: 2, to: 3 }], "")!,
    );
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.textContent).toBe("ab");
  });
  it("does nothing for a read-only selection without writable text ranges", () => {
    expect(
      replaceTextRanges(EditorState.create({ doc: fixture() }), [], "replace"),
    ).toBeNull();
  });
});
it("scrolls in both directions and stops away from the edges", () => {
  expect(edgeVelocity(0, 0, 600)).toBe(-18);
  expect(edgeVelocity(580, 0, 600)).toBe(9);
  expect(edgeVelocity(300, 0, 600)).toBe(0);
});
