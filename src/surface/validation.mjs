import { objectCapabilities, bindingParent } from "./geometry.mjs";
import { isResource, fillResource, surfaceKind } from "./containers.mjs";
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
  if (isResource(document)) return validateResource(document);
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
    if (frame.rotation !== undefined) {
      const target = nodes.get(id);
      if (!objectCapabilities(target).rotate)
        throw new Error(`Rotation is not supported for ${id}.`);
      finite(frame.rotation, -360, 360, `layout.${id}.rotation`);
    }
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
  validateViews(
    document.views,
    ids,
    (document.content.content ?? []).map((node) => node.attrs.id),
  );
}
function validateViews(views, ids, rootIds) {
  object(views, "views");
  if (
    Object.keys(views).some(
      (key) => !["initial", "saved", "readingOrder"].includes(key),
    )
  )
    throw new Error("Unsupported view configuration.");
  const { saved, readingOrder } = views;
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
  views.initial ??= null;
  if (views.initial !== null && !viewIds.has(views.initial))
    throw new Error("The initial view does not exist.");
  if (
    !Array.isArray(readingOrder) ||
    new Set(readingOrder).size !== readingOrder.length ||
    readingOrder.some((id) => !rootIds.includes(id))
  )
    throw new Error("Reading order must contain unique root node ids.");
  views.readingOrder = [
    ...readingOrder,
    ...rootIds.filter((id) => !readingOrder.includes(id)),
  ];
}

function validateResource(document) {
  const ids = new Set(),
    nodes = new Map(),
    parents = new Map(),
    owners = new Map();
  const walk = (node, parent, owner) => {
    if (node.type === "text") return;
    const id = node.attrs?.id;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 200 ||
      reserved.has(id) ||
      ids.has(id)
    )
      throw new Error("Container nodes require unique, non-reserved ids.");
    ids.add(id);
    nodes.set(id, node);
    parents.set(id, parent);
    owners.set(id, owner);
    if (node.attrs?.canvas != null)
      throw new Error("Positions belong in layout.");
    if (node.type === "surface") {
      if (!["page", "board"].includes(node.attrs.kind))
        throw new Error("Surface kind must be page or board.");
      if (
        node.attrs.widthMode !== undefined &&
        (node.attrs.kind !== "page" ||
          !["standard", "wide", "full"].includes(node.attrs.widthMode))
      )
        throw new Error("Page width mode must be standard, wide or full.");
      if (parent && !["surface", "region"].includes(parent.type))
        throw new Error("A surface requires a container parent.");
      owner = node;
    }
    if (node.type === "drawing") {
      if (owner?.attrs.kind !== "board")
        throw new Error("Drawings belong inside a Board.");
      if (!["pen", "rectangle", "ellipse", "arrow"].includes(node.attrs.tool))
        throw new Error("Unknown drawing tool.");
      if (!/^#[0-9a-fA-F]{6}$/.test(node.attrs.color))
        throw new Error("Drawing color must be a six-digit hex value.");
      if (!Array.isArray(node.attrs.extent) || node.attrs.extent.length !== 2)
        throw new Error("Drawing extent requires width and height.");
      node.attrs.extent.forEach((value) =>
        finite(value, 1, 1000000, "drawing.extent"),
      );
      finite(node.attrs.strokeWidth, 0.5, 40, "drawing.strokeWidth");
      if (
        !Array.isArray(node.attrs.points) ||
        node.attrs.points.length < 2 ||
        node.attrs.points.length > 20000
      )
        throw new Error("A drawing needs 2–20000 points.");
      for (const point of node.attrs.points) {
        object(point, "drawing point");
        finite(point.x, -1000000, 1000000, "point.x");
        finite(point.y, -1000000, 1000000, "point.y");
      }
    }
    for (const child of node.content ?? []) walk(child, node, owner);
  };
  walk(document.content, null, null);
  for (const [id, node] of nodes) {
    if (node.attrs?.bindings === undefined) continue;
    if (node.type !== "drawing" || node.attrs.tool !== "arrow")
      throw new Error("Only arrows can define endpoint bindings.");
    object(node.attrs.bindings, "bindings");
    for (const [key, binding] of Object.entries(node.attrs.bindings)) {
      if (!["start", "end"].includes(key))
        throw new Error("Unknown arrow endpoint.");
      object(binding, "binding");
      if (
        Object.keys(binding).some(
          (field) => !["targetId", "anchor"].includes(field),
        )
      )
        throw new Error("Unsupported binding field.");
      const target = nodes.get(binding.targetId);
      if (
        !target ||
        parents.get(id) !== parents.get(binding.targetId) ||
        !objectCapabilities(target).bindTarget
      )
        throw new Error("Arrow bindings require a non-arrow sibling target.");
      object(binding.anchor, "binding.anchor");
      if (
        Object.keys(binding.anchor).some((field) => !["x", "y"].includes(field))
      )
        throw new Error("Unsupported anchor field.");
      finite(binding.anchor.x, 0, 1, "binding.anchor.x");
      finite(binding.anchor.y, 0, 1, "binding.anchor.y");
    }
  }
  if (document.views !== undefined)
    throw new Error("Version 3 stores views per surface in surfaceViews.");
  if (document.layout !== undefined) object(document.layout, "layout");
  if (document.surfaceViews !== undefined)
    object(document.surfaceViews, "surfaceViews");
  fillResource(document);
  for (const [id, node] of nodes) {
    const bindings = Object.values(node.attrs?.bindings ?? {});
    if (!bindings.length) continue;
    if (
      !bindingParent(parents.get(id), document.layout) ||
      !document.layout[id] ||
      bindings.some((binding) => !document.layout[binding.targetId])
    )
      throw new Error(
        "Arrow bindings require framed siblings in a Board or free-layout region.",
      );
  }
  for (const [id, frame] of Object.entries(document.layout)) {
    const node = nodes.get(id),
      parent = parents.get(id);
    if (!node || !parent || !["surface", "region"].includes(parent.type))
      throw new Error(`Layout requires a direct container child: ${id}.`);
    object(frame, `layout.${id}`);
    if (
      Object.keys(frame).some(
        (key) =>
          ![
            "x",
            "y",
            "width",
            "height",
            "heightMode",
            "rotation",
            "contentSize",
            "mode",
            "columns",
            "gap",
          ].includes(key),
      )
    )
      throw new Error("Unsupported layout field.");
    if (frame.contentSize !== undefined) {
      object(frame.contentSize, "layout.contentSize");
      if (
        node.type === "drawing" ||
        (node.type === "surface" && frame.heightMode !== "auto")
      )
        throw new Error("Content size hints require content-sized objects.");
      if (
        Object.keys(frame.contentSize).some(
          (key) => !["width", "height"].includes(key),
        )
      )
        throw new Error("Unsupported content size hint.");
      finite(frame.contentSize.width, 1, 10000, "contentSize.width");
      finite(frame.contentSize.height, 1, 1000000, "contentSize.height");
    }
    if (frame.rotation !== undefined) {
      const target = nodes.get(id);
      if (
        !objectCapabilities(target).rotate ||
        (frame.rotation !== 0 && !bindingParent(parent, document.layout))
      )
        throw new Error(`Rotation is not supported for ${id}.`);
      finite(frame.rotation, -360, 360, `layout.${id}.rotation`);
    }
    finite(frame.x, -1000000, 1000000, `layout.${id}.x`);
    finite(frame.y, -1000000, 1000000, `layout.${id}.y`);
    finite(
      frame.width,
      node.type === "drawing" ? 1 : 120,
      10000,
      `layout.${id}.width`,
    );
    if (frame.height !== undefined)
      finite(
        frame.height,
        node.type === "drawing" ? 1 : 40,
        1000000,
        `layout.${id}.height`,
      );
    if (
      frame.heightMode !== undefined &&
      (node.type !== "surface" ||
        !["fixed", "auto"].includes(frame.heightMode) ||
        (surfaceKind(node) === "board" && frame.heightMode === "auto"))
    )
      throw new Error(
        "Only embedded Pages support auto height; Boards use a fixed viewport.",
      );
    if (
      node.type !== "region" &&
      ["mode", "columns", "gap"].some((key) => frame[key] !== undefined)
    )
      throw new Error("Only regions can define mode, columns and gap.");
    if (
      frame.mode !== undefined &&
      !["flow", "grid", "free"].includes(frame.mode)
    )
      throw new Error("Unknown region layout.");
    if (frame.columns !== undefined) {
      finite(frame.columns, 1, 12, "columns");
      if (!Number.isInteger(frame.columns))
        throw new Error("Columns must be an integer.");
    }
    if (frame.gap !== undefined) finite(frame.gap, 0, 160, "gap");
  }
  for (const [id, views] of Object.entries(document.surfaceViews)) {
    const owner = nodes.get(id);
    if (owner?.type !== "surface")
      throw new Error("View owner must be an existing surface.");
    const descendants = new Set();
    visitNodes(owner, (node) => {
      if (node !== owner && node.attrs?.id) descendants.add(node.attrs.id);
    });
    validateViews(
      views,
      descendants,
      (owner.content ?? []).map((node) => node.attrs.id),
    );
  }
}
