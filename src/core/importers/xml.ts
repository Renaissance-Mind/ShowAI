// A small XML reader for the parts of Office documents: elements with their
// qualified names, attributes and children. Office XML is well formed and
// has no DTDs, so entities are the five predefined ones and character
// references.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
function unescape(text: string): string {
  return text.includes("&")
    ? text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
        if (entity[0] !== "#") return ENTITIES[entity] ?? whole;
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      })
    : text;
}

const TAG =
  /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("<", index);
    const end = open < 0 ? source.length : open;
    if (end > index) {
      const text = source.slice(index, end);
      if (stack.length > 1) stack.at(-1)!.children.push(unescape(text));
    }
    if (open < 0) break;
    const after = (marker: string) => {
      const close = source.indexOf(marker, open);
      if (close < 0)
        throw new Error(`Malformed XML: unterminated markup at ${open}.`);
      return close;
    };
    if (source.startsWith("<?", open)) index = after("?>") + 2;
    else if (source.startsWith("<!--", open)) index = after("-->") + 3;
    else if (source.startsWith("<![CDATA[", open)) {
      const close = after("]]>");
      stack.at(-1)!.children.push(source.slice(open + 9, close));
      index = close + 3;
    } else if (source.startsWith("<!", open)) index = after(">") + 1;
    else {
      TAG.lastIndex = open;
      const match = TAG.exec(source);
      if (!match) throw new Error(`Malformed XML near character ${open}.`);
      const [, closing, name, attributes, selfClosing] = match;
      if (closing) {
        const current = stack.pop();
        if (!current || current.name !== name)
          throw new Error(`Mismatched XML end tag </${name}>.`);
      } else {
        const attrs: Record<string, string> = {};
        for (const [, key, double, single] of attributes.matchAll(ATTR))
          attrs[key] = unescape(double ?? single ?? "");
        const element: XmlElement = { name, attrs, children: [] };
        stack.at(-1)!.children.push(element);
        if (!selfClosing) stack.push(element);
      }
      index = TAG.lastIndex;
    }
  }
  if (stack.length !== 1) throw new Error("Malformed XML: unclosed elements.");
  return root;
}

export const elements = (node: XmlElement, name?: string): XmlElement[] =>
  node.children.filter(
    (child): child is XmlElement =>
      typeof child !== "string" && (!name || child.name === name),
  );
export const child = (node: XmlElement | undefined, name: string) =>
  node ? elements(node, name)[0] : undefined;
/** Every descendant with this name, in document order. */
export function descendants(node: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (current: XmlElement) => {
    for (const item of elements(current)) {
      if (item.name === name) found.push(item);
      visit(item);
    }
  };
  visit(node);
  return found;
}
export function textOf(node: XmlElement): string {
  return node.children
    .map((item) => (typeof item === "string" ? item : textOf(item)))
    .join("");
}
