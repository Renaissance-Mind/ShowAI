// Immutable updates over page content, including documents components hold
// in their data. Untouched branches keep their identity. No DOM dependencies.
import { walk } from "./walk.mjs";

const isRichDocument = (value) =>
  value.type === "doc" && Array.isArray(value.content);

/**
 * Component data with each held rich-text document replaced by
 * `map(document)`. Finds the same documents as widgetDocuments, in the same
 * order; data whose documents all come back unchanged is returned as is.
 */
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

/**
 * Rebuild `root` with `map(node, { host, owner })` applied to every node in
 * the scope, parents first; the children of the returned node are mapped
 * next. `map` returns the node itself to keep it. With scope "content", a
 * changed node inside a component's held document is written back into that
 * component's data, and every ancestor on the way up is copied once.
 */
export function mapNodes(root, map, options) {
  const scope = options?.scope;
  if (!SCOPES.has(scope))
    throw new TypeError('mapNodes requires { scope: "tree" } or { scope: "content" }.');
  const content = scope === "content";
  const step = (node, host, owner) => {
    let next = map(node, { host, owner });
    if (content && next.type === "widget" && next.attrs?.data) {
      const data = mapWidgetDocuments(next.attrs.data, (document) =>
        step(document, next, owner ?? next),
      );
      if (data !== next.attrs.data)
        next = { ...next, attrs: { ...next.attrs, data } };
    }
    if (Array.isArray(next.content)) {
      const children = next.content.map((child) => step(child, host, owner));
      if (children.some((child, index) => child !== next.content[index]))
        next = { ...next, content: children };
    }
    return next;
  };
  return step(root, options.host ?? null, options.owner ?? options.host ?? null);
}

/** Every identified node with this id in the scope, with its walk context. */
export function findNodes(root, id, options) {
  const found = [];
  walk(root, (node, context) => {
    if (node.type !== "text" && node.attrs?.id === id)
      found.push({ node, ...context });
  }, options);
  return found;
}

/**
 * The node page operations address by `id`: a node of the page tree when
 * one has the id (the root included), otherwise the one node with the id
 * inside documents components hold. Undefined when no node has it; throws
 * when only nested nodes have it and there are several.
 */
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

/**
 * `root` with the one node named `id` replaced by `update(node)`. With scope
 * "content" the node may sit in a document a component holds; the change is
 * written back into that component's data. Throws when the id names no node
 * or several.
 */
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
