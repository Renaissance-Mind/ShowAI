/**
 * A failed built-in Agent request or turn, shown with the shared problem
 * notice: a summary chosen by the host's problem code, the reason, actions
 * for that code, the original text collapsed, and the troubleshooting guide.
 */
import { useRef } from "react";
import type { AgentProblem, AgentProblemCode } from "../../agent-host/types";
import { translator } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/agentProblems";
import errorMessages from "../../i18n/messages/errors";
import { ExternalLink } from "../../ui/icons";
import {
  ProblemNotice,
  dispatchReportProblem,
  problemReportText,
  type ProblemAction,
  type ProblemDescription,
} from "../problems";
import {
  AGENT_HOSTS_GUIDE,
  AGENT_TROUBLESHOOTING,
  requestAgentSetup,
  type AgentSetupHandlers,
  type AgentStepKind,
} from "../AgentReadiness";

export type AgentProblemActionId =
  | "connectChatgpt"
  | "apiKey"
  | "useLocalCodex"
  | "retry"
  | "viewLog"
  | "openSettings"
  | "chooseModel"
  | "installSdk"
  | "newConversation"
  | "guide"
  | "recheck"
  | "report";

const codes = new Set<AgentProblemCode>([
  "no_model_source",
  "source_removed",
  "credentials_missing",
  "invalid_credentials",
  "rate_limited",
  "model_missing",
  "model_not_found",
  "runtime_missing",
  "agent_missing",
  "sign_in_required",
  "network",
  "sandbox",
  "process_exited",
  "timeout",
  "provider_error",
  "unknown",
]);

/** The host's classification carried by a thrown IPC error, if any. */
export function agentProblemOf(error: unknown): AgentProblem | null {
  const problem =
    error && typeof error === "object" && "problem" in error
      ? (error as { problem: unknown }).problem
      : undefined;
  if (
    problem &&
    typeof problem === "object" &&
    codes.has((problem as AgentProblem).code) &&
    typeof (problem as AgentProblem).summary === "string"
  )
    return problem as AgentProblem;
  return null;
}

/** An error the host didn't classify still gets retry and a report. */
export function unclassifiedProblem(error: unknown): AgentProblem {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  return {
    code: "unknown",
    summary: translator(messages)("summary.unknown"),
    detail: message,
  };
}

/** Readiness kinds whose status card already offers the same next steps. */
export function readinessKindOf(code: AgentProblemCode): AgentStepKind | null {
  const kinds: Partial<Record<AgentProblemCode, AgentStepKind>> = {
    no_model_source: "noSource",
    credentials_missing: "credentials",
    model_missing: "model",
    runtime_missing: "runtime",
    agent_missing: "agentMissing",
    sign_in_required: "signIn",
  };
  return kinds[code] ?? null;
}

/** Actions for a problem code, most useful first; the caller drops what it can't do. */
export function problemActions(
  problem: Pick<AgentProblem, "code" | "chatgpt">,
  options: { localCodex?: boolean } = {},
): AgentProblemActionId[] {
  const credential = problem.chatgpt ? "connectChatgpt" : "apiKey";
  switch (problem.code) {
    case "no_model_source":
      return [
        "connectChatgpt",
        "apiKey",
        ...(options.localCodex ? (["useLocalCodex"] as const) : []),
      ];
    case "source_removed":
      return ["newConversation", "openSettings"];
    case "credentials_missing":
    case "invalid_credentials":
      return [credential, "retry"];
    case "rate_limited":
    case "network":
    case "provider_error":
      return ["retry", "openSettings"];
    case "model_missing":
      return ["chooseModel"];
    case "model_not_found":
      return ["chooseModel", "retry"];
    case "runtime_missing":
      return ["installSdk"];
    case "agent_missing":
      return [
        "guide",
        "apiKey",
        ...(options.localCodex ? [] : (["recheck"] as const)),
      ];
    case "sign_in_required":
      return ["guide", "retry"];
    case "sandbox":
    case "process_exited":
    case "timeout":
      return ["retry", "viewLog"];
    case "unknown":
      return ["retry", "report"];
  }
}

const translateErrors = translator(errorMessages);

/** Notice parts for the shared ProblemNotice, in the current UI language. */
export function describeAgentProblem(
  problem: AgentProblem,
  t: ReturnType<typeof translator<(typeof messages)["catalogs"]["zh-CN"]>>,
  context: { agent?: string; at?: string } = {},
): ProblemDescription {
  const name = problem.name ?? "Agent";
  const title =
    problem.code === "unknown"
      ? problem.summary
      : problem.code === "process_exited" && problem.exitCode !== undefined
        ? t("summary.process_exited_code", { name, code: problem.exitCode })
        : t(`summary.${problem.code}`, { name });
  const status = problem.status ?? "";
  const cause =
    problem.code === "credentials_missing" ||
    problem.code === "invalid_credentials"
      ? t(`cause.${problem.code}.${problem.chatgpt ? "chatgpt" : "apiKey"}`, {
          status: status || "—",
        })
      : t(`cause.${problem.code}`, { status: status || "—" });
  const code = `AGENT_${problem.code.toUpperCase()}`;
  const at = context.at ?? new Date().toISOString();
  const lines: [string, string | number | undefined][] = [
    [translateErrors("detail.code"), code],
    // The execution label already names itself, e.g. 执行：DeepSeek · model.
    ["", context.agent],
    [translateErrors("detail.status"), problem.status],
    [t("detail.exitCode"), problem.exitCode],
    [translateErrors("detail.time"), at],
    [translateErrors("detail.message"), problem.detail ?? problem.summary],
  ];
  return {
    title,
    cause,
    actions: [],
    details: lines
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) =>
        !key
          ? String(value)
          : String(value).includes("\n")
            ? `${key}:\n${value}`
            : `${key}: ${value}`,
      )
      .join("\n"),
    code,
    message: problem.detail ?? problem.summary,
    source: "agent",
    at,
  };
}

export function AgentProblemNotice({
  problem,
  safety,
  setup,
  agent,
  at,
  compact = false,
  onRetry,
  onNewConversation,
}: {
  problem: AgentProblem;
  /** "input": the request was not sent and stays in the input; "page": the turn left the page unchanged. */
  safety?: "input" | "page";
  setup: AgentSetupHandlers;
  /** Execution label for the details, e.g. "Codex" or "DeepSeek · model". */
  agent?: string;
  at?: string;
  /** The readiness card above already offers the actions; keep only the reassurance. */
  compact?: boolean;
  onRetry?: () => void;
  onNewConversation?: () => void;
}) {
  const t = useTranslator(messages);
  const box = useRef<HTMLDivElement>(null);
  const description = describeAgentProblem(problem, t, { agent, at });
  const open = (intent: "chatgpt" | "apiKey") => () => {
    requestAgentSetup(intent);
    setup.onOpenSettings();
  };
  const handlers: Partial<Record<AgentProblemActionId, () => void>> = {
    connectChatgpt: open("chatgpt"),
    apiKey: open("apiKey"),
    useLocalCodex: setup.onUseLocalCodex,
    retry: onRetry,
    viewLog: () => {
      const details = box.current?.querySelector("details");
      if (!details) return;
      details.open = true;
      details.scrollIntoView({ block: "nearest" });
    },
    openSettings: setup.onOpenSettings,
    chooseModel: setup.onOpenSettings,
    installSdk: setup.onOpenSettings,
    newConversation: onNewConversation,
    guide: () => window.open(AGENT_HOSTS_GUIDE, "_blank", "noreferrer"),
    recheck: setup.onRecheck,
    report: () =>
      dispatchReportProblem({
        source: description.source,
        code: description.code,
        message: problemReportText(description),
        at: description.at,
      }),
  };
  const actions: ProblemAction[] = problemActions(problem, {
    localCodex: !!setup.onUseLocalCodex,
  }).flatMap((id) => {
    const onSelect = handlers[id];
    return onSelect ? [{ label: t(`action.${id}`), onSelect }] : [];
  });
  // Unclassified failures always offer a report, even without a retry.
  if (problem.code === "unknown" && !actions.length)
    actions.push({ label: t("action.report"), onSelect: handlers.report! });
  const reassurance = safety
    ? t(safety === "input" ? "safety.inputKept" : "safety.pageUnchanged")
    : "";
  return (
    <div className="assistant-problem" ref={box}>
      {!compact && (
        <ProblemNotice
          problem={description}
          level="banner"
          tone={problem.code === "rate_limited" ? "warning" : "error"}
          actions={actions}
        />
      )}
      <p className="assistant-problem-meta">
        {reassurance && <span>{reassurance}</span>}
        <a href={AGENT_TROUBLESHOOTING} target="_blank" rel="noreferrer">
          <ExternalLink size={11} aria-hidden="true" />
          {t("troubleshooting")}
        </a>
      </p>
    </div>
  );
}
