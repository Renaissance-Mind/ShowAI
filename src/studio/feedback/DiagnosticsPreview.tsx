import { useEffect, useState } from "react";
import type { DesktopInfo } from "../../desktop/bridge";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import { Loader2 } from "../../ui/icons";
import { errorMessage } from "../bridge";
import { gatherDiagnostics } from "./diagnostics";

export interface DiagnosticsOptions {
  includeLibraryPath: boolean;
  includeLog: boolean;
}

/** The log lives in the desktop App's main process; the browser has none. */
export function logAvailable() {
  return typeof window !== "undefined" && !!window.showai?.logTail;
}

/** Collects the report whenever the options change; `null` while collecting. */
export function useDiagnostics(
  info: DesktopInfo | null,
  options: DiagnosticsOptions,
  enabled = true,
) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { includeLibraryPath, includeLog } = options;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    setText(null);
    setError("");
    gatherDiagnostics({ info, includeLibraryPath, includeLog }).then(
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
  }, [info, includeLibraryPath, includeLog, enabled]);
  return { text, error };
}

/** Options and the read-only full text, shown before anything is copied or attached. */
export function DiagnosticsPreview({
  options,
  onOptionsChange,
  text,
  error,
}: {
  options: DiagnosticsOptions;
  onOptionsChange: (options: DiagnosticsOptions) => void;
  text: string | null;
  error: string;
}) {
  const t = useTranslator(messages);
  return (
    <div className="feedback-diagnostics-preview">
      <div className="feedback-diagnostics-options">
        <label>
          <input
            type="checkbox"
            checked={options.includeLibraryPath}
            onChange={(event) =>
              onOptionsChange({
                ...options,
                includeLibraryPath: event.target.checked,
              })
            }
          />
          {t("diag.includeLibrary")}
        </label>
        {logAvailable() && (
          <label>
            <input
              type="checkbox"
              checked={options.includeLog}
              onChange={(event) =>
                onOptionsChange({ ...options, includeLog: event.target.checked })
              }
            />
            {t("diag.includeLog")}
          </label>
        )}
      </div>
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
          className="feedback-diagnostics-text"
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
