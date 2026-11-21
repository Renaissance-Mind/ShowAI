import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import navigationMessages from "../i18n/messages/navigation";
import surfaceMessages from "../i18n/messages/surface";
import {
  clientIsMac,
  eventToChord,
  findShortcutConflict,
  formatShortcut,
  getCustomShortcutsSnapshot,
  hasCustomShortcuts,
  resetAllCustomShortcuts,
  setCustomShortcut,
  shortcutGroups,
  subscribeShortcuts,
  type ShortcutEntry,
} from "./keyboard-shortcuts";

function splitKeys(
  chord: string,
  mac: boolean,
  names: Partial<Record<string, string>>,
): string[] {
  const formatted = formatShortcut(chord, mac, names);
  if (!mac) {
    if (formatted === "+") return ["+"];
    const parts = formatted.split("+").filter(Boolean);
    return parts.length ? parts : [formatted];
  }
  const macMods = new Set(["⌃", "⌥", "⇧", "⌘"]);
  const tokens: string[] = [];
  let rest = formatted;
  while (rest.length > 1 && macMods.has(rest[0])) {
    tokens.push(rest[0]);
    rest = rest.slice(1);
  }
  if (rest) tokens.push(rest);
  return tokens;
}

export default function ShortcutsPanel({
  browser = false,
  tabs,
  windows,
  dialog = false,
}: {
  browser?: boolean;
  tabs: boolean;
  windows: boolean;
  dialog?: boolean;
}) {
  const t = useTranslator(navigationMessages);
  const ts = useTranslator(surfaceMessages);
  const mac = clientIsMac();
  useSyncExternalStore(
    subscribeShortcuts,
    getCustomShortcutsSnapshot,
    () => "",
  );
  const [editing, setEditing] = useState<{
    entryId: string;
    slotIndex: number;
  } | null>(null);
  const [conflict, setConflict] = useState("");
  const names = {
    Click: t("key.click"),
    Space: t("key.space"),
    Menu: t("key.menu"),
    Arrows: t("key.arrows"),
  };

  const entryLabel = (entry: ShortcutEntry) =>
    "navigation" in entry.label
      ? t(entry.label.navigation)
      : ts(entry.label.surface);

  useEffect(() => {
    if (!editing || dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        setEditing(null);
        setConflict("");
        return;
      }
      const chord = eventToChord(event, mac);
      if (!chord) return;
      const hit = findShortcutConflict(
        chord,
        editing.entryId,
        editing.slotIndex,
        { mac, tabs, windows, browser },
      );
      if (hit) {
        setConflict(t("shortcuts.conflict", { name: entryLabel(hit) }));
        return;
      }
      setCustomShortcut(editing.entryId, editing.slotIndex, chord);
      setEditing(null);
      setConflict("");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [editing, dialog, mac, tabs, windows, browser]);

  const groups = shortcutGroups({ mac, tabs, windows, browser });
  const customized = hasCustomShortcuts();

  return (
    <div
      className={`settings-shortcuts-grid${dialog ? " is-dialog" : " is-single-column"}`}
      role="region"
      aria-label={t("shortcuts.title")}
    >
      {!dialog && (
        <div className="settings-shortcut-edit-bar">
          <span className="settings-shortcut-edit-hint">
            {conflict ? (
              <span className="settings-shortcut-conflict" role="alert">
                {conflict}
              </span>
            ) : (
              t("shortcuts.editHint")
            )}
          </span>
          {customized && (
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                resetAllCustomShortcuts();
                setEditing(null);
                setConflict("");
              }}
            >
              <RotateCcw size={13} aria-hidden="true" />
              {t("shortcuts.resetAll")}
            </button>
          )}
        </div>
      )}
      {groups.map((group) => (
        <section
          className="settings-group settings-shortcut-group"
          key={group.id}
          aria-labelledby={`shortcuts-${group.id}`}
        >
          <h2 id={`shortcuts-${group.id}`}>{t(`shortcuts.${group.id}`)}</h2>
          <div className="settings-card settings-shortcut-list">
            {group.entries.map((entry) => {
              const label = entryLabel(entry);
              const editable = !dialog && entry.editable !== false;
              const entryCustomized =
                !!entry.defaultKeys &&
                entry.keys.some(
                  (chord, index) => chord !== entry.defaultKeys![index],
                );
              return (
                <div className="settings-shortcut-row" key={entry.id}>
                  <span className="settings-shortcut-action">{label}</span>
                  <span className="settings-shortcut-chords">
                    {entry.keys.map((chord, keyIndex) => {
                      const isRecording =
                        editing?.entryId === entry.id &&
                        editing?.slotIndex === keyIndex;
                      const isCustomSlot =
                        !!entry.defaultKeys &&
                        chord !== entry.defaultKeys[keyIndex];
                      return (
                        <Fragment key={`${entry.id}:${keyIndex}`}>
                          {keyIndex > 0 && (
                            <span className="settings-shortcut-or">
                              {t("shortcuts.or")}
                            </span>
                          )}
                          {editable ? (
                            <button
                              type="button"
                              className={`settings-shortcut-combo is-editable${isRecording ? " is-recording" : ""}${isCustomSlot ? " is-custom" : ""}`}
                              aria-label={t("shortcuts.clickToEdit", {
                                action: label,
                              })}
                              aria-pressed={isRecording}
                              onClick={() => {
                                setConflict("");
                                setEditing(
                                  isRecording
                                    ? null
                                    : { entryId: entry.id, slotIndex: keyIndex },
                                );
                              }}
                            >
                              {isRecording ? (
                                <span className="settings-kbd settings-kbd-recording">
                                  {t("shortcuts.recording")}
                                </span>
                              ) : (
                                splitKeys(chord, mac, names).map(
                                  (token, tokenIndex) => (
                                    <kbd
                                      className="settings-kbd"
                                      key={`${chord}:${tokenIndex}:${token}`}
                                    >
                                      {token}
                                    </kbd>
                                  ),
                                )
                              )}
                            </button>
                          ) : (
                            <span className="settings-shortcut-combo">
                              {splitKeys(chord, mac, names).map(
                                (token, tokenIndex) => (
                                  <kbd
                                    className="settings-kbd"
                                    key={`${chord}:${tokenIndex}:${token}`}
                                  >
                                    {token}
                                  </kbd>
                                ),
                              )}
                            </span>
                          )}
                        </Fragment>
                      );
                    })}
                    {!dialog && entryCustomized && entry.defaultKeys && (
                      <button
                        type="button"
                        className="settings-icon-button settings-shortcut-reset"
                        title={t("shortcuts.resetOne")}
                        aria-label={t("shortcuts.resetOne")}
                        onClick={() => {
                          for (let i = 0; i < entry.defaultKeys!.length; i++)
                            setCustomShortcut(entry.id, i, null);
                          if (editing?.entryId === entry.id) setEditing(null);
                          setConflict("");
                        }}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
