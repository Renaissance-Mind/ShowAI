import type { JSONContent } from "@tiptap/core";
import { visitContentNodes } from "../surface/document.mjs";
import { parsePageLink } from "../portable/page-link.mjs";
import { parsePageCell } from "../components/blocks/database-contract.mjs";
import { parameterValues } from "../portable/component-parameters.mjs";

/** Where a page refers to another page. */
export interface PageReferenceEdge {
  /** The page block holding the reference, addressable with page_read blockIds. */
  blockId: string | null;
  projectId: string;
  pageId: string;
  /** Blocks the reference points at on the target page. */
  blockIds: string[];
  /** link: a page link in text. database: a page cell. component: a field its contract declares. */
  kind: "link" | "database" | "component";
  /** Text around the reference, for people deciding whether to follow it. */
  snippet: string;
}

/** Page-reference field paths a component version declares, or none. */
export type ComponentPageFields = (
  componentId: string,
  version: string,
) => readonly string[] | undefined;

const SNIPPET = 200;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
function plainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  // A component inside the line, such as a date, reads as its text values.
  if (node.type === "inlineWidget") {
    const data = node.attrs?.data ?? {};
    return Object.values(data.props ?? data)
      .filter((value) => typeof value === "string")
      .join(" ");
  }
  return (node.content ?? []).map(plainText).join(" ");
}
/** The text of a block, a window around `focus` when it is long. */
function excerpt(text: string, focus = "") {
  const value = clean(text);
  if (value.length <= SNIPPET) return value;
  const at = focus ? value.indexOf(focus) : -1;
  const start = Math.max(
    0,
    Math.min(at < 0 ? 0 : at - SNIPPET / 3, value.length - SNIPPET),
  );
  return (
    (start ? "…" : "") +
    value.slice(start, start + SNIPPET).trim() +
    (start + SNIPPET < value.length ? "…" : "")
  );
}
/** Strings of an item, the reference itself left out. */
function itemText(value: unknown, skip: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.entries(value)
    .filter(
      ([key, item]) =>
        typeof item === "string" && item !== skip && !/^id$|Id$/.test(key),
    )
    .map(([, item]) => item)
    .join(" · ");
}
function valueAt(root: unknown, pointer: string): unknown {
  let value = root;
  for (const part of pointer.split("/").slice(1)) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    value = (value as Record<string, unknown> | undefined)?.[key];
  }
  return value;
}

/**
 * Every reference a page makes to other pages: page links in its text,
 * including text kept in component data and steps, page cells of databases,
 * and the fields components declare with a `page` parameter rule.
 */
export function pageReferenceEdges(
  document: { id: string; content: JSONContent },
  projectId: string,
  componentFields: ComponentPageFields = () => undefined,
): PageReferenceEdge[] {
  const edges: PageReferenceEdge[] = [];
  const seen = new Set<string>();
  // Text inside component data belongs to its component: page_read
  // addresses the component, not the nodes of its own text.
  const holders = new Map<JSONContent, { id: string | null; owned: boolean }>();
  const blockTexts = new Map<JSONContent, string>();
  const add = (
    holder: string | null,
    target: { projectId: string; pageId: string; blockIds?: string[] },
    kind: PageReferenceEdge["kind"],
    snippet: string,
  ) => {
    if (target.projectId === projectId && target.pageId === document.id)
      return;
    const key = `${holder}\n${target.projectId}\n${target.pageId}\n${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      blockId: holder,
      projectId: target.projectId,
      pageId: target.pageId,
      blockIds: target.blockIds ?? [],
      kind,
      snippet,
    });
  };
  visitContentNodes(document.content, (node: JSONContent, parent) => {
    const above = parent ? holders.get(parent) : undefined;
    const id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    const holder =
      above?.owned || (node.type === "doc" && parent?.type === "widget")
        ? { id: above?.id ?? null, owned: true }
        : { id: id ?? above?.id ?? null, owned: false };
    holders.set(node, holder);
    if (node.type === "text") {
      for (const mark of node.marks ?? []) {
        if (mark.type !== "link") continue;
        const target = parsePageLink(mark.attrs?.href);
        if (!target) continue;
        let text = parent ? blockTexts.get(parent) : undefined;
        if (parent && text === undefined)
          blockTexts.set(parent, (text = plainText(parent)));
        add(holder.id, target, "link", excerpt(text ?? "", node.text));
      }
      return;
    }
    if (node.type !== "widget" && node.type !== "inlineWidget") return;
    const kind = node.attrs?.kind;
    const data = node.attrs?.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") return;
    if (kind === "database" && Array.isArray(data.columns)) {
      const columns = (data.columns as { id: string; type: string }[]).filter(
        (column) => column?.type === "page",
      );
      const text = (data.columns as { id: string; type: string }[]).find(
        (column) => column?.type === "text",
      );
      for (const row of Array.isArray(data.rows) ? data.rows : [])
        for (const column of columns) {
          const target = parsePageCell(row?.[column.id]);
          if (target)
            add(
              holder.id,
              target,
              "database",
              excerpt(
                [data.title, text && row[text.id]]
                  .filter((part) => typeof part === "string" && part)
                  .join(" · "),
              ),
            );
        }
      return;
    }
    if (kind !== "custom") return;
    const fields =
      typeof data.componentId === "string" && typeof data.version === "string"
        ? componentFields(data.componentId, data.version)
        : undefined;
    if (!fields?.length) return;
    const props = data.props;
    for (const field of fields)
      for (const found of parameterValues(props, field, 5000)) {
        const target = parsePageLink(found.value);
        if (!target) continue;
        const parentPath = found.path.slice(0, found.path.lastIndexOf("/"));
        add(
          holder.id,
          target,
          "component",
          excerpt(
            itemText(valueAt(props, parentPath), found.value) ||
              itemText(props, found.value),
          ),
        );
      }
  });
  return edges;
}

/** Page-reference paths declared by a component's parameter contract. */
export function declaredPageFields(manifest: {
  documentation?: { usage?: { rules?: { kind: string; path?: string }[] } };
}): string[] {
  return (manifest.documentation?.usage?.rules ?? [])
    .filter((rule) => rule.kind === "page" && typeof rule.path === "string")
    .map((rule) => rule.path!);
}
