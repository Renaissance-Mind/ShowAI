import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { PageMergeConflict } from "../core/page-merge";

const textTypes = new Set([
  "doc",
  "surface",
  "text",
  "paragraph",
  "heading",
  "hardBreak",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

/** Only unwrap known rich text. Arbitrary component data must remain inspectable. */
export function conflictText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (!value.length) return "";
    const parts = value.map(conflictText);
    if (parts.some((part) => part === null)) return null;
    return parts.join(
      value.every((item) => item?.type === "text" || item?.type === "hardBreak")
        ? ""
        : "\n",
    );
  }
  if (!value || typeof value !== "object") return null;
  const node = value as JSONContent;
  if (!textTypes.has(node.type ?? "")) return null;
  if (node.type === "text")
    return typeof node.text === "string" ? node.text : null;
  if (node.type === "hardBreak") return "\n";
  return conflictText(node.content ?? []);
}

export function conflictNodeLabel(
  conflict: PageMergeConflict,
  documents: ShowDocument[],
): string | null {
  const id = conflict.path.startsWith("/nodes/")
    ? conflict.path.split("/")[2]
    : null;
  if (!id) return null;
  const find = (node: JSONContent): JSONContent | undefined =>
    node.attrs?.id === id ? node : node.content?.map(find).find(Boolean);
  for (const document of documents) {
    const node = find(document.content);
    if (!node) continue;
    const label =
      node.attrs?.name ||
      conflictText(node) ||
      conflictText(node.attrs?.data?.content);
    if (typeof label === "string" && label.trim())
      return label.trim().replace(/\s+/g, " ").slice(0, 44);
  }
  return null;
}
