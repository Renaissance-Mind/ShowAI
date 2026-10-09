import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageContent } from "./PageContent";
import { validateDocument } from "./validation.mjs";
import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ReadingHighlight } from "../editor/reading-highlight";

const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (value: string): JSONContent => ({
  type: "paragraph",
  content: [text(value)],
});
function render(content: JSONContent[]) {
  const document = validateDocument({
    id: "reader-check",
    title: "Reader",
    content: { type: "doc", content },
  });
  return renderToStaticMarkup(
    createElement(PageContent, { content: document.content }),
  );
}

describe("portable read-only content", () => {
  it("retains the selected highlight colour in editor and exported markup", () => {
    const schema = getSchema([
      StarterKit,
      ReadingHighlight.configure({ multicolor: true }),
    ]);
    const colour = "#f8c9dd";
    const mark = schema.marks.highlight.create({ color: colour });
    const output = schema.marks.highlight.spec.toDOM!(mark, true) as [
      string,
      Record<string, string>,
      number,
    ];
    expect(output[0]).toBe("mark");
    expect(output[1]["data-color"]).toBe(colour);
    expect(output[1].style).toBe(`--showai-highlight-color: ${colour}`);
    const html = render([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "保留所选颜色", marks: [mark.toJSON()] },
        ],
      },
    ]);
    expect(html).toContain(`data-color="${colour}"`);
    expect(html).toContain(`--showai-highlight-color:${colour}`);
    expect(html).not.toContain("background-color:");
  });

  it("preserves all supported inline formats, line breaks, block alignment and escaped content", () => {
    const html = render([
      {
        type: "heading",
        attrs: { level: 2, id: "finding", textAlign: "center" },
        content: [text("Finding")],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "<script>alert(1)</script>",
            marks: [
              { type: "bold" },
              { type: "italic" },
              { type: "underline" },
              { type: "strike" },
              { type: "highlight", attrs: { color: "#ffeedd" } },
              { type: "link", attrs: { href: "https://example.com/source" } },
            ],
          },
          { type: "hardBreak" },
          { type: "text", text: "value", marks: [{ type: "code" }] },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "javascript" },
        content: [text('const html = "<p>";')],
      },
      { type: "horizontalRule" },
    ]);
    expect(html).toContain(
      '<h2 id="finding" data-block-id="finding" style="text-align:center">Finding</h2>',
    );
    for (const tag of [
      "strong",
      "em",
      "u",
      "s",
      "mark",
      "a",
      "code",
      "br",
      "hr",
      "pre",
    ])
      expect(html).toContain(`<${tag}`);
    expect(html).toContain("--showai-highlight-color:#ffeedd");
    expect(html).toContain('data-color="#ffeedd"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="language-javascript"');
  });

  it("renders structured lists, read-only tasks, callouts, toggles and image sizing", () => {
    const html = render([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph("Bullet"),
              {
                type: "orderedList",
                attrs: { start: 3, type: "A" },
                content: [{ type: "listItem", content: [paragraph("Nested")] }],
              },
            ],
          },
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [paragraph("Done")],
          },
        ],
      },
      { type: "blockquote", content: [paragraph("Evidence")] },
      {
        type: "callout",
        attrs: { tone: "blue", icon: "🔎" },
        content: [paragraph("Context")],
      },
      {
        type: "toggle",
        attrs: { title: "Details", open: true },
        content: [paragraph("Expanded finding")],
      },
      {
        type: "image",
        attrs: {
          src: "data:image/png;base64,YQ==",
          alt: "Description",
          width: 320,
          height: 180,
          align: "right",
        },
      },
    ]);
    expect(html).toContain('<ol start="3" type="A">');
    expect(html).toMatch(
      /<input[^>]*type="checkbox"[^>]*disabled=""[^>]*checked=""/,
    );
    expect(html).toContain('class="portable-callout tone-blue"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('class="portable-toggle" open=""');
    expect(html).toContain("<summary>Details</summary>");
    expect(html).toContain(
      "width:320px;height:180px;margin-left:auto;margin-right:0",
    );
    expect(html).toContain('alt="Description"');
  });

  it("keeps table column widths, row/column spans and cell formatting", () => {
    const html = render([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: {
                  colspan: 2,
                  rowspan: 1,
                  colwidth: [140, 160],
                  backgroundColor: "#eef4ea",
                },
                content: [paragraph("Comparison")],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { rowspan: 2, colspan: 1 },
                content: [paragraph("Method A")],
              },
              { type: "tableCell", content: [paragraph("Value")] },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain(
      '<colgroup><col style="width:140px"/><col style="width:160px"/></colgroup>',
    );
    expect(html).toContain('colSpan="2" rowSpan="1"');
    expect(html).toContain('colSpan="1" rowSpan="2"');
    expect(html).toContain("background-color:#eef4ea");
    expect(html).toContain("<tbody>");
  });
});
