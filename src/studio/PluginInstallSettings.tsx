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
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/pluginInstall";
import onboardingMessages from "../i18n/messages/onboarding";
import { Copy, ExternalLink } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import {
  pluginActionBlocked,
  pluginActionLabel,
  pluginHostList,
  pluginHostNames,
  pluginLibraryMismatch,
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
  const [records, setRecords] = useState<AgentConnectionRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [repaired, setRepaired] = useState<PluginHost[]>([]);
  const states = new Map(
    hosts.map((host) => [host.host, verifyState(host, records)]),
  );
  const waiting = [...states.values()].some((state) => state.kind !== "called");
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
    // Quick while the person switches to the agent; slower afterwards, so later failures still show.
    const timer = setInterval(() => void read(), waiting ? 3000 : 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waiting]);
  const reason = (code: string) => {
    const key = `failure.${code}` as Parameters<typeof t>[0];
    const text = t(key);
    return text.startsWith("onboarding.") ? t("failure.unknown", { code }) : text;
  };
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
                          ? state.at
                            ? t("verify.notSinceInstallBefore", {
                                time: formatTime(state.at),
                              })
                            : t("verify.notSinceInstall")
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

/** Launcher failures that a new registration fixes; the others only need the plugin rebound. */
export const RUNTIME_FAILURES = new Set([
  "RUNTIME_MISSING",
  "RUNTIME_INVALID",
  "RUNTIME_UNAVAILABLE",
  "RUNTIME_PROBE_FAILED",
  "RUNTIME_OUTDATED",
  "RUNTIME_START_FAILED",
]);

/** 当前登记的运行时: which ShowAI the plugin launcher starts for this library. */
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
  const registered = runtime.registered;
  const state =
    runtime.state === "other" ? runtime.reason! : runtime.state;
  return (
    <div className="settings-row" data-runtime-state={state}>
      <div className="settings-row-text">
        <h3>{t("runtime.title")}</h3>
        <p>{t("runtime.detail")}</p>
        {registered && (
          <>
            <p>
              {t("runtime.version", {
                version: registered.version,
                protocol: String(registered.protocol),
              })}
              {runtime.state === "current" && ` · ${t("runtime.current")}`}
            </p>
            <code className="plugin-install-code">{registered.entry}</code>
          </>
        )}
        {runtime.state !== "current" && (
          <p role="status">
            {t(`runtime.${state}`, {
              channel: t(
                registered?.channel
                  ? `channel.${registered.channel}`
                  : "channel.unknown",
              ),
            })}
          </p>
        )}
      </div>
      {runtime.state !== "current" && (
        <button className="settings-button" disabled={busy} onClick={onRepair}>
          {busy ? t("runtime.repairing") : t("runtime.repair")}
        </button>
      )}
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
    <div className="settings-row plugin-launch-config">
      <div className="settings-row-text">
        <p>{t("launch.detail")}</p>
        {kinds.map((kind) => {
          const text = launchSnippet(kind, server, info.platform);
          return (
            <details key={kind} className="settings-config">
              <summary>
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
      </div>
    </div>
  );
}

export default function PluginInstallSettings({ home }: { home: string }) {
  const t = useTranslator(messages);
  const {
    hosts,
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
      {runtime && (
        <RuntimeRegistration
          runtime={runtime}
          busy={busy === "runtime"}
          onRepair={() => void repairRuntime()}
        />
      )}
      {hosts.map((host) => {
        const mismatch = pluginLibraryMismatch(host, home);
        return (
          <div className="settings-row" key={host.host} data-host={host.host}>
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
                          ? mismatch
                            ? t("libraryMismatch")
                            : host.current === false
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
              {host.boundHome && (
                <p className="plugin-install-note">
                  {t("boundLibrary")} <span>{host.boundHome}</span>
                </p>
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
              {busy === host.host
                ? t("installing")
                : t(pluginActionLabel(host, home))}
            </button>
          </div>
        );
      })}
      <PluginError message={error} details={errorDetails} />
      {batch && (
        <div role="status" className="plugin-install-result">
          {batch.updated.length > 0 && (
            <>
              <p>
                {t("batchUpdated", {
                  hosts: pluginHostList(batch.updated),
                })}
              </p>
              <RestartHints hosts={batch.updated} />
            </>
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
            <RestartHints hosts={[receipt.host]} />
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
      {installed.length > 0 && (
        <VerifyConnection
          hosts={installed}
          busy={!!busy}
          onRepair={(host, failure) =>
            install(host, { repairRuntime: RUNTIME_FAILURES.has(failure) })
          }
        />
      )}
      <p className="plugin-install-note">
        {t("library")} <span>{home}</span>
      </p>
    </div>
  );
}
