import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { findNodes, mapNodes, mapWidgetDocuments, updateNode } from "./update.mjs";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (id: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [text(id)],
});
const doc = (...content: JSONContent[]) => ({ type: "doc", content });
const widget = (id: string, kind: string, data: unknown) => ({
  type: "widget",
  attrs: { id, kind, data },
});
const custom = (id: string) =>
  widget(id, "custom", {
    componentId: "value-slider",
    version: "1.0.0",
    integrity: `sha256-${"a".repeat(64)}`,
    props: { label: id },
  });

const page = (): JSONContent =>
  doc(
    paragraph("top"),
    widget("note", "text", {
      format: "richtext",
      content: doc(
        paragraph("in-note"),
        widget("callout", "callout", { content: doc(custom("deep")) }),
      ),
    }),
    widget("steps", "stepper", {
      steps: [
        { title: "One", content: doc(paragraph("one")) },
        { title: "Two", content: doc(custom("in-step")) },
      ],
    }),
  );

describe("mapWidgetDocuments", () => {
  test("replaces held documents and keeps data without changes", () => {
    const data = { steps: [{ content: doc(paragraph("a")) }, { content: doc() }], title: "x" };
    expect(mapWidgetDocuments(data, (document) => document)).toBe(data);
    const next = mapWidgetDocuments(data, (document) =>
      document.content!.length ? doc(paragraph("b")) : document,
    ) as typeof data;
    expect(next).not.toBe(data);
    expect(next.steps[0].content).toEqual(doc(paragraph("b")));
    expect(next.steps[1]).toBe(data.steps[1]);
    expect(next.title).toBe("x");
  });
});

describe("updateNode", () => {
  test("replaces a node held two components deep and shares every other branch", () => {
    const before = page();
    const snapshot = structuredClone(before);
    const after = updateNode(
      before,
      "deep",
      (node) => ({
        ...node,
        attrs: {
          ...node.attrs,
          data: { ...node.attrs!.data, version: "2.0.0" },
        },
      }),
      { scope: "content" },
    );
    // The input is never mutated.
    expect(before).toEqual(snapshot);
    const [found] = findNodes(after, "deep", { scope: "content" });
    expect(found.node.attrs!.data.version).toBe("2.0.0");
    expect(found.host!.attrs!.id).toBe("callout");
    expect(found.owner!.attrs!.id).toBe("note");
    // Untouched branches keep their identity.
    expect(after.content![0]).toBe(before.content![0]);
    expect(after.content![2]).toBe(before.content![2]);
    const note = (root: JSONContent) => root.content![1].attrs!.data.content;
    expect(note(after).content[0]).toBe(note(before).content[0]);
    expect(after.content![1]).not.toBe(before.content![1]);
  });

  test("reaches stepper steps and keeps the other steps", () => {
    const before = page();
    const after = updateNode(
      before,
      "in-step",
      (node) => ({ ...node, attrs: { ...node.attrs, data: { ...node.attrs!.data, props: { label: "changed" } } } }),
      { scope: "content" },
    );
    const steps = (root: JSONContent) => root.content![2].attrs!.data.steps;
    expect(steps(after)[0]).toBe(steps(before)[0]);
    expect(steps(after)[1].content.content[0].attrs.data.props).toEqual({ label: "changed" });
    expect(steps(after)[1].title).toBe("Two");
  });

  test("tree scope does not see held documents", () => {
    expect(() =>
      updateNode(page(), "deep", (node) => node, { scope: "tree" }),
    ).toThrow(/does not exist/);
    expect(findNodes(page(), "deep", { scope: "tree" })).toEqual([]);
  });

  test("refuses an id that names several nodes", () => {
    const root = doc(
      widget("a", "text", { content: doc(paragraph("same")) }),
      widget("b", "text", { content: doc(paragraph("same")) }),
    );
    expect(() =>
      updateNode(root, "same", (node) => node, { scope: "content" }),
    ).toThrow(/names 2 nodes/);
  });

  test("returning the node keeps the whole document", () => {
    const before = page();
    expect(updateNode(before, "deep", (node) => node, { scope: "content" })).toBe(before);
    expect(mapNodes(before, (node) => node, { scope: "content" })).toBe(before);
  });
});
