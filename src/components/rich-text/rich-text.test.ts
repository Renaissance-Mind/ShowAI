import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RichText } from "./RichText";
import { createExtensions } from "./extensions";
import {
  richTextDocument,
  createRichTextNode,
  markdownToRichText,
} from "./model.mjs";
import { createResource } from "../../surface/containers.mjs";
import { insertComponent } from "../../surface/component-insertion";
import { findSurfaceNode } from "../../surface/document.mjs";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../../portable/validation.mjs";
import {
  blankDocument,
  readBuiltinComponentSource,
  saveComponent,
} from "../../core/catalog";
import { FileStore } from "../../core/store";
import { applyOperations } from "../../core/diff";
import { structuredContent } from "../../agent/page-reading";
const paths: string[] = [];
afterEach(async () => {
  for (const p of paths.splice(0))
    await rm(p, { recursive: true, force: true });
});
const data = {
  format: "richtext",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          {
            type: "text",
            text: "统一格式",
            marks: [
              { type: "underline" },
              { type: "highlight", attrs: { color: "#e8eed0" } },
              {
                type: "textStyle",
                attrs: {
                  fontFamily: "serif",
                  fontSize: "20px",
                  color: "#123456",
                },
              },
            ],
          },
        ],
      },
    ],
  },
};
describe("shared rich-text component", () => {
  it("keeps component fences literal inside text while preserving host Markdown imports", () => {
    const input =
      '```showai-block\n{"id":"existing","kind":"metrics","data":{"title":"kept","items":[]}}\n```';
    expect(richTextDocument({ content: input }).content?.[0].type).toBe(
      "codeBlock",
    );
    const imported = markdownToRichText(input, { allowComponentBlocks: true })
      .content?.[0];
    expect(imported?.type).toBe("widget");
    expect(imported?.attrs?.id).toBe("existing");
    expect(imported?.attrs?.data.title).toBe("kept");
  });

  it("retains all formatting from structured input through native insertion and portable save", () => {
    const inserted = insertComponent(
      createResource(blankDocument()),
      null,
      "text",
      data,
    );
    const node = findSurfaceNode(inserted.document, inserted.nodeId)!.node;
    expect(node.type).toBe("richText");
    const saved = parseArtifact(serializeArtifact(inserted.document)).document;
    expect(findSurfaceNode(saved, inserted.nodeId)!.node).toEqual(node);
    const schema = getSchema(createExtensions());
    const doc = schema.nodeFromJSON(data.content);
    doc.check();
    const html = renderToStaticMarkup(
      createElement(RichText, { data, readOnly: true }),
    );
    for (const part of [
      "<u>",
      "<mark",
      "text-align:center",
      "font-family:serif",
      "font-size:20px",
      "--showai-highlight-color:#e8eed0",
    ])
      expect(html).toContain(part);
    expect(html).not.toContain("选中文字格式");
    expect(html).not.toContain("<textarea");
  });
  it("imports Markdown, math and images into editable schema nodes without flattening formulas", () => {
    const doc = richTextDocument({
      content:
        "###### 六级标题\n\n**粗体**与 $x_1$。\n\n![图](https://example.com/image.png)\n\n- [x] 已完成\n\n$$\\frac{1}{2}$$",
    });
    getSchema(createExtensions()).nodeFromJSON(doc).check();
    expect(doc.content?.some((n) => n.type === "mathBlock")).toBe(true);
    expect(doc.content?.some((n) => n.type === "image")).toBe(true);
    const source = JSON.stringify(doc);
    expect(source).toContain("mathInline");
    expect(source).toContain("taskItem");
    expect(source).not.toContain("[x]");
    expect(source).toContain("bold");
    expect(
      richTextDocument({ content: "**原样**\n第二行", format: "plain" })
        .content?.[0].content?.[0].text,
    ).toBe("**原样**");
  });
  it("AI component insertion creates the same native text instance and keeps child IDs patchable", () => {
    const before = createResource(blankDocument());
    const after = applyOperations(before, [
      { type: "component.insert", kind: "text", data },
    ]);
    const rich = after.content.content!.at(-1)!;
    expect(rich.type).toBe("richText");
    const id = rich.content![0].attrs!.id;
    const edited = applyOperations(after, [
      { type: "block.text.set", blockId: id, text: "Agent 修改文字" },
    ]);
    expect(findSurfaceNode(edited, id)!.node.content?.[0].text).toBe(
      "Agent 修改文字",
    );
    expect(() => validateDocument(edited)).not.toThrow();
  });
  it("reads structured legacy text widgets as prose instead of object strings", () => {
    const doc = validateDocument({
      ...blankDocument(),
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: { id: "text-component", kind: "text", data },
          },
        ],
      },
    });
    const result = structuredContent(doc);
    expect(JSON.stringify(result)).toContain("统一格式");
    expect(JSON.stringify(result)).not.toContain("[object Object]");
    expect(createRichTextNode(data).content).toEqual(data.content.content);
  });
  it("compiles the same rich-text component for a standalone editable SDK instance", async () => {
    const home = await mkdtemp(join(tmpdir(), "rich-text-sdk-"));
    paths.push(home);
    const project = await new FileStore(home).createProject({
      name: "Rich text SDK",
    });
    const source = readBuiltinComponentSource("text");
    const compiled = await saveComponent(home, source, project.id);
    expect(compiled.defaultData).toEqual({
      format: "richtext",
      content: { type: "doc", content: [{ type: "paragraph", content: [] }] },
    });
    expect(compiled.inline!.script).toContain("rich-text-component");
    expect(compiled.inline!.script.length).toBeLessThan(2000000);
  }, 60000);
});
