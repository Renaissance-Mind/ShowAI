import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { parseMarkdown } from "../lib/markdown";
import { walk } from "../document/walk.mjs";

const text = (node: JSONContent): string =>
  node.text ?? node.content?.map(text).join("") ?? "";

export function templateHeadings(document: ShowDocument): string[] {
  const titles: string[] = [];
  const collect = (root: JSONContent) =>
    walk(root, (node) => {
      if (node.type === "heading") {
        const title = text(node).trim();
        if (title && !titles.includes(title)) titles.push(title);
      }
      const content = node.attrs?.data?.content;
      if (typeof content === "string") collect(parseMarkdown(content));
    }, { scope: "content" });
  collect(document.content);
  return titles;
}
