import { useNotify } from "../problems/toast-context";
import { useEffect, useState } from "react";
import type {
  DshPendingSteps,
  PluginHost,
  PluginInstallation,
} from "../plugin/desktop-install";
import type { RuntimeRegistrationStatus } from "../agent/runtime";
import type { AgentConnectionRecord } from "../agent/mcp-connections";
import type { DesktopInfo } from "../host/protocol";
import {
  launchSnippet,
  runtimeMcpLaunch,
  type LaunchSnippetKind,
  type McpLaunch,
} from "../plugin/launch-snippets";
import { getLocale, type Translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import onboardingMessages from "../i18n/messages/onboarding";
import settingsMessages from "../i18n/messages/settings";
import { PendingNotice } from "../ui/PendingNotice";
import { ChevronDown, CircleAlert, Copy, ExternalLink, FolderOpen, RefreshCw } from "../ui/icons";
import Dialog from "../ui/Dialog";
import commonMessages from "../i18n/messages/common";
import { desktop, errorMessage } from "../host/bridge";
import {
  pluginActionBlocked,
  pluginActionLabel,
  pluginErrorText,
  pluginHostNames,
  pluginLibraryMismatch,
  pluginNeedsUpdate,
  usePluginHosts,
  type PluginBatchResult,
} from "./usePluginHosts";
import { AGENT_TROUBLESHOOTING, connectionHost } from "./AgentReadiness";
import AgentBrandIcon from "./AgentBrandIcon";
import type { Onboarding } from "./sample-project";
import "./agent-settings.css";

function DshSteps({ steps }: { steps: DshPendingSteps }) {
  const t = useTranslator(messages);
  const notify = useNotify();
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
          type="button"
          className="settings-button"
          onClick={() =>
            void desktop
              .invoke("clipboard:write", { text: steps.bundlePath })
              .then(
                () => notify(t("copied")),
                (reason) =>
                  notify(errorMessage(reason), {
                    kind: "warning",
                    duration: 8000,
                  }),
              )
          }
        >
          {t("copyPath")}
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

export function RestartHints({ hosts }: { hosts: PluginHost[] }) {
  const t = useTranslator(messages);
  return (
    <ul className="plugin-install-steps">
      {[...new Set(hosts)].map((host) => (
        <li key={host}>{t(`restart.${host}`)}</li>
      ))}
    </ul>
  );
}

export function PluginError({
  message,
  details,
}: {
  message: string;
  details?: string;
}) {
  const t = useTranslator(messages);
  if (!message) return null;
  const distinctDetails =
    details?.trim() && details.trim() !== message.trim()
      ? details.trim()
      : undefined;
  return (
    <div role="alert" className="plugin-install-error">
      <p>{message}</p>
      {distinctDetails && (
        <section>
          <h3 className="settings-section-heading">{t("technicalDetails")}</h3>
          <pre className="plugin-install-details">{distinctDetails}</pre>
        </section>
      )}
    </div>
  );
}

type VerifyState =
  | { kind: "failed"; at: string; code: string; detail?: string }
  | { kind: "called"; at: string }
  | { kind: "connected"; at: string }
  | { kind: "notSinceInstall"; at?: string }
  | { kind: "waiting" };

export function verifyState(
  host: PluginInstallation,
  records: AgentConnectionRecord[],
): VerifyState {
  const record = records
    .filter((item) => connectionHost(item.client) === host.host)
    .sort((a, b) =>
      (b.lastFailure?.at ?? b.lastCallAt ?? b.lastConnectedAt).localeCompare(
        a.lastFailure?.at ?? a.lastCallAt ?? a.lastConnectedAt,
      ),
    )[0];
  if (!record) return { kind: "waiting" };
  const sameInstall = (version?: string) =>
    !host.version || version === host.version;
  const failure =
    record.lastFailure &&
    (record.neverConnected || record.lastFailure.at > record.lastConnectedAt)
      ? record.lastFailure
      : undefined;
  if (failure && (!failure.pluginVersion || sameInstall(failure.pluginVersion)))
    return {
      kind: "failed",
      at: failure.at,
      code: failure.code,
      detail: failure.detail,
    };
  if (record.neverConnected) return { kind: "waiting" };
  if (record.lastCallAt && sameInstall(record.callPluginVersion))
    return { kind: "called", at: record.lastCallAt };
  if (sameInstall(record.pluginVersion))
    return { kind: "connected", at: record.lastConnectedAt };
  return { kind: "notSinceInstall", at: record.lastCallAt };
}

function useVerifyStates(hosts: PluginInstallation[]) {
  const [records, setRecords] = useState<AgentConnectionRecord[]>([]);
  const [error, setError] = useState("");
  const states = new Map(
    hosts.map((host) => [host.host, verifyState(host, records)]),
  );
  const active = hosts.length > 0;
  const waiting = [...states.values()].some((state) => state.kind !== "called");
  useEffect(() => {
    if (!active) return;
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
    const timer = setInterval(() => void read(), waiting ? 3000 : 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, waiting]);
  return { states, error };
}

export function useFailureReason() {
  const t = useTranslator(onboardingMessages);
  return (code: string) => {
    const key = `failure.${code}` as Parameters<typeof t>[0];
    const text = t(key);
    return text.startsWith("onboarding.")
      ? t("failure.unknown", { code })
      : text;
  };
}

function VerifyPrompt({ label }: { label: string }) {
  const t = useTranslator(onboardingMessages);
  const notify = useNotify();
  const [error, setError] = useState("");
  return (
    <div className="plugin-verify-prompt">
      <div className="plugin-install-path">
        <span>{label}</span>
        <code>{t("verify.prompt")}</code>
        <button
          type="button"
          className="settings-button"
          onClick={() =>
            void desktop
              .invoke("clipboard:write", { text: t("verify.prompt") })
              .then(() => notify(t("verify.copied")))
              .catch((reason) => setError(errorMessage(reason)))
          }
        >
          <Copy size={14} aria-hidden="true" />
          {t("verify.copy")}
        </button>
      </div>
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
  );
}

export function VerifyConnection({
  hosts,
  busy,
  onRepair,
}: {
  hosts: PluginInstallation[];
  busy: boolean;
  onRepair: (host: PluginHost, failure: string) => Promise<boolean>;
}) {
  const t = useTranslator(onboardingMessages);
  const { states, error } = useVerifyStates(hosts);
  const reason = useFailureReason();
  const notify = useNotify();
  const [repaired, setRepaired] = useState<PluginHost[]>([]);
  return (
    <div className="settings-row plugin-verify">
      <div className="settings-row-text">
        <h3>{t("verify.title")}</h3>
        <VerifyPrompt label={t("verify.detail")} />
        <ul className="plugin-verify-hosts">
          {hosts.map((host) => {
            const state = states.get(host.host)!;
            return (
              <li key={host.host} data-state={state.kind}>
                <strong>{pluginHostNames[host.host]}</strong>
                <span role="status">
                  {state.kind === "called"
                    ? t("verify.called", { time: formatTime(state.at) })
                    : state.kind === "connected"
                      ? t("verify.connected", { time: formatTime(state.at) })
                      : state.kind === "failed"
                        ? t("verify.failed", {
                            time: formatTime(state.at),
                            reason: reason(state.code),
                          })
                        : state.kind === "notSinceInstall"
                          ? t("verify.notSinceInstall")
                          : t("verify.waiting")}
                </span>
                {state.kind === "failed" && (
                  <>
                    <button
                      type="button"
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void onRepair(host.host, state.code).then((done) => {
                          if (done) {
                            notify(t("verify.repaired"));
                            setRepaired((items) =>
                              items.includes(host.host)
                                ? items
                                : [...items, host.host],
                            );
                          }
                        })
                      }
                    >
                      {busy ? t("verify.repairing") : t("verify.repair")}
                    </button>
                    {state.detail && (
                      <section className="plugin-verify-detail">
                        <h3 className="settings-section-heading">
                          {t("verify.details")}
                        </h3>
                        <pre className="plugin-install-details">
                          {state.code}: {state.detail}
                        </pre>
                      </section>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {repaired.length > 0 && <RestartHints hosts={repaired} />}
        {error && (
          <p role="alert" className="plugin-install-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export const RUNTIME_FAILURES = new Set([
  "RUNTIME_MISSING",
  "RUNTIME_INVALID",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_PROBE_FAILED",
  "RUNTIME_OUTDATED",
  "RUNTIME_START_FAILED",
]);

function RuntimeRegistration({
  runtime,
  busy,
  onRepair,
}: {
  runtime: RuntimeRegistrationStatus;
  busy: boolean;
  onRepair: () => void;
}) {
  const t = useTranslator(messages);
  if (runtime.state === "current") return null;
  const registered = runtime.registered;
  const state = runtime.state === "other" ? runtime.reason! : runtime.state;
  return (
    <div
      className="settings-callout plugin-runtime"
      data-tone="warn"
      data-runtime-state={state}
    >
      <CircleAlert size={16} aria-hidden="true" />
      <div className="settings-row-text">
        <h3>{t("runtime.title")}</h3>
        <p role="status">
          {t(`runtime.${state}`, {
            channel: t(
              registered?.channel
                ? `channel.${registered.channel}`
                : "channel.unknown",
            ),
          })}
        </p>
        {registered && (
          <code className="plugin-install-code">
            {registered.version} · {registered.entry}
          </code>
        )}
      </div>
      <button
        type="button"
        className="settings-button settings-primary-button"
        disabled={busy}
        onClick={onRepair}
      >
        {busy ? t("runtime.repairing") : t("runtime.repair")}
      </button>
    </div>
  );
}

function ManualPath({
  host,
  busy,
  onSave,
  onClose,
}: {
  host: PluginInstallation;
  busy: boolean;
  onSave: (path: string) => void;
  onClose?: () => void;
}) {
  const t = useTranslator(messages);
  const [path, setPath] = useState(host.manualPath ?? "");
  const [choosing, setChoosing] = useState(false);
  const command =
    host.host === "deepseek"
      ? "dsh"
      : host.host === "antigravity"
        ? "agy"
        : host.host;
  return (
    <div className="plugin-manual-path">
      <form
        className="plugin-install-path"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(path.trim());
        }}
      >
        <label className="plugin-manual-label">
          <span>{t("manualPath")}</span>
          <input
            className="showai-input settings-input"
            value={path}
            spellCheck={false}
            placeholder={`/…/${command}`}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button
          className="settings-button"
          type="button"
          disabled={busy || choosing}
          onClick={() => {
            setChoosing(true);
            void desktop
              .invoke<string | null>("plugins:choosePath", {
                path: path.trim() || host.manualPath || host.executable || undefined,
              })
              .then(
                (chosen) => {
                  if (chosen) setPath(chosen);
                },
                () => {},
              )
              .finally(() => setChoosing(false));
          }}
        >
          <FolderOpen size={14} aria-hidden="true" />
          {t("chooseFile")}
        </button>
        <button
          className="settings-button settings-primary-button"
          type="submit"
          disabled={busy || choosing || !path.trim()}
        >
          {t("manualSave")}
        </button>
        {host.manualPath ? (
          <button
            className="settings-button"
            type="button"
            disabled={busy}
            onClick={() => onSave("")}
          >
            {t("manualClear")}
          </button>
        ) : (
          onClose && (
            <button
              className="settings-button"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              {t("manualCancel")}
            </button>
          )
        )}
      </form>
      <p className="plugin-install-note">
        {t("manualPathDetail", { command })}
      </p>
      {host.searched && host.searched.length > 0 && (
        <div>
          <h4 className="settings-section-heading">{t("searched")}</h4>
          <ul className="plugin-install-searched">
            {host.searched.map((directory) => (
              <li key={directory}>
                <code>{directory}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function LaunchConfigCopy({ info }: { info: DesktopInfo | null }) {
  const t = useTranslator(messages);
  const notify = useNotify();
  const [exporting, setExporting] = useState(false);
  const [launcher, setLauncher] = useState<McpLaunch | null>(null);
  const [copied, setCopied] = useState<LaunchSnippetKind | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!info) return;
    let stopped = false;
    void desktop
      .invoke<McpLaunch>("plugins:launchConfig")
      .then((value) => {
        if (!stopped) setLauncher(value);
      })
      .catch((reason) => {
        if (!stopped) setError(errorMessage(reason));
      });
    return () => {
      stopped = true;
    };
  }, [info]);
  if (!info) return null;
  const server = launcher ?? runtimeMcpLaunch(info.cli);
  const kinds: LaunchSnippetKind[] = ["claude", "codex", "json"];
  async function exportUniversal() {
    setError("");
    setExporting(true);
    try {
      const result = await desktop.invoke<{ path: string } | null>(
        "remoteMcp:exportPlugin", { universal: true },
      );
      if (result) notify(t("universalSaved", { path: result.path }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section
      className="settings-group plugin-launch-config"
      aria-labelledby="settings-launch-title"
    >
      <div className="settings-group-heading">
        <div>
          <h2 id="settings-launch-title">{t("launch.title")}</h2>
          <p className="settings-group-desc">{t("launch.detail")}</p>
        </div>
        {info.mode === "desktop" && (
          <button
            type="button"
            className="settings-button"
            disabled={exporting}
            onClick={exportUniversal}
          >
            {t("exportUniversal")}
          </button>
        )}
      </div>
      {kinds.map((kind) => {
        const text = launchSnippet(kind, server, info.platform);
        return (
          <section key={kind} className="settings-config">
            <h3 className="settings-section-heading">
              <span>{t(`launch.${kind}Hint`)}</span>
              <button
                className="settings-button"
                type="button"
                onClick={() => {
                  setError("");
                  void desktop
                    .invoke("clipboard:write", { text })
                    .then(() => {
                      setCopied(kind);
                      notify(t("copied"));
                    })
                    .catch((reason) => setError(errorMessage(reason)));
                }}
              >
                <Copy size={14} aria-hidden="true" />
                {copied === kind ? t("copied") : t(`launch.${kind}`)}
              </button>
            </h3>
            <pre>
              <code>{text}</code>
            </pre>
          </section>
        );
      })}
      {error && (
        <p role="alert" className="plugin-install-error">
          {error}
        </p>
      )}
    </section>
  );
}

function hostStatus(
  t: Translator<(typeof messages.catalogs)["zh-CN"]>,
  host: PluginInstallation,
  home: string,
  verify: VerifyState | undefined,
  reason: (code: string) => string,
): { text: string; tone: "muted" | "ok" | "warn" | "error" } {
  const name = pluginHostNames[host.host];
  if (!host.executable)
    return {
      text: t(host.host === "deepseek" ? "dshMissing" : "missing"),
      tone: "muted",
    };
  if (host.error) return { text: t("scanFailed"), tone: "error" };
  if (host.otherSources.length)
    return {
      text: t("otherSource", {
        source: host.otherSources.join(", "),
        host: name,
      }),
      tone: "muted",
    };
  if (!host.installed)
    return {
      text: t(
        host.host === "deepseek" && host.installedPath ? "dshStaged" : "ready",
      ),
      tone: "muted",
    };
  if (!host.enabled) return { text: t("disabled"), tone: "warn" };
  if (pluginLibraryMismatch(host, home))
    return {
      text: t("libraryMismatch", { library: host.boundHome! }),
      tone: "warn",
    };
  if (host.current === false) return { text: t("outdated"), tone: "warn" };
  if (verify?.kind === "failed")
    return {
      text: t("state.failed", {
        time: formatTime(verify.at),
        reason: reason(verify.code),
      }),
      tone: "error",
    };
  if (verify?.kind === "called")
    return {
      text: t("state.called", { time: formatTime(verify.at) }),
      tone: "ok",
    };
  if (verify?.kind === "connected")
    return {
      text: t("state.connected", { time: formatTime(verify.at) }),
      tone: "ok",
    };
  return { text: t("state.waiting"), tone: "ok" };
}

function resolveHostError(host: PluginInstallation): {
  message: string;
  details?: string;
} {
  if (!host.error) return { message: "" };
  if (!host.errorCode) return { message: host.error };
  const versionMatch = host.error.match(/\bv?\d+\.\d+(?:\.\d+)?\b/);
  return pluginErrorText(
    {
      code: host.errorCode,
      message: host.error,
      details: {
        host: host.host,
        minimumVersion: versionMatch?.[0] ?? "latest",
      },
    },
    host.host,
  );
}

export default function PluginInstallSettings({ home }: { home: string }) {
  const t = useTranslator(messages);
  const ts = useTranslator(settingsMessages);
  const tv = useTranslator(onboardingMessages);
  const tc = useTranslator(commonMessages);
  const {
    hosts,
    scanned,
    busy,
    error,
    errorDetails,
    receipt,
    runtime,
    refresh,
    refreshHost,
    installedAt,
    install,
    updateAll,
    repairRuntime,
    setPath,
  } = usePluginHosts(home);
  const [batch, setBatch] = useState<PluginBatchResult | null>(null);
  const [manualHost, setManualHost] = useState<PluginHost | null>(null);
  const [dshHost, setDshHost] = useState<PluginHost | null>(null);
  const [showUndetected, setShowUndetected] = useState(false);
  const installed = hosts.filter(
    (host) =>
      host.installed &&
      host.enabled &&
      host.current !== false &&
      !pluginLibraryMismatch(host, home),
  );
  const outdated = hosts.filter(pluginNeedsUpdate);
  const verify = useVerifyStates(installed);
  const reason = useFailureReason();
  const restart = new Set<PluginHost>(
    receipt && !receipt.dsh ? [receipt.host] : (batch?.updated ?? []),
  );
  const uncalled = installed.some(
    (host) => verify.states.get(host.host)?.kind !== "called",
  );
  const detectedHosts = hosts.filter(
    (host) =>
      !!host.executable ||
      host.installed ||
      !!host.installedPath ||
      !!host.manualPath ||
      !!host.error,
  );
  const undetectedHosts = hosts.filter((host) => !detectedHosts.includes(host));
  const manualTarget = manualHost
    ? hosts.find((item) => item.host === manualHost)
    : undefined;
  const dshTarget = dshHost
    ? hosts.find((item) => item.host === dshHost)
    : undefined;
  const dshTargetSteps = dshTarget
    ? receipt?.host === dshTarget.host && receipt.dsh
      ? receipt.dsh
      : dshTarget.dsh && dshTarget.installedPath
        ? dshTarget.dsh
        : undefined
    : undefined;

  const renderHostRow = (host: PluginInstallation) => {
    const state = verify.states.get(host.host);
    const status = hostStatus(t, host, home, state, reason);
    const failed = state?.kind === "failed" ? state : undefined;
    const updateFailure = batch?.failed.find(
      (item) => item.host === host.host,
    );
    const confirmed =
      (state?.kind === "connected" || state?.kind === "called") &&
      Date.parse(state.at) >= (installedAt[host.host] ?? 0);
    const dsh =
      receipt?.host === host.host && receipt.dsh
        ? receipt.dsh
        : host.dsh && host.installedPath
          ? host.dsh
          : undefined;
    const hostErr = resolveHostError(host);
    const canManual = !host.executable && host.host !== "deepseek";
    const actionKey = pluginActionLabel(host, home);
    return (
      <div
        className="settings-row plugin-host"
        key={host.host}
        data-host={host.host}
      >
        <AgentBrandIcon brand={host.host} />
        <div className="settings-row-text">
          <h3>
            {pluginHostNames[host.host]}
            {host.version && (
              <span className="plugin-host-version">
                {host.version.split("+")[0]}
              </span>
            )}
          </h3>
          <p className="plugin-host-state" data-tone={status.tone}>
            {status.text}
          </p>
          {restart.has(host.host) && !confirmed && (
            <p className="plugin-host-next" role="status">
              {t(`next.${host.host}`)}
            </p>
          )}
          {failed?.detail && (
            <section className="plugin-verify-detail">
              <h4 className="settings-section-heading">{tv("verify.details")}</h4>
              <pre className="plugin-install-details">
                {failed.code}: {failed.detail}
              </pre>
            </section>
          )}
          {host.manualPath && host.executable === host.manualPath && (
            <p className="plugin-install-note">
              {t("manualCurrent", { path: host.manualPath })}
            </p>
          )}
          {updateFailure && (
            <PluginError
              message={updateFailure.message}
              details={updateFailure.details}
            />
          )}
          {hostErr.message && (
            <PluginError message={hostErr.message} details={hostErr.details} />
          )}
        </div>
        <div className="plugin-host-actions">
          {canManual && (
            <button
              type="button"
              className="settings-button"
              disabled={!!busy}
              onClick={() => setManualHost(host.host)}
            >
              {t("manualToggle")}
            </button>
          )}
          {dsh && (
            <button
              type="button"
              className="settings-button"
              onClick={() => setDshHost(host.host)}
            >
              {t("dshStepsButton")}
            </button>
          )}
          {updateFailure ? (
            <button
              type="button"
              className="settings-button"
              disabled={!!busy}
              onClick={() =>
                void updateAll([host.host]).then((result) =>
                  setBatch((previous) => ({
                    updated: [
                      ...(previous?.updated ?? []).filter(
                        (item) => item !== host.host,
                      ),
                      ...result.updated,
                    ],
                    failed: [
                      ...(previous?.failed ?? []).filter(
                        (item) => item.host !== host.host,
                      ),
                      ...result.failed,
                    ],
                  })),
                )
              }
            >
              {t("retryHost")}
            </button>
          ) : host.error ? (
            <button
              type="button"
              className="settings-button"
              disabled={!!busy}
              onClick={() => void refreshHost(host.host)}
            >
              {t("rescanHost", { host: pluginHostNames[host.host] })}
            </button>
          ) : failed ? (
            <button
              type="button"
              className="settings-button"
              disabled={!!busy}
              onClick={() => {
                setBatch(null);
                void install(host.host, {
                  repairRuntime: RUNTIME_FAILURES.has(failed.code),
                });
              }}
            >
              {busy === host.host ? tv("verify.repairing") : tv("verify.repair")}
            </button>
          ) : (
            !pluginActionBlocked(host) && (
              <button
                type="button"
                className={`settings-button${actionKey === "install" || actionKey === "update" ? " settings-primary-button" : ""}`}
                disabled={!!busy}
                onClick={() => {
                  setBatch(null);
                  void install(host.host);
                }}
              >
                {busy === host.host ? t("installing") : t(actionKey)}
              </button>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <section
      className="settings-group plugin-install-settings"
      aria-labelledby="settings-plugins-title"
      aria-busy={!!busy}
    >
      <div className="settings-group-heading">
        <h2 id="settings-plugins-title">{ts("pluginSummaryTitle")}</h2>
        <div className="library-space-actions">
          {outdated.length > 1 && (
            <button
              type="button"
              className="settings-button settings-primary-button"
              disabled={!!busy}
              onClick={() => {
                setBatch(null);
                void updateAll(outdated.map((host) => host.host)).then(
                  setBatch,
                );
              }}
            >
              {busy === "all" ? t("updatingAll") : t("updateAll")}
            </button>
          )}
          <button
            type="button"
            className="settings-button"
            disabled={!!busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {busy === "scan" ? t("scanning") : t("refresh")}
          </button>
        </div>
      </div>
      {runtime && (
        <RuntimeRegistration
          runtime={runtime}
          busy={busy === "runtime"}
          onRepair={() => void repairRuntime()}
        />
      )}
      <PendingNotice
        active={!scanned && !hosts.length}
        label={t("scanningHosts")}
        lines={3}
        minHeight={200}
      />
      {hosts.length > 0 && (
        <div className="settings-card">
          {detectedHosts.length > 0 ? (
            detectedHosts.map(renderHostRow)
          ) : (
            <div className="settings-row">
              <div className="settings-row-text">
                <h3>{t("noDetectedAgents")}</h3>
                <p>{t("noDetectedAgentsDetail")}</p>
              </div>
            </div>
          )}
          {undetectedHosts.length > 0 && (
            <div className="plugin-undetected-section">
              <button
                type="button"
                className="plugin-undetected-toggle"
                aria-expanded={showUndetected}
                onClick={() => setShowUndetected((value) => !value)}
              >
                <span>
                  {showUndetected
                    ? t("undetectedToggleHide")
                    : t("undetectedToggleShow", {
                        count: undetectedHosts.length,
                      })}
                </span>
                <ChevronDown
                  size={15}
                  className={showUndetected ? "is-open" : undefined}
                  aria-hidden="true"
                />
              </button>
              {showUndetected && (
                <div className="plugin-undetected-list">
                  {undetectedHosts.map(renderHostRow)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {uncalled && (
        <div className="settings-card plugin-verify-card">
          <div className="settings-card-section">
            <div className="settings-row-text">
              <h3>{t("verifySectionTitle")}</h3>
            </div>
            <VerifyPrompt label={t("verifyHint")} />
          </div>
        </div>
      )}
      <PluginError message={error} details={errorDetails} />
      {verify.error && (
        <p role="alert" className="plugin-install-error">
          {verify.error}
        </p>
      )}
      {manualTarget && (
        <Dialog
          title={`${pluginHostNames[manualTarget.host]} · ${t("manualPath")}`}
          onClose={() => {
            if (!busy) setManualHost(null);
          }}
        >
          <div className="studio-dialog-body">
            <ManualPath
              host={manualTarget}
              busy={!!busy}
              onSave={(path) => {
                void setPath(manualTarget.host, path).then(() => {
                  setManualHost(null);
                });
              }}
              onClose={() => setManualHost(null)}
            />
          </div>
        </Dialog>
      )}
      {dshTarget && dshTargetSteps && (
        <Dialog
          title={pluginHostNames[dshTarget.host]}
          onClose={() => setDshHost(null)}
        >
          <div className="studio-dialog-body studio-dialog-form">
            <DshSteps steps={dshTargetSteps} />
            <div className="studio-dialog-actions">
              <button
                type="button"
                className="settings-button settings-primary-button"
                onClick={() => setDshHost(null)}
              >
                {tc("done")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
