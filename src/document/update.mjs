import { walk } from "./walk.mjs";

const isRichDocument = (value) =>
  value.type === "doc" && Array.isArray(value.content);

export function mapWidgetDocuments(data, map) {
  const step = (value) => {
    if (!value || typeof value !== "object") return value;
    if (isRichDocument(value)) return map(value);
    if (Array.isArray(value)) {
      const next = value.map(step);
      return next.some((item, index) => item !== value[index]) ? next : value;
    }
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const mapped = step(item);
      if (mapped !== item) changed = true;
      next[key] = mapped;
    }
    return changed ? next : value;
  };
  return step(data);
}

const SCOPES = new Set(["tree", "content"]);

function retargetLevelBindings(before, after, replacements) {
  if (!Array.isArray(before.levels)) return after;
  let changed = false;
  const levels = after.levels.map((level, index) => {
    const original = before.levels[index];
    if (!original?.content || !Array.isArray(level.bindings)) return level;
    const ids = new Map();
    walk(original.content, (node) => {
      const id = node.attrs?.id, next = replacements.get(node)?.attrs?.id;
      if (id && next && next !== id) ids.set(id, next);
    }, { scope: "tree" });
    if (!level.bindings.some((binding) => ids.has(binding.blockId))) return level;
    changed = true;
    return { ...level, bindings: level.bindings.map((binding) =>
      ids.has(binding.blockId) ? { ...binding, blockId: ids.get(binding.blockId) } : binding,
    ) };
  });
  return changed ? { ...after, levels } : after;
}

export function mapNodes(root, map, options) {
  const scope = options?.scope;
  if (!SCOPES.has(scope))
    throw new TypeError('mapNodes requires { scope: "tree" } or { scope: "content" }.');
  const content = scope === "content";
  const replacements = new WeakMap();
  const step = (node, host, owner) => {
    let next = map(node, { host, owner });
    if (content && next.type === "widget" && next.attrs?.data) {
      let data = mapWidgetDocuments(next.attrs.data, (document) =>
        step(document, next, owner ?? next),
      );
      if (next.attrs.kind === "multi-level-view" && data !== next.attrs.data)
        data = retargetLevelBindings(next.attrs.data, data, replacements);
      if (data !== next.attrs.data)
        next = { ...next, attrs: { ...next.attrs, data } };
    }
    if (Array.isArray(next.content)) {
      const children = next.content.map((child) => step(child, host, owner));
      if (children.some((child, index) => child !== next.content[index]))
        next = { ...next, content: children };
    }
    replacements.set(node, next);
    return next;
  };
  return step(root, options.host ?? null, options.owner ?? options.host ?? null);
}

export function findNodes(root, id, options) {
  const found = [];
  walk(root, (node, context) => {
    if (node.type !== "text" && node.attrs?.id === id)
      found.push({ node, ...context });
  }, options);
  return found;
}

export function addressNode(root, id) {
  const found = findNodes(root, id, { scope: "content" });
  const tree = found.find((match) => !match.host);
  if (tree) return tree;
  if (found.length > 1)
    throw new Error(
      `Block id ${id} names ${found.length} blocks nested in component content.`,
    );
  return found[0];
}

export function updateNode(root, id, update, options) {
  const found = findNodes(root, id, options);
  if (found.length !== 1)
    throw new Error(
      found.length
        ? `Node id ${id} names ${found.length} nodes.`
        : `Node ${id} does not exist.`,
    );
  const target = found[0].node;
  return mapNodes(root, (node) => (node === target ? update(node) : node), {
    scope: options.scope,
  });
}
