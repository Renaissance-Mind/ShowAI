import { useEffect, useState } from "react";
import type {
  DshPendingSteps,
  PluginHost,
  PluginInstallation,
  PluginInstallReceipt,
} from "../plugin/desktop-install";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import { desktop, errorMessage } from "./bridge";

const hostNames: Record<PluginHost, string> = {
  codex: "Codex",
  claude: "Claude Code",
  deepseek: "DeepSeek Harness",
};

/** Harness installs bundles itself, so the App lists the steps left in Harness. */
function DshSteps({ steps }: { steps: DshPendingSteps }) {
  const t = useTranslator(messages);
  const [copied, setCopied] = useState(false);
  const items = [
    steps.profileMissing && t("dshOpenOnce"),
    steps.otherSource && `${t("dshRemoveOther")} ${steps.otherSource}`,
    ...steps.legacyBundles.map((name) => `${t("dshRemoveLegacy")} ${name}`),
    steps.manualMcpRow && `${t("dshRemoveRow")} ${steps.manualMcpRow}`,
    steps.shadowingSkills.length > 0 &&
      `${t("dshRemoveSkills")} ${steps.skillRoot}: ${steps.shadowingSkills.join(", ")}`,
    steps.add && t("dshAdd"),
    steps.enable && t("dshEnable"),
    t("dshRestart"),
  ].filter((item): item is string => typeof item === "string");
  return (
    <div className="plugin-install-result">
      <ol className="plugin-install-steps">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <div className="plugin-install-path">
        <code>{steps.bundlePath}</code>
        <button
          className="settings-button"
          onClick={() =>
            void desktop
              .invoke("clipboard:write", { text: steps.bundlePath })
              .then(() => setCopied(true))
          }
        >
          {copied ? t("copied") : t("copyPath")}
        </button>
      </div>
    </div>
  );
}

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
            <h3>{hostNames[host.host]}</h3>
            <p>
              {!host.executable
                ? host.host === "deepseek"
                  ? t("dshMissing")
                  : t("missing")
                : host.error
                  ? t("scanFailed")
                  : host.otherSources.length
                    ? t("otherSource")
                    : host.installed
                      ? host.enabled
                        ? t("installed")
                        : t("disabled")
                      : host.host === "deepseek" && host.installedPath
                        ? t("dshStaged")
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
            {host.dsh && host.installedPath && !receipt?.dsh && (
              <DshSteps steps={host.dsh} />
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
              : host.host === "deepseek"
                ? host.installedPath
                  ? t("dshUpdate")
                  : t("dshPrepare")
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
          <p>{receipt.dsh ? t("dshStagedDone") : t("success")}</p>
          {receipt.dsh ? (
            <DshSteps steps={receipt.dsh} />
          ) : (
            <p>{t("refreshHost")}</p>
          )}
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
