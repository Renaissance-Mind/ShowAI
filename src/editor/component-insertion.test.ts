import { expect, test } from "vitest";
import { getSchema } from "@tiptap/core";
import { createExtensions } from "./extensions";
import { splitForComponent } from "./component-insertion";
import { insertComponentAtText } from "../surface/component-insertion";
import { createResource, createSurface } from "../surface/containers.mjs";
import { blankDocument } from "../core/catalog";
import { validateDocument } from "../portable/validation.mjs";
import { visitNodes } from "../surface/document.mjs";
const schema = getSchema(createExtensions());
const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

test("caret insertion keeps text on both sides and preserves neighboring identities", () => {
  const input = createResource(blankDocument());
  input.content.content = [
    paragraph("before", "Before"),
    paragraph("cursor", "LeftRight"),
    paragraph("after", "After"),
  ];
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: input.content.content,
  });
  const point = splitForComponent(doc, 8 + 1 + 4);
  const result = insertComponentAtText(
    input,
    {
      parentId: input.content.attrs!.id,
      ids: ["before", "cursor", "after"],
      kind: "children",
    },
    point,
    "board",
    {},
  );
  const nodes = result.document.content.content!;
  expect(nodes.map((n) => n.type)).toEqual([
    "paragraph",
    "paragraph",
    "surface",
    "paragraph",
    "paragraph",
  ]);
  expect(nodes[1].content![0].text).toBe("Left");
  expect(nodes[3].content![0].text).toBe("Right");
  expect(nodes[0].attrs!.id).toBe("before");
  expect(nodes[4].attrs!.id).toBe("after");
  expect(nodes[1].attrs!.id).not.toBe(nodes[3].attrs!.id);
  expect(() => validateDocument(result.document)).not.toThrow();
  expect(input.content.content).toHaveLength(3);
});

test("native insertion replaces an empty paragraph and splits nested list content safely", () => {
  const empty = schema.nodeFromJSON({
    type: "doc",
    content: [paragraph("empty", "")],
  });
  expect(splitForComponent(empty, 1)).toEqual({ before: [], after: [] });
  const list = {
    type: "bulletList",
    attrs: { id: "list" },
    content: [
      {
        type: "listItem",
        attrs: { id: "item" },
        content: [paragraph("line", "AlphaBeta")],
      },
    ],
  };
  const doc = schema.nodeFromJSON({ type: "doc", content: [list] });
  const point = splitForComponent(doc, 3 + 5);
  for (const fragment of [point.before, point.after])
    schema.nodeFromJSON({ type: "doc", content: fragment }).check();
  const ids: string[] = [];
  visitNodes(
    { type: "doc", content: [...point.before, ...point.after] },
    (node) => {
      if (node.attrs?.id) ids.push(node.attrs.id);
    },
  );
  expect(new Set(ids).size).toBe(ids.length);
});

test("a Board text card splits around a Page without changing its other siblings", () => {
  const input = createResource(blankDocument());
  input.content = { ...createSurface("board"), type: "surface" };
  const text = {
    type: "richText",
    attrs: { id: "card", name: "Note" },
    content: [paragraph("line", "BeforeAfter")],
  };
  input.content.content = [text];
  input.layout = { card: { x: 20, y: 30, width: 360 } };
  const point = splitForComponent(
    schema.nodeFromJSON({ type: "doc", content: text.content }),
    7,
  );
  const result = insertComponentAtText(
    input,
    { parentId: "card", ids: ["line"], kind: "children" },
    point,
    "page",
    {},
  );
  expect(result.document.content.content!.map((n) => n.type)).toEqual([
    "richText",
    "surface",
    "richText",
  ]);
  expect(result.document.content.content![0].attrs!.id).toBe("card");
  expect(result.document.layout!["card"]).toEqual(input.layout.card);
  expect(() => validateDocument(result.document)).not.toThrow();
});
