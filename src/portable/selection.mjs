import { reconcileSurface, visitNodes } from "../surface/document.mjs";
import { validateDocument } from "./validation.mjs";

/** Project a page into selected subtrees and the containers needed to render them. */
export function selectDocumentBlocks(source, blockIds) {
  if (
    !Array.isArray(blockIds) ||
    !blockIds.length ||
    blockIds.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(blockIds).size !== blockIds.length
  )
    throw new Error("Block selection requires non-empty, unique block ids.");
  const document = structuredClone(source);
  const available = new Set();
  visitNodes(document.content, (node) => {
    if (node.attrs?.id && !["doc", "text"].includes(node.type))
      available.add(node.attrs.id);
  });
  const missing = blockIds.filter((id) => !available.has(id));
  if (missing.length)
    throw new Error(
      `Selected blocks not found in this page: ${missing.join(", ")}`,
    );
  const selected = new Set(blockIds);
  const prune = (node) => {
    if (selected.has(node.attrs?.id)) return node;
    const content = (node.content ?? []).map(prune).filter(Boolean);
    if (!content.length) return null;
    return {
      ...node,
      ...(node.type === "toggle"
        ? { attrs: { ...node.attrs, open: true } }
        : {}),
      content,
    };
  };
  document.content.content = (document.content.content ?? [])
    .map(prune)
    .filter(Boolean);
  // Page decorations and comments are outside the requested content projection.
  document.cover = "";
  document.icon = "";
  document.comments = [];
  if (document.content.type === "surface") {
    reconcileSurface(document, { clone: false });
    // A saved camera focus is a view over the original page, not this selection.
    if (document.surfaceViews)
      for (const views of Object.values(document.surfaceViews))
        views.initial = null;
    else document.views.initial = null;
  }
  return validateDocument(document);
}
