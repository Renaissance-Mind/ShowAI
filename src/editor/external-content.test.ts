import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { createExtensions } from "./extensions";
import { externalContentTransaction } from "./external-content";

test("remote insertion maps the caret and undo retains another user's text", () => {
  const schema = getSchema(createExtensions());
  const doc = schema.nodes.doc.create(
    null,
    schema.nodes.paragraph.create({ id: "paragraph" }, schema.text("共同编辑")),
  );
  let state = EditorState.create({ schema, doc, plugins: [history()] });
  state = state.apply(
    state.tr
      .setSelection(TextSelection.create(state.doc, 5))
      .insertText("本机"),
  );
  const caret = state.selection.from;
  const remote = state.doc.toJSON();
  remote.content[0].content[0].text = "远端" + state.doc.textContent;
  const transaction = externalContentTransaction(state, remote)!;
  state = state.apply(transaction);
  expect(state.selection.from).toBe(caret + 2);
  expect(state.doc.textContent).toBe("远端共同编辑本机");
  expect(
    undo(state, (step) => {
      state = state.apply(step);
    }),
  ).toBe(true);
  expect(state.doc.textContent).toBe("远端共同编辑");
  expect(externalContentTransaction(state, state.doc.toJSON())).toBeNull();
});
