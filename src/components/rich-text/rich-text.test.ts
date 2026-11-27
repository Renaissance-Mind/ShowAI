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
  validateRichTextData,
} from "../../document/rich-text.mjs";
import { createResource } from "../../document/containers.mjs";
import { insertComponent } from "../../surface/component-insertion";
import { findSurfaceNode } from "../../document/document.mjs";
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
              { type: "highlight", attrs: { color: "#e8eed0", mode: "full" } },
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
      'data-highlight-mode="full"',
    ])
      expect(html).toContain(part);
    expect(html).not.toContain("选中文字格式");
    expect(html).not.toContain("<textarea");
  });
  it.each(["upper", "", true, 1, {}])(
    "rejects unsupported highlight modes at component and page boundaries (%s)",
    (mode) => {
      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Highlight",
                marks: [{ type: "highlight", attrs: { mode } }],
              },
            ],
          },
        ],
      };
      expect(() =>
        validateRichTextData({ format: "richtext", content }),
      ).toThrow("lower");
      expect(() => validateDocument({ ...blankDocument(), content })).toThrow(
        "lower",
      );
    },
  );
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
  it("imports [text]{note} as hover notes on text and formulas", () => {
    const doc = markdownToRichText(
      "[侧网络]{只更新这一支} 预测 [$\\epsilon_\\theta$]{去噪网络的噪声估计}，[x] {y} 保持原样。",
    );
    getSchema(createExtensions()).nodeFromJSON(doc).check();
    expect(() =>
      validateDocument({ ...blankDocument(), content: doc }),
    ).not.toThrow();
    const nodes = doc.content?.[0].content ?? [];
    expect(nodes[0]).toEqual({
      type: "text",
      text: "侧网络",
      marks: [{ type: "annotation", attrs: { note: "只更新这一支" } }],
    });
    expect(nodes.find((node) => node.type === "mathInline")).toEqual({
      type: "mathInline",
      attrs: {
        latex: "\\note{\\epsilon_\\theta}{去噪网络的噪声估计}",
        display: false,
      },
    });
    expect(nodes.map((node) => node.text ?? "").join("")).toContain(
      "[x] {y} 保持原样",
    );
    const html = renderToStaticMarkup(
      createElement(RichText, {
        data: { content: doc, format: "richtext" },
        readOnly: true,
      }),
    );
    expect(html).toContain(
      '<span class="showai-note" data-showai-note="只更新这一支" tabindex="0">侧网络</span>',
    );
    expect(html).toContain('data-showai-note="去噪网络的噪声估计"');
    expect(() =>
      validateRichTextData({
        format: "richtext",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "a", marks: [{ type: "annotation" }] },
              ],
            },
          ],
        },
      }),
    ).toThrow(/note/);
  });
  it("imports ==highlight== and every heading level as valid page content", () => {
    const doc = markdownToRichText(
      "#### 四级标题\n\n读 ==重点 **加粗**== 时，a == b 与 `==代码==` 保持原样。",
    );
    getSchema(createExtensions()).nodeFromJSON(doc).check();
    expect(doc.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 4 },
    });
    const texts = doc.content?.[1].content ?? [];
    expect(
      texts.filter((n) => n.marks?.some((m) => m.type === "highlight")),
    ).toEqual([
      { type: "text", text: "重点 ", marks: [{ type: "highlight" }] },
      {
        type: "text",
        text: "加粗",
        marks: [{ type: "highlight" }, { type: "bold" }],
      },
    ]);
    const plain = texts.map((n) => n.text).join("");
    expect(plain).toContain("a == b");
    expect(texts.find((n) => n.text === "==代码==")?.marks).toEqual([
      { type: "code" },
    ]);
    expect(() =>
      validateDocument({ ...blankDocument(), content: doc }),
    ).not.toThrow();
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
    expect(compiled.inline!.script.length).toBeLessThan(2200000);
  }, 60000);

  it("parses CJK-adjacent bold around annotations, links, quotes and masked inline extensions without regressing CommonMark rules", () => {
    const schema = getSchema(createExtensions());
    const prose = markdownToRichText(
      [
        "A2UI 是面向 AI Agent 的**[服务端驱动 UI]{由服务端声明组件结构}传输协议**，支持**“渐进渲染”**与**[官方文档](https://example.org/a**b)**验证。",
        "补充罕见汉字 𠀀**[词条]{解释}**𠀀、括号（**重点**）、嵌套 **外层（**内层**）**、以及 *中文**， 与 foo_bar_baz 和 a**b**c。",
        "内部含星号：**[术语]{注：a**b 与 a * b}后文**、**前 $a**b$ 后**、**前 \\(c**d\\) 后**、**前 `code $a**b$` 后**。",
        "| 维度 | 说明 |\n| --- | --- |\n| 协议 | 的**[服务端驱动 UI]{表内注释}**支持 |",
      ].join("\n\n"),
    );
    schema.nodeFromJSON(prose).check();
    expect(() =>
      validateDocument({ ...blankDocument(), content: prose }),
    ).not.toThrow();

    const p0 = prose.content?.[0].content ?? [];
    expect(p0.map((n) => n.text).join("")).not.toContain("**");
    expect(p0).toContainEqual({
      type: "text",
      text: "服务端驱动 UI",
      marks: [
        { type: "bold" },
        { type: "annotation", attrs: { note: "由服务端声明组件结构" } },
      ],
    });
    expect(p0).toContainEqual({
      type: "text",
      text: "传输协议",
      marks: [{ type: "bold" }],
    });
    expect(p0).toContainEqual({
      type: "text",
      text: "“渐进渲染”",
      marks: [{ type: "bold" }],
    });
    expect(p0).toContainEqual({
      type: "text",
      text: "官方文档",
      marks: [
        { type: "bold" },
        { type: "link", attrs: { href: "https://example.org/a**b" } },
      ],
    });

    const p1 = prose.content?.[1].content ?? [];
    expect(p1).toContainEqual({
      type: "text",
      text: "词条",
      marks: [
        { type: "bold" },
        { type: "annotation", attrs: { note: "解释" } },
      ],
    });
    expect(p1).toContainEqual({
      type: "text",
      text: "中文",
      marks: [{ type: "italic" }],
    });
    expect(p1.map((n) => n.text).join("")).toContain("*，");
    expect(p1.map((n) => n.text).join("")).toContain("foo_bar_baz");

    const p2 = prose.content?.[2].content ?? [];
    expect(p2).toContainEqual({
      type: "text",
      text: "术语",
      marks: [
        { type: "bold" },
        { type: "annotation", attrs: { note: "注：a**b 与 a * b" } },
      ],
    });
    expect(
      p2.filter((n) => n.type === "mathInline").map((n) => n.attrs?.latex),
    ).toEqual(["a**b", "c**d"]);
    expect(p2).toContainEqual({
      type: "text",
      text: "code $a**b$",
      marks: [{ type: "code" }],
    });

    const tableCell =
      prose.content?.[3].content?.[1].content?.[1].content?.[0].content ?? [];
    expect(tableCell.map((n) => n.text).join("")).not.toContain("**");
    expect(tableCell).toContainEqual({
      type: "text",
      text: "服务端驱动 UI",
      marks: [
        { type: "bold" },
        { type: "annotation", attrs: { note: "表内注释" } },
      ],
    });
  });
});
