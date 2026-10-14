import { useCallback, useSyncExternalStore } from "react";
import { Check, Loader2 } from "../ui/icons";
import type { PageSessions } from "./page-sessions";
import { useTranslator } from "../i18n/react";
import pageSessionMessages from "../i18n/messages/pageSession";

const labels = {
  saved: "status.saved",
  saving: "status.saving",
  changed: "status.changed",
  retained: "status.retained",
  conflict: "status.failed",
  error: "status.failed",
} as const;

/** Save progress changes several times per edit; only this badge observes it. */
export default function SaveState({ sessions }: { sessions: PageSessions }) {
  const t = useTranslator(pageSessionMessages);
  const read = useCallback(
    () => sessions.getSnapshot().active?.getSnapshot().status ?? "saved",
    [sessions],
  );
  const status = useSyncExternalStore(sessions.subscribe, read, read);
  return (
    <span className={`studio-save-state ${status}`}>
      {status === "saving" ? (
        <Loader2 size={12} className="studio-spin" />
      ) : (
        <Check size={12} />
      )}
      {t(labels[status])}
    </span>
  );
}
