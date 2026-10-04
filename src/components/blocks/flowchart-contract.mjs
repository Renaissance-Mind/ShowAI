const kinds = new Set([
  "request",
  "skill",
  "decision",
  "reference",
  "query",
  "result",
]);
const reserved = new Set(["__proto__", "prototype", "constructor"]);
function label(value, name, required = false, max = 10000) {
  if (value === undefined && !required) return;
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new Error(`${name} must be ${required ? "non-empty " : ""}text.`);
}
function unique(items, name, limit) {
  if (!Array.isArray(items) || items.length > limit)
    throw new Error(`${name} must contain at most ${limit} items.`);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`${name} requires objects.`);
    label(item.id, `${name}.id`, true, 200);
    if (reserved.has(item.id) || ids.has(item.id))
      throw new Error(`${name} requires unique, non-reserved IDs.`);
    ids.add(item.id);
  }
  return ids;
}
export function validateFlowchartData(data) {
  label(data.title, "flowchart.title");
  label(data.description, "flowchart.description");
  if (
    data.height !== undefined &&
    (!Number.isFinite(data.height) || data.height < 360 || data.height > 1200)
  )
    throw new Error("Flowchart height must be between 360 and 1200.");
  unique(data.flows, "flowchart.flows", 20);
  for (const flow of data.flows) {
    label(flow.label, "flow.label", true, 200);
    label(flow.description, "flow.description");
    if (flow.direction !== undefined && !["TB", "LR"].includes(flow.direction))
      throw new Error("Flow direction must be TB or LR.");
    const ids = unique(flow.nodes, "flow.nodes", 200);
    unique(flow.edges, "flow.edges", 400);
    for (const node of flow.nodes) {
      label(node.label, "node.label", true, 200);
      label(node.subtitle, "node.subtitle", false, 300);
      label(node.detail, "node.detail");
      for (const side of ["sourceSide", "targetSide"]) {
        if (
          node[side] !== undefined &&
          !["top", "bottom", "left", "right"].includes(node[side])
        )
          throw new Error(`${side} must be a valid connection side.`);
      }
      if (node.kind !== undefined && !kinds.has(node.kind))
        throw new Error("Unsupported flow node kind.");
      for (const key of ["commands", "references"]) {
        if (node[key] === undefined) continue;
        if (!Array.isArray(node[key]) || node[key].length > 30)
          throw new Error(`${key} must have at most 30 entries.`);
        node[key].forEach((item) => label(item, key, true, 3000));
      }
      if (
        node.position &&
        (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
      )
        throw new Error("Node positions must be finite.");
    }
    for (const edge of flow.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target))
        throw new Error(`Flow edge ${edge.id} references a missing node.`);
      label(edge.label, "edge.label", false, 300);
    }
  }
  return data;
}
