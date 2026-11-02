// Warnings of the data reading layer: why a dataset read returned stale or no
// data, or why it cannot be written. The same shape reaches the workbench
// (bound blocks), page_read bindings and dataset_read, so every reader
// explains a problem the same way and offers the same next steps.

/** Defaults by code: severity, the reading stage that failed, the next steps. */
export const WARNING_CODES = {
  /** An external file is not linked on this device. */
  SOURCE_NOT_LINKED: {
    level: "warning",
    stage: "location",
    actions: ["link-file"],
  },
  /** The linked file is missing or cannot be opened. */
  SOURCE_MISSING: {
    level: "warning",
    stage: "location",
    actions: ["retry", "link-file"],
  },
  /** An online source did not answer, or answered with an error. */
  SOURCE_UNREACHABLE: {
    level: "warning",
    stage: "location",
    actions: ["retry"],
  },
  /** The data was synchronized without its external file. */
  NOT_BUNDLED: { level: "warning", stage: "location", actions: ["link-file"] },
  /** The content is not valid for its format (JSON, CSV, TSV, XLSX). */
  PARSE_FAILED: {
    level: "error",
    stage: "format",
    actions: ["open-file", "retry"],
  },
  /** The content parsed but no longer satisfies the dataset's schema. */
  SHAPE_CHANGED: {
    level: "error",
    stage: "format",
    actions: ["open-file", "ask-agent"],
  },
  TRANSFORM_FAILED: {
    level: "error",
    stage: "transform",
    actions: ["ask-agent"],
  },
  OUTPUT_INVALID: {
    level: "error",
    stage: "transform",
    actions: ["ask-agent"],
  },
  /**
   * The source changed while it was being written, or a linked file and its
   * synchronized copy were both changed on different devices.
   */
  WRITE_CONFLICT: {
    level: "warning",
    stage: "writeback",
    actions: ["retry", "open-file"],
  },
  /** The source is read-only (online data, spreadsheets, stale copies). */
  READ_ONLY: { level: "info", stage: "writeback", actions: [] },
  /** The source is larger than a dataset may hold. */
  TOO_LARGE: { level: "error", stage: "capacity", actions: ["packaging"] },
};

/** Actions that act on a local file; an online source cannot take them. */
const FILE_ACTIONS = new Set(["link-file", "open-file"]);

/**
 * A warning about one dataset. `options` overrides the code's level, stage
 * or actions; `source: "url"` drops the file actions.
 */
export function datasetWarning(code, datasetId, message, options = {}) {
  const defaults = WARNING_CODES[code];
  if (!defaults) throw new Error(`Unknown dataset warning: ${code}`);
  const actions = (options.actions ?? defaults.actions).filter(
    (action) => options.source !== "url" || !FILE_ACTIONS.has(action),
  );
  return {
    code,
    level: options.level ?? defaults.level,
    stage: options.stage ?? defaults.stage,
    datasetId,
    message,
    actions,
  };
}
