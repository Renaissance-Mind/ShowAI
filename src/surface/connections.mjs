import {
  frameAnchor,
  normalizedAnchor,
  hitFrame,
  objectCapabilities,
  pointsBounds,
} from "./geometry.mjs";

export function indexSurfaceTree(content) {
  const index = new Map();
  const walk = (node, parent) => {
    if (node.attrs?.id) index.set(node.attrs.id, { node, parent });
    for (const child of node.content ?? []) walk(child, node);
  };
  walk(content, null);
  return index;
}
export function arrowEndpoints(node, frame) {
  const points = node.attrs.points,
    extent = node.attrs.extent;
  return [points[0], points.at(-1)].map((p) =>
    frameAnchor(frame, { x: p.x / extent[0], y: p.y / extent[1] }),
  );
}
export function boundEndpoints(node, frame, index, layout) {
  const endpoints = arrowEndpoints(node, frame);
  const parent = index.get(node.attrs.id)?.parent;
  for (const [i, key] of ["start", "end"].entries()) {
    const binding = node.attrs.bindings?.[key],
      target = binding && index.get(binding.targetId);
    const targetFrame = binding && layout[binding.targetId];
    if (
      target &&
      target.parent === parent &&
      targetFrame &&
      objectCapabilities(target.node).bindTarget
    )
      endpoints[i] = frameAnchor(targetFrame, binding.anchor);
  }
  return endpoints;
}
export function arrowFromEndpoints(
  node,
  frame,
  endpoints,
  bindings = node.attrs.bindings,
) {
  const bounds = pointsBounds(endpoints),
    padding = Math.max(4, node.attrs.strokeWidth * 2);
  const x = bounds.x - padding,
    y = bounds.y - padding;
  const width = bounds.width + padding * 2,
    height = bounds.height + padding * 2;
  const attrs = {
    ...node.attrs,
    extent: [width, height],
    points: endpoints.map((p) => ({ x: p.x - x, y: p.y - y })),
  };
  if (bindings && Object.keys(bindings).length) attrs.bindings = bindings;
  else delete attrs.bindings;
  const nextFrame = { ...frame, x, y, width, height };
  delete nextFrame.rotation;
  return { node: { ...node, attrs }, frame: nextFrame };
}
/** Resolve once after a logical edit. Invalidated bindings become stored free endpoints. */
export function reconcileConnections(document) {
  const index = indexSurfaceTree(document.content),
    replacements = new Map();
  let layout = document.layout;
  for (const [id, { node, parent }] of index) {
    if (
      node.type !== "drawing" ||
      node.attrs.tool !== "arrow" ||
      !node.attrs.bindings ||
      !layout?.[id]
    )
      continue;
    const bindings = {};
    for (const key of ["start", "end"]) {
      const binding = node.attrs.bindings[key],
        target = binding && index.get(binding.targetId);
      if (
        target &&
        target.parent === parent &&
        layout[binding.targetId] &&
        objectCapabilities(target.node).bindTarget
      )
        bindings[key] = binding;
    }
    const resolved = arrowFromEndpoints(
      node,
      layout[id],
      boundEndpoints(node, layout[id], index, layout),
      bindings,
    );
    if (
      JSON.stringify(resolved.node.attrs) !== JSON.stringify(node.attrs) ||
      JSON.stringify(resolved.frame) !== JSON.stringify(layout[id])
    ) {
      replacements.set(id, resolved.node);
      if (layout === document.layout) layout = { ...layout };
      layout[id] = resolved.frame;
    }
  }
  if (!replacements.size) return document;
  const walk = (node) => {
    if (replacements.has(node.attrs?.id))
      return replacements.get(node.attrs.id);
    if (!node.content) return node;
    const content = node.content.map(walk);
    return content.some((child, i) => child !== node.content[i])
      ? { ...node, content }
      : node;
  };
  document.content = walk(document.content);
  document.layout = layout;
  return document;
}
/** The last painted sibling wins. Endpoint targets never cross container coordinates. */
export function bindingAtPoint(
  document,
  parentId,
  point,
  tolerance = 0,
  excluded = new Set(),
) {
  const index = indexSurfaceTree(document.content),
    parent = index.get(parentId)?.node;
  for (const node of [...(parent?.content ?? [])].reverse()) {
    const id = node.attrs?.id,
      frame = document.layout?.[id];
    if (!frame || excluded.has(id) || !objectCapabilities(node).bindTarget)
      continue;
    if (hitFrame(frame, point, tolerance))
      return { targetId: id, anchor: normalizedAnchor(frame, point) };
  }
  return null;
}
