import { parseArtifact, validateDocument } from "../portable/validation.mjs";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import recoveryMessages from "../i18n/messages/recovery";

const translate = translator(recoveryMessages);

function readable(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image")
    return node.attrs?.alt
      ? translate("imageNamed", { alt: node.attrs.alt })
      : translate("image");
  if (node.type === "widget") {
    const data = node.attrs?.data;
    if (data?.kind === "text" && typeof data.text === "string")
      return data.text;
    return node.attrs?.name
      ? translate("componentNamed", { name: node.attrs.name })
      : translate("componentContent");
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
  expandContent = false,
}: {
  value: ShowDocument | string | null;
  expandContent?: boolean;
}) {
  const t = useTranslator(recoveryMessages);
  const tc = useTranslator(commonMessages);
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
          <strong>{document.title || tc("untitled")}</strong>
          <p
            style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}
          >
            {readable(document.content) || t("emptyPage")}
          </p>
        </>
      ) : (
        <p>{invalid ? t("invalidFile") : t("pageMissing")}</p>
      )}
      {expandContent ? (
        <section className="conflict-raw-data">
          <h4>{t("rawData")}</h4>
          <pre style={{ maxHeight: 320, overflow: "auto" }}>
            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          </pre>
        </section>
      ) : (
        <details>
          <summary>{t("viewRawData")}</summary>
          <pre style={{ maxHeight: 320, overflow: "auto" }}>
            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
