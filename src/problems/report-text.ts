import { redact } from "../core/redact";
import type { ProblemDescription } from "./describe";
import { problemRedaction } from "./redaction";

export function problemReportText(problem: ProblemDescription) {
  return redact(
    [problem.title, problem.cause, problem.details].filter(Boolean).join("\n"),
    problemRedaction(),
  );
}
