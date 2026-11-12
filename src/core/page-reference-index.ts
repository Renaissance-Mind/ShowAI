import type { JSONContent } from "@tiptap/core";
import { visitContentNodes } from "../document/document.mjs";
import { parsePageLink } from "../portable/page-link.mjs";
import { parsePageCell } from "../components/blocks/database-contract.mjs";
import { parameterValues } from "../portable/component-parameters.mjs";
import { readBinding } from "../datasets/binding.mjs";
import { parsePath, valueAt as datasetValueAt } from "../datasets/operations.mjs";

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

/**
 * A database block whose rows live in a shared dataset. Its page cells are
 * read from the dataset, so the index resolves them once the dataset file is
 * read (boundDatabaseEdges) and reads the page again when the dataset changes.
 */
export interface BoundDatabase {
  blockId: string | null;
  /** Project and id of the dataset. */
  projectId: string;
  datasetId: string;
  /** The block's own data: its title and the props it keeps locally. */
  data: Record<string, unknown>;
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
  bound?: (database: BoundDatabase) => void,
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
    if (kind === "database") {
      const binding = readBinding(data);
      if (binding && typeof binding.dataset === "string") {
        bound?.({
          blockId: holder.id,
          projectId:
            typeof binding.project === "string" ? binding.project : projectId,
          datasetId: binding.dataset,
          data,
        });
        return;
      }
      for (const cell of databasePageCells(data))
        add(holder.id, cell.target, "database", cell.snippet);
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

/**
 * Page cells of a database's columns and rows. Only page columns refer to
 * pages: relation columns hold record ids of another dataset.
 */
function databasePageCells(data: Record<string, unknown>) {
  if (!Array.isArray(data.columns)) return [];
  const columns = data.columns as { id: string; type: string }[];
  const pages = columns.filter((column) => column?.type === "page");
  const text = columns.find((column) => column?.type === "text");
  const cells: {
    target: { projectId: string; pageId: string; blockIds?: string[] };
    snippet: string;
  }[] = [];
  for (const row of Array.isArray(data.rows) ? data.rows : [])
    for (const column of pages) {
      const target = parsePageCell(row?.[column.id]);
      if (target)
        cells.push({
          target,
          snippet: excerpt(
            [data.title, text && row[text.id]]
              .filter((part) => typeof part === "string" && part)
              .join(" · "),
          ),
        });
    }
  return cells;
}

/**
 * The page cells of a database block bound to a shared dataset, read from the
 * dataset's stored value the way the block resolves its props: the value (or
 * the object at binding.props.path) supplies every prop the block does not
 * keep locally. A dataset read from a file, a URL or a transform has no stored
 * value and contributes nothing.
 */
export function boundDatabaseEdges(
  database: BoundDatabase,
  datasetValue: unknown,
  page: { projectId: string; pageId: string },
): PageReferenceEdge[] {
  const binding = readBinding(database.data);
  const props = binding?.props as
    | { local?: string[]; path?: string }
    | undefined;
  if (!props) return [];
  const shared =
    props.path === undefined
      ? datasetValue
      : datasetValueAt(datasetValue, parsePath(props.path));
  if (!shared || typeof shared !== "object" || Array.isArray(shared)) return [];
  const merged: Record<string, unknown> = {
    ...(shared as Record<string, unknown>),
  };
  for (const key of props.local ?? [])
    if (key in database.data) merged[key] = database.data[key];
  const edges: PageReferenceEdge[] = [];
  const seen = new Set<string>();
  for (const cell of databasePageCells(merged)) {
    if (
      cell.target.projectId === page.projectId &&
      cell.target.pageId === page.pageId
    )
      continue;
    const key = `${cell.target.projectId}/${cell.target.pageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      blockId: database.blockId,
      projectId: cell.target.projectId,
      pageId: cell.target.pageId,
      blockIds: cell.target.blockIds ?? [],
      kind: "database",
      snippet: cell.snippet,
    });
  }
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
