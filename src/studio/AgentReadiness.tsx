import { useCallback, useEffect, useState } from "react";
import type { AgentHostStatus } from "../agent-host/types";
import type { PluginHost } from "../plugin/desktop-install";
import { desktop, errorMessage } from "./bridge";
import { remoteExecution } from "./AgentExecution";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/onboarding";
import assistantMessages from "../i18n/messages/assistant";
import agentHostMessages from "../i18n/messages/agentHost";
import { ExternalLink, Flag, Loader2, RefreshCw, Settings2 } from "../ui/icons";
import feedbackMessages from "../i18n/messages/feedback";
import { redact } from "../core/redact";
import { dispatchReportProblem } from "./problems/report-event";
import { problemRedaction } from "./problems/redaction";
import "./onboarding.css";

export const AGENT_HOSTS_GUIDE = "https://showai.renaissancemind.ai/doc/agent-hosts";
export const AGENT_TROUBLESHOOTING =
  "https://showai.renaissancemind.ai/doc/agent-troubleshooting";

export const localAgentNames: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  kimi: "Kimi",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};

/** What keeps the built-in Agent from running, decided from the host status. */
export type AgentReadiness =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "agentMissing"; name: string }
  | { kind: "signIn"; name: string }
  | { kind: "noSource" }
  | { kind: "credentials"; name: string; chatgpt: boolean }
  | { kind: "model"; name: string }
  | { kind: "runtime" };
export type AgentStepKind = Exclude<AgentReadiness["kind"], "checking" | "ready">;

const loopback = ["127.0.0.1", "localhost", "[::1]"];

export function agentReadiness(status: AgentHostStatus): AgentReadiness {
  // Remote execution (iPad) is checked by the device that runs the turn.
  if (status.executionKind) return { kind: "ready" };
  const { settings } = status;
  if (settings.mode === "local") {
    const name = localAgentNames[settings.localAgent] ?? settings.localAgent;
    if (!status.agents.length) return { kind: "checking" };
    const agent = status.agents.find((item) => item.id === settings.localAgent);
    if (!agent?.path) return { kind: "agentMissing", name };
    if (agent.auth === "missing") return { kind: "signIn", name };
    return { kind: "ready" };
  }
  const source = settings.sources.find((item) => item.id === settings.sourceId);
  if (!source) return { kind: "noSource" };
  const chatgpt = source.credential === "chatgpt";
  const local = URL.canParse(source.baseUrl)
    ? loopback.includes(new URL(source.baseUrl).hostname)
    : false;
  if (
    !source.hosted &&
    (chatgpt ? !source.connected : !source.apiKeyPresent && !local)
  )
    return { kind: "credentials", name: source.name, chatgpt };
  if (!source.model) return { kind: "model", name: source.name };
  if (status.runtime.state !== "ready") return { kind: "runtime" };
  return { kind: "ready" };
}

const errorKinds: [AgentStepKind, (keyof (typeof agentHostMessages)["catalogs"]["zh-CN"])[]][] =
  [
    ["agentMissing", ["task.agentMissing", "agent.notFound"]],
    ["signIn", ["task.signInRequired", "agent.signInExpired", "agent.codexSignIn"]],
    [
      "credentials",
      [
        "source.saveApiKey",
        "source.select",
        "conversation.sourceMissing",
        "chatgpt.connectFirst",
        "chatgpt.expired",
        "chatgpt.reauthorizePlan",
        "chatgpt.disconnected",
      ],
    ],
    ["model", ["task.chooseModel"]],
    ["runtime", ["runtime.installFirst"]],
  ];

/** Setup errors from the Agent host, recognized in either UI language. */
export function agentErrorKind(message: string): AgentStepKind | null {
  for (const [kind, keys] of errorKinds)
    for (const catalog of Object.values(agentHostMessages.catalogs))
      if (
        keys.some((key) => {
          const text = (catalog as Record<string, unknown>)[key];
          return typeof text === "string" && message.includes(text);
        })
      )
        return kind;
  return null;
}

/** Maps an MCP clientInfo name to the plugin host it belongs to. */
export function connectionHost(client: string): PluginHost | null {
  const name = client.toLowerCase();
  if (name.includes("claude")) return "claude";
  if (name.includes("codex")) return "codex";
  if (/deepseek|\bdsh\b|cordis/.test(name)) return "deepseek";
  return null;
}

/** Built-in Agent status, scanning local agents once when none were detected yet. */
export function useAgentStatus(
  active: boolean,
  projectId: string | null,
  revision = 0,
) {
  const [status, setStatus] = useState<AgentHostStatus | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    void desktop
      .invoke<AgentHostStatus>("agent:status", { projectId })
      .then(async (value) => {
        if (stopped) return;
        setStatus(value);
        setError("");
        if (
          !remoteExecution() &&
          value.settings.mode === "local" &&
          !value.agents.length
        ) {
          const scanned = await desktop.invoke<AgentHostStatus>("agent:scan");
          if (!stopped) setStatus(scanned);
        }
      })
      .catch((reason) => {
        if (stopped) return;
        setStatus(null);
        setError(errorMessage(reason));
      });
    return () => {
      stopped = true;
    };
  }, [active, projectId, revision]);
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(
        await desktop.invoke<AgentHostStatus>(
          remoteExecution() ? "agent:status" : "agent:scan",
        ),
      );
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setChecking(false);
    }
  }, []);
  return { status, error, checking, recheck };
}

/** "Runs with Codex" / "Runs with DeepSeek · model", or empty while unknown. */
export function useExecutionLabel(status: AgentHostStatus | null) {
  const t = useTranslator(assistantMessages);
  if (!status) return "";
  const { settings } = status;
  if (settings.mode === "local")
    return t("panel.agentLocal", {
      name: localAgentNames[settings.localAgent] ?? settings.localAgent,
    });
  const source = settings.sources.find((item) => item.id === settings.sourceId);
  return source
    ? t("panel.agentApi", { source: source.name, model: source.model || "—" })
    : "";
}

export function readinessText(
  t: ReturnType<typeof useTranslator<(typeof messages)["catalogs"]["zh-CN"]>>,
  readiness: AgentReadiness,
) {
  switch (readiness.kind) {
    case "checking":
      return t("status.checking");
    case "ready":
      return t("status.ready");
    case "agentMissing":
      return t("status.agentMissing", { name: readiness.name });
    case "signIn":
      return t("status.signIn", { name: readiness.name });
    case "noSource":
      return t("status.noSource");
    case "credentials":
      return t("status.apiKey", { name: readiness.name });
    case "model":
      return t("status.model", { name: readiness.name });
    case "runtime":
      return t("status.runtime");
  }
}

/** Next-step actions for a setup problem: docs, Agent settings and a fresh check. */
export function AgentNextSteps({
  kind,
  chatgpt = false,
  checking,
  onOpenSettings,
  onRecheck,
}: {
  kind: AgentStepKind;
  chatgpt?: boolean;
  checking: boolean;
  onOpenSettings: () => void;
  onRecheck: () => void;
}) {
  const t = useTranslator(messages);
  const guide = kind === "agentMissing" || kind === "signIn";
  const apiKey =
    kind === "agentMissing" ||
    kind === "noSource" ||
    (kind === "credentials" && !chatgpt);
  const settings = (kind === "credentials" && chatgpt) || kind === "model" || kind === "runtime";
  return (
    <div className="onboarding-steps" role="group" aria-label={t("steps.label")}>
      {guide && (
        <a
          className="onboarding-step"
          href={AGENT_HOSTS_GUIDE}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={12} aria-hidden="true" />
          {t("steps.guide")}
        </a>
      )}
      {apiKey && (
        <button type="button" className="onboarding-step" onClick={onOpenSettings}>
          <Settings2 size={12} aria-hidden="true" />
          {t("steps.apiKey")}
        </button>
      )}
      {settings && (
        <button type="button" className="onboarding-step" onClick={onOpenSettings}>
          <Settings2 size={12} aria-hidden="true" />
          {t("steps.settings")}
        </button>
      )}
      {kind !== "model" && (
        <button
          type="button"
          className="onboarding-step"
          disabled={checking}
          onClick={onRecheck}
        >
          {checking ? (
            <Loader2 size={12} className="studio-spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={12} aria-hidden="true" />
          )}
          {t("steps.recheck")}
        </button>
      )}
    </div>
  );
}

/** Leading CODE of an Agent error ("INVALID_DATA: …", "ENOSPC …"), if any. */
export function agentErrorCode(message: string): string {
  return /^\s*([A-Z][A-Z0-9_]{2,})\b/.exec(message)?.[1] ?? "AGENT_ERROR";
}

/**
 * Next steps under an Agent error ShowAI does not recognize: the
 * troubleshooting page, and 报告问题 with the error prefilled.
 */
export function AgentHelpSteps({ message }: { message: string }) {
  const t = useTranslator(feedbackMessages);
  const tr = useTranslator(messages);
  return (
    <div className="onboarding-steps" role="group" aria-label={tr("steps.label")}>
      <a
        className="onboarding-step"
        href={AGENT_TROUBLESHOOTING}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink size={12} aria-hidden="true" />
        {t("agent.faq")}
      </a>
      <button
        type="button"
        className="onboarding-step"
        onClick={() =>
          dispatchReportProblem({
            source: "agent",
            code: agentErrorCode(message),
            message: redact(message, problemRedaction()),
            at: new Date().toISOString(),
          })
        }
      >
        <Flag size={12} aria-hidden="true" />
        {t("agent.report")}
      </button>
    </div>
  );
}

/** Current execution source and state, with a way to change it. */
export function AgentStatusRow({
  status,
  error,
  checking,
  onOpenSettings,
  onRecheck,
}: {
  status: AgentHostStatus | null;
  error: string;
  checking: boolean;
  onOpenSettings: () => void;
  onRecheck: () => void;
}) {
  const t = useTranslator(messages);
  const label = useExecutionLabel(status);
  const readiness: AgentReadiness = status
    ? agentReadiness(status)
    : { kind: "checking" };
  const state = error
    ? "error"
    : readiness.kind === "ready"
      ? "ready"
      : readiness.kind === "checking"
        ? "checking"
        : "blocked";
  return (
    <section
      className="onboarding-status"
      data-state={state}
      aria-label={t("status.label")}
    >
      <div className="onboarding-status-line">
        <span className="onboarding-status-dot" aria-hidden="true" />
        <span className="onboarding-status-source">
          {label || t("builtin.title")}
        </span>
        <button
          type="button"
          className="onboarding-status-change"
          onClick={onOpenSettings}
        >
          {t("status.change")}
        </button>
      </div>
      <p className="onboarding-status-text" role="status">
        {error
          ? t("status.unavailable", { error })
          : readinessText(t, readiness)}
      </p>
      {error ? (
        <AgentNextSteps
          kind="runtime"
          checking={checking}
          onOpenSettings={onOpenSettings}
          onRecheck={onRecheck}
        />
      ) : (
        readiness.kind !== "ready" &&
        readiness.kind !== "checking" && (
          <AgentNextSteps
            kind={readiness.kind}
            chatgpt={readiness.kind === "credentials" && readiness.chatgpt}
            checking={checking}
            onOpenSettings={onOpenSettings}
            onRecheck={onRecheck}
          />
        )
      )}
    </section>
  );
}
