import type { AppUpdateInstallMode } from "../../host/protocol";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/feedback";
import { RefreshCw } from "../../ui/icons";

export function UpdateOffer({
  version,
  checking,
  failure,
  onCheck,
  onDownload,
}: {
  version: string;
  checking: boolean;
  failure?: string;
  onCheck: () => void;
  onDownload: (mode: AppUpdateInstallMode) => void;
}) {
  const t = useTranslator(messages);
  return (
    <div className="feedback-product-update feedback-update-offer">
      <div className="feedback-update-version">
        <p
          className="feedback-update-status"
          role={failure ? "alert" : "status"}
        >
          {failure
            ? t("update.failed", { message: failure })
            : t("update.available", { version })}
          {checking && (
            <span className="settings-sr-only"> {t("update.checking")}</span>
          )}
        </p>
        <button
          type="button"
          className="settings-icon-button feedback-update-recheck"
          title={t("update.recheck")}
          aria-label={t("update.recheck")}
          aria-disabled={checking}
          onClick={() => {
            if (!checking) onCheck();
          }}
        >
          <RefreshCw
            size={13}
            className={checking ? "studio-spin" : undefined}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="feedback-product-update-actions">
        <button
          type="button"
          className="settings-button feedback-primary"
          disabled={checking}
          onClick={() => onDownload("restart")}
        >
          {t("update.restart")}
        </button>
        <button
          type="button"
          className="settings-button"
          disabled={checking}
          onClick={() => onDownload("onQuit")}
        >
          {t("update.nextLaunch")}
        </button>
      </div>
    </div>
  );
}
