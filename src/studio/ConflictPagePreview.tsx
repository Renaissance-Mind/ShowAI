import { parseArtifact, validateDocument } from "../portable/validation.mjs";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";

function readable(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image")
    return `[图片${node.attrs?.alt ? `：${node.attrs.alt}` : ""}]`;
  if (node.type === "widget") {
    const data = node.attrs?.data;
    if (data?.kind === "text" && typeof data.text === "string")
      return data.text;
    return `[组件内容${node.attrs?.name ? `：${node.attrs.name}` : "，可返回页面检查"}]`;
  }
  const separator = ["paragraph", "heading", "codeBlock"].includes(
    node.type ?? "",
  )
    ? ""
    : "\n";
  return (node.content ?? []).map(readable).join(separator);
}
export default function ConflictPagePreview({
  value,
}: {
  value: ShowDocument | string | null;
}) {
  let document: ShowDocument | null = null;
  let invalid = false;
  if (value !== null) {
    try {
      const input = typeof value === "string" ? JSON.parse(value) : value;
      document =
        input?.format === "showai"
          ? parseArtifact(input).document
          : validateDocument(input);
    } catch {
      invalid = true;
    }
  }
  return (
    <section>
      {document ? (
        <>
          <strong>{document.title || "无标题"}</strong>
          <p
            style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}
          >
            {readable(document.content) || "空页面"}
          </p>
        </>
      ) : (
        <p>
          {invalid ? "文件格式有问题，请修复后保存。" : "此版本中没有该页面。"}
        </p>
      )}
      <details>
        <summary>查看原始页面数据</summary>
        <pre style={{ maxHeight: 320, overflow: "auto" }}>
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </pre>
      </details>
    </section>
  );
}
