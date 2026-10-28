import type { JSONContent } from "@tiptap/core";
import { validateRichTextData } from "../components/rich-text/model.mjs";
import { isPlainObject } from "../datasets/operations.mjs";
import { CoreError } from "./model";

export const DATABASE_INTRODUCTION_MAX_BYTES = 256 * 1024;

const inline = new Set(["text", "hardBreak", "mathInline"]);
const blocks = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
  "horizontalRule",
  "image",
  "table",
  "callout",
  "toggle",
  "stepper",
  "mathBlock",
]);

/** A bounded native document, rather than arbitrary component data or HTML. */
export function validateProjectDatabaseIntroduction(
  value: unknown,
): JSONContent {
  try {
    let entries = 0,
      characters = 0;
    const json = (item: unknown, depth = 0): void => {
      if (++entries > 32000 || depth > 64)
        throw new Error(
          "Database introduction is too deeply nested or complex.",
        );
      if (typeof item === "string") characters += item.length;
      else if (Array.isArray(item))
        for (const child of item) json(child, depth + 1);
      else if (isPlainObject(item)) {
        for (const [key, child] of Object.entries(item)) {
          if (["__proto__", "constructor", "prototype"].includes(key))
            throw new Error("Database introduction contains a reserved key.");
          characters += key.length;
          json(child, depth + 1);
        }
      } else if (
        item !== null &&
        typeof item !== "boolean" &&
        !(typeof item === "number" && Number.isFinite(item))
      )
        throw new Error("Database introduction must contain only JSON.");
      if (characters > DATABASE_INTRODUCTION_MAX_BYTES)
        throw new Error("Database introduction exceeds 256 KiB.");
    };
    json(value);
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      DATABASE_INTRODUCTION_MAX_BYTES
    )
      throw new Error("Database introduction exceeds 256 KiB.");
    if (!isPlainObject(value))
      throw new Error("Database introduction must be a rich-text document.");
    validateRichTextData({ format: "richtext", content: value });
    const visit = (node: JSONContent, root = false): void => {
      const type = node.type!;
      if (
        Object.keys(node).some(
          (key) => !["type", "text", "attrs", "marks", "content"].includes(key),
        ) ||
        (node.attrs !== undefined && !isPlainObject(node.attrs)) ||
        (node.marks !== undefined && !Array.isArray(node.marks)) ||
        (root
          ? type !== "doc"
          : !blocks.has(type) &&
            !inline.has(type) &&
            ![
              "listItem",
              "taskItem",
              "tableRow",
              "tableHeader",
              "tableCell",
              "step",
            ].includes(type))
      )
        throw new Error(
          "Invalid native rich-text node in database introduction.",
        );
      for (const mark of node.marks ?? []) {
        if (
          !isPlainObject(mark) ||
          Object.keys(mark).some((key) => !["type", "attrs"].includes(key)) ||
          (mark.attrs !== undefined && !isPlainObject(mark.attrs))
        )
          throw new Error(
            "Invalid rich-text formatting in database introduction.",
          );
      }
      const children = node.content ?? [];
      const all = (types: Set<string>) =>
        children.every((child) => types.has(child.type!));
      const leaf =
        inline.has(type) ||
        ["horizontalRule", "image", "mathBlock"].includes(type);
      const level = node.attrs?.level;
      if (
        (type === "text"
          ? !node.text || children.length > 0
          : node.text !== undefined) ||
        (leaf && children.length > 0) ||
        (["paragraph", "heading"].includes(type) && !all(inline)) ||
        (type === "codeBlock" && !all(new Set(["text"]))) ||
        ([
          "doc",
          "blockquote",
          "listItem",
          "taskItem",
          "tableCell",
          "tableHeader",
          "callout",
          "toggle",
          "step",
        ].includes(type) &&
          !all(blocks)) ||
        (["bulletList", "orderedList"].includes(type) &&
          !all(new Set(["listItem"]))) ||
        (type === "taskList" && !all(new Set(["taskItem"]))) ||
        (type === "table" && !all(new Set(["tableRow"]))) ||
        (type === "tableRow" && !all(new Set(["tableCell", "tableHeader"]))) ||
        (type === "stepper" && !all(new Set(["step"]))) ||
        (!["doc", "paragraph", "heading", "codeBlock"].includes(type) &&
          !leaf &&
          children.length === 0) ||
        (["listItem", "taskItem"].includes(type) &&
          children[0]?.type !== "paragraph") ||
        (type === "heading" &&
          (typeof level !== "number" ||
            !Number.isInteger(level) ||
            level < 1 ||
            level > 6))
      )
        throw new Error(
          "Invalid rich-text content structure in database introduction.",
        );
      children.forEach((child) => visit(child));
    };
    visit(value as JSONContent, true);
    return value as JSONContent;
  } catch (error) {
    throw new CoreError(
      "INVALID_DATA",
      error instanceof Error ? error.message : String(error),
    );
  }
}
