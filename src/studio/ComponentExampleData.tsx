import { useState } from "react";
import { supportsManualEditing } from "../components/blocks/manual-editing";
import { getBlockDefinition } from "../components/blocks/registry";
import type { BlockData } from "../components/blocks/types";
import { assertComponentContent } from "../contract/schema";
import type { BuiltinComponentMetadata } from "../contract/types";
import { errorMessage } from "../host/bridge";
import messages from "../i18n/messages/catalog";
import common from "../i18n/messages/common";
import customMessages from "../i18n/messages/customComponents";
import { useTranslator } from "../i18n/react";
import { nativeComponentDocument } from "../surface/component-insertion";

export default function ComponentExampleData({
  builtin,
  data,
  onChange,
}: {
  builtin?: BuiltinComponentMetadata;
  data: BlockData;
  onChange: (next: BlockData) => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const tp = useTranslator(customMessages);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ text: string; base: BlockData } | null>(
    null,
  );
  const [error, setError] = useState("");
  const editable = builtin && !supportsManualEditing(builtin.kind);
  const clear = () => {
    setDraft(null);
    setError("");
  };
  const apply = () => {
    if (!builtin || !draft) return;
    if (draft.base !== data) {
      setError(tp("dataChanged"));
      return;
    }
    try {
      const next = JSON.parse(draft.text);
      if (!next || typeof next !== "object" || Array.isArray(next))
        throw new Error(tp("notJsonObject"));
      assertComponentContent(next);
      if (builtin.insertion) nativeComponentDocument(builtin.kind, next);
      else getBlockDefinition(builtin.kind)?.validate?.(next);
      onChange(next);
      clear();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  return (
    <details
      className="catalog-example-data"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) clear();
      }}
    >
      <summary>{t(editable ? "editExampleData" : "exampleData")}</summary>
      {open &&
        (editable ? (
          <>
            <textarea
              className="showai-textarea"
              aria-label={t("exampleData")}
              aria-invalid={!!error}
              spellCheck={false}
              rows={10}
              value={draft?.text ?? JSON.stringify(data, null, 2)}
              onChange={(event) => {
                setDraft({
                  text: event.target.value,
                  base: draft?.base ?? data,
                });
                setError("");
              }}
            />
            {error && (
              <p className="studio-form-error" role="alert">
                {error}
              </p>
            )}
            {draft && (
              <>
                <button type="button" className="studio-button" onClick={apply}>
                  {t("applyToPreview")}
                </button>
                <button
                  type="button"
                  className="studio-text-button"
                  onClick={clear}
                >
                  {tc("cancel")}
                </button>
              </>
            )}
          </>
        ) : (
          <pre>{JSON.stringify(data, null, 2)}</pre>
        ))}
    </details>
  );
}
