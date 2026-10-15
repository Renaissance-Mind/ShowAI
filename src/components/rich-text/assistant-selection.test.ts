import { getSchema } from "@tiptap/core";
import { expect, test } from "vitest";
import { createExtensions } from "./extensions";
import { selectionBlockIds } from "./assistant-selection";

const schema = getSchema(createExtensions());
const paragraph = (id: string, text = "") =>
  schema.nodes.paragraph.create({ id }, text ? schema.text(text) : undefined);

test("paragraph selection ending at the following text start does not widen the Agent target", () => {
  const first = paragraph("selected", "选中内容");
  const doc = schema.nodes.doc.create(null, [
    first,
    paragraph("untouched", "保留原文"),
  ]);
  expect(selectionBlockIds(doc, 1, first.nodeSize + 1)).toEqual(["selected"]);
  expect(selectionBlockIds(doc, 1, first.nodeSize + 2)).toEqual([
    "selected",
    "untouched",
  ]);
});

test("a selection beginning at the preceding text end excludes that paragraph", () => {
  const first = paragraph("untouched", "保留原文");
  const doc = schema.nodes.doc.create(null, [
    first,
    paragraph("selected", "选中内容"),
  ]);
  expect(
    selectionBlockIds(doc, first.nodeSize - 1, doc.content.size - 1),
  ).toEqual(["selected"]);
});

test("fully selected empty paragraphs remain targets while synthetic page tails do not", () => {
  const first = paragraph("selected", "正文");
  const empty = paragraph("empty");
  const doc = schema.nodes.doc.create(null, [
    first,
    empty,
    paragraph("page-tail-test"),
  ]);
  expect(selectionBlockIds(doc, 1, doc.content.size)).toEqual([
    "selected",
    "empty",
  ]);
});
