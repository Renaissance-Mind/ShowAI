import { useEffect, useState } from "react";
import type { DesktopInfo } from "../../host/protocol";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import { Loader2 } from "../../ui/icons";
import { errorMessage } from "../../host/bridge";
import { gatherDiagnostics } from "./diagnostics";

export function logAvailable() {
  return typeof window !== "undefined" && !!window.showai?.logTail;
}

export function useDiagnostics(info: DesktopInfo | null, enabled = true) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    setText(null);
    setError("");
    gatherDiagnostics({
      info,
      includeLibraryPath: false,
      includeLog: logAvailable(),
    }).then(
      (value) => {
        if (!stopped) setText(value);
      },
      (reason: unknown) => {
        if (!stopped) setError(errorMessage(reason));
      },
    );
    return () => {
      stopped = true;
    };
  }, [info, enabled]);
  return { text, error };
}

export function DiagnosticsPreview({
  text,
  error,
}: {
  text: string | null;
  error: string;
}) {
  const t = useTranslator(messages);
  return (
    <div className="feedback-diagnostics-preview">
      {error ? (
        <p className="feedback-error" role="alert">
          {t("diag.failed", { message: error })}
        </p>
      ) : text === null ? (
        <p className="feedback-collecting" role="status">
          <Loader2 size={14} className="studio-spin" aria-hidden="true" />
          {t("diag.collecting")}
        </p>
      ) : (
        <textarea
          className="showai-textarea feedback-diagnostics-text"
          aria-label={t("diag.preview")}
          readOnly
          spellCheck={false}
          value={text}
          rows={14}
        />
      )}
    </div>
  );
}
