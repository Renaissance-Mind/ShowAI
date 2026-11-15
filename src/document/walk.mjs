const isRichDocument = (value) =>
  value.type === "doc" && Array.isArray(value.content);

export function widgetDocuments(data) {
  const found = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    if (isRichDocument(value)) found.push(value);
    else (Array.isArray(value) ? value : Object.values(value)).forEach(collect);
  };
  collect(data);
  return found;
}

export const SKIP = Symbol("skip children");

const SCOPES = new Set(["tree", "content"]);

export function walk(root, visit, options) {
  const scope = options?.scope;
  if (!SCOPES.has(scope))
    throw new TypeError('walk requires { scope: "tree" } or { scope: "content" }.');
  const content = scope === "content";
  const step = (node, parent, host, owner, index) => {
    if (visit(node, { parent, host, owner, index }) === SKIP) return;
    if (content && node.type === "widget")
      for (const tree of widgetDocuments(node.attrs?.data))
        step(tree, node, node, owner ?? node, -1);
    if (Array.isArray(node.content))
      node.content.forEach((child, position) =>
        step(child, node, host, owner, position),
      );
  };
  step(root, options.parent ?? null, options.host ?? null, options.owner ?? options.host ?? null, -1);
}
