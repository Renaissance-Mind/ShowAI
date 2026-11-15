export const WARNING_CODES = {
  SOURCE_NOT_LINKED: {
    level: "warning",
    stage: "location",
    actions: ["link-file"],
  },
  SOURCE_MISSING: {
    level: "warning",
    stage: "location",
    actions: ["retry", "link-file"],
  },
  SOURCE_UNREACHABLE: {
    level: "warning",
    stage: "location",
    actions: ["retry"],
  },
  NOT_BUNDLED: { level: "warning", stage: "location", actions: ["link-file"] },
  PARSE_FAILED: {
    level: "error",
    stage: "format",
    actions: ["open-file", "retry"],
  },
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
  WRITE_CONFLICT: {
    level: "warning",
    stage: "writeback",
    actions: ["retry", "open-file"],
  },
  READ_ONLY: { level: "info", stage: "writeback", actions: [] },
  TOO_LARGE: { level: "error", stage: "capacity", actions: ["packaging"] },
};

const FILE_ACTIONS = new Set(["link-file", "open-file"]);

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
