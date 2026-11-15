export function validateRegionData(data, depth = 0) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("region data must be an object.");
  if (depth > 16) throw new Error("region blocks exceed 16 nested containers.");
  for (const key of Object.keys(data))
    if (
      !["name", "mode", "columns", "gap", "minColumnWidth", "blocks"].includes(
        key,
      )
    )
      throw new Error(`Unknown region property: ${key}.`);
  if (
    data.name !== undefined &&
    (typeof data.name !== "string" || data.name.length > 200)
  )
    throw new Error("region.name must be a string up to 200 characters.");
  if (data.mode !== undefined && !["flow", "grid", "free"].includes(data.mode))
    throw new Error("region.mode must be flow, grid or free.");
  for (const [key, min, max] of [
    ["columns", 1, 12],
    ["gap", 0, 160],
    ["minColumnWidth", 120, 1200],
  ]) {
    const value = data[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) ||
        value < min ||
        value > max ||
        (key === "columns" && !Number.isInteger(value)))
    )
      throw new Error(
        `region.${key} must be ${min}–${max}${key === "columns" ? " (integer)" : ""}.`,
      );
  }
  if (data.blocks !== undefined) {
    if (!Array.isArray(data.blocks) || data.blocks.length > 200)
      throw new Error(
        "region.blocks must be an array with at most 200 entries.",
      );
    for (const [i, block] of data.blocks.entries()) {
      if (
        !block ||
        typeof block !== "object" ||
        typeof block.kind !== "string" ||
        !block.kind ||
        !block.data ||
        typeof block.data !== "object" ||
        Array.isArray(block.data) ||
        Object.keys(block).some((key) => !["kind", "data"].includes(key))
      )
        throw new Error(`region.blocks[${i}] must be {kind,data}.`);
      if (block.kind === "region") validateRegionData(block.data, depth + 1);
    }
  }
}

export function regionGridStyle(frame = {}) {
  const columns = frame.columns ?? 2,
    gap = frame.gap ?? 24,
    minWidth = frame.minColumnWidth ?? 320;
  return {
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(${minWidth}px, calc((100% - ${(columns - 1) * gap}px) / ${columns}))), 1fr))`,
    gap,
  };
}
