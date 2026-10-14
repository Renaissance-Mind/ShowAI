import { inlineStyleSheet, scopeReaderCss } from "./inline-style.mjs";

// The CDN build turns each stylesheet import into a registerStyle() call, so
// styles of lazily loaded blocks arrive with their chunk and reach every
// mounted reader.
const sheets: string[] = [];
const roots = new Set<HTMLElement>();

function append(root: HTMLElement, css: string) {
  const style = root.ownerDocument.createElement("style");
  style.dataset.showaiReaderStyle = "";
  style.textContent = inlineStyleSheet(root.id, scopeReaderCss(css));
  root.append(style);
}

export function registerStyle(css: string) {
  sheets.push(css);
  for (const root of roots) append(root, css);
}

/** Applies every registered and future stylesheet inside `root`. */
export function attachStyles(root: HTMLElement) {
  roots.add(root);
  for (const css of sheets) append(root, css);
  return () => {
    roots.delete(root);
    root
      .querySelectorAll(":scope > style[data-showai-reader-style]")
      .forEach((style) => style.remove());
  };
}
