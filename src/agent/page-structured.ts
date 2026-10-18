import { richTextDocument } from "../components/rich-text/model.mjs";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
export interface OutlineItem {
  id?: string;
  type: string;
  title: string;
  depth: number;
  kind?: string;
}

function text(node: JSONContent): string {
  return node.text ?? (node.content ?? []).map(text).join("");
}

function markdownText(node: JSONContent): string {
  if (node.type === "mathInline") return `$${node.attrs?.latex ?? ""}$`;
  if (node.type !== "text")
    return (node.content ?? []).map(markdownText).join("");
  let value = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "link") value = `[${value}](${mark.attrs?.href ?? ""})`;
    else if (mark.type === "bold") value = `**${value}**`;
    else if (mark.type === "italic") value = `*${value}*`;
    else if (mark.type === "strike") value = `~~${value}~~`;
    else if (mark.type === "code")
      value = `\`${value.replaceAll("`", "\\`")}\``;
  }
  return value;
}

export function structuredContent(document: ShowDocument) {
  const outline: OutlineItem[] = [];
  const lines = [`# ${document.title}`, ""];
  function visit(node: JSONContent, depth: number) {
    const attrs = node.attrs ?? {};
    if (node.type === "text") return;
    const kind = node.type === "widget" ? String(attrs.kind ?? "") : undefined;
    const title =
      node.type === "surface" || node.type === "region"
        ? String(attrs.name ?? attrs.title ?? "")
        : node.type === "widget"
          ? String(attrs.data?.props?.title ?? attrs.data?.title ?? kind)
          : text(node);
    if (attrs.id)
      outline.push({
        id: attrs.id,
        type: node.type ?? "unknown",
        title: title.slice(0, 200),
        depth,
        ...(kind ? { kind } : {}),
      });
    if (node.type === "widget") {
      if (attrs.kind === "text") {
        if (typeof attrs.data?.content === "string")
          lines.push(attrs.data.content, "");
        else
          for (const child of richTextDocument(attrs.data ?? {}).content ?? [])
            visit(child, depth + 1);
        return;
      }
      lines.push(
        `### ${title || "组件"} [${attrs.id ?? ""}]`,
        "",
        "```json",
        JSON.stringify(
          attrs.kind === "custom"
            ? {
                componentId: attrs.data?.componentId,
                version: attrs.data?.version,
                props: attrs.data?.props,
              }
            : attrs.data,
          null,
          2,
        ),
        "```",
        "",
      );
      return;
    }
    if (node.type === "heading") {
      lines.push(
        `${"#".repeat(Math.min(6, Math.max(1, Number(attrs.level ?? 2))))} ${markdownText(node)}`,
        "",
      );
      return;
    }
    if (["paragraph", "codeBlock"].includes(node.type ?? "")) {
      lines.push(
        node.type === "codeBlock"
          ? `\`\`\`${attrs.language ?? ""}\n${text(node)}\n\`\`\``
          : markdownText(node),
        "",
      );
      return;
    }
    if (node.type === "mathBlock") {
      lines.push(`$$\n${attrs.latex ?? ""}\n$$`, "");
      return;
    }
    if (node.type === "image") {
      lines.push(
        `![${attrs.alt ?? "图片"}](${String(attrs.src ?? "").startsWith("data:") ? "embedded-image" : (attrs.src ?? "")})`,
        "",
      );
      return;
    }
    if (node.type === "table") {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          markdownText(cell).replaceAll("|", "\\|").replaceAll("\n", " "),
        ),
      );
      if (rows.length) {
        lines.push(
          `| ${rows[0].join(" | ")} |`,
          `| ${rows[0].map(() => "---").join(" | ")} |`,
          ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
          "",
        );
      }
      return;
    }
    if ((node.type === "surface" || node.type === "region") && title)
      lines.push(`${"#".repeat(Math.min(6, depth + 2))} ${title}`, "");
    if (node.type === "toggle")
      lines.push(`### ${attrs.title ?? "折叠内容"}`, "");
    if (node.type === "listItem" || node.type === "taskItem") {
      lines.push(
        `${node.type === "taskItem" ? `- [${attrs.checked ? "x" : " "}]` : "-"} ${markdownText(node)}`,
        "",
      );
      return;
    }
    for (const child of node.content ?? []) visit(child, depth + 1);
  }
  visit(document.content, 0);
  return { outline, markdown: lines.join("\n").trim() };
}
