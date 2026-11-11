import type { JSONContent } from "@tiptap/core";
import type { PageRecord } from "../core/model";
import type { ShowDocument } from "../types";

/**
 * What an Agent needs after a page state change, without the document. Built
 * after the transaction commits, when the record carries its revision.
 */
export function pageStateReceipt(record: PageRecord, projectId?: string) {
  return {
    ...(projectId ? { projectId } : {}),
    pageId: record.document.id,
    title: record.document.title,
    hash: record.hash,
    ...(record.revision ? { revision: record.revision } : {}),
    archived: !!record.document.archived,
    pinned: !!record.document.favorite,
    ...(record.document.parentId ? { parentId: record.document.parentId } : {}),
  };
}

/** Ids per kind of change; long lists keep their first ids and report the total. */
export interface BlockChanges {
  added: string[];
  removed: string[];
  changed: string[];
  moved: string[];
  /** Total per kind when a list was cut to RECEIPT_IDS entries. */
  counts?: { added: number; removed: number; changed: number; moved: number };
  /** Title or other page fields changed. */
  page?: true;
}

const RECEIPT_IDS = 100;

interface Entry {
  own: string;
  parentId: string | null;
  afterId: string | null;
}

/** Each identified block's own attributes and direct text, with its place. */
function blocks(document: ShowDocument): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const visit = (node: JSONContent, parentId: string | null) => {
    let previous: string | null = null;
    for (const child of node.content ?? []) {
      if (child.type === "text") continue;
      const id = child.attrs?.id;
      if (typeof id === "string") {
        const { content, ...rest } = child;
        entries.set(id, {
          own: JSON.stringify([
            rest,
            (content ?? []).filter((item) => item.type === "text"),
          ]),
          parentId,
          afterId: previous,
        });
        visit(child, id);
        previous = id;
      } else visit(child, parentId);
    }
  };
  visit(document.content, null);
  return entries;
}

function pageFields(document: ShowDocument) {
  const {
    content,
    createdAt: _created,
    updatedAt: _updated,
    // Layout and views follow the blocks; inserting one is not a page-level change.
    surfaceViews: _views,
    layout: _layout,
    ...rest
  } = document;
  return JSON.stringify([rest, content.type, content.attrs ?? null]);
}

/**
 * Which blocks a save added, removed, changed or moved, compared by their own
 * attributes and text. One serialization pass per document, so receipts stay
 * cheap on large pages; page_diff gives the field-level comparison.
 */
export function blockChanges(
  before: ShowDocument,
  after: ShowDocument,
): BlockChanges {
  const old = blocks(before),
    next = blocks(after);
  const added: string[] = [],
    removed: string[] = [],
    changed: string[] = [],
    moved: string[] = [];
  for (const id of old.keys()) if (!next.has(id)) removed.push(id);
  for (const [id, entry] of next) {
    const previous = old.get(id);
    if (!previous) {
      added.push(id);
      continue;
    }
    if (previous.own !== entry.own) changed.push(id);
    if (previous.parentId !== entry.parentId) moved.push(id);
    else if (previous.afterId !== entry.afterId) {
      // Inserting or removing a sibling shifts the next one without moving it.
      let left = previous.afterId,
        right = entry.afterId;
      while (left && !next.has(left)) left = old.get(left)?.afterId ?? null;
      while (right && !old.has(right)) right = next.get(right)?.afterId ?? null;
      if (left !== right) moved.push(id);
    }
  }
  const lists = { added, removed, changed, moved };
  const cut = Object.values(lists).some((list) => list.length > RECEIPT_IDS);
  return {
    added: added.slice(0, RECEIPT_IDS),
    removed: removed.slice(0, RECEIPT_IDS),
    changed: changed.slice(0, RECEIPT_IDS),
    moved: moved.slice(0, RECEIPT_IDS),
    ...(cut
      ? {
          counts: {
            added: added.length,
            removed: removed.length,
            changed: changed.length,
            moved: moved.length,
          },
        }
      : {}),
    ...(pageFields(before) !== pageFields(after) ? { page: true as const } : {}),
  };
}
