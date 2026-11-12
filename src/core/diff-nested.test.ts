import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { applyOperations, normalizeDocument } from "./diff";
import { blankDocument } from "./catalog";
import { createResource } from "../document/containers.mjs";
import { findNodes } from "../document/update.mjs";
import type { PageOperation, ShowDocument } from "./model";

const integrity = (digit: string) => `sha256-${digit.repeat(64)}`;
const custom = (id: string) => ({
  type: "widget",
  attrs: {
    id,
    kind: "custom",
    data: {
      componentId: "value-slider",
      version: "1.0.0",
      integrity: integrity("a"),
      props: { label: id },
    },
  },
});
const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

/** A text block holding a paragraph and a callout that holds a component. */
function nestedPage(): ShowDocument {
  const page = createResource(blankDocument());
  page.title = "Nested";
  page.content.content = [
    paragraph("top", "Top"),
    {
      type: "widget",
      attrs: {
        id: "note",
        kind: "text",
        data: {
          content: {
            type: "doc",
            content: [
              paragraph("in-note", "Inside"),
              {
                type: "widget",
                attrs: {
                  id: "callout",
                  kind: "callout",
                  data: {
                    tone: "info",
                    content: { type: "doc", content: [custom("deep")] },
                  },
                },
              },
            ],
          },
        },
      },
    },
  ] as JSONContent[];
  page.surfaceViews![page.content.attrs!.id].readingOrder = ["top", "note"];
  return normalizeDocument(page);
}

const node = (document: ShowDocument, id: string) =>
  findNodes(document.content, id, { scope: "content" })[0]?.node;
const apply = (operations: PageOperation[]) =>
  applyOperations(nestedPage(), operations);

describe("operations on blocks nested in component content", () => {
  it("component.ref.set upgrades a component nested two components deep", () => {
    const after = apply([
      {
        type: "component.ref.set",
        blockId: "deep",
        version: "2.0.0",
        integrity: integrity("b"),
      },
    ]);
    expect(node(after, "deep").attrs!.data).toMatchObject({
      componentId: "value-slider",
      version: "2.0.0",
      integrity: integrity("b"),
      props: { label: "deep" },
    });
    expect(node(after, "callout").attrs!.data.tone).toBe("info");
  });

  it("component.props.set, block.attrs.set and block.text.set reach nested blocks", () => {
    const after = apply([
      { type: "block.attrs.set", blockId: "callout", attrs: { data: { tone: "warning", content: node(nestedPage(), "callout").attrs!.data.content } } },
      { type: "component.props.set", blockId: "deep", props: { label: "Moved" } },
      { type: "block.text.set", blockId: "in-note", text: "Rewritten" },
    ]);
    expect(node(after, "deep").attrs!.data.props).toEqual({ label: "Moved" });
    expect(node(after, "callout").attrs!.data.tone).toBe("warning");
    expect(node(after, "in-note").content).toEqual([
      { type: "text", text: "Rewritten" },
    ]);
  });

  it("block.replace and block.remove work inside held documents", () => {
    const replaced = apply([
      {
        type: "block.replace",
        blockId: "in-note",
        node: { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
      },
    ]);
    expect(node(replaced, "in-note")).toMatchObject({
      type: "heading",
      attrs: { id: "in-note", level: 2 },
    });
    const removed = apply([{ type: "block.remove", blockId: "deep" }]);
    expect(node(removed, "deep")).toBeUndefined();
    expect(node(removed, "callout")).toBeDefined();
  });

  it("tree operations name the nested block and its holder", () => {
    for (const operation of [
      { type: "block.move", blockId: "deep", parentId: null },
      { type: "block.insert", parentId: "callout", node: paragraph("x", "x") },
      { type: "surface.layout.set", nodeId: "deep", layout: { x: 1 } },
      { type: "component.insert", parentId: "in-note", kind: "callout" },
    ] as PageOperation[])
      expect(() => apply([operation])).toThrow(
        /is nested in the content of component callout inside block note|is nested in the content of block note/,
      );
    expect(() => apply([{ type: "block.remove", blockId: "missing" }])).toThrow(
      /does not exist/,
    );
  });

  it("an id repeated inside component content is made unique when saved", () => {
    const page = nestedPage();
    const text = page.content.content!.find((item) => item.attrs?.id === "note")!;
    const copy = structuredClone(text);
    copy.attrs!.id = "note-copy";
    page.content.content!.push(copy);
    page.surfaceViews![page.content.attrs!.id].readingOrder.push("note-copy");
    const saved = normalizeDocument(page);
    for (const id of ["in-note", "callout", "deep"])
      expect(findNodes(saved.content, id, { scope: "content" })).toHaveLength(1);
    const after = applyOperations(saved, [
      { type: "component.props.set", blockId: "deep", props: { label: "One" } },
    ]);
    expect(node(after, "deep").attrs!.data.props.label).toBe("One");
  });
});
