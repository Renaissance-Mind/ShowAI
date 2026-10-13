import { useCallback, useSyncExternalStore } from "react";
import { Check, Loader2 } from "../ui/icons";
import type { PageSessions } from "./page-sessions";

const labels = {
  saved: "本机已保存",
  saving: "保存中",
  changed: "待保存",
  retained: "本机草稿已保留",
  conflict: "保存失败",
  error: "保存失败",
} as const;

/** Save progress changes several times per edit; only this badge observes it. */
export default function SaveState({ sessions }: { sessions: PageSessions }) {
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
      {labels[status]}
    </span>
  );
}
