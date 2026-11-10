import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  normalizeContentTree,
  readContentTree,
  richTextContent,
  richTextDocument,
  validateRichTextData,
} from "./model.mjs";
import { freezeOwnedJSON } from "../../portable/owned-json.mjs";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const nest = (depth: number): JSONContent =>
  depth ? { type: "blockquote", content: [nest(depth - 1)] } : paragraph("x");

describe("read-only rich text content", () => {
  it("matches the copied normalization and keeps untouched nodes", () => {
    const first = paragraph("first");
    const list: JSONContent = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("item")] }],
    };
    const doc: JSONContent = {
      type: "doc",
      content: [
        first,
        { type: "widget", attrs: { id: "d", kind: "divider", data: {} } },
        list,
      ],
    };
    const shared = readContentTree(doc);
    expect(shared).toEqual(normalizeContentTree(doc));
    expect(shared).not.toBe(doc);
    expect(shared.content![0]).toBe(first);
    expect(shared.content![2]).toBe(list);
    expect(doc.content![1].type).toBe("widget");

    const plain = { type: "doc", content: [first, list] };
    expect(readContentTree(plain)).toBe(plain);
    expect(richTextContent({ format: "richtext", content: plain })).toBe(plain);
    expect(richTextContent({ format: "markdown", content: "# Title" })).toEqual(
      richTextDocument({ format: "markdown", content: "# Title" }),
    );
  });
});

describe("rich text validation of shared subtrees", () => {
  it("accepts frozen content repeatedly and still rejects invalid nodes", () => {
    const block = freezeOwnedJSON(paragraph("shared"));
    validateRichTextData({ content: { type: "doc", content: [block] } });
    validateRichTextData({ content: { type: "doc", content: [block, block] } });
    expect(() =>
      validateRichTextData({
        content: { type: "doc", content: [block, { type: "unknown" }] },
      }),
    ).toThrow();
  });

  it("revalidates subtrees that are not frozen throughout", () => {
    const child = paragraph("mutable");
    const parent = Object.freeze({
      type: "blockquote",
      content: Object.freeze([child]),
    });
    validateRichTextData({ content: { type: "doc", content: [parent] } });
    child.type = "unknown";
    expect(() =>
      validateRichTextData({ content: { type: "doc", content: [parent] } }),
    ).toThrow();
  });

  it("applies the size limit across previously validated subtrees", () => {
    const blocks = freezeOwnedJSON(
      Array.from({ length: 2000 }, (_, index) => paragraph(String(index))),
    );
    const half = { type: "doc", content: blocks };
    validateRichTextData({ content: half });
    expect(() =>
      validateRichTextData({
        content: { type: "doc", content: [...blocks, ...blocks, ...blocks] },
      }),
    ).toThrow("超出大小限制");
    expect(() =>
      validateRichTextData({
        content: freezeOwnedJSON({ type: "doc", content: [...blocks, ...blocks] }),
      }),
    ).not.toThrow();
  });

  it("applies the depth limit when a validated subtree moves deeper", () => {
    const deep = freezeOwnedJSON(nest(40));
    validateRichTextData({ content: { type: "doc", content: [deep] } });
    expect(() =>
      validateRichTextData({
        content: { type: "doc", content: [nest(8)].map(() => wrap(deep, 8)) },
      }),
    ).toThrow("超出大小限制");
  });
});

function wrap(node: JSONContent, depth: number): JSONContent {
  return depth ? { type: "blockquote", content: [wrap(node, depth - 1)] } : node;
}
