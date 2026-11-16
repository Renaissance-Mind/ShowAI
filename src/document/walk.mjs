import {
  componentContentDocuments,
  nodeComponentContract,
} from "./component-structure.mjs";

export function widgetDocuments(data, contract) {
  return componentContentDocuments(data, contract);
}

export const SKIP = Symbol("skip children");

const SCOPES = new Set(["tree", "content"]);

export function walk(root, visit, options) {
  const scope = options?.scope;
  if (!SCOPES.has(scope))
    throw new TypeError(
      'walk requires { scope: "tree" } or { scope: "content" }.',
    );
  const content = scope === "content";
  const step = (node, parent, host, owner, index) => {
    if (visit(node, { parent, host, owner, index }) === SKIP) return;
    if (
      content &&
      (node.type === "widget" ||
        (node.type === "inlineWidget" && nodeComponentContract(node)))
    )
      for (const tree of widgetDocuments(
        node.attrs?.kind === "custom"
          ? node.attrs.data?.props
          : node.attrs?.data,
        nodeComponentContract(node),
      ))
        step(tree, node, node, owner ?? node, -1);
    if (Array.isArray(node.content))
      node.content.forEach((child, position) =>
        step(child, node, host, owner, position),
      );
  };
  step(
    root,
    options.parent ?? null,
    options.host ?? null,
    options.owner ?? options.host ?? null,
    -1,
  );
}
