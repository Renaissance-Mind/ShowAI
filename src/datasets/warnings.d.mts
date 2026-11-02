export type WarningCode =
  | "SOURCE_NOT_LINKED"
  | "SOURCE_MISSING"
  | "SOURCE_UNREACHABLE"
  | "NOT_BUNDLED"
  | "PARSE_FAILED"
  | "SHAPE_CHANGED"
  | "TRANSFORM_FAILED"
  | "OUTPUT_INVALID"
  | "WRITE_CONFLICT"
  | "READ_ONLY"
  | "TOO_LARGE";
export type WarningLevel = "info" | "warning" | "error";
export type WarningStage =
  "location" | "format" | "transform" | "writeback" | "capacity";
export type WarningAction =
  "link-file" | "retry" | "open-file" | "ask-agent" | "packaging";

/** Why a dataset read returned stale or no data, or why it cannot be written. */
export interface DatasetWarning {
  code: WarningCode;
  level: WarningLevel;
  stage: WarningStage;
  datasetId: string;
  message: string;
  actions: WarningAction[];
}

/** How current the value of a read is. */
export type DatasetReadStatus = "ok" | "stale" | "empty";
/** Whether a dataset can be written: all of it, none, or these field paths. */
export type Editable = boolean | { paths: string[] };

export const WARNING_CODES: Record<
  WarningCode,
  { level: WarningLevel; stage: WarningStage; actions: WarningAction[] }
>;

export function datasetWarning(
  code: WarningCode,
  datasetId: string,
  message: string,
  options?: {
    level?: WarningLevel;
    stage?: WarningStage;
    actions?: WarningAction[];
    source?: "file" | "url";
  },
): DatasetWarning;
