import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  matchNote,
  noteSegments,
  outerLatexNote,
  plainNotes,
  prepareNoteLatex,
  textNotes,
} from "./note-markup.mjs";
import { mathHtml } from "./markdown-math.mjs";
import { NoteText } from "./NoteText";
import { noteHtml } from "./note-bubble";

describe("hover notes", () => {
  it("parses [label]{note} with formulas and balanced braces", () => {
    expect(matchNote("[$x_t$]{第 t 步的 $\\bar{\\alpha}_t$} 后文")).toEqual({
      raw: "[$x_t$]{第 t 步的 $\\bar{\\alpha}_t$}",
      label: "$x_t$",
      note: "第 t 步的 $\\bar{\\alpha}_t$",
      end: 32,
    });
    expect(noteSegments("用 [CFG]{分类器无关引导} 生成")).toEqual([
      { type: "text", text: "用 " },
      { type: "note", text: "CFG", note: "分类器无关引导" },
      { type: "text", text: " 生成" },
    ]);
    expect(plainNotes("[a]{b}、[c](https://x.dev)")).toBe(
      "a、[c](https://x.dev)",
    );
    expect(textNotes("[a]{b} [c]{d}")).toEqual([
      { text: "a", note: "b" },
      { text: "c", note: "d" },
    ]);
  });

  it("leaves ordinary brackets, links and unbalanced notes as text", () => {
    for (const source of [
      "[x] {y}",
      "[x](y)",
      "[x]{}",
      "[x]{a",
      "\\[x]{y}",
      "[a\nb]{c}",
    ])
      expect(noteSegments(source), source).toEqual([
        { type: "text", text: source },
      ]);
  });

  it("annotates parts of a formula through \\note", () => {
    const { latex, notes } = prepareNoteLatex(
      "\\note{x_t}{带噪潜变量, 含逗号} = \\note {\\epsilon} {噪声 $\\epsilon$}",
    );
    expect(latex).toBe(
      "\\htmlData{showai-note=0}{x_t} = \\htmlData{showai-note=1}{\\epsilon}",
    );
    expect(notes).toEqual(["带噪潜变量, 含逗号", "噪声 $\\epsilon$"]);
    const html = mathHtml("\\note{x_t}{带噪潜变量, 含逗号} + y");
    expect(html).toContain(
      'data-showai-note="带噪潜变量, 含逗号" tabindex="0"',
    );
    expect(html).not.toContain("katex-error");
    expect(prepareNoteLatex("\\notequal{a}").latex).toBe("\\notequal{a}");
    expect(outerLatexNote("\\note{a+b}{和}")).toEqual({
      body: "a+b",
      note: "和",
    });
    expect(outerLatexNote("\\note{a}{b} + c")).toBeNull();
  });

  it("does not let other \\htmlData attributes through without a note", () => {
    expect(mathHtml("\\htmlData{x=1}{a}")).not.toContain('data-x="1"');
  });

  it("renders annotated text and escapes note bubbles", () => {
    expect(
      renderToStaticMarkup(createElement(NoteText, { text: "看 [ρ]{比值}" })),
    ).toBe(
      '看 <span class="showai-note" data-showai-note="比值" tabindex="0">ρ</span>',
    );
    const bubble = noteHtml("<b>x</b> 等于 $\\alpha$\n第二行");
    expect(bubble).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(bubble).toContain("katex");
    expect(bubble).toContain("<br>");
  });
});
