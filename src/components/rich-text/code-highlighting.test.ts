import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  codeHighlighter,
  codeLanguages,
  highlightCode,
} from "./code-highlighting";
import { RichTextNode } from "./RichTextView";
import { markdownToRichText } from "./model.mjs";
import {
  parseArtifact,
  serializeArtifact,
} from "../../portable/validation.mjs";
import { blankDocument } from "../../core/catalog";
import { Editor } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { HighlightedCodeBlock } from "./code-block";
import { loadCodeHighlighter } from "./HighlightedCode";

function render(code: string, language?: string | null) {
  return renderToStaticMarkup(
    createElement(RichTextNode, {
      node: {
        type: "codeBlock",
        attrs: { language },
        content: [{ type: "text", text: code }],
      },
    }),
  );
}

// Runs before the grammars load: readers show the code itself, then color it.
it("renders code as plain text until the highlighter loads", async () => {
  const code = 'const html = "<b>bold</b>";';
  const before = render(code, "javascript");
  expect(before).not.toContain("hljs-");
  expect(before).toContain("const html = &quot;&lt;b&gt;bold&lt;/b&gt;&quot;;");
  await loadCodeHighlighter();
  expect(render(code, "javascript")).toContain("hljs-string");
});

describe("code syntax highlighting", () => {
  beforeAll(() => loadCodeHighlighter());
  it("refreshes unselected blocks on language and text changes and maps offsets through surrounding edits", () => {
    const editor = new Editor({
      element: null,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        HighlightedCodeBlock,
      ],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Outside" }] },
          {
            type: "codeBlock",
            attrs: { language: "plaintext" },
            content: [{ type: "text", text: 'const message = "hello";' }],
          },
        ],
      },
    });
    let state = EditorState.create({
      schema: editor.schema,
      doc: editor.state.doc,
      plugins: editor.extensionManager.plugins,
    });
    const decorations = () =>
      state.plugins.flatMap((plugin) => {
        const value = plugin.props.decorations?.call(plugin, state);
        return value instanceof DecorationSet ? value.find() : [];
      });
    expect(state.selection.$head.parent.type.name).toBe("paragraph");
    const position = state.doc.firstChild!.nodeSize;
    expect(decorations()).toHaveLength(0);
    state = state.apply(state.tr.setNodeAttribute(position, "language", "JS"));
    expect(decorations().length).toBeGreaterThan(0);
    expect(state.selection.$head.parent.type.name).toBe("paragraph");
    const first = decorations()[0].from;
    state = state.apply(state.tr.insertText("prefix ", 1));
    expect(decorations()[0].from).toBe(first + 7);
    const moved = position + 7;
    state = state.apply(state.tr.insertText("// note\n", moved + 1));
    expect(decorations()[0].from).toBe(moved + 1);
    expect(decorations()[0].to).toBe(moved + 8);
    const count = decorations().length;
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, moved + 2)),
    );
    expect(decorations()).toHaveLength(count);
    state = state.apply(
      state.tr.setNodeAttribute(moved, "language", "unknown"),
    );
    expect(decorations()).toHaveLength(0);
    expect(state.doc.nodeAt(moved)!.textContent).toBe(
      '// note\nconst message = "hello";',
    );
    expect(JSON.stringify(state.doc.toJSON())).not.toContain("hljs-");
    editor.destroy();
  });
  it.each([
    ["javascript", '// comment\nconst message = "hello";'],
    ["python", '# comment\ndef greet():\n    return "hello"'],
    ["typescript", '// comment\nconst message: string = "hello";'],
    ["sql", "-- comment\nSELECT 'hello' FROM messages;"],
    ["bash", '# comment\nif true; then echo "hello"; fi'],
  ])("colors keywords, strings and comments in %s", (language, code) => {
    const html = render(code, language);
    for (const token of ["keyword", "string", "comment"]) {
      expect(html).toContain(`hljs-${token}`);
    }
    expect(codeHighlighter.highlight(language, code)).toEqual(
      highlightCode(code, language),
    );
  });

  it.each(["js", "JS", " JavaScript ", "javascript title=example.js"])(
    "resolves %s consistently",
    (language) => {
      const code = 'const message = "hello";';
      expect(highlightCode(code, language).children).toEqual(
        highlightCode(code, "javascript").children,
      );
      expect(codeHighlighter.registered(language)).toBe(true);
    },
  );

  it.each([undefined, null, "", "plaintext", "text", "txt", "not-a-language"])(
    "keeps %s as plain text",
    (language) => {
      const code = '// comment\nconst message = "hello";\n';
      expect(highlightCode(code, language).children).toEqual([
        { type: "text", value: code },
      ]);
      expect(render(code, language)).not.toContain("hljs-");
      expect(codeHighlighter.highlightAuto(code).children).toEqual(
        highlightCode(code, language).children,
      );
    },
  );

  it("supports all offered languages, HTML aliases, TSX and empty code", () => {
    for (const language of codeLanguages)
      expect(() => highlightCode("", language)).not.toThrow();
    expect(render('<div class="example">hello</div>', "html")).toContain(
      "hljs-tag",
    );
    expect(render('const view = <div title="hello" />;', "tsx")).toContain(
      "hljs-keyword",
    );
    expect(render('{"count": 42, "active": true}', "json")).toContain(
      "hljs-number",
    );
  });

  it("keeps nested template expression keywords independent of the outer string", () => {
    const html = render(
      'const message = `value: ${true ? "yes" : "no"}`;',
      "javascript",
    );
    expect(html).toContain('<span class="hljs-literal">true</span>');
    expect(html).toContain('<span class="hljs-string">&quot;yes&quot;</span>');
    expect(html).not.toContain('class="hljs-string hljs-subst');
  });

  it("escapes HTML and preserves source through Markdown import and artifact save", () => {
    const code =
      '// 中文 😀\nconst html = "<script>alert(1)</script> &";\n\treturn html;';
    const document = blankDocument();
    document.content = markdownToRichText("```js\n" + code + "\n```");
    const saved = parseArtifact(serializeArtifact(document)).document;
    expect(saved.content.content![0].content).toEqual([
      { type: "text", text: code },
    ]);
    const html = renderToStaticMarkup(
      createElement(RichTextNode, { node: saved.content }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("hljs-string");
    expect(JSON.stringify(saved)).not.toContain("hljs-");
  });
});
