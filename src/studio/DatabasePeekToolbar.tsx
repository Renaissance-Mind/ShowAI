import { useEffect, useRef, useSyncExternalStore } from "react";
import { ArrowUp, ArrowDown, Maximize2, X } from "../ui/icons";
import PageIcon from "../components/PageIcon";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/databasePeek";
import commonMessages from "../i18n/messages/common";
import type { PageSession } from "./page-session";
import type { DatasetSession } from "../datasets/client";
import { useDatasetSnapshot } from "../datasets/react";
import "./database-peek.css";

export default function DatabasePeekToolbar({
  session,
  dataset,
  index,
  count,
  busy,
  readOnly,
  onClose,
  onFullPage,
  onStep,
  onRetry,
  onRestore,
}: {
  session: PageSession;
  dataset?: DatasetSession;
  index: number;
  count: number;
  busy: boolean;
  readOnly: boolean;
  onClose: () => void;
  onFullPage: () => void;
  onStep: (offset: number) => void;
  onRetry: () => void;
  onRestore: (id: string) => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const properties = useDatasetSnapshot(dataset);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus({ preventScroll: true }), []);
  return (
    <>
      <header className="database-peek-toolbar">
        <button
          ref={close}
          type="button"
          className="studio-icon"
          aria-label={t("close")}
          title={`${t("close")} · Esc`}
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} />
        </button>
        <button
          type="button"
          className="studio-icon"
          aria-label={t("fullPage")}
          title={t("fullPage")}
          disabled={busy}
          onClick={onFullPage}
        >
          <Maximize2 size={16} />
        </button>
        <div className="database-peek-title">
          <PageIcon value={snapshot.draft?.icon} size={16} />
          <span>{snapshot.draft?.title || tc("untitled")}</span>
        </div>
        <span
          className="database-peek-save-state"
          role="status"
          aria-live="polite"
        >
          {readOnly || snapshot.record?.readOnly
            ? t("readOnly")
            : snapshot.error ||
                properties?.error ||
                properties?.conflicts.length
              ? t("needsAttention")
              : snapshot.status === "saving" || properties?.saving
                ? t("saving")
                : snapshot.dirty || properties?.dirty
                  ? t("unsaved")
                  : t("saved")}
        </span>
        {index >= 0 && (
          <span
            className="database-peek-position"
            title={t("position", { index: index + 1, count })}
          >
            {index + 1}/{count}
          </span>
        )}
        <button
          type="button"
          className="studio-icon"
          aria-label={t("previous")}
          title={t("previous")}
          disabled={busy || index <= 0}
          onClick={() => onStep(-1)}
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          className="studio-icon"
          aria-label={t("next")}
          title={t("next")}
          disabled={busy || index < 0 || index >= count - 1}
          onClick={() => onStep(1)}
        >
          <ArrowDown size={16} />
        </button>
      </header>
      {snapshot.error && (
        <div className="database-peek-notice" role="alert">
          <span>{snapshot.error}</span>
          <button
            type="button"
            disabled={busy}
            onClick={snapshot.status === "conflict" ? onFullPage : onRetry}
          >
            {t(snapshot.status === "conflict" ? "resolve" : "retry")}
          </button>
        </div>
      )}
      {!snapshot.error && snapshot.draftNotice && (
        <div className="database-peek-notice" role="status">
          {snapshot.draftNotice}
        </div>
      )}
      {!!snapshot.availableDrafts.length && (
        <div className="database-peek-notice">
          {snapshot.availableDrafts.map((draft) => (
            <button
              key={draft.id}
              type="button"
              disabled={busy || readOnly}
              onClick={() => onRestore(draft.id)}
            >
              {t("restore")} · {new Date(draft.savedAt).toLocaleString()}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
