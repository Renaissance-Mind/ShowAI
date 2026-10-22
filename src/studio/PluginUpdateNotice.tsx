import { useEffect, useState } from "react";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import { Loader2 } from "../ui/icons";
import "./plugin-update-notice.css";
import {
  pluginHostList,
  pluginHostNames,
  pluginNeedsUpdate,
  usePluginHosts,
  type PluginBatchResult,
} from "./usePluginHosts";

const DISMISSED_KEY = "showai:plugin-update-dismissed";

/**
 * Checks the agent plugins once the App starts or switches libraries. A host
 * still running the plugin from an earlier App, another library or a moved App
 * is offered one update for all; "Later" stays quiet until what the App would
 * install changes again. The decision is shared by every window of the App.
 */
export default function PluginUpdateNotice({
  home,
  hidden,
  onOpenSettings,
}: {
  home: string | null;
  /** Settings → Plugins already shows the same state; keep the scan, skip the notice. */
  hidden: boolean;
  onOpenSettings: () => void;
}) {
  const t = useTranslator(messages);
  const plugins = usePluginHosts(home);
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(DISMISSED_KEY),
  );
  const [result, setResult] = useState<PluginBatchResult | null>(null);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === DISMISSED_KEY) setDismissed(event.newValue);
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  const outdated = plugins.hosts.filter(pluginNeedsUpdate);
  // What this App would install for each outdated host; a new App or library changes it.
  const key = outdated
    .map((host) => `${home}|${host.host}|${host.expected}`)
    .sort()
    .join(",");
  const dismiss = (value: string) => {
    localStorage.setItem(DISMISSED_KEY, value);
    setDismissed(value);
  };
  if (hidden) return null;
  if (result)
    return (
      <div className="plugin-update-notice" role="status">
        <div className="plugin-update-notice-text">
          {result.updated.length > 0 && (
            <p>{t("batchUpdated", { hosts: pluginHostList(result.updated) })}</p>
          )}
          {result.failed.map((item) => (
            <p key={item.host} role="alert" className="plugin-install-error">
              {t("batchFailed", {
                host: pluginHostNames[item.host],
                message: item.message,
              })}
            </p>
          ))}
        </div>
        <div className="plugin-update-notice-actions">
          {result.failed.length > 0 && (
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                setResult(null);
                onOpenSettings();
              }}
            >
              {t("openSettings")}
            </button>
          )}
          <button
            type="button"
            className="settings-button"
            onClick={() => setResult(null)}
          >
            {t("done")}
          </button>
        </div>
      </div>
    );
  if (!outdated.length || key === dismissed) return null;
  const busy = plugins.busy === "all";
  return (
    <div
      className="plugin-update-notice"
      role="region"
      aria-label={t("noticeTitle")}
    >
      <div className="plugin-update-notice-text">
        <strong>{t("noticeTitle")}</strong>
        <p>
          {t("noticeDetail", {
            hosts: pluginHostList(outdated.map((host) => host.host)),
          })}
        </p>
      </div>
      <div className="plugin-update-notice-actions">
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => dismiss(key)}
        >
          {t("later")}
        </button>
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={onOpenSettings}
        >
          {t("openSettings")}
        </button>
        <button
          type="button"
          className="settings-button plugin-update-notice-primary"
          disabled={busy}
          onClick={() =>
            void plugins
              .updateAll(outdated.map((host) => host.host))
              .then((next) => {
                // Other windows hide the same notice once this one has updated.
                if (!next.failed.length) dismiss(key);
                setResult(next);
              })
          }
        >
          {busy && <Loader2 size={13} className="studio-spin" aria-hidden />}
          {busy ? t("updatingAll") : t("updateAll")}
        </button>
      </div>
    </div>
  );
}
