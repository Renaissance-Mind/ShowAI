import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createExtensions } from "./extensions";
import { primitiveContentNode, normalizeContentTree } from "./model.mjs";
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
  it("preserves object names when real editor transactions change widget data and image metadata", () => {
    const schema=getSchema(createExtensions());
    const input={type:"doc",content:[
      {type:"widget",attrs:{id:"counter",name:"计数器",kind:"custom-counter",data:{value:0}}},
      {type:"image",attrs:{id:"picture",name:"示意图",src:"data:image/png;base64,YQ==",alt:"source",caption:"说明"}},
    ]};
    const original=schema.nodeFromJSON(input);original.check();
    const state=EditorState.create({doc:original});
    const widget=original.child(0),image=original.child(1);
    const updated=state.apply(state.tr
      .setNodeMarkup(0,undefined,{...widget.attrs,data:{value:1}})
      .setNodeMarkup(widget.nodeSize,undefined,{...image.attrs,caption:"新的说明"})).doc.toJSON();
    expect(updated.content[0].attrs).toMatchObject({id:"counter",name:"计数器",data:{value:1}});
    expect(updated.content[1].attrs).toMatchObject({id:"picture",name:"示意图",caption:"新的说明"});
    expect(input.content[0].attrs.data).toEqual({value:0});
  });
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
  it("imports table values into a single rich text representation", () => {
    const node = primitiveContentNode("table", fixtures.table);
    const cells = node.content![1].content!;
    expect(cells.map((cell) => cell.content![0].content![0].text)).toEqual([
      "42",
      "false",
    ]);
    expect(cells.every((cell) => !("scalarValue" in cell.attrs!))).toBe(true);
    cells[0].attrs!.colwidth = [160];
    cells[0].content![0].content![0].marks = [{ type: "bold" }];
    const parsed = getSchema(createExtensions()).nodeFromJSON({
      type: "doc",
      content: [node],
    });
    parsed.check();
    const edited = parsed.toJSON().content[0].content[1].content[0];
    expect(edited.attrs.colwidth).toEqual([160]);
    expect(edited.content[0].content[0].marks).toEqual([{ type: "bold" }]);
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
  it("edits native content with node operations and rejects the old props protocol", () => {
    const inserted = insertComponent(
      createResource(blankDocument()),
      null,
      "image",
      fixtures.image,
    );
    expect(() =>
      applyOperations(inserted.document, [
        {
          type: "component.props.set",
          blockId: inserted.nodeId,
          props: { caption: "updated" },
        },
      ]),
    ).toThrow(/requires a component block/);
    const result = applyOperations(inserted.document, [
      {
        type: "block.attrs.set",
        blockId: inserted.nodeId,
        attrs: { caption: "updated" },
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
  it("keeps SDK document wrappers free of legacy routing tags", () => {
    const doc = {
      type: "doc",
      content: [
        primitiveContentNode("code", fixtures.code),
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
    const inserted = insertComponent(
      createResource(blankDocument()),
      null,
      "code",
      { document: doc },
    );
    const wrapper = findSurfaceNode(inserted.document, inserted.nodeId)!.node;
    expect(wrapper.attrs).not.toHaveProperty("kind");
    expect(wrapper.content).toMatchObject(doc.content);
    const parsed = getSchema(createExtensions()).nodeFromJSON({
      type: "doc",
      content: [wrapper],
    });
    parsed.check();
    expect(parsed.toJSON().content[0].attrs).not.toHaveProperty("kind");
  });
  it.each(Object.entries(fixtures))(
    "validates %s without migrating stored content",
    (kind, data) => {
      const content = {
        type: "doc",
        content: [{ type: "widget", attrs: { id: "legacy", kind, data } }],
      };
      const saved = validateDocument({ ...blankDocument(), content });
      expect(saved.content).toEqual(content);
      const normalized = normalizeContentTree(saved.content);
      expect(normalized.content![0].type).toBe(
        primitiveContentNode(kind, data).type,
      );
      expect(saved.content).toEqual(content);
      expect(
        renderToStaticMarkup(
          createElement(RichTextNode, { node: saved.content }),
        ),
      ).toBe(
        renderToStaticMarkup(createElement(RichTextNode, { node: normalized })),
      );
    },
  );
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
