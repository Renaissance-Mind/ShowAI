import { describe, expect, it } from "vitest";
import {
  applyOperations,
  canonicalJson,
  diffDocuments,
  documentHash,
  indexBlocks,
  normalizeDocument,
} from "./diff";

function document() {
  return normalizeDocument({
    id: "page",
    title: "Example",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "summary" },
          content: [{ type: "text", text: "Original conclusion" }],
        },
        {
          type: "paragraph",
          attrs: { id: "methods" },
          content: [{ type: "text", text: "Methods" }],
        },
      ],
    },
  });
}

describe("semantic page changes", () => {
  it("normalizes stable IDs and preserves supplied IDs", () => {
    const source = document();
    source.content.content!.push({ type: "paragraph" });
    const first = normalizeDocument(source);
    const second = normalizeDocument(source);
    expect([...indexBlocks(first).keys()]).toEqual([
      ...indexBlocks(second).keys(),
    ]);
    expect([...indexBlocks(first).keys()]).toContain("summary");
    const duplicate = structuredClone(first);
    duplicate.content.content!.push(
      structuredClone(duplicate.content.content![0]),
    );
    expect(indexBlocks(normalizeDocument(duplicate)).size).toBe(4);
  });

  it("hashes key ordering consistently and retains meaningful user data", () => {
    expect(canonicalJson({ z: 1, a: { y: 3, b: 2 } })).toBe(
      canonicalJson({ a: { b: 2, y: 3 }, z: 1 }),
    );
    const before = document();
    const after = applyOperations(before, [
      { type: "block.text.set", blockId: "summary", text: "2027-01-01" },
    ]);
    expect(documentHash(before)).not.toBe(documentHash(after));
  });

  it("reports only the edited block rather than the complete document", () => {
    const before = document();
    const after = applyOperations(before, [
      {
        type: "block.text.set",
        blockId: "summary",
        text: "A better conclusion",
      },
    ]);
    const changes = diffDocuments(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "block.changed",
      blockId: "summary",
    });
    expect(JSON.stringify(changes)).not.toContain("Methods");
  });

  it("does not report all existing blocks moved when one is inserted at the start", () => {
    const before = document();
    const after = applyOperations(before, [
      {
        type: "block.insert",
        afterId: null,
        node: {
          type: "paragraph",
          attrs: { id: "new" },
          content: [{ type: "text", text: "New" }],
        },
      },
    ]);
    expect(diffDocuments(before, after)).toMatchObject([
      { type: "block.added", blockId: "new", parentId: null, afterId: null },
    ]);
  });

  it("represents added or removed nested sections once including their children", () => {
    const before = document();
    const after = applyOperations(before, [
      {
        type: "block.insert",
        node: {
          type: "blockquote",
          attrs: { id: "section" },
          content: [
            {
              type: "paragraph",
              attrs: { id: "nested" },
              content: [{ type: "text", text: "Nested evidence" }],
            },
          ],
        },
      },
    ]);
    const changes = diffDocuments(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "block.added",
      blockId: "section",
    });
    expect(diffDocuments(after, before)).toHaveLength(1);
  });

  it("applies moves and rejects ancestor cycles", () => {
    const before = document();
    const moved = applyOperations(before, [
      { type: "block.move", blockId: "methods", afterId: null },
    ]);
    expect(moved.content.content![0].attrs!.id).toBe("methods");
    expect(
      diffDocuments(before, moved).some(
        (change) => change.type === "block.moved",
      ),
    ).toBe(true);
    const section = applyOperations(before, [
      {
        type: "block.insert",
        node: {
          type: "blockquote",
          attrs: { id: "section" },
          content: [{ type: "paragraph", attrs: { id: "nested" } }],
        },
      },
    ]);
    expect(() =>
      applyOperations(section, [
        { type: "block.move", blockId: "section", parentId: "nested" },
      ]),
    ).toThrow("inside itself");
  });

  it("supports field changes without changing stable IDs", () => {
    const before = document();
    const changed = applyOperations(before, [
      { type: "page.set", fields: { title: "Renamed" } },
      {
        type: "block.attrs.set",
        blockId: "summary",
        attrs: { textAlign: "center" },
      },
      {
        type: "block.replace",
        blockId: "methods",
        node: {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Approach" }],
        },
      },
    ]);
    expect(changed.title).toBe("Renamed");
    expect([...indexBlocks(changed).keys()]).toEqual(["summary", "methods"]);
    expect(diffDocuments(before, changed)).toHaveLength(3);
  });

  it("distinguishes removal of a null property from an unchanged value", () => {
    const before = document();
    before.content.content![0].attrs!.backgroundColor = null;
    const after = structuredClone(before);
    delete after.content.content![0].attrs!.backgroundColor;
    expect(documentHash(before)).not.toBe(documentHash(after));
    expect(diffDocuments(before, after)).toMatchObject([
      {
        type: "block.changed",
        blockId: "summary",
        fields: [{ field: "attrs.backgroundColor", before: null }],
      },
    ]);
  });
});
