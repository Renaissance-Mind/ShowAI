import type { BindingIssue } from "./binding.mjs";
import type {
  DatasetReadStatus,
  DatasetWarning,
  Editable,
  WarningAction,
  WarningLevel,
  WarningStage,
} from "./warnings.mjs";

export interface WarningEntry {
  key: string;
  level: WarningLevel;
  code: DatasetWarning["code"] | "ISSUE";
  title: string;
  detail?: string;
  dataset?: string;
  datasetId?: string;
  stage?: WarningStage | "binding";
  actions: WarningAction[];
  transient?: boolean;
}

export interface WarningEntryInput {
  datasetId: string;
  name?: string;
  names: Record<string, string>;
  status: DatasetReadStatus;
  warnings: DatasetWarning[];
  datasetEditable: Editable;
  blockEditable: Editable;
  pageEditable: boolean;
  source?: { kind?: "file" | "url"; format: string };
  transform?: boolean;
  issues: BindingIssue[];
  rejection?: string;
  available: Partial<Record<WarningAction, boolean>>;
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

const ORDER: Record<WarningLevel, number> = { error: 0, warning: 1, info: 2 };

export function warningEntries(
  input: WarningEntryInput,
  t: Translate,
): WarningEntry[] {
  const nameOf = (id: string) =>
    id === input.datasetId ? (input.name ?? id) : (input.names[id] ?? id);
  const actions = (list: WarningAction[], datasetId: string) =>
    list.filter(
      (action) =>
        input.available[action] &&
        (action !== "packaging" || datasetId === input.datasetId),
    );
  const entries: WarningEntry[] = input.warnings.map((warning, index) => ({
    key: `warning:${index}:${warning.datasetId}:${warning.code}`,
    level: warning.level,
    code: warning.code,
    title: t(`warning.${warning.code}`),
    detail: warning.message,
    dataset: nameOf(warning.datasetId),
    datasetId: warning.datasetId,
    stage: warning.stage,
    actions: actions(warning.actions, warning.datasetId),
  }));
  if (
    input.pageEditable &&
    input.status === "ok" &&
    input.datasetEditable !== true
  )
    entries.push({
      key: "read-only",
      level: "info",
      code: "READ_ONLY",
      title:
        input.blockEditable === false ? t("readOnly") : t("partlyReadOnly"),
      detail: input.transform
        ? t("readOnlyTransform")
        : input.source?.kind === "url"
          ? t("readOnlyUrl")
          : input.source
            ? t("readOnlyFile", { format: input.source.format.toUpperCase() })
            : t("readOnlyProject"),
      dataset: input.name ?? input.datasetId,
      datasetId: input.datasetId,
      stage: input.transform ? "transform" : "writeback",
      actions: [],
    });
  input.issues.forEach((issue, index) =>
    entries.push({
      key: `issue:${index}`,
      level: "info",
      code: "ISSUE",
      title: t("issues"),
      detail: issue.message,
      dataset: input.name ?? input.datasetId,
      datasetId: input.datasetId,
      stage: "binding",
      actions: [],
    }),
  );
  if (input.rejection)
    entries.unshift({
      key: "rejection",
      level: "info",
      code: "READ_ONLY",
      title: input.rejection,
      dataset: input.name ?? input.datasetId,
      datasetId: input.datasetId,
      stage: "writeback",
      actions: [],
      transient: true,
    });
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Number(!!b.entry.transient) - Number(!!a.entry.transient) ||
        ORDER[a.entry.level] - ORDER[b.entry.level] ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}

export function topLevel(entries: WarningEntry[]): WarningLevel | undefined {
  return entries.reduce<WarningLevel | undefined>(
    (top, entry) =>
      !top || ORDER[entry.level] < ORDER[top] ? entry.level : top,
    undefined,
  );
}

export function agentRequest(entry: WarningEntry, t: Translate): string {
  return t("askAgentPrompt", {
    name: entry.dataset ?? entry.datasetId ?? "",
    id: entry.datasetId ?? "",
    code: entry.code,
    message: entry.detail ?? entry.title,
  });
}

export interface ResourceProblem {
  status: "missing" | "failed";
  name: string;
  message?: string;
  located: boolean;
}

export function resourceEntry(
  problem: ResourceProblem,
  available: Partial<Record<WarningAction, boolean>>,
  t: Translate,
): WarningEntry {
  const code = problem.status === "missing" ? "SOURCE_MISSING" : "PARSE_FAILED";
  const actions: WarningAction[] = [
    "link-file",
    ...(problem.located ? (["open-file"] as const) : []),
    "retry",
  ];
  return {
    key: `resource:${code}`,
    level: problem.status === "missing" ? "warning" : "error",
    code,
    title: t(`resource.${code}`),
    ...(problem.message ? { detail: problem.message } : {}),
    dataset: t("resourceLabel", { name: problem.name }),
    stage: problem.status === "missing" ? "location" : "format",
    actions: actions.filter((action) => available[action]),
  };
}
