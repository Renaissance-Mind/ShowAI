// The one traversal over page content. No DOM dependencies.

const isRichDocument = (value) =>
  value.type === "doc" && Array.isArray(value.content);

/**
 * Rich-text trees a component keeps in its data: a text block's content,
 * callout and toggle bodies, stepper steps, a primitive's saved document.
 * Their nodes, including nested components, are part of the page.
 */
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

/** Returned by a visitor to leave the node's children (and held documents) unvisited. */
export const SKIP = Symbol("skip children");

const SCOPES = new Set(["tree", "content"]);

/**
 * Visit `root` and its descendants depth first, parents before children.
 *
 * `scope` is required. "tree" follows `node.content` only. "content" also
 * enters the documents components keep in their data (see widgetDocuments),
 * before the component's own `content`.
 *
 * The visitor receives the node and `{ parent, host, owner, index }`:
 * `parent` is the node whose content holds it (for the root of a held
 * document, the component holding it); `host` is the nearest component whose
 * data holds it and `owner` the outermost one, the block page_read addresses
 * (both null at the top level); `index` is its position in `parent.content`
 * (-1 for the root and held documents). Returning SKIP leaves its children
 * and held documents unvisited.
 */
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
