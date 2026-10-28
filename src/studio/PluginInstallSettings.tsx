import { useEffect, useState } from "react";
import type {
  DshPendingSteps,
  PluginHost,
  PluginInstallation,
} from "../plugin/desktop-install";
import type { RuntimeRegistrationStatus } from "../agent/runtime";
import type { AgentConnectionRecord } from "../agent/mcp-connections";
import type { DesktopInfo } from "../desktop/bridge";
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
import { ChevronRight, Copy, ExternalLink, RefreshCw } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import {
  pluginActionBlocked,
  pluginActionLabel,
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

/** Restart instructions differ per host; show only those just installed or updated. */
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

/** A localized error with the original output collapsed beneath it. */
export function PluginError({
  message,
  details,
}: {
  message: string;
  details?: string;
}) {
  const t = useTranslator(messages);
  if (!message) return null;
  return (
    <div role="alert" className="plugin-install-error">
      <p>{message}</p>
      {details && (
        <details>
          <summary>{t("technicalDetails")}</summary>
          <pre className="plugin-install-details">{details}</pre>
        </details>
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

/**
 * The state of one host compared with its current installation. A call recorded by an
 * earlier plugin version does not prove the current one works; a launcher failure after
 * the latest connection is the current state.
 */
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
  // Without a version from the host, every record counts (earlier Apps behaved so).
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

/**
 * After installation, the first MCP call from each host proves the plugin is loaded
 * and pinned to this library; the stdio MCP records it in the library, and the plugin
 * launcher records failures that happen before the MCP handshake.
 */
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
    // Quick while the person switches to the agent; slower afterwards, so later failures still show.
    const timer = setInterval(() => void read(), waiting ? 3000 : 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, waiting]);
  return { states, error };
}

/** The launcher failure code in the person's words. */
function useFailureReason() {
  const t = useTranslator(onboardingMessages);
  return (code: string) => {
    const key = `failure.${code}` as Parameters<typeof t>[0];
    const text = t(key);
    return text.startsWith("onboarding.") ? t("failure.unknown", { code }) : text;
  };
}

/** The prompt that makes an agent call ShowAI, with the troubleshooting link. */
function VerifyPrompt({ label }: { label: string }) {
  const t = useTranslator(onboardingMessages);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="plugin-verify-prompt">
      <div className="plugin-install-path">
        <span>{label}</span>
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
          <Copy size={14} aria-hidden="true" />
          {copied ? t("verify.copied") : t("verify.copy")}
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

/** The welcome's check after an installation: the prompt, then each host's first call. */
export function VerifyConnection({
  hosts,
  busy,
  onRepair,
}: {
  hosts: PluginInstallation[];
  busy: boolean;
  /** Repairs the registration and reinstalls the plugin for one host. */
  onRepair: (host: PluginHost, failure: string) => Promise<boolean>;
}) {
  const t = useTranslator(onboardingMessages);
  const { states, error } = useVerifyStates(hosts);
  const reason = useFailureReason();
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
                      className="settings-button"
                      disabled={busy}
                      onClick={() =>
                        void onRepair(host.host, state.code).then((done) => {
                          if (done)
                            setRepaired((items) => [...items, host.host]);
                        })
                      }
                    >
                      {busy ? t("verify.repairing") : t("verify.repair")}
                    </button>
                    {state.detail && (
                      <details className="plugin-verify-detail">
                        <summary>{t("verify.details")}</summary>
                        <pre className="plugin-install-details">
                          {state.code}: {state.detail}
                        </pre>
                      </details>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {repaired.length > 0 && (
          <div role="status" className="plugin-install-result">
            <p>{t("verify.repaired")}</p>
            <RestartHints hosts={repaired} />
          </div>
        )}
        {error && (
          <p role="alert" className="plugin-install-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Launcher failures that a new registration fixes; the others only need the plugin rebound. */
export const RUNTIME_FAILURES = new Set([
  "RUNTIME_MISSING",
  "RUNTIME_INVALID",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_PROBE_FAILED",
  "RUNTIME_OUTDATED",
  "RUNTIME_START_FAILED",
]);

/**
 * Shown only when the registered runtime is not this App: the plugin launcher would
 * start another ShowAI for this library, or none.
 */
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
  const state =
    runtime.state === "other" ? runtime.reason! : runtime.state;
  return (
    <div className="settings-row plugin-runtime" data-runtime-state={state}>
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
      <button className="settings-button" disabled={busy} onClick={onRepair}>
        {busy ? t("runtime.repairing") : t("runtime.repair")}
      </button>
    </div>
  );
}

/** Not found: what was searched, and a path the person sets by hand. */
function ManualPath({
  host,
  busy,
  onSave,
}: {
  host: PluginInstallation;
  busy: boolean;
  onSave: (path: string) => void;
}) {
  const t = useTranslator(messages);
  const [path, setPath] = useState(host.manualPath ?? "");
  const command = host.host === "deepseek" ? "dsh" : host.host;
  return (
    <div className="plugin-manual-path">
      {host.searched && (
        <details>
          <summary>{t("searched")}</summary>
          <ul className="plugin-install-searched">
            {host.searched.map((directory) => (
              <li key={directory}>
                <code>{directory}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
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
            className="settings-input"
            value={path}
            spellCheck={false}
            placeholder={`/…/${command}`}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button
          className="settings-button"
          type="submit"
          disabled={busy || !path.trim()}
        >
          {t("manualSave")}
        </button>
        {host.manualPath && (
          <button
            className="settings-button"
            type="button"
            disabled={busy}
            onClick={() => onSave("")}
          >
            {t("manualClear")}
          </button>
        )}
      </form>
      <p className="plugin-install-note">
        {t("manualPathDetail", { command })}
      </p>
    </div>
  );
}

/** Per-host configuration for adding ShowAI by hand, started through the plugin launcher. */
export function LaunchConfigCopy({ info }: { info: DesktopInfo | null }) {
  const t = useTranslator(messages);
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
  // Without the launcher (an older host), the runtime CLI starts its MCP entry directly.
  const server = launcher ?? runtimeMcpLaunch(info.cli);
  const kinds: LaunchSnippetKind[] = ["claude", "codex", "json"];
  return (
    <section
      className="settings-group plugin-launch-config"
      aria-labelledby="settings-launch-title"
    >
      <h2 id="settings-launch-title">{t("launch.title")}</h2>
      {kinds.map((kind) => {
        const text = launchSnippet(kind, server, info.platform);
        return (
          <details key={kind} className="settings-config">
            <summary>
              <ChevronRight size={14} aria-hidden="true" />
              <span>{t(`launch.${kind}Hint`)}</span>
              <button
                className="settings-button"
                onClick={(event) => {
                  event.preventDefault();
                  setError("");
                  void desktop
                    .invoke("clipboard:write", { text })
                    .then(() => setCopied(kind))
                    .catch((reason) => setError(errorMessage(reason)));
                }}
              >
                <Copy size={14} aria-hidden="true" />
                {copied === kind ? t("copied") : t(`launch.${kind}`)}
              </button>
            </summary>
            <pre>
              <code>{text}</code>
            </pre>
          </details>
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

/** One host's state in a single line: detection, plugin, then the latest connection. */
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

export default function PluginInstallSettings({ home }: { home: string }) {
  const t = useTranslator(messages);
  const ts = useTranslator(settingsMessages);
  const tv = useTranslator(onboardingMessages);
  const {
    hosts,
    scanned,
    busy,
    error,
    errorDetails,
    receipt,
    runtime,
    refresh,
    install,
    updateAll,
    repairRuntime,
    setPath,
  } = usePluginHosts(home);
  const [batch, setBatch] = useState<PluginBatchResult | null>(null);
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
  // Hosts installed or updated just now need a restart before the first call.
  const restart = new Set<PluginHost>(
    receipt && !receipt.dsh ? [receipt.host] : (batch?.updated ?? []),
  );
  const uncalled = installed.some(
    (host) => verify.states.get(host.host)?.kind !== "called",
  );
  return (
    <section
      className="settings-group plugin-install-settings"
      aria-labelledby="settings-plugins-title"
      aria-busy={!!busy}
    >
      <div className="settings-group-heading">
        <h2 id="settings-plugins-title">{ts("localConnection")}</h2>
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
          <RefreshCw size={13} aria-hidden="true" />
          {busy === "scan" ? t("scanning") : t("refresh")}
        </button>
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
      {hosts.map((host) => {
        const state = verify.states.get(host.host);
        const status = hostStatus(t, host, home, state, reason);
        const failed = state?.kind === "failed" ? state : undefined;
        const dsh =
          receipt?.host === host.host && receipt.dsh
            ? receipt.dsh
            : host.dsh && host.installedPath
              ? host.dsh
              : undefined;
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
              {restart.has(host.host) && (
                <p className="plugin-host-next" role="status">
                  {t(`next.${host.host}`)}
                </p>
              )}
              {failed?.detail && (
                <details className="plugin-verify-detail">
                  <summary>{tv("verify.details")}</summary>
                  <pre className="plugin-install-details">
                    {failed.code}: {failed.detail}
                  </pre>
                </details>
              )}
              {host.manualPath && host.executable === host.manualPath && (
                <p className="plugin-install-note">
                  {t("manualCurrent", { path: host.manualPath })}
                </p>
              )}
              {host.error && (
                <PluginError
                  message={
                    host.errorCode === "PLUGIN_HOST_TOO_OLD" ||
                    host.errorCode === "PLUGIN_HOST_COMMAND_FAILED"
                      ? t(`error.${host.errorCode}`, {
                          host: pluginHostNames[host.host],
                          version: "",
                        })
                      : host.error
                  }
                  details={host.errorCode ? host.error : undefined}
                />
              )}
              {!host.executable && host.host !== "deepseek" && (
                <ManualPath
                  host={host}
                  busy={!!busy}
                  onSave={(path) => void setPath(host.host, path)}
                />
              )}
              {dsh && <DshSteps steps={dsh} />}
            </div>
            {failed ? (
              <button
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
                  className="settings-button"
                  disabled={!!busy}
                  onClick={() => {
                    setBatch(null);
                    void install(host.host);
                  }}
                >
                  {busy === host.host
                    ? t("installing")
                    : t(pluginActionLabel(host, home))}
                </button>
              )
            )}
          </div>
        );
      })}
      {uncalled && <VerifyPrompt label={t("verifyHint")} />}
      <PluginError message={error} details={errorDetails} />
      {verify.error && (
        <p role="alert" className="plugin-install-error">
          {verify.error}
        </p>
      )}
      {batch?.failed.map((item) => (
        <p key={item.host} role="alert" className="plugin-install-error">
          {t("batchFailed", {
            host: pluginHostNames[item.host],
            message: item.message,
          })}
        </p>
      ))}
    </section>
  );
}
