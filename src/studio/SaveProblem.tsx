import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Check, CircleAlert, Loader2 } from "../ui/icons";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import pageSessionMessages from "../i18n/messages/pageSession";
import studioMessages from "../i18n/messages/studio";
import commonMessages from "../i18n/messages/common";
import type { PageSessions } from "./page-sessions";
import type { SaveStatus } from "./page-session";
import Dialog from "./Dialog";
import { ProblemNotice, type ProblemAction } from "./problems";
import { describeSaveFailure, type SaveFailureState } from "./save-problem";

export const SAVE_BANNER_ID = "studio-save-problem";

/**
 * Banner for a failed page save (not a conflict): cause-specific title,
 * the fixed content-safety line and only the follow-ups that can work.
 */
export function SaveFailureBanner({
  state,
  platform,
  onRetry,
  onKeepCopy,
  onLibrarySpace,
  onReveal,
  onLocateLargest,
}: {
  state: SaveFailureState;
  platform?: string;
  onRetry: () => void;
  onKeepCopy: () => void;
  onLibrarySpace?: () => void;
  onReveal?: (path: string) => void;
  onLocateLargest?: () => void;
  "data-priority"?: number;
}) {
  const t = useTranslator(pageSessionMessages);
  const ts = useTranslator(studioMessages);
  const failure = describeSaveFailure(state);
  const handlers: Record<string, ProblemAction | undefined> = {
    retry: { label: ts("retrySave"), onSelect: onRetry },
    keepCopy: { label: ts("keepAsCopy"), onSelect: onKeepCopy },
    librarySpace: onLibrarySpace && {
      label: t("save.librarySpace"),
      onSelect: onLibrarySpace,
    },
    reveal:
      onReveal && failure.path
        ? {
            label: t(platform === "darwin" ? "save.revealFinder" : "save.reveal"),
            onSelect: () => onReveal(failure.path!),
          }
        : undefined,
    locateLargest: onLocateLargest && {
      label: t("save.locateLargest"),
      onSelect: onLocateLargest,
    },
  };
  return (
    <div id={SAVE_BANNER_ID} tabIndex={-1} className="studio-save-problem">
      <ProblemNotice
        problem={failure.problem}
        level="banner"
        actions={failure.offers.flatMap((offer) =>
          handlers[offer] ? [handlers[offer]!] : [],
        )}
      />
    </div>
  );
}

/** Moves focus to the save banner, e.g. from the 失败 status mark. */
export function focusSaveBanner() {
  const banner =
    document.getElementById(SAVE_BANNER_ID) ??
    document.querySelector<HTMLElement>(".studio-save-conflict");
  if (!banner) return false;
  banner.scrollIntoView({ block: "nearest" });
  banner.focus({ preventScroll: true });
  return true;
}

const labels = {
  saved: "status.saved",
  saving: "status.saving",
  changed: "status.changed",
  retained: "status.retained",
  conflict: "status.failed",
  error: "status.failed",
} as const satisfies Record<SaveStatus, string>;

/**
 * Low-key save state beside the page title. Routine progress changes several
 * times per edit, so only this mark observes it; 已保存 fades out.
 */
export function SaveStatusMark({
  sessions,
  onShowProblem,
}: {
  sessions: PageSessions;
  onShowProblem: () => void;
}) {
  const t = useTranslator(pageSessionMessages);
  const read = useCallback(
    () => sessions.getSnapshot().active?.getSnapshot().status ?? "saved",
    [sessions],
  );
  const status = useSyncExternalStore(sessions.subscribe, read, read);
  const [faded, setFaded] = useState(status === "saved");
  useEffect(() => {
    if (status !== "saved") {
      setFaded(false);
      return;
    }
    const timer = setTimeout(() => setFaded(true), 1800);
    return () => clearTimeout(timer);
  }, [status]);
  const label = t(labels[status]);
  if (status === "error" || status === "conflict")
    return (
      <button
        type="button"
        className="studio-save-state is-failed"
        title={t("save.showProblem")}
        aria-label={t("save.statusLabel", { status: label })}
        onClick={onShowProblem}
      >
        <CircleAlert size={12} aria-hidden="true" />
        {label}
      </button>
    );
  return (
    <span
      className={`studio-save-state is-${status}${faded ? " is-faded" : ""}`}
      role="status"
      aria-label={t("save.statusLabel", { status: label })}
    >
      {status === "saving" ? (
        <Loader2 size={12} className="studio-spin" aria-hidden="true" />
      ) : status === "saved" ? (
        <Check size={12} aria-hidden="true" />
      ) : null}
      {label}
    </span>
  );
}

/**
 * Confirms 「放弃修改，载入当前文件」: the draft is deleted and cannot be
 * recovered, so the dialog names when it was last edited.
 */
export function DiscardDraftDialog({
  editedAt,
  onClose,
  onConfirm,
}: {
  editedAt?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslator(pageSessionMessages);
  const tc = useTranslator(commonMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const time =
    editedAt && !Number.isNaN(Date.parse(editedAt))
      ? new Date(editedAt).toLocaleString(getLocale(), {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  return (
    <Dialog title={t("discard.title")} onClose={onClose}>
      <div className="studio-form">
        <p className="studio-delete-description">
          {time ? t("discard.body", { time }) : t("discard.bodyUnknown")}
        </p>
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" onClick={onClose}>
            {tc("cancel")}
          </button>
          <button
            className="studio-button danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void onConfirm()
                .then(onClose)
                .catch((reason: unknown) =>
                  setError(String((reason as Error)?.message ?? reason)),
                )
                .finally(() => setBusy(false));
            }}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}
            {t("discard.confirm")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
