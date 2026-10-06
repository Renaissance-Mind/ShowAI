import { fillSurfaceLayout, visitNodes } from "./document.mjs";
const reserved = new Set(["__proto__", "constructor", "prototype"]);
const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
};
const finite = (value, min, max, label) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${label} must be between ${min} and ${max}.`);
};
export function validateSurface(document) {
  const ids = new Set(),
    nodes = new Map();
  visitNodes(document.content, (node) => {
    if (["surface", "text"].includes(node.type)) return;
    const id = node.attrs?.id;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 200 ||
      reserved.has(id) ||
      ids.has(id)
    )
      throw new Error("Whiteboard nodes require unique, non-reserved ids.");
    ids.add(id);
    nodes.set(id, node);
    if (node.attrs?.canvas != null)
      throw new Error(
        "Whiteboard positions belong in layout, not attrs.canvas.",
      );
  });
  if (document.layout !== undefined) object(document.layout, "layout");
  fillSurfaceLayout(document);
  for (const [id, frame] of Object.entries(document.layout)) {
    if (!ids.has(id))
      throw new Error(`Layout references an unknown node: ${id}.`);
    object(frame, `layout.${id}`);
    if (
      Object.keys(frame).some(
        (key) =>
          !["x", "y", "width", "height", "mode", "columns", "gap"].includes(
            key,
          ),
      )
    )
      throw new Error(`Unsupported layout field for ${id}.`);
    finite(frame.x, -1000000, 1000000, `layout.${id}.x`);
    finite(frame.y, -1000000, 1000000, `layout.${id}.y`);
    finite(frame.width, 120, 10000, `layout.${id}.width`);
    if (frame.height !== undefined)
      finite(frame.height, 40, 1000000, `layout.${id}.height`);
    if (
      frame.mode !== undefined &&
      (nodes.get(id).type !== "region" ||
        !["flow", "grid", "free"].includes(frame.mode))
    )
      throw new Error(`Invalid region layout: ${id}.`);
    if (
      nodes.get(id).type !== "region" &&
      (frame.columns !== undefined || frame.gap !== undefined)
    )
      throw new Error(`Only regions can define columns and gap: ${id}.`);
    if (frame.columns !== undefined) {
      finite(frame.columns, 1, 12, `layout.${id}.columns`);
      if (!Number.isInteger(frame.columns))
        throw new Error("Grid columns must be an integer.");
    }
    if (frame.gap !== undefined) finite(frame.gap, 0, 160, `layout.${id}.gap`);
  }
  object(document.views, "views");
  if (
    Object.keys(document.views).some(
      (key) => !["initial", "saved", "readingOrder"].includes(key),
    )
  )
    throw new Error("Unsupported view configuration.");
  const { saved, readingOrder } = document.views;
  if (!Array.isArray(saved) || saved.length > 100)
    throw new Error("At most 100 saved views are supported.");
  const viewIds = new Set();
  for (const view of saved) {
    object(view, "view");
    if (
      Object.keys(view).some((key) => !["id", "name", "targets"].includes(key))
    )
      throw new Error("Unsupported saved view field.");
    if (
      typeof view.id !== "string" ||
      !view.id.trim() ||
      view.id.length > 200 ||
      reserved.has(view.id) ||
      viewIds.has(view.id)
    )
      throw new Error("Saved views require unique ids.");
    viewIds.add(view.id);
    if (
      typeof view.name !== "string" ||
      !view.name.trim() ||
      view.name.length > 200
    )
      throw new Error("Saved views require a name of at most 200 characters.");
    if (
      !Array.isArray(view.targets) ||
      !view.targets.length ||
      view.targets.length > 1000 ||
      new Set(view.targets).size !== view.targets.length ||
      view.targets.some((id) => !ids.has(id))
    )
      throw new Error("Saved view targets must reference existing nodes.");
  }
  document.views.initial ??= null;
  if (document.views.initial !== null && !viewIds.has(document.views.initial))
    throw new Error("The initial view does not exist.");
  const rootIds = (document.content.content ?? []).map((node) => node.attrs.id);
  if (
    !Array.isArray(readingOrder) ||
    new Set(readingOrder).size !== readingOrder.length ||
    readingOrder.some((id) => !rootIds.includes(id))
  )
    throw new Error("Reading order must contain unique root node ids.");
  document.views.readingOrder = [
    ...readingOrder,
    ...rootIds.filter((id) => !readingOrder.includes(id)),
  ];
}
