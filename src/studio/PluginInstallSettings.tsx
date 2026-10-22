import { useEffect, useState } from "react";
import type {
  DshPendingSteps,
  PluginHost,
  PluginInstallation,
} from "../plugin/desktop-install";
import type { AgentConnectionRecord } from "../agent/mcp-connections";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import onboardingMessages from "../i18n/messages/onboarding";
import { ExternalLink } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import {
  pluginActionBlocked,
  pluginActionLabel,
  pluginHostList,
  pluginHostNames,
  pluginNeedsUpdate,
  usePluginHosts,
  type PluginBatchResult,
} from "./usePluginHosts";
import { AGENT_TROUBLESHOOTING, connectionHost } from "./AgentReadiness";
import type { Onboarding } from "./sample-project";

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

function formatTime(value: string) {
  return new Date(value).toLocaleString(getLocale(), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/**
 * After installation, the first MCP call from each host proves the plugin is
 * loaded and pinned to this library. The stdio MCP records it in the library.
 */
function VerifyConnection({ hosts }: { hosts: PluginInstallation[] }) {
  const t = useTranslator(onboardingMessages);
  const [records, setRecords] = useState<AgentConnectionRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const latest = (host: PluginHost) =>
    records
      .filter((record) => connectionHost(record.client) === host)
      .sort((a, b) =>
        (b.lastCallAt ?? b.lastConnectedAt).localeCompare(
          a.lastCallAt ?? a.lastConnectedAt,
        ),
      )[0];
  const waiting = hosts.some((host) => !latest(host.host)?.firstCallAt);
  useEffect(() => {
    let stopped = false;
    const read = () =>
      desktop
        .invoke<Onboarding>("agent:onboarding")
        .then((value) => {
          if (!stopped) {
            setRecords(value.connections);
            setError("");
          }
        })
        .catch((reason) => {
          if (!stopped) setError(errorMessage(reason));
        });
    void read();
    // Keep checking while a host has not called yet; the person is switching apps.
    const timer = waiting ? setInterval(() => void read(), 3000) : undefined;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waiting]);
  return (
    <div className="settings-row plugin-verify">
      <div className="settings-row-text">
        <h3>{t("verify.title")}</h3>
        <p>{t("verify.detail")}</p>
        <div className="plugin-install-path">
          <code>{t("verify.prompt")}</code>
          <button
            className="settings-button"
            onClick={() =>
              void desktop
                .invoke("clipboard:write", { text: t("verify.prompt") })
                .then(() => setCopied(true))
                .catch((reason) => setError(errorMessage(reason)))
            }
          >
            {copied ? t("verify.copied") : t("verify.copy")}
          </button>
        </div>
        <ul className="plugin-verify-hosts">
          {hosts.map((host) => {
            const record = latest(host.host);
            return (
              <li
                key={host.host}
                data-state={
                  record?.firstCallAt
                    ? "called"
                    : record
                      ? "connected"
                      : "waiting"
                }
              >
                <strong>{pluginHostNames[host.host]}</strong>
                <span role="status">
                  {record?.firstCallAt
                    ? t("verify.called", {
                        time: formatTime(record.lastCallAt ?? record.firstCallAt),
                      })
                    : record
                      ? t("verify.connected", {
                          time: formatTime(record.lastConnectedAt),
                        })
                      : t("verify.waiting")}
                </span>
              </li>
            );
          })}
        </ul>
        <a href={AGENT_TROUBLESHOOTING} target="_blank" rel="noreferrer">
          <ExternalLink size={12} aria-hidden="true" />
          {t("verify.help")}
        </a>
        {error && (
          <p role="alert" className="plugin-install-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function PluginInstallSettings({ home }: { home: string }) {
  const t = useTranslator(messages);
  const { hosts, busy, error, receipt, refresh, install, updateAll } =
    usePluginHosts(home);
  const [batch, setBatch] = useState<PluginBatchResult | null>(null);
  const installed = hosts.filter((host) => host.installed && host.enabled);
  const outdated = hosts.filter(pluginNeedsUpdate);
  return (
    <div className="plugin-install-settings" aria-busy={!!busy}>
      <div className="settings-row">
        <div className="settings-row-text">
          <h3>{t("title")}</h3>
          <p>{t("detail")}</p>
        </div>
        {outdated.length > 1 && (
          <button
            className="settings-button"
            disabled={!!busy}
            onClick={() => {
              setBatch(null);
              void updateAll(outdated.map((host) => host.host)).then(setBatch);
            }}
          >
            {busy === "all" ? t("updatingAll") : t("updateAll")}
          </button>
        )}
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
            <h3>{pluginHostNames[host.host]}</h3>
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
                        ? host.current === false
                          ? t("outdated")
                          : t("installed")
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
            disabled={!!busy || pluginActionBlocked(host)}
            onClick={() => {
              setBatch(null);
              void install(host.host);
            }}
          >
            {busy === host.host ? t("installing") : t(pluginActionLabel(host))}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="plugin-install-error">
          {error}
        </p>
      )}
      {batch && (
        <div role="status" className="plugin-install-result">
          {batch.updated.length > 0 && (
            <p>
              {t("batchUpdated", {
                hosts: pluginHostList(batch.updated),
              })}
            </p>
          )}
          {batch.failed.map((item) => (
            <p key={item.host} role="alert" className="plugin-install-error">
              {t("batchFailed", {
                host: pluginHostNames[item.host],
                message: item.message,
              })}
            </p>
          ))}
        </div>
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
      {installed.length > 0 && <VerifyConnection hosts={installed} />}
      <p className="plugin-install-note">
        {t("library")} <span>{home}</span>
      </p>
    </div>
  );
}
