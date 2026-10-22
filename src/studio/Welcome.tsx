import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { DesktopInfo } from "../desktop/bridge";
import type { SampleState } from "../core/onboarding";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/onboarding";
import pluginMessages from "../i18n/messages/pluginInstall";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Sparkles,
} from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import AgentBrandIcon from "./AgentBrandIcon";
import {
  PluginError,
  RestartHints,
  RUNTIME_FAILURES,
  VerifyConnection,
} from "./PluginInstallSettings";
import { workbenchCapabilities } from "./capabilities";
import {
  pluginActionBlocked,
  pluginActionLabel,
  pluginUpToDate,
  pluginHostNames,
  pluginHostState,
  usePluginHosts,
} from "./usePluginHosts";
import {
  AGENT_HOSTS_GUIDE,
  agentReadiness,
  readinessText,
  useAgentStatus,
  useExecutionLabel,
} from "./AgentReadiness";
import { SAMPLE_ICONS, SAMPLE_KEYS, type SampleKey } from "./sample-project";
import "./agent-settings.css";
import "./onboarding.css";

const PROMPTS = ["mortgage", "foldable", "attention"] as const;

/**
 * The first-run page: "Get started" in the built-in documentation, opened when a new App
 * starts, or the Recent view's content while the documentation is hidden and the library
 * has no pages of its own.
 */
export default function Welcome({
  info,
  samples,
  preparing,
  onOpenSample,
  onOpenAgentSettings,
  onOpenPluginSettings,
  onCreateProject,
  onStartPrompt,
}: {
  info: DesktopInfo | null;
  samples: SampleState | null;
  preparing: boolean;
  onOpenSample: (
    projectId: string,
    pageId: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  onOpenAgentSettings: () => void;
  onOpenPluginSettings: () => void;
  onCreateProject: () => void;
  /** Writes the prompt into the built-in Agent on a new sample page. */
  onStartPrompt?: (prompt: string) => Promise<void>;
}) {
  const t = useTranslator(messages);
  const tp = useTranslator(pluginMessages);
  // The desktop App and the local browser server both reach the host CLIs on this machine.
  const desktopPlugins =
    !!info && workbenchCapabilities(info.platform).localPlugins;
  const plugins = usePluginHosts(desktopPlugins ? info.home : null);
  const agent = useAgentStatus(!!info, null);
  const executionLabel = useExecutionLabel(agent.status);
  const readiness = agent.status ? agentReadiness(agent.status) : null;
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<{
    key: (typeof PROMPTS)[number];
    message: string;
  } | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const copy = async (key: (typeof PROMPTS)[number]) => {
    setCopyError(null);
    try {
      await desktop.invoke("clipboard:write", {
        text: t(`prompts.${key}Prompt`),
      });
      setCopied(key);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 2400);
    } catch (reason) {
      // Without clipboard access the prompt stays visible for copying by hand.
      setCopyError({ key, message: errorMessage(reason) });
    }
  };
  const installedHosts = plugins.hosts.filter(
    (host) => host.installed && host.enabled,
  );
  const shown = plugins.hosts.filter(
    (host) => host.host !== "deepseek" || !!host.executable,
  );
  const noHost =
    desktopPlugins &&
    plugins.scanned &&
    !plugins.error &&
    !plugins.hosts.some(
      (host) => host.host !== "deepseek" && !!host.executable,
    );
  // Prompts go where they can be used: an external host takes a pasted prompt,
  // otherwise a ready built-in Agent receives it on a new page.
  const externalHost =
    desktopPlugins &&
    plugins.hosts.some((host) => host.host !== "deepseek" && !!host.executable);
  const promptMode: "builtin" | "copy" | "copyOnly" | null =
    desktopPlugins && !plugins.scanned
      ? null
      : externalHost
        ? "copy"
        : onStartPrompt && readiness?.kind === "ready"
          ? "builtin"
          : "copyOnly";
  const [starting, setStarting] = useState<string | null>(null);
  const start = async (key: (typeof PROMPTS)[number]) => {
    setCopyError(null);
    setStarting(key);
    try {
      await onStartPrompt!(t(`prompts.${key}Prompt`));
    } catch (reason) {
      setCopyError({ key, message: errorMessage(reason) });
    } finally {
      setStarting(null);
    }
  };
  const sampleCards =
    samples?.state === "seeded"
      ? SAMPLE_KEYS.filter((key) => samples.pages[key])
      : [];
  return (
    <div className="studio-welcome" aria-label={t("welcome.label")}>
      <header className="studio-welcome-intro">
        <h2>{t("welcome.title")}</h2>
        <p>{t("welcome.oneLiner")}</p>
        <p>{t("welcome.start")}</p>
      </header>

      <section
        className="studio-welcome-section"
        aria-labelledby="welcome-connect"
      >
        <h3 id="welcome-connect">{t("connect.title")}</h3>
        <ul className="studio-welcome-hosts">
          {desktopPlugins && !plugins.scanned && (
            <li className="studio-welcome-host" role="status">
              <Loader2 size={14} className="studio-spin" aria-hidden="true" />
              <span className="studio-welcome-host-state">
                {t("connect.checking")}
              </span>
            </li>
          )}
          {shown.map((host) => {
            const auth = agent.status?.agents.find(
              (item) => item.id === host.host,
            )?.auth;
            return (
              <li
                className="studio-welcome-host"
                key={host.host}
                data-host={host.host}
                data-state={
                  host.installed && host.enabled
                    ? "ready"
                    : host.executable
                      ? "found"
                      : "missing"
                }
              >
                <AgentBrandIcon brand={host.host} />
                <span className="studio-welcome-host-text">
                  <strong>{pluginHostNames[host.host]}</strong>
                  <span className="studio-welcome-host-state">
                    {t(pluginHostState(host, auth, info?.home))}
                  </span>
                </span>
                {host.executable &&
                  !pluginUpToDate(host, info?.home) &&
                  (pluginActionBlocked(host) ? (
                    // Another plugin source or a host error is explained in Settings → Plugins.
                    <button
                      type="button"
                      className="settings-button"
                      onClick={onOpenPluginSettings}
                    >
                      {t("connect.settings")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="settings-button"
                      disabled={!!plugins.busy}
                      onClick={() => void plugins.install(host.host)}
                    >
                      {plugins.busy === host.host
                        ? tp("installing")
                        : tp(pluginActionLabel(host, info?.home))}
                    </button>
                  ))}
              </li>
            );
          })}
          <li
            className="studio-welcome-host"
            data-host="builtin"
            data-state={readiness?.kind === "ready" ? "ready" : "found"}
          >
            <AgentBrandIcon
              brand={
                agent.status?.settings.mode === "local"
                  ? agent.status.settings.localAgent
                  : (agent.status?.settings.sources.find(
                      (source) => source.id === agent.status?.settings.sourceId,
                    )?.provider ?? "builtin")
              }
            />
            <span className="studio-welcome-host-text">
              <strong>{t("builtin.title")}</strong>
              <span className="studio-welcome-host-state">
                {[
                  executionLabel,
                  agent.error
                    ? t("status.unavailable", { error: agent.error })
                    : readiness
                      ? readinessText(t, readiness)
                      : t("status.checking"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <button
              type="button"
              className="settings-button"
              onClick={onOpenAgentSettings}
            >
              {t("builtin.open")}
            </button>
          </li>
        </ul>
        {noHost && (
          <div className="studio-welcome-fallback">
            <p>{t("connect.noHost")}</p>
            <a
              className="settings-button"
              href={AGENT_HOSTS_GUIDE}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={13} aria-hidden="true" />
              {t("connect.hostGuide")}
            </a>
            <button
              type="button"
              className="settings-button"
              onClick={onOpenAgentSettings}
            >
              {t("connect.useBuiltin")}
            </button>
          </div>
        )}
        {info?.mode === "browser" && desktopPlugins && (
          <p className="studio-welcome-hint">{t("connect.installHere")}</p>
        )}
        {plugins.receipt && (
          <div role="status" className="studio-welcome-result">
            <p>
              {plugins.receipt.dsh ? tp("dshStagedDone") : tp("success")}
            </p>
            {plugins.receipt.dsh ? (
              <button
                type="button"
                className="settings-button"
                onClick={onOpenPluginSettings}
              >
                {t("connect.settings")}
              </button>
            ) : (
              <RestartHints hosts={[plugins.receipt.host]} />
            )}
          </div>
        )}
        {/* After an installation, the first call from the agent confirms the connection here. */}
        {plugins.receipt && !plugins.receipt.dsh && installedHosts.length > 0 && (
          <div className="studio-welcome-verify plugin-install-settings">
            <VerifyConnection
              hosts={installedHosts}
              busy={!!plugins.busy}
              onRepair={(host, failure) =>
                plugins.install(host, {
                  repairRuntime: RUNTIME_FAILURES.has(failure),
                })
              }
            />
          </div>
        )}
        <PluginError message={plugins.error} details={plugins.errorDetails} />
      </section>

      <section
        className="studio-welcome-section"
        aria-labelledby="welcome-prompts"
      >
        <h3 id="welcome-prompts">{t("prompts.title")}</h3>
        <p className="studio-welcome-hint">
          {t(
            promptMode === "builtin"
              ? "prompts.hintBuiltin"
              : promptMode === "copyOnly"
                ? "prompts.hintCopyOnly"
                : "prompts.hint",
          )}
        </p>
        <div className="studio-welcome-prompts">
          {PROMPTS.map((key) => (
            <button
              type="button"
              key={key}
              className="studio-welcome-prompt"
              data-copied={copied === key || undefined}
              title={t(`prompts.${key}Prompt`)}
              disabled={!!starting}
              onClick={() =>
                void (promptMode === "builtin" ? start(key) : copy(key))
              }
            >
              {starting === key ? (
                <Loader2 size={13} className="studio-spin" aria-hidden="true" />
              ) : promptMode === "builtin" ? (
                <Sparkles size={13} aria-hidden="true" />
              ) : copied === key ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <Copy size={13} aria-hidden="true" />
              )}
              <span>{t(`prompts.${key}`)}</span>
              {copied === key && (
                <span className="studio-welcome-copied" role="status">
                  {t("prompts.copied")}
                </span>
              )}
            </button>
          ))}
        </div>
        {copyError && (
          <>
            <p role="alert" className="studio-welcome-error">
              {copyError.message}
            </p>
            <p className="studio-welcome-prompt-text">
              {t(`prompts.${copyError.key}Prompt`)}
            </p>
          </>
        )}
      </section>

      {(preparing || sampleCards.length > 0) && (
        <section
          className="studio-welcome-section"
          aria-labelledby="welcome-samples"
        >
          <h3 id="welcome-samples">{t("samples.title")}</h3>
          {preparing ? (
            <p className="studio-welcome-hint" role="status">
              <Loader2 size={13} className="studio-spin" aria-hidden="true" />{" "}
              {t("samples.preparing")}
            </p>
          ) : (
            <div className="studio-welcome-samples">
              {sampleCards.map((key: SampleKey) => (
                <button
                  type="button"
                  key={key}
                  className="studio-welcome-sample"
                  data-sample={key}
                  onClick={(event) =>
                    samples?.state === "seeded" &&
                    onOpenSample(samples.projectId, samples.pages[key], event)
                  }
                >
                  <span aria-hidden="true">{SAMPLE_ICONS[key]}</span>
                  <strong>{t(`samples.${key}`)}</strong>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="studio-welcome-footer">
        <button
          type="button"
          className="studio-button primary"
          onClick={onCreateProject}
        >
          <Plus size={14} aria-hidden="true" />
          {t("welcome.newProject")}
        </button>
      </div>
    </div>
  );
}
