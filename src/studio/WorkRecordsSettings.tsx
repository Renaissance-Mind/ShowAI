import { useNotify } from "../problems/toast-context";
import { useEffect, useId, useState } from "react";
import { desktop, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/settings";
import type { WorkRecordsLocation } from "../core/work-records";
import { SettingsPath } from "./SettingsPath";

export default function WorkRecordsSettings() {
  const t = useTranslator(messages);
  const errorId = useId();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<WorkRecordsLocation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void desktop
      .invoke<WorkRecordsLocation>("library:workRecords")
      .then(setLocation, (reason) => setError(errorMessage(reason)));
  }, []);
  async function save(directory: string | null) {
    if (busy) return;
    setError("");
    if (directory !== null && !/^(?:[/\\]|[A-Za-z]:[/\\])/.test(directory)) {
      setError(t("completePath"));
      return;
    }
    setBusy(true);
    try {
      setLocation(
        await desktop.invoke<WorkRecordsLocation>("library:setWorkRecords", {
          directory,
        }),
      );
      notify(t("recordsLocationSaved"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function chooseFolder() {
    if (!location || location.source === "environment" || busy) return;
    setError("");
    try {
      const chosen = await desktop.invoke<string | null>(
        "settings:chooseFolder",
        { path: location.directory },
      );
      if (chosen) await save(chosen);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  const pinned = location?.source === "environment";
  const badge = location
    ? location.source === "default"
      ? t("temporaryRecords")
      : location.source === "environment"
        ? t("workRecordsEnvBadge")
        : t("workRecordsCustomBadge")
    : undefined;
  return (
    <section
      className="settings-group work-records-settings"
      aria-labelledby="settings-work-records-title"
    >
      <h2 id="settings-work-records-title">{t("workRecords")}</h2>
      <div className="settings-card">
        <div className="settings-card-section">
          <div className="settings-row-head">
            <div className="settings-row-text">
              <h3>
                {t("workRecordsLocation")}
                {badge && (
                  <span
                    className="settings-badge"
                    data-tone={location?.source === "setting" ? "ok" : undefined}
                  >
                    {badge}
                  </span>
                )}
              </h3>
              <p>{t("workRecordsDetail")}</p>
            </div>
            <div className="settings-row-actions">
              {location?.source === "setting" && (
                <button
                  type="button"
                  className="settings-button"
                  disabled={busy}
                  onClick={() => void save(null)}
                >
                  {t("resetWorkRecords")}
                </button>
              )}
              <button
                type="button"
                className="settings-button"
                disabled={!location || pinned || busy}
                onClick={() => void chooseFolder()}
              >
                {t("changeWorkRecords")}
              </button>
            </div>
          </div>
          <SettingsPath
            value={location?.directory ?? t("readingLibrary")}
            copyLabel={t("copyDirectory")}
            copiedLabel={t("directoryCopied")}
            disabled={!location || busy}
            onCopy={() =>
              location
                ? desktop
                    .invoke("clipboard:write", { text: location.directory })
                    .then(
                      () => {
                        notify(t("directoryCopied"));
                        return true;
                      },
                      (reason) => {
                        setError(errorMessage(reason));
                        return false;
                      },
                    )
                : false
            }
          />
          {pinned && <p className="settings-help">{t("workRecordsPinned")}</p>}
          {error && (
            <p id={errorId} className="studio-form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
