import { inlineStyleSheet, scopeReaderCss } from "./inline-style.mjs";

const sheets: string[] = [];
type Target = { root: HTMLElement; scoped: boolean };
const targets = new Set<Target>();

function append({ root, scoped }: Target, css: string) {
  const style = root.ownerDocument.createElement("style");
  style.dataset.showaiReaderStyle = root.id;
  style.textContent = scoped
    ? inlineStyleSheet(root.id, scopeReaderCss(css))
    : css;
  (scoped ? root : root.ownerDocument.head).append(style);
}

export function registerStyle(css: string) {
  sheets.push(css);
  for (const target of targets) append(target, css);
}

export function attachStyles(root: HTMLElement, { scoped = true } = {}) {
  const target = { root, scoped };
  targets.add(target);
  for (const css of sheets) append(target, css);
  return () => {
    targets.delete(target);
    root.ownerDocument
      .querySelectorAll(`style[data-showai-reader-style="${root.id}"]`)
      .forEach((style) => style.remove());
  };
}
