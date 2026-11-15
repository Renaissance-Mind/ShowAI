import { recordProblem } from "./problem-log";

export const REPORT_PROBLEM_EVENT = "showai:report-problem";

export interface ReportProblemDetail {
  source: string;
  code: string;
  message: string;
  at: string;
  action?: string;
}

declare global {
  interface WindowEventMap {
    [REPORT_PROBLEM_EVENT]: CustomEvent<ReportProblemDetail>;
  }
}

export function dispatchReportProblem(detail: ReportProblemDetail): boolean {
  recordProblem(detail);
  return window.dispatchEvent(
    new CustomEvent<ReportProblemDetail>(REPORT_PROBLEM_EVENT, {
      detail,
      cancelable: true,
    }),
  );
}

export function onReportProblem(
  listener: (detail: ReportProblemDetail) => void,
): () => void {
  const receive = (event: CustomEvent<ReportProblemDetail>) =>
    listener(event.detail);
  window.addEventListener(REPORT_PROBLEM_EVENT, receive);
  return () => window.removeEventListener(REPORT_PROBLEM_EVENT, receive);
}
