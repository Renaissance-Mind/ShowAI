import { conflictDisplayValue } from "./conflict-content";
import { parseArtifact, validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "../types";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import recoveryMessages from "../i18n/messages/recovery";

export default function ConflictPagePreview({
  value,
}: {
  value: ShowDocument | string | null;
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
            {conflictDisplayValue(document.content, "", document) ||
              t("emptyPage")}
          </p>
        </>
      ) : (
        <p>{invalid ? t("invalidFile") : t("pageMissing")}</p>
      )}
    </section>
  );
}
