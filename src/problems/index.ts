// Shared error presentation: describe a thrown value, show it with
// ProblemNotice, queue workbench problems, and redact details for reports.
export {
  describeError,
  problemFacts,
  problemCode,
  safetyText,
  actionLabel,
  configureProblemPlatform,
  revealLabel,
  type ProblemActionId,
  type ProblemContext,
  type ProblemDescription,
  type ProblemFacts,
  type ProblemSafety,
} from "./describe";
export {
  ProblemNotice,
  NoticeStack,
  ToastViewport,
  arrangeProblemActions,
  bindProblemActions,
  problemReportText,
  type ProblemAction,
  type ProblemLevel,
  type ProblemNoticeProps,
  type ProblemTone,
  type ToastItem,
  type ToastKind,
} from "./ProblemNotice";
export {
  labelProblem,
  useProblemQueue,
  useToasts,
  type QueuedProblem,
  type ReportOptions,
  type ToastOptions,
} from "./queue";
export {
  REPORT_PROBLEM_EVENT,
  dispatchReportProblem,
  onReportProblem,
  type ReportProblemDetail,
} from "./report-event";
export { configureProblemRedaction, problemRedaction } from "./redaction";
export {
  clearProblemLog,
  recentProblems,
  recordProblem,
  type LoggedProblem,
} from "./problem-log";
