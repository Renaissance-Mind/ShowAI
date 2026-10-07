import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Widget } from "./Widget";
import { mathMarkdown } from "./markdown-math.mjs";
import { safeResourceUrl, validateResearchData } from "./research-contract.mjs";
import { validateDocument } from "../../portable/validation.mjs";

function markdown(content: string) {
  return renderToStaticMarkup(
    createElement(Widget, { kind: "text", data: { content }, readOnly: true }),
  );
}
describe("Markdown math and research resources", () => {
  it("renders both math delimiters, fractions, multiline display, tables and lists", () => {
    const html = markdown(
      "行内 $E=mc^2$ 与 \\(a_1\\)。\n\n$$\n\\frac{1}{2} + \\sum_{i=1}^n i\n$$\n\n\\[x^2\\]\n\n- $a+b$\n\n|变量|值|\n|---|---|\n|$x$|1|",
    );
    expect(html.match(/class="katex"/g)).toHaveLength(6);
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('encoding="application/x-tex"');
    expect(html).toContain("<table>");
    expect(html).toContain("<ul>");
  });
  it("preserves currency, escaped dollars and TeX inside code without math rendering", () => {
    const html = markdown(
      "价格 $20 和 $30。\\$x$；`$a+b$`\n\n```latex\n$$x^2$$\n```\n\n未结束 $x",
    );
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$20 和 $30");
    expect(html).toContain("$$x^2$$");
  });
  it("shows invalid TeX source and prevents trusted HTML/URL commands", () => {
    expect(markdown("$\\frac{$")).toContain("katex-error");
    const html = markdown(
      "$\\href{javascript:alert(1)}{click}$ $\\htmlClass{evil}{x}$",
    );
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('class="evil"');
  });
  it("keeps formulas as tokens and preserves local citation links", () => {
    const tokens = mathMarkdown.lexer("$a_1$\n\n$$\nb^2\n$$");
    expect(tokens.some((token) => token.type === "mathBlock")).toBe(true);
    expect(markdown("文献 [1](#ref-one)")).toContain('href="#ref-one"');
    expect(markdown("文献 [1](#ref-one)")).not.toContain('target="_blank"');
  });
  it("validates file types at both rendering and document-save boundaries", () => {
    for (const kind of ["video", "audio", "pdf"]) {
      expect(safeResourceUrl(kind, "javascript:alert(1)")).toBeUndefined();
      expect(
        safeResourceUrl(kind, "data:text/html;base64,AA=="),
      ).toBeUndefined();
      expect(() =>
        validateDocument({
          id: "resources",
          title: "resources",
          content: {
            type: "doc",
            content: [
              {
                type: "widget",
                attrs: { kind, data: { src: "data:text/html;base64,AA==" } },
              },
            ],
          },
        }),
      ).toThrow("文件");
    }
    expect(
      safeResourceUrl("audio", "data:audio/mpeg;base64,AA=="),
    ).toBeDefined();
    expect(
      safeResourceUrl("pdf", "data:application/pdf;base64,AA=="),
    ).toBeDefined();
    expect(
      safeResourceUrl("video", "data:audio/mpeg;base64,AA=="),
    ).toBeUndefined();
  });
  it("renders playable media and numbered citations without edit controls", () => {
    const video = renderToStaticMarkup(
      createElement(Widget, {
        kind: "video",
        data: { src: "data:video/mp4;base64,AA==", caption: "实验录像" },
        readOnly: true,
      }),
    );
    expect(video).toContain("<video");
    expect(video).toContain("controls");
    expect(video).toContain("实验录像");
    expect(video).not.toContain("编辑区块");
    const refs = renderToStaticMarkup(
      createElement(Widget, {
        kind: "references",
        data: {
          items: [
            {
              id: "one",
              title: "Actual paper",
              authors: "Author",
              year: "2026",
              doi: "10.1000/182",
            },
          ],
        },
        readOnly: true,
      }),
    );
    expect(refs).toContain('id="ref-one"');
    expect(refs).toContain("[1]");
    expect(refs).toContain('href="https://doi.org/10.1000/182"');
    expect(() =>
      validateResearchData("references", {
        items: [
          { id: "one", title: "Paper" },
          { id: "one", title: "Duplicate" },
        ],
      }),
    ).toThrow("id");
  });
});
