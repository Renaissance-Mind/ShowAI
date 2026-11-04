import { SVG_ELEMENTS, safeSvgHref, safeSvgUrls } from "./svg-contract.mjs";

const ELEMENTS = new Set(SVG_ELEMENTS);
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Parses SVG source with the browser, keeps only drawing elements and safe
 * attributes, prefixes ids so several figures on one page cannot collide, and
 * turns data-note attributes into hover-note anchors. Returns null when the
 * source does not parse as an <svg> document.
 */
export function sanitizeSvg(
  source: string,
  prefix: string,
  labelledBy: string,
): { markup: string; notes: boolean } | null {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.namespaceURI !== SVG_NS ||
    root.localName !== "svg" ||
    parsed.getElementsByTagName("parsererror").length
  )
    return null;
  const ids = new Map<string, string>();
  for (const element of [root, ...Array.from(root.querySelectorAll("[id]"))]) {
    const id = element.getAttribute("id");
    if (id) ids.set(id, `${prefix}-${id}`);
  }
  const relink = (value: string) =>
    value
      .replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, _, id: string) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match,
      )
      .replace(/^#(.+)$/, (match, id: string) =>
        ids.has(id) ? `#${ids.get(id)}` : match,
      );
  let notes = false;
  const clean = (element: Element) => {
    for (const child of Array.from(element.children)) {
      if (child.namespaceURI !== SVG_NS || !ELEMENTS.has(child.localName))
        child.remove();
      else clean(child);
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name;
      const value = attribute.value;
      if (
        /^on/i.test(name) ||
        /javascript:/i.test(value) ||
        ((name === "href" || name === "xlink:href") && !safeSvgHref(value)) ||
        !safeSvgUrls(value)
      ) {
        element.removeAttribute(name);
        continue;
      }
      if (name === "id") element.setAttribute("id", ids.get(value) ?? value);
      else if (name === "data-note") {
        const note = value.trim();
        element.removeAttribute(name);
        if (!note) continue;
        notes = true;
        element.setAttribute("data-showai-note", note);
        element.setAttribute("tabindex", "0");
        element.setAttribute(
          "class",
          `${element.getAttribute("class") ?? ""} showai-note`.trim(),
        );
      } else if (value.includes("#")) element.setAttribute(name, relink(value));
    }
  };
  clean(root);
  root.removeAttribute("width");
  root.removeAttribute("height");
  root.setAttribute("role", "img");
  // A labelledby name keeps the host icon tooltip from covering the figure.
  root.setAttribute("aria-labelledby", labelledBy);
  root.setAttribute("class", "sv-figure");
  return { markup: new XMLSerializer().serializeToString(root), notes };
}
