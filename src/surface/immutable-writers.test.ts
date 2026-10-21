import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { blankDocument } from "../core/catalog";
import { createResource, createSurface } from "./containers.mjs";
import { reconcileSurface } from "./document.mjs";
import { addNode, editNode, replaceChildren } from "./editing";
import { ownSourceValue } from "./source-runtime";
import { fromPageEditorDraft, toPageEditor } from "./page-content";
import { editorNodeJSON, sameEditorContent } from "../editor/node-json";
import { createExtensions } from "../editor/extensions";
import { Widget } from "../components/blocks/Widget";
import { registerBlock } from "../components/blocks/registry";
import type { BlockData } from "../components/blocks/types";

const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const fixture = () => {
  const document = createResource(blankDocument(), "board");
  document.content.content = [
    {
      type: "widget",
      attrs: {
        id: "widget",
        kind: "test-immutable-data",
        data: { nested: { value: 1 } },
      },
    },
    {
      type: "richText",
      attrs: { id: "text", name: "Text" },
      content: [paragraph("p", "alpha")],
    },
    {
      type: "drawing",
      attrs: {
        id: "ink",
        tool: "pen",
        points: Array.from({ length: 4096 }, (_, index) => ({
          x: index,
          y: index % 7,
        })),
        extent: [4096, 7],
        color: "#000000",
        strokeWidth: 2,
      },
    },
  ];
  const result = reconcileSurface(document);
  return ownSourceValue({
    ...result,
    customRoot: { "e\u0301": { values: [null, false, "\u0000"] } },
  });
};

describe("immutable UI command boundaries", () => {
  it("reconciles missing IDs and shared maps without writing any frozen source branch", () => {
    const base = fixture();
    const dirty = ownSourceValue({
      ...base,
      content: {
        ...base.content,
        content: [
          ...base.content.content!,
          { type: "paragraph", content: [{ type: "text", text: "new" }] },
        ],
      },
      surfaceViews: {
        ...base.surfaceViews,
        [base.content.attrs!.id]: {
          ...base.surfaceViews![base.content.attrs!.id],
          unknown: { keep: [1, 2, 3] },
        },
      },
    });
    const before = JSON.stringify(dirty);
    const result = reconcileSurface(dirty, { clone: false });
    expect(JSON.stringify(dirty)).toBe(before);
    expect(result.content.content!.at(-1)!.attrs!.id).toBeTruthy();
    expect(dirty.content.content!.at(-1)!.attrs).toBeUndefined();
    expect(result.content.content![2]).toBe(dirty.content.content![2]);
    expect(result.customRoot).toBe(dirty.customRoot);
    expect(
      (result.surfaceViews as Record<string, unknown>)[base.content.attrs!.id],
    ).toMatchObject({ unknown: { keep: [1, 2, 3] } });
    expect(result.layout).not.toBe(dirty.layout);
  });

  it("captures only the edited node and protects the publication from a retained widget draft", () => {
    const base = fixture(),
      ink = base.content.content![2];
    let retained: BlockData = {};
    const changed = editNode(
      base,
      "widget",
      (node) => {
        retained = structuredClone(node.attrs!.data);
        (retained.nested as { value: number }).value = 2;
        node.attrs = { ...node.attrs, data: retained };
      },
      { normalize: false },
    );
    (retained.nested as { value: number }).value = 99;
    expect(changed.content.content![0].attrs!.data.nested.value).toBe(2);
    expect(base.content.content![0].attrs!.data.nested.value).toBe(1);
    expect(changed.content.content![2]).toBe(ink);
    expect(changed.layout).toBe(base.layout);
    expect(changed.surfaceViews).toBe(base.surfaceViews);
    expect((changed as typeof base).customRoot).toBe(base.customRoot);
    expect(
      Object.isFrozen(changed.content.content![0].attrs!.data.nested),
    ).toBe(true);
  });

  it("renames a root surface without cloning any descendant samples", () => {
    const base = fixture();
    const changed = editNode(
      base,
      base.content.attrs!.id,
      (node) => {
        node.attrs = { ...node.attrs, name: "Typed root name" };
      },
      { normalize: false, attributesOnly: true },
    );
    expect(changed.content.content).toBe(base.content.content);
    expect(changed.content.content![2].attrs!.points).toBe(
      base.content.content![2].attrs!.points,
    );
    expect(changed.content.attrs!.name).toBe("Typed root name");
    expect(base.content.attrs!.name).not.toBe("Typed root name");
  });

  it("changes a drawing attribute without cloning its sample buffer", () => {
    const base = fixture();
    const changed = editNode(
      base,
      "ink",
      (node) => {
        node.attrs = { ...node.attrs, color: "#ff0000" };
      },
      { normalize: false, attributesOnly: true },
    );
    expect(changed.content.content![2].attrs!.points).toBe(
      base.content.content![2].attrs!.points,
    );
    expect(changed.content.content![2].attrs!.color).toBe("#ff0000");
    expect(base.content.content![2].attrs!.color).toBe("#000000");
  });

  it("accepts schema-assigned text replacement without normalizing or cloning unrelated ink", () => {
    const base = fixture(),
      replacement = paragraph("p", "typed");
    const changed = replaceChildren(base, "text", ["p"], [replacement], {
      normalize: false,
    });
    replacement.content[0].text = "mutated after callback";
    expect(changed.content.content![1].content![0].content![0].text).toBe(
      "typed",
    );
    expect(changed.content.content![0]).toBe(base.content.content![0]);
    expect(changed.content.content![2]).toBe(base.content.content![2]);
    expect(changed.layout).toBe(base.layout);
    expect(changed.surfaceViews).toBe(base.surfaceViews);
  });

  it("duplicates an embedded module using a separate layout draft on a frozen Page", () => {
    const page = createResource(blankDocument());
    const source = ownSourceValue(
      addNode(page, createSurface("board", "Board", "embedded"), {
        x: 10,
        y: 20,
        width: 600,
        height: 400,
        heightMode: "fixed",
      }),
    );
    const before = JSON.stringify(source),
      board = source.content.content!.find(
        (node) => node.attrs?.id === "embedded",
      )!;
    const unchanged = fromPageEditorDraft(toPageEditor(board, source), source);
    expect(unchanged.document.layout).toBe(source.layout);
    expect(unchanged.document.surfaceViews).toBe(source.surfaceViews);
    const module = structuredClone(toPageEditor(board, source));
    module.attrs!.id = "embedded-copy";
    const decoded = fromPageEditorDraft(module, source);
    expect(JSON.stringify(source)).toBe(before);
    expect(decoded.content.attrs!.id).toBe("embedded-copy");
    expect(decoded.document.layout!["embedded-copy"]).toEqual(
      source.layout!.embedded,
    );
    expect(decoded.document.surfaceViews!["embedded-copy"]).toEqual(
      source.surfaceViews!.embedded,
    );
    expect(source.layout!["embedded-copy"]).toBeUndefined();
    expect(decoded.document.content).toBe(source.content);
  });

  it("serializes real ProseMirror nodes into independent frozen JSON while retaining unchanged children", () => {
    const schema = getSchema(createExtensions());
    const widgetData = { nested: { value: 1 } };
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        paragraph("p", "alpha"),
        {
          type: "widget",
          attrs: { id: "w", kind: "custom", data: widgetData },
        },
      ],
    });
    const before = editorNodeJSON(doc);
    expect(Object.isFrozen(before.content![1].attrs!.data.nested)).toBe(true);
    expect(Object.isFrozen(widgetData.nested)).toBe(false);
    widgetData.nested.value = 7;
    expect(before.content![1].attrs!.data.nested.value).toBe(1);
    const state = EditorState.create({ schema, doc });
    const changed = state.apply(state.tr.insertText("!", 3));
    const after = editorNodeJSON(changed.doc);
    expect(after.content![1]).toBe(before.content![1]);
    expect(sameEditorContent(changed.doc, after)).toBe(true);
  });

  it("gives an actual registered editable component its own working copy and captures each publication", () => {
    const canonical = ownSourceValue({ nested: { value: 1 } }),
      published: BlockData[] = [];
    registerBlock({
      kind: "test-immutable-data",
      label: "Immutable boundary",
      description: "Independent component data",
      createData: () => ({ nested: { value: 1 } }),
      Component: ({ data, onChange }) => {
        const nested = data.nested as { value: number };
        nested.value++;
        onChange?.(data);
        nested.value++;
        onChange?.(data);
        nested.value = 99;
        return createElement("output", null, "edited");
      },
    });
    expect(
      renderToStaticMarkup(
        createElement(Widget, {
          kind: "test-immutable-data",
          data: canonical,
          onChange: (value) => published.push(value),
        }),
      ),
    ).toContain("edited");
    expect(canonical.nested.value).toBe(1);
    expect(
      published.map((value) => (value.nested as { value: number }).value),
    ).toEqual([2, 3]);
    expect(Object.isFrozen(published[0].nested)).toBe(true);
    expect(published[0].nested).not.toBe(published[1].nested);
  });
});
