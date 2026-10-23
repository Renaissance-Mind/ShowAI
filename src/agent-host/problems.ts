import { homedir } from "node:os";
import { redact } from "../core/redact";
import { translator } from "../i18n";
import messages from "../i18n/messages/agentProblems";
import type { AgentProblem, AgentProblemCode } from "./types";

const t = translator(messages);

/** Longest original text kept with a problem; stderr can reach 64 KB. */
export const PROBLEM_DETAIL_LIMIT = 4000;

/** Redacts secrets and the home path, keeping the last part of long output. */
export function problemDetail(text: string | undefined): string | undefined {
  const clean = redact((text ?? "").trim(), { home: homedir() });
  if (!clean) return undefined;
  return clean.length > PROBLEM_DETAIL_LIMIT
    ? `${t("detail.truncated", { count: PROBLEM_DETAIL_LIMIT })}\n…${clean.slice(-PROBLEM_DETAIL_LIMIT)}`
    : clean;
}

export function problemSummary(problem: Omit<AgentProblem, "summary">): string {
  const name = problem.name ?? "Agent";
  if (problem.code === "process_exited" && problem.exitCode !== undefined)
    return t("summary.process_exited_code", { name, code: problem.exitCode });
  return t(`summary.${problem.code}`, { name });
}

/** A failure the host already understands; travels through IPC as `problem`. */
export class AgentFailure extends Error {
  readonly problem: AgentProblem;
  constructor(problem: Omit<AgentProblem, "summary"> & { summary?: string }) {
    const { detail: raw, ...rest } = problem;
    const detail = problemDetail(raw);
    const full: AgentProblem = {
      ...rest,
      summary: problem.summary ?? problemSummary(problem),
      ...(detail ? { detail } : {}),
    };
    super(full.summary);
    this.name = "AgentFailure";
    this.problem = full;
  }
}

/** Last provider failure seen by the model gateway during one run. */
export interface GatewayFailure {
  status?: number;
  code?: string;
  message: string;
  network?: boolean;
}

export function gatewayProblem(
  failure: GatewayFailure,
  context: { chatgpt?: boolean; name?: string } = {},
): AgentFailure {
  const { status, code } = failure;
  const kind: AgentProblemCode = failure.network
    ? "network"
    : status === 401 || status === 403
      ? "invalid_credentials"
      : status === 429 || code === "insufficient_quota"
        ? "rate_limited"
        : status === 404 || code === "model_not_found"
          ? "model_not_found"
          : "provider_error";
  return new AgentFailure({
    code: kind,
    detail: failure.message,
    ...(status ? { status } : {}),
    ...context,
  });
}

const PATTERNS: [AgentProblemCode, RegExp][] = [
  [
    "sign_in_required",
    /Authentication required|login_required|Failed to authenticate|OAuth session expired|Please run .*login|Not logged in/i,
  ],
  [
    "invalid_credentials",
    /\b(?:401|403)\b.*(?:unauthori[sz]ed|forbidden|invalid|api key)|invalid[_ ]api[_ ]key|incorrect api key|unauthori[sz]ed/i,
  ],
  [
    "rate_limited",
    /\b429\b|rate[_ ]limit|too many requests|insufficient_quota|quota exceeded|exceeded your current quota/i,
  ],
  [
    "model_not_found",
    /model[_ ]not[_ ]found|model .*does not exist|unknown model|no such model|invalid model/i,
  ],
  [
    "network",
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|fetch failed|stream disconnected|error sending request|connection refused|dns error|certificate|getaddrinfo/i,
  ],
  [
    "sandbox",
    /sandbox(?:ed)? (?:denied|error|violation)|seatbelt|Operation not permitted|blocked by (?:the )?sandbox|outside (?:of )?the (?:writable|workspace)/i,
  ],
];

/** Recognizes a well-known failure in Agent output; null when nothing matches. */
export function matchProblem(text: string): AgentProblemCode | null {
  for (const [code, pattern] of PATTERNS) if (pattern.test(text)) return code;
  return null;
}

/**
 * Turns whatever a run threw into a classified problem. Known failures keep
 * their classification; process exits look for a recognizable reason in
 * stderr first; everything else is matched by text or stays `unknown`.
 */
export function classifyFailure(
  error: unknown,
  context: { name?: string; chatgpt?: boolean; output?: string } = {},
): AgentProblem {
  const credentials = (code: AgentProblemCode) =>
    context.chatgpt !== undefined &&
    (code === "invalid_credentials" || code === "credentials_missing")
      ? { chatgpt: context.chatgpt }
      : {};
  if (error instanceof AgentFailure) {
    const problem = error.problem;
    // Exits and unfinished runs often name their reason in stderr.
    if (problem.code !== "process_exited" && problem.code !== "unknown")
      return problem;
    const specific = matchProblem(
      `${problem.detail ?? ""}\n${context.output ?? ""}`,
    );
    if (!specific) return problem;
    const next = {
      ...problem,
      code: specific,
      ...credentials(specific),
    };
    return { ...next, summary: problemSummary(next) };
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = matchProblem(`${message}\n${context.output ?? ""}`);
  // The Codex SDK reports a failed child process as "exited with code N".
  const exit = /exited with code (\d+)/i.exec(message);
  return new AgentFailure({
    code: code ?? (exit ? "process_exited" : "unknown"),
    detail: message,
    ...(exit && !code ? { exitCode: Number(exit[1]) } : {}),
    ...(context.name ? { name: context.name } : {}),
    ...(code ? credentials(code) : {}),
  }).problem;
}
