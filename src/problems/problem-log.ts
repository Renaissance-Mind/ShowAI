import { redact } from "../core/redact";
import { problemRedaction } from "./redaction";

export interface LoggedProblem {
  at: string;
  source: string;
  code: string;
  message: string;
}

const LIMIT = 20;
const MESSAGE_LIMIT = 400;
const entries: LoggedProblem[] = [];

export function recordProblem(problem: LoggedProblem): void {
  const message = redact(problem.message, {
    ...problemRedaction(),
    truncateIds: true,
  })
    .replace(/\s+/g, " ")
    .trim();
  const entry = {
    at: problem.at,
    source: problem.source,
    code: problem.code,
    message:
      message.length > MESSAGE_LIMIT
        ? `${message.slice(0, MESSAGE_LIMIT)}…`
        : message,
  };
  const index = entries.findIndex(
    (item) =>
      item.at === entry.at &&
      item.source === entry.source &&
      item.code === entry.code,
  );
  if (index >= 0) entries.splice(index, 1);
  entries.push(entry);
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}

export function recentProblems(): LoggedProblem[] {
  return entries.map((item) => ({ ...item }));
}

export function clearProblemLog(): void {
  entries.length = 0;
}
