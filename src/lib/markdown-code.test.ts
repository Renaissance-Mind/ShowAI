import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { renderMarkdownCode } from "./markdown-code";

function render(source: string) {
  const renderer = new marked.Renderer();
  renderer.code = renderMarkdownCode;
  return marked.parser(marked.lexer(source), { renderer, async: false });
}

describe("Markdown code import", () => {
  it("does not invent a blank line after a one-line or multiline command", () => {
    expect(render("```sh\necho one\n```")).toBe(
      '<pre><code class="language-sh">echo one</code></pre>\n',
    );
    expect(render("```sh\necho one\necho two\n```")).toContain(
      "echo one\necho two</code>",
    );
  });
  it("preserves intentional leading, interior and trailing blank lines", () => {
    expect(render("```sh\n\necho one\n\necho two\n\n\n```")).toContain(
      ">\necho one\n\necho two\n\n</code>",
    );
  });
  it("keeps code literal and applies to nested code fences", () => {
    expect(render('```html\n<script>"&"</script>\n```')).toContain(
      "&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;</code>",
    );
    expect(render("> ```sh\n> echo nested\n> ```")).toContain(
      'class="language-sh">echo nested</code>',
    );
    expect(render("use `inline` code")).toBe(
      "<p>use <code>inline</code> code</p>\n",
    );
  });
});
