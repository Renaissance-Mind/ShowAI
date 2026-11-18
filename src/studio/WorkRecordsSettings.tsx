import { useEffect, useId, useState } from "react";
import { Copy, Folder } from "../ui/icons";
import { desktop, errorMessage } from "../host/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/settings";
import type { WorkRecordsLocation } from "../core/work-records";

export default function WorkRecordsSettings() {
  const t = useTranslator(messages);
  const errorId = useId();
  const [notice, setNotice] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [location, setLocation] = useState<WorkRecordsLocation | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void desktop
      .invoke<WorkRecordsLocation>("library:workRecords")
      .then(setLocation, (reason) => setError(errorMessage(reason)));
  }, []);
  async function save(directory: string | null) {
    setError("");
    setInvalid(
      directory !== null && !/^(?:[/\\]|[A-Za-z]:[/\\])/.test(directory),
    );
    if (directory !== null && !/^(?:[/\\]|[A-Za-z]:[/\\])/.test(directory)) {
      setError(t("completePath"));
      return;
    }
    try {
      setLocation(
        await desktop.invoke<WorkRecordsLocation>("library:setWorkRecords", {
          directory,
        }),
      );
      setDraft(null);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
  const pinned = location?.source === "environment";
  return (
    <section
      className="settings-group work-records-settings"
      aria-labelledby="settings-work-records-title"
    >
      <h2 id="settings-work-records-title">{t("workRecords")}</h2>
      <div className="settings-row">
        <div className="settings-row-text">
          <h3>{t("workRecordsLocation")}</h3>
          <p>{t("workRecordsDetail")}</p>
        </div>
        {draft === null && (
          <button
            className="settings-button"
            disabled={!location || pinned}
            onClick={() => setDraft(location?.directory ?? "")}
          >
            {t("changeWorkRecords")}
          </button>
        )}
      </div>
      {draft === null ? (
        <div className="settings-path">
          <Folder size={17} aria-hidden="true" />
          {location?.source === "default" ? (
            <details>
              <summary>{t("temporaryRecords")}</summary>
              <code>{location.directory}</code>
            </details>
          ) : (
            <code>{location?.directory ?? t("readingLibrary")}</code>
          )}
          {location && (
            <button
              className="settings-icon-button"
              aria-label={t("copyDirectory")}
              onClick={() =>
                void desktop
                  .invoke("clipboard:write", { text: location.directory })
                  .then(
                    () => setNotice(t("directoryCopied")),
                    (reason) => setError(errorMessage(reason)),
                  )
              }
            >
              <Copy size={15} />
            </button>
          )}
          {location?.source === "setting" && (
            <button className="settings-button" onClick={() => save(null)}>
              {t("resetWorkRecords")}
            </button>
          )}
        </div>
      ) : (
        <form
          className="work-records-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft.trim());
          }}
        >
          <input
            aria-label={t("workRecordsLocation")}
            value={draft}
            autoFocus
            aria-invalid={invalid}
            aria-describedby={error ? errorId : undefined}
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
            }}
          />
          <button
            className="settings-button"
            type="button"
            onClick={() =>
              void desktop.invoke<string | null>("settings:chooseFolder").then(
                (path) => {
                  if (path) setDraft(path);
                },
                (reason) => setError(errorMessage(reason)),
              )
            }
          >
            {t("chooseFolder")}
          </button>
          <button className="settings-button" type="submit">
            {t("saveWorkRecords")}
          </button>
          <button
            className="settings-button"
            type="button"
            onClick={() => setDraft(null)}
          >
            {t("cancelWorkRecords")}
          </button>
        </form>
      )}
      {pinned && <p className="settings-help">{t("workRecordsPinned")}</p>}
      {notice && (
        <p role="status" className="settings-help">
          {notice}
        </p>
      )}
      {error && (
        <p id={errorId} className="studio-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
