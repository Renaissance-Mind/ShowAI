const reserved = new Set(["__proto__", "prototype", "constructor"]);
export const MAX_MINDMAP_NODES = 500;
export function validateMindmapData(data) {
  for (const key of ["title", "description"])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || data[key].length > 10000)
    )
      throw new Error(`mindmap.${key} must be text.`);
  if (
    data.height !== undefined &&
    (!Number.isFinite(data.height) || data.height < 240 || data.height > 1200)
  )
    throw new Error("Mind map height must be between 240 and 1200.");
  if (
    !Array.isArray(data.nodes) ||
    !data.nodes.length ||
    data.nodes.length > MAX_MINDMAP_NODES
  )
    throw new Error(`Mind map requires 1–${MAX_MINDMAP_NODES} nodes.`);
  if (data.layout !== undefined && !["radial", "tree"].includes(data.layout))
    throw new Error("Mind map layout must be radial or tree.");
  if (
    data.direction !== undefined &&
    !["right", "left"].includes(data.direction)
  )
    throw new Error("Mind map direction must be right or left.");
  const nodes = new Map();
  for (const node of data.nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      typeof node.id !== "string" ||
      !node.id.trim() ||
      node.id.length > 200 ||
      reserved.has(node.id) ||
      nodes.has(node.id)
    )
      throw new Error("Mind map node IDs must be unique, non-reserved text.");
    if (
      typeof node.label !== "string" ||
      !node.label.trim() ||
      node.label.length > 200
    )
      throw new Error("Mind map node labels require 1–200 characters.");
    if (
      node.parentId !== null &&
      (typeof node.parentId !== "string" || !node.parentId)
    )
      throw new Error("Mind map nodes require parentId (null for the root).");
    if (node.collapsed !== undefined && typeof node.collapsed !== "boolean")
      throw new Error("Mind map collapsed must be boolean.");
    nodes.set(node.id, node);
  }
  if (data.nodes.filter((node) => node.parentId === null).length !== 1)
    throw new Error("Mind map requires exactly one root.");
  const resolved = new Set();
  for (const node of data.nodes) {
    const path = new Set();
    let cursor = node;
    while (cursor && !resolved.has(cursor.id)) {
      if (path.has(cursor.id))
        throw new Error("Mind map cannot contain cycles.");
      path.add(cursor.id);
      if (cursor.parentId === null) break;
      cursor = nodes.get(cursor.parentId);
      if (!cursor) throw new Error("Mind map references a missing parent.");
    }
    for (const id of path) resolved.add(id);
  }
  return data;
}
export function mindmapChildren(data, id) {
  return data.nodes.filter((node) => node.parentId === id);
}
export function addMindmapNode(
  data,
  selected,
  id,
  relation = "child",
  before = false,
) {
  const target = data.nodes.find((node) => node.id === selected);
  if (!target) throw new Error("Selected mind map node is missing.");
  if (data.nodes.length >= MAX_MINDMAP_NODES)
    throw new Error("思维导图最多支持 500 个节点。");
  const parentId =
    relation === "sibling" && target.parentId !== null
      ? target.parentId
      : target.id;
  const node = {
    id,
    parentId,
    label: parentId === target.id ? "子主题" : "同级主题",
  };
  const nodes = data.nodes.map((item) =>
    item.id === parentId ? { ...item, collapsed: false } : item,
  );
  const index = nodes.findIndex((item) => item.id === target.id);
  nodes.splice(
    relation === "sibling" ? index + (before ? 0 : 1) : nodes.length,
    0,
    node,
  );
  return validateMindmapData({ ...data, nodes });
}
export function removeMindmapNode(data, id) {
  const target = data.nodes.find((node) => node.id === id);
  if (!target || target.parentId === null) return data;
  const removed = new Set([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index++)
    for (const child of mindmapChildren(data, queue[index])) {
      removed.add(child.id);
      queue.push(child.id);
    }
  return { ...data, nodes: data.nodes.filter((node) => !removed.has(node.id)) };
}
export function promoteMindmapNode(data, id) {
  const target = data.nodes.find((node) => node.id === id);
  const parent = data.nodes.find((node) => node.id === target?.parentId);
  if (!parent || parent.parentId === null) return data;
  const nodes = data.nodes.filter((node) => node.id !== id);
  nodes.splice(nodes.findIndex((node) => node.id === parent.id) + 1, 0, {
    ...target,
    parentId: parent.parentId,
  });
  return validateMindmapData({ ...data, nodes });
}
/** Keep branch rectangles disjoint in all four directions, including long titles. */
export function layoutMindmap(data, collapsed = new Set()) {
  const root = data.nodes.find((node) => node.parentId === null);
  const children = new Map(
    data.nodes.map((node) => [node.id, mindmapChildren(data, node.id)]),
  );
  const heights = new Map(),
    widths = new Map();
  const ownHeight = (node) =>
    Math.max(
      46,
      22 +
        Math.ceil(
          [...node.label].reduce(
            (sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.55),
            0,
          ) / 10,
        ) *
          20,
    );
  const visibleChildren = (node) =>
    collapsed.has(node.id) ? [] : children.get(node.id);
  const measure = (node) => {
    const list = visibleChildren(node);
    list.forEach(measure);
    heights.set(
      node.id,
      Math.max(
        ownHeight(node),
        list.reduce((sum, child) => sum + heights.get(child.id), 0) +
          Math.max(0, list.length - 1) * 18,
      ),
    );
    widths.set(
      node.id,
      Math.max(
        184,
        list.reduce((sum, child) => sum + widths.get(child.id), 0) +
          Math.max(0, list.length - 1) * 24,
      ),
    );
  };
  measure(root);
  const single = data.layout === "tree";
  const banks = [[], [], [], []];
  visibleChildren(root).forEach((node, index) => {
    banks[single ? 0 : index % 4].push({ node, color: index % 6 });
  });
  const placed = [
    {
      ...root,
      x: 0,
      y: -ownHeight(root) / 2,
      width: 184,
      height: ownHeight(root),
      side: 0,
      axis: "horizontal",
      depth: 0,
      color: -1,
    },
  ];
  const walkHorizontal = (node, depth, top, side, color) => {
    placed.push({
      ...node,
      x: side * depth * 244,
      y: top + (heights.get(node.id) - ownHeight(node)) / 2,
      width: 184,
      height: ownHeight(node),
      side,
      axis: "horizontal",
      depth,
      color,
    });
    const list = visibleChildren(node);
    const total =
      list.reduce((sum, child) => sum + heights.get(child.id), 0) +
      Math.max(0, list.length - 1) * 18;
    let cursor = top + (heights.get(node.id) - total) / 2;
    list.forEach((child) => {
      walkHorizontal(child, depth + 1, cursor, side, color);
      cursor += heights.get(child.id) + 18;
    });
  };
  banks.slice(0, 2).forEach((bank, index) => {
    const total =
      bank.reduce((sum, { node }) => sum + heights.get(node.id), 0) +
      Math.max(0, bank.length - 1) * 18;
    let cursor = -total / 2;
    const side = single
      ? data.direction === "left"
        ? -1
        : 1
      : index === 0
        ? 1
        : -1;
    bank.forEach(({ node, color }) => {
      walkHorizontal(node, 1, cursor, side, color);
      cursor += heights.get(node.id) + 18;
    });
  });
  const lower = Math.max(...placed.map((node) => node.y + node.height)) + 60;
  const upper = Math.min(...placed.map((node) => node.y)) - 60;
  const rank = Math.max(...data.nodes.map(ownHeight)) + 60;
  const walkVertical = (node, depth, left, side, color) => {
    placed.push({
      ...node,
      x: left + (widths.get(node.id) - 184) / 2,
      y:
        side > 0
          ? lower + (depth - 1) * rank
          : upper - ownHeight(node) - (depth - 1) * rank,
      width: 184,
      height: ownHeight(node),
      side,
      axis: "vertical",
      depth,
      color,
    });
    const list = visibleChildren(node);
    const total =
      list.reduce((sum, child) => sum + widths.get(child.id), 0) +
      Math.max(0, list.length - 1) * 24;
    let cursor = left + (widths.get(node.id) - total) / 2;
    list.forEach((child) => {
      walkVertical(child, depth + 1, cursor, side, color);
      cursor += widths.get(child.id) + 24;
    });
  };
  banks.slice(2).forEach((bank, index) => {
    const total =
      bank.reduce((sum, { node }) => sum + widths.get(node.id), 0) +
      Math.max(0, bank.length - 1) * 24;
    let cursor = 92 - total / 2;
    bank.forEach(({ node, color }) => {
      walkVertical(node, 1, cursor, index === 0 ? 1 : -1, color);
      cursor += widths.get(node.id) + 24;
    });
  });
  const minX = Math.min(...placed.map((node) => node.x)),
    minY = Math.min(...placed.map((node) => node.y));
  return {
    nodes: placed.map((node) => ({
      ...node,
      x: node.x - minX + 32,
      y: node.y - minY + 32,
    })),
    width: Math.max(...placed.map((node) => node.x + node.width)) - minX + 64,
    height: Math.max(...placed.map((node) => node.y + node.height)) - minY + 64,
  };
}
export function mindmapConnectionPath(parent, node) {
  if (node.axis === "vertical") {
    const x1 = parent.x + parent.width / 2,
      x2 = node.x + node.width / 2;
    const y1 = parent.y + (node.side > 0 ? parent.height : 0),
      y2 = node.y + (node.side > 0 ? 0 : node.height);
    if (parent.depth === 0) {
      // Leave the horizontal branch banks through the center corridor first.
      const lane = y2 + (node.side > 0 ? -30 : 30);
      return `M ${x1} ${y1} L ${x1} ${lane} C ${x1} ${lane}, ${x2} ${lane}, ${x2} ${y2}`;
    }
    const middle = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
  }
  const x1 = parent.x + (node.side > 0 ? parent.width : 0),
    x2 = node.x + (node.side > 0 ? 0 : node.width);
  const y1 = parent.y + parent.height / 2,
    y2 = node.y + node.height / 2,
    middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}
