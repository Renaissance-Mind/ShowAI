import { describe, it, expect } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import { createExtensions } from "../editor/extensions";
import { pageEditorNodes } from "./PageEditorNodes";
import { toPageEditor, fromPageEditor } from "./page-content";
import { createResource } from "./containers.mjs";
import { blankDocument } from "../core/catalog";
import { validateDocument } from "../portable/validation.mjs";

describe("continuous Page editing", () => {
  it("keeps text regions, embedded boards and their descendants through the real editor schema", () => {
    const document = createResource(blankDocument());
    const paragraph = (id: string, text: string) => ({
      type: "paragraph",
      attrs: { id },
      content: [{ type: "text", text }],
    });
    document.content.content = [
      paragraph("a", "Before"),
      {
        type: "region",
        attrs: { id: "region", name: "Section" },
        content: [
          paragraph("b", "Within section"),
          {
            type: "richText",
            attrs: { id: "text", name: "Text" },
            content: [paragraph("c", "Within text")],
          },
        ],
      },
      {
        type: "surface",
        attrs: { id: "board", name: "Board", kind: "board" },
        content: [paragraph("d", "On Board")],
      },
      paragraph("e", "After"),
    ];
    document.surfaceViews = {};
    Object.assign(document, validateDocument(document));
    const content = {
      type: "doc",
      content: document.content.content,
    } as JSONContent;
    const schema = getSchema([...createExtensions(), ...pageEditorNodes]);
    const loaded = schema.nodeFromJSON(toPageEditor(content, document));
    expect(loaded.textContent).toBe("BeforeWithin sectionWithin textAfter");
    const restored = fromPageEditor(loaded.toJSON());
    const ids = (node: JSONContent): string[] =>
      [node.attrs?.id, ...(node.content ?? []).flatMap(ids)].filter(Boolean);
    expect(ids(restored)).toEqual(ids(content));
    expect(restored.content![2]).toEqual(content.content![2]);
    const source = structuredClone(document);
    const module = toPageEditor(content.content![2], document);
    module.attrs!.id = "board-copy";
    const copy = fromPageEditor(module, source);
    expect(copy.attrs!.id).toBe("board-copy");
    expect(copy.content![0].attrs!.id).not.toBe("d");
    source.content.content!.push(copy);
    source.surfaceViews![source.content.attrs!.id].readingOrder.push(
      "board-copy",
    );
    expect(source.layout![copy.content![0].attrs!.id]).toEqual(
      document.layout!.d,
    );
    expect(() => validateDocument(source)).not.toThrow();
    expect(() =>
      validateDocument({
        ...document,
        content: { ...document.content, content: restored.content },
      }),
    ).not.toThrow();
  });
});
