import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { parseMarkdown } from "../lib/markdown";
export default function TemplateOutline({
  document,
}: {
  document: ShowDocument;
}) {
  const titles: string[] = [];
  const text = (node: JSONContent): string =>
    node.text ?? node.content?.map(text).join("") ?? "";
  const visit = (node: JSONContent) => {
    if (node.type === "heading") {
      const title = text(node).trim();
      if (title && !titles.includes(title)) titles.push(title);
    }
    node.content?.forEach(visit);
    const content = node.attrs?.data?.content;
    if (typeof content === "string") visit(parseMarkdown(content));
    else if (content?.type === "doc") visit(content);
  };
  visit(document.content);
  return titles.length ? (
    <ol className="catalog-outline">
      {titles.slice(0, 8).map((title) => (
        <li key={title}>{title}</li>
      ))}
    </ol>
  ) : (
    <p>{document.title || "页面内容"}</p>
  );
}
