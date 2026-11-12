import { translator } from "../i18n";
import recoveryMessages from "../i18n/messages/recovery";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { PageMergeConflict } from "../core/page-merge";
import { walk } from "../document/walk.mjs";

/** Merge conflicts name nodes of the page tree. */
function treeNode(root: JSONContent, id: string): JSONContent | undefined {
  let found: JSONContent | undefined;
  walk(root, (node) => {
    if (!found && node.attrs?.id === id) found = node;
  }, { scope: "tree" });
  return found;
}

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
  for (const document of documents) {
    const node = treeNode(document.content, id);
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

/** Present source values as user content, never as serialized application state. */
export function conflictDisplayValue(
  value: unknown,
  path: string,
  document: ShowDocument,
): string {
  const t = translator(recoveryMessages);
  const nodeName = (id: unknown, index: number) => {
    const node =
      typeof id === "string" ? treeNode(document.content, id) : undefined;
    return (
      node?.attrs?.name ||
      (node && conflictText(node)?.trim().split("\n")[0]) ||
      t("unnamedContent", { number: index + 1 })
    );
  };
  if (path.endsWith("/order") || path.endsWith("/readingOrder"))
    return Array.isArray(value)
      ? value
          .map((id, index) => `${index + 1}. ${nodeName(id, index)}`)
          .join("\n") || t("emptyPage")
      : t("missingInVersion");
  if (
    path === "/root" ||
    path.endsWith("/parent") ||
    path.endsWith("/parentId")
  )
    return value == null ? t("pageRootLocation") : nodeName(value, 0);

  const readable = (input: unknown): string => {
    if (input === undefined) return t("missingInVersion");
    if (input === null) return t("notSet");
    if (typeof input === "boolean")
      return t(input ? "settingEnabled" : "settingDisabled");
    if (typeof input === "number") return String(input);
    if (typeof input === "string")
      return /^data:image\//.test(input)
        ? t("image")
        : input || t("emptyContent");
    const text = conflictText(input);
    if (text !== null) return text || t("emptyContent");
    if (Array.isArray(input)) return input.map(readable).join("\n");
    if (typeof input !== "object") return t("componentContent");
    const object = input as Record<string, unknown>;
    const node = input as JSONContent;
    if (node.type === "image")
      return node.attrs?.alt
        ? t("imageNamed", { alt: node.attrs.alt })
        : t("image");
    if (node.type === "widget") {
      const data = node.attrs?.data;
      const content = data?.content ?? data?.text;
      return [
        node.attrs?.name,
        content !== undefined ? readable(content) : t("componentContent"),
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (object.node) return readable(object.node);
    if (node.content) return readable(node.content);
    const content = [
      "title",
      "name",
      "label",
      "text",
      "description",
      "caption",
      "value",
      "items",
    ]
      .filter((key) => Object.hasOwn(object, key))
      .map((key) => readable(object[key]));
    return content.length ? content.join("\n") : t("componentContent");
  };
  return readable(value);
}
