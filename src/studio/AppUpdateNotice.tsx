import { useEffect, useState } from "react";
import type { AppUpdateState } from "../desktop/bridge";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/feedback";
import { errorMessage } from "./bridge";
import type { AppUpdateAction } from "./useAppUpdate";
import "./plugin-update-notice.css";

const DISMISSED_KEY = "showai:app-update-dismissed";

/**
 * Offers the restart once a downloaded update is ready. "Later" hides the
 * notice for that version in every window; ShowAI still installs it on quit.
 */
export default function AppUpdateNotice({
  state,
  run,
  hidden,
}: {
  state: AppUpdateState | null;
  run: (action: AppUpdateAction) => Promise<void>;
  /** Settings → 关于与反馈 already shows the same state and action. */
  hidden: boolean;
}) {
  const t = useTranslator(messages);
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY),
  );
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === DISMISSED_KEY) setDismissed(event.newValue);
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  if (hidden || state?.phase !== "ready" || state.version === dismissed)
    return null;
  const version = state.version!;
  return (
    <div
      className="plugin-update-notice"
      role="region"
      aria-label={t("update.title")}
    >
      <div className="plugin-update-notice-text">
        <strong>{t("update.ready", { version })}</strong>
        {failure && (
          <p role="alert" className="plugin-install-error">
            {t("update.failed", { message: failure })}
          </p>
        )}
      </div>
      <div className="plugin-update-notice-actions">
        <button
          type="button"
          className="settings-button"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, version);
            setDismissed(version);
          }}
        >
          {t("update.later")}
        </button>
        <button
          type="button"
          className="settings-button plugin-update-notice-primary"
          onClick={() => {
            setFailure(undefined);
            void run("appUpdate:install").catch((reason: unknown) =>
              setFailure(errorMessage(reason)),
            );
          }}
        >
          {t("update.restart")}
        </button>
      </div>
    </div>
  );
}
