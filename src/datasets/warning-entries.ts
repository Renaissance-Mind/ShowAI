// What a bound block lists in its warning popover: the reading layer's
// warnings, why parts of it are read-only, mapping issues of its binding and
// a change the host just rejected. Pure, so the list can be tested without a
// workbench.

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
  /** A reading-layer code, or "ISSUE" for a mapping issue of the binding. */
  code: DatasetWarning["code"] | "ISSUE";
  title: string;
  /** The precise cause (the warning's message, an issue or rejection text). */
  detail?: string;
  /** Name of the dataset the entry is about. */
  dataset?: string;
  datasetId?: string;
  stage?: WarningStage | "binding";
  actions: WarningAction[];
  /** Shown only for a moment, right after the change it explains. */
  transient?: boolean;
}

export interface WarningEntryInput {
  datasetId: string;
  name?: string;
  /** Names of other datasets the warnings refer to, by id. */
  names: Record<string, string>;
  status: DatasetReadStatus;
  warnings: DatasetWarning[];
  /** Whether the dataset accepts writes. */
  datasetEditable: Editable;
  /** What the block can change; false also when the page is read-only. */
  blockEditable: Editable;
  /** The page lets this block change (an editable page, not a reader). */
  pageEditable: boolean;
  source?: { kind?: "file" | "url"; format: string };
  transform?: boolean;
  issues: BindingIssue[];
  /** Text of a change the host just rejected. */
  rejection?: string;
  /** Which actions this block can carry out here. */
  available: Partial<Record<WarningAction, boolean>>;
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

const ORDER: Record<WarningLevel, number> = { error: 0, warning: 1, info: 2 };

/** Entries in display order: errors first, then warnings, then information. */
export function warningEntries(
  input: WarningEntryInput,
  t: Translate,
): WarningEntry[] {
  const nameOf = (id: string) =>
    id === input.datasetId ? (input.name ?? id) : (input.names[id] ?? id);
  const actions = (list: WarningAction[]) =>
    list.filter((action) => input.available[action]);
  const entries: WarningEntry[] = input.warnings.map((warning, index) => ({
    key: `warning:${index}:${warning.datasetId}:${warning.code}`,
    level: warning.level,
    code: warning.code,
    title: t(`warning.${warning.code}`),
    detail: warning.message,
    dataset: nameOf(warning.datasetId),
    datasetId: warning.datasetId,
    stage: warning.stage,
    actions: actions(warning.actions),
  }));
  // A stale or empty read already says why nothing can be written.
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

/** The most severe level among entries; undefined without entries. */
export function topLevel(entries: WarningEntry[]): WarningLevel | undefined {
  return entries.reduce<WarningLevel | undefined>(
    (top, entry) =>
      !top || ORDER[entry.level] < ORDER[top] ? entry.level : top,
    undefined,
  );
}

/** The request an Agent receives for a warning it can help with. */
export function agentRequest(entry: WarningEntry, t: Translate): string {
  return t("askAgentPrompt", {
    name: entry.dataset ?? entry.datasetId ?? "",
    id: entry.datasetId ?? "",
    code: entry.code,
    message: entry.detail ?? entry.title,
  });
}
