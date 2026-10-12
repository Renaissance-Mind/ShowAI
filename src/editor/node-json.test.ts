import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { createExtensions } from "./extensions";
import { editorNodeJSON, sameEditorContent } from "./node-json";
import { externalContentTransaction } from "../components/rich-text/external-content";

const schema = getSchema(createExtensions());
const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

describe("immutable editor JSON", () => {
  it("keeps real ProseMirror serialization and shares untouched paragraphs after typing", () => {
    const document = schema.nodeFromJSON({
      type: "doc",
      content: [paragraph("a", "alpha"), paragraph("b", "beta")],
    });
    const before = editorNodeJSON(document);
    expect(before).toEqual(document.toJSON());
    const state = EditorState.create({ schema, doc: document });
    const edited = state.apply(state.tr.insertText("!", 3));
    const after = editorNodeJSON(edited.doc);
    expect(after).toEqual(edited.doc.toJSON());
    expect(after.content![1]).toBe(before.content![1]);
    expect(after.content![0]).not.toBe(before.content![0]);
    expect(
      sameEditorContent(edited.doc, { type: "doc", content: after.content }),
    ).toBe(true);
    expect(
      externalContentTransaction(edited, {
        type: "doc",
        content: after.content,
      }),
    ).toBeNull();
  });
  it("still maps a genuine external edit and keeps undo from deleting it", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [paragraph("a", "alpha"), paragraph("b", "beta")],
    });
    let state = EditorState.create({ schema, doc, plugins: [history()] });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 3)).insertText("!"),
    );
    const echoed = editorNodeJSON(state.doc);
    const external = {
      ...echoed,
      content: [echoed.content![0], paragraph("b", "remote")],
    };
    expect(sameEditorContent(state.doc, external)).toBe(false);
    state = state.apply(externalContentTransaction(state, external)!);
    undo(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(state.doc.textContent).toBe("alpharemote");
  });
});
