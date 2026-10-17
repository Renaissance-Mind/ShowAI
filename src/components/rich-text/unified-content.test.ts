import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createExtensions } from "./extensions";
import {
  primitiveContentNode,
  normalizeContentTree,
  patchPrimitiveContentNode,
} from "./model.mjs";
import {
  validateDocument,
  serializeArtifact,
  parseArtifact,
} from "../../portable/validation.mjs";
import { RichTextNode } from "./RichTextView";
import { createResource } from "../../surface/containers.mjs";
import { blankDocument } from "../../core/catalog";
import { insertComponent } from "../../surface/component-insertion";
import { findSurfaceNode } from "../../surface/document.mjs";
import { applyOperations } from "../../core/diff";

const fixtures = {
  image: {
    src: "data:image/png;base64,YQ==",
    alt: "alt",
    caption: "caption",
    width: 320,
    height: 180,
    fit: "cover",
    radius: 8,
  },
  table: {
    title: "Values",
    columns: ["n", "flag"],
    rows: [[42, false]],
    columnAlignments: ["right", "center"],
  },
  code: {
    content: "const x = 1;\n",
    language: "javascript",
    backgroundColor: "#eeeeee",
  },
  callout: {
    title: "Read this",
    content: "**Bold** and $x^2$",
    color: "#123456",
  },
  toggle: {
    summary: "Details",
    content: "![alt](data:image/png;base64,YQ==)",
    open: true,
  },
  divider: { color: "#123456" },
};
describe("unified content compatibility", () => {
  it.each(Object.entries(fixtures))(
    "keeps %s identity and data through migration, editor schema and portable export",
    (kind, data) => {
      const input = {
        type: "doc",
        content: [{ type: "widget", attrs: { id: "original", kind, data } }],
      };
      const copy = structuredClone(input);
      const node = normalizeContentTree(input);
      expect(input).toEqual(copy);
      expect(normalizeContentTree(node)).toEqual(node);
      const schema = getSchema(createExtensions());
      const parsed = schema.nodeFromJSON(node);
      parsed.check();
      const edited = parsed.toJSON();
      expect(edited.content[0].attrs.id).toBe("original");
      for (const [key, value] of Object.entries(node.content![0].attrs!))
        expect(edited.content[0].attrs[key]).toEqual(value);
      const saved = validateDocument({ ...blankDocument(), content: edited });
      expect(parseArtifact(serializeArtifact(saved)).document.content).toEqual(
        saved.content,
      );
      const html = renderToStaticMarkup(
        createElement(RichTextNode, { node: saved.content }),
      );
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("contenteditable");
    },
  );
  it("retains typed table values, formatted merged cells and widths", () => {
    const node = primitiveContentNode("table", fixtures.table);
    expect(node.content![1].content![0].attrs!.scalarValue).toBe(42);
    expect(node.content![1].content![1].attrs!.scalarValue).toBe(false);
    const cell = node.content![1].content![0];
    cell.attrs!.colwidth = [160];
    cell.content![0].content![0].marks = [{ type: "bold" }];
    const changed = patchPrimitiveContentNode(node, {
      title: "Renamed",
      rows: [[42, true]],
    });
    expect(changed.content![1].content![0]).toEqual(cell);
    expect(changed.content![1].content![1].attrs!.scalarValue).toBe(true);
    cell.content![0].content![0].text = "43";
    expect(
      normalizeContentTree(node).content![1].content![0].attrs!.scalarValue,
    ).toBe("43");
  });
  it.each(Object.entries(fixtures))(
    "catalog insertion creates the same %s node as legacy input",
    (kind, data) => {
      const inserted = insertComponent(
        createResource(blankDocument()),
        null,
        kind,
        data,
      );
      const node = findSurfaceNode(inserted.document, inserted.nodeId)!.node;
      expect(node.type).toBe(primitiveContentNode(kind, data).type);
      expect(node.type).not.toBe("widget");
      expect(() => validateDocument(inserted.document)).not.toThrow();
    },
  );
  it("keeps old component props calls working after migration", () => {
    const inserted = insertComponent(
      createResource(blankDocument()),
      null,
      "image",
      fixtures.image,
    );
    const result = applyOperations(inserted.document, [
      {
        type: "component.props.set",
        blockId: inserted.nodeId,
        props: { caption: "updated" },
      },
    ]);
    expect(findSurfaceNode(result, inserted.nodeId)!.node.attrs!.caption).toBe(
      "updated",
    );
  });
  it.each(Object.entries(fixtures))(
    "Board insertion shares the same %s content model",
    (kind, data) => {
      const source = createResource(blankDocument());
      source.content.attrs!.kind = "board";
      const inserted = insertComponent(source, null, kind, data);
      const page = findSurfaceNode(inserted.document, inserted.nodeId)!.node;
      expect(page.type).toBe("surface");
      expect(page.content![0].type).toBe(primitiveContentNode(kind, data).type);
      expect(() => validateDocument(inserted.document)).not.toThrow();
    },
  );
  it("keeps unrelated components and nested rich cell formatting unchanged", () => {
    const custom = {
      type: "widget",
      attrs: {
        id: "custom",
        kind: "custom",
        data: {
          componentId: "example",
          version: "1.0.0",
          integrity: "sha256-test",
          props: { title: "preserved" },
        },
      },
    };
    expect(normalizeContentTree(custom)).toEqual(custom);
    const cell = {
      type: "tableCell",
      attrs: { colspan: 2, rowspan: 2, colwidth: [120, 180] },
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "formatted",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: "https://example.com" } },
              ],
            },
          ],
        },
      ],
    };
    expect(normalizeContentTree(cell)).toEqual(cell);
  });
  it("keeps SDK document updates editable by existing component prop callers", () => {
    const doc = {
      type: "doc",
      content: [
        primitiveContentNode("code", fixtures.code),
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    const wrapper = normalizeContentTree({
      type: "widget",
      attrs: { id: "sdk-code", kind: "code", data: { document: doc } },
    });
    const schema = getSchema(createExtensions());
    const parsed = schema
      .nodeFromJSON({ type: "doc", content: [wrapper] })
      .toJSON();
    const source = validateDocument({ ...blankDocument(), content: parsed });
    const changed = applyOperations(source, [
      {
        type: "component.props.set",
        blockId: "sdk-code",
        props: { language: "typescript" },
      },
    ]);
    expect(changed.content.content![0].content![0].attrs!.language).toBe(
      "typescript",
    );
    expect(changed.content.content![0].content![1].content![0].text).toBe(
      "after",
    );
  });
  it("does not reinterpret unrelated kinds or accept misplaced ink metadata", () => {
    const node = { type: "widget", attrs: { kind: "constructor", data: {} } };
    expect(normalizeContentTree(node)).toEqual(node);
    expect(() =>
      validateDocument({
        ...blankDocument(),
        content: {
          type: "doc",
          content: [{ type: "paragraph", attrs: { nativeInk: {} } }],
        },
      }),
    ).toThrow(/image node/);
  });
});
