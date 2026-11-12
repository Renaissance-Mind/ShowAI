import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { parseMarkdown } from "../lib/markdown";
import { walk } from "../document/walk.mjs";

const text = (node: JSONContent): string =>
  node.text ?? node.content?.map(text).join("") ?? "";

/** Distinct heading titles of a template, including those inside component
 * rich text (text blocks, callout and toggle bodies, stepper steps). */
export function templateHeadings(document: ShowDocument): string[] {
  const titles: string[] = [];
  const collect = (root: JSONContent) =>
    walk(root, (node) => {
      if (node.type === "heading") {
        const title = text(node).trim();
        if (title && !titles.includes(title)) titles.push(title);
      }
      // A text block may still keep its body as Markdown source.
      const content = node.attrs?.data?.content;
      if (typeof content === "string") collect(parseMarkdown(content));
    }, { scope: "content" });
  collect(document.content);
  return titles;
}
