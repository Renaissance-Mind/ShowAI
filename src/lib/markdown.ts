import { generateJSON, type JSONContent } from "@tiptap/core";
import { marked } from "marked";
import { mathMarkdown } from "../components/blocks/markdown-math.mjs";
import { createExtensions } from "../editor/extensions";
import { renderMarkdownCode } from "./markdown-code";

/** Convert GFM tasks and serialized widgets into the editor's native node format. */
export function parseMarkdown(source: string): JSONContent {
  // Keep math-bearing blocks as editable Markdown widgets. This preserves TeX source
  // through imports, saving and exports instead of flattening it into plain text.
  const renderer = new marked.Renderer();
  renderer.code = renderMarkdownCode;
  const tokens = mathMarkdown.lexer(source);
  const definitions = Object.entries(tokens.links)
    .map(
      ([id, link]) =>
        `[${id}]: <${link.href}>${link.title ? " " + JSON.stringify(link.title) : ""}`,
    )
    .join("\n");
  const html = tokens
    .map((token) => {
      let hasMath = false;
      mathMarkdown.walkTokens([token], (entry) => {
        if (entry.type === "mathBlock" || entry.type === "mathInline")
          hasMath = true;
      });
      if (!hasMath) return marked.parser([token], { async: false, renderer });
      const attrs = JSON.stringify({
        content: token.raw + (definitions ? "\n\n" + definitions : ""),
        format: "markdown",
      })
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;");
      return `<div data-showai-widget kind="text" data-widget-content="${attrs}"></div>`;
    })
    .join("");
  const dom = new DOMParser().parseFromString(html, "text/html");
  dom
    .querySelectorAll("script,style,iframe,object,embed")
    .forEach((node) => node.remove());
  dom.querySelectorAll<HTMLUListElement>("ul").forEach((list) => {
    const items = [...list.children].filter((child) => child.tagName === "LI");
    if (
      !items.some((item) =>
        item.querySelector(
          ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
        ),
      )
    )
      return;
    list.dataset.type = "taskList";
    items.forEach((item) => {
      const check = item.querySelector<HTMLInputElement>(
        ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
      );
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", String(check?.checked ?? false));
      check?.remove();
    });
  });
  dom.querySelectorAll("pre > code.language-showai-block").forEach((code) => {
    const attrs = JSON.parse(code.textContent ?? "{}");
    if (
      typeof attrs.kind !== "string" ||
      !attrs.data ||
      typeof attrs.data !== "object" ||
      Array.isArray(attrs.data)
    )
      throw new Error("showai-block 区块格式不正确");
    const block = dom.createElement("div");
    block.setAttribute("data-showai-widget", "");
    block.setAttribute("kind", attrs.kind);
    block.setAttribute("data-widget-content", JSON.stringify(attrs.data));
    code.parentElement!.replaceWith(block);
  });
  return generateJSON(dom.body.innerHTML, createExtensions());
}
