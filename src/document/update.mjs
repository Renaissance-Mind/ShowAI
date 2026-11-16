import {
  mapComponentContent,
  nodeComponentContract,
} from "./component-structure.mjs";
import { walk } from "./walk.mjs";

export function mapWidgetDocuments(data, map, contract) {
  return mapComponentContent(data, contract, map);
}

const SCOPES = new Set(["tree", "content"]);

export function mapNodes(root, map, options) {
  const scope = options?.scope;
  if (!SCOPES.has(scope))
    throw new TypeError(
      'mapNodes requires { scope: "tree" } or { scope: "content" }.',
    );
  const content = scope === "content";
  const replacements = new WeakMap();
  const step = (node, host, owner) => {
    let next = map(node, { host, owner });
    if (
      content &&
      (next.type === "widget" ||
        (next.type === "inlineWidget" && nodeComponentContract(next))) &&
      next.attrs?.data
    ) {
      const custom = next.attrs.kind === "custom";
      const source = custom ? next.attrs.data.props : next.attrs.data;
      const mapped = mapComponentContent(
        source,
        nodeComponentContract(next),
        (document) => step(document, next, owner ?? next),
        replacements,
      );
      const data =
        custom && mapped !== source
          ? { ...next.attrs.data, props: mapped }
          : custom
            ? next.attrs.data
            : mapped;
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
