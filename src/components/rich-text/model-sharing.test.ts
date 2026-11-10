import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { normalizeContentTree, readContentTree } from "./model.mjs";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

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
    expect(readContentTree(shared)).toBe(shared);
  });
});
