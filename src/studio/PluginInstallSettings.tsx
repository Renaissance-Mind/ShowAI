import { useEffect, useState } from "react";
import type {
  PluginHost,
  PluginInstallation,
  PluginInstallReceipt,
} from "../plugin/desktop-install";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import { desktop, errorMessage } from "./bridge";

export default function PluginInstallSettings({ home }: { home: string }) {
  const t = useTranslator(messages);
  const [hosts, setHosts] = useState<PluginInstallation[]>([]);
  const [busy, setBusy] = useState<PluginHost | "scan" | null>(null);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<PluginInstallReceipt | null>(null);
  async function refresh() {
    setBusy("scan");
    setError("");
    try {
      setHosts(await desktop.invoke<PluginInstallation[]>("plugins:status"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  useEffect(() => {
    setReceipt(null);
    void refresh();
  }, [home]);
  async function install(host: PluginHost) {
    setBusy(host);
    setError("");
    setReceipt(null);
    try {
      setReceipt(
        await desktop.invoke<PluginInstallReceipt>("plugins:install", { host }),
      );
      setHosts(await desktop.invoke<PluginInstallation[]>("plugins:status"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="plugin-install-settings" aria-busy={!!busy}>
      <div className="settings-row">
        <div className="settings-row-text">
          <h3>{t("title")}</h3>
          <p>{t("detail")}</p>
        </div>
        <button
          className="settings-button"
          disabled={!!busy}
          onClick={() => void refresh()}
        >
          {busy === "scan" ? t("scanning") : t("refresh")}
        </button>
      </div>
      {hosts.map((host) => (
        <div className="settings-row" key={host.host}>
          <div className="settings-row-text">
            <h3>{host.host === "codex" ? "Codex" : "Claude Code"}</h3>
            <p>
              {!host.executable
                ? t("missing")
                : host.error
                  ? t("scanFailed")
                  : host.otherSources.length
                    ? t("otherSource")
                    : host.installed
                      ? host.enabled
                        ? t("installed")
                        : t("disabled")
                      : t("ready")}
            </p>
            {host.otherSources.length > 0 && (
              <p>{host.otherSources.join(", ")}</p>
            )}
            {host.version && <p>{host.version.split("+")[0]}</p>}
            {host.error && (
              <p role="alert" className="plugin-install-error">
                {host.error}
              </p>
            )}
          </div>
          <button
            className="settings-button"
            disabled={
              !!busy ||
              !host.executable ||
              !!host.error ||
              !!host.otherSources.length
            }
            onClick={() => void install(host.host)}
          >
            {busy === host.host
              ? t("installing")
              : host.installed
                ? t("update")
                : t("install")}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="plugin-install-error">
          {error}
        </p>
      )}
      {receipt && (
        <div role="status" className="plugin-install-result">
          <p>{t("success")}</p>
          <p>{t("refreshHost")}</p>
          <details>
            <summary>{t("details")}</summary>
            <p>{receipt.installedPath}</p>
            <p>{receipt.home}</p>
            <p>
              {receipt.verifiedFiles} {t("verifiedFiles")}
            </p>
          </details>
        </div>
      )}
      <p className="plugin-install-note">
        {t("library")} <span>{home}</span>
      </p>
    </div>
  );
}
