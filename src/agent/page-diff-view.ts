import { createHash } from "node:crypto";
import {
  diffValues,
  formatPath,
  type DataPath,
} from "../datasets/operations.mjs";
import { diffDocuments } from "../core/diff";
import type { JSONContent, PageDiff, ShowDocument } from "../core/model";
import { isResource } from "../surface/containers.mjs";

/**
 * Record-level page comparison for Agents. The core diff reports changed
 * fields with their whole before/after values, so one edited record of a
 * component's list returned the entire list twice. Here every block change is
 * expressed with the dataset id-path engine (objects per key, arrays of
 * records per id), large values are summarized and the entries are paged.
 */

export type DiffOp = "set" | "remove" | "insert" | "move";
export type DiffEntry =
  | {
      type: "page.changed";
      op: DiffOp;
      path: string;
      before?: unknown;
      after?: unknown;
      afterId?: string | number | null;
    }
  | {
      type: "block.added";
      blockId: string;
      parentId: string | null;
      afterId: string | null;
      node: unknown;
    }
  | {
      type: "block.removed";
      blockId: string;
      parentId: string | null;
      node: unknown;
    }
  | {
      type: "block.changed";
      blockId: string;
      op: DiffOp;
      path: string;
      before?: unknown;
      after?: unknown;
      afterId?: string | number | null;
    }
  | {
      type: "block.moved";
      blockId: string;
      parentId: string | null;
      afterId: string | null;
    };

export interface DiffViewOptions {
  blockIds?: string[];
  offset?: number;
  limit?: number;
  /** Serialized size of the returned entries. */
  maxBytes?: number;
  /** Keep values as stored (for file output). */
  full?: boolean;
}

export const DIFF_DEFAULT_LIMIT = 100;
export const DIFF_MAX_LIMIT = 500;
export const DIFF_DEFAULT_BYTES = 24_000;
const MAX_STRING = 240;
const MAX_VALUE_BYTES = 4096;

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

/** Long text and embedded files become markers; small values stay as they are. */
export function compactValue(
  value: unknown,
  counter = { omitted: 0 },
): unknown {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (item.length <= MAX_STRING) return item;
      counter.omitted++;
      const uri = /^data:([^;,]+)?(;base64)?,/.exec(item);
      if (uri)
        return {
          $omitted: "data-uri",
          mime: uri[1] ?? "text/plain",
          chars: item.length,
          sha256: digest(item),
        };
      return {
        $omitted: "text",
        chars: item.length,
        start: item.slice(0, 80),
        sha256: digest(item),
      };
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, visit(child)]),
      );
    return item;
  };
  const compact = visit(value);
  const text = JSON.stringify(compact) ?? "";
  if (text.length <= MAX_VALUE_BYTES) return compact;
  counter.omitted++;
  const full = JSON.stringify(value) ?? "";
  if (Array.isArray(value))
    return {
      $omitted: "array",
      items: value.length,
      chars: full.length,
      sha256: digest(full),
    };
  const record = value as Record<string, unknown>;
  return {
    $omitted: "object",
    ...(typeof record.id === "string" || typeof record.id === "number"
      ? { id: record.id }
      : {}),
    ...(typeof record.type === "string" ? { nodeType: record.type } : {}),
    keys: Object.keys(record).slice(0, 30),
    chars: full.length,
    sha256: digest(full),
  };
}

/** A block's own attributes and inline text; nested blocks have their own entries. */
function own(node: JSONContent): Record<string, unknown> {
  const { content, ...rest } = node;
  return {
    ...rest,
    content: (content ?? []).filter((child) => child.type === "text"),
  };
}

function metadata(document: ShowDocument): Record<string, unknown> {
  const {
    content,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = document;
  return {
    ...rest,
    content: {
      type: content.type,
      ...(isResource(document) ? { attrs: content.attrs ?? {} } : {}),
    },
  };
}

function nodes(document: ShowDocument): Map<string, JSONContent> {
  const found = new Map<string, JSONContent>();
  const walk = (node: JSONContent) => {
    for (const child of node.content ?? []) {
      if (child.type === "text") continue;
      if (typeof child.attrs?.id === "string") found.set(child.attrs.id, child);
      walk(child);
    }
  };
  walk(document.content);
  return found;
}

function entriesFor(
  type: "page.changed" | "block.changed",
  before: unknown,
  after: unknown,
  extra: { blockId?: string },
): DiffEntry[] {
  return diffValues(before, after).map((operation) => {
    const path = formatPath(operation.path as DataPath);
    const base = { type, ...extra, op: operation.op, path };
    if (operation.op === "set")
      return {
        ...base,
        ...("before" in operation ? { before: operation.before } : {}),
        after: operation.value,
      } as DiffEntry;
    if (operation.op === "remove")
      return { ...base, before: operation.before } as DiffEntry;
    if (operation.op === "insert")
      return {
        ...base,
        after: operation.value,
        afterId: operation.after ?? null,
      } as DiffEntry;
    return { ...base, afterId: operation.after } as DiffEntry;
  });
}

/** Every change between two documents, one entry per record-level edit. */
export function pageDiffEntries(
  baseline: ShowDocument,
  current: ShowDocument,
): DiffEntry[] {
  const entries: DiffEntry[] = entriesFor(
    "page.changed",
    metadata(baseline),
    metadata(current),
    {},
  );
  const before = nodes(baseline);
  const after = nodes(current);
  for (const change of diffDocuments(baseline, current)) {
    if (change.type === "page.changed") continue;
    if (change.type === "block.changed")
      entries.push(
        ...entriesFor(
          "block.changed",
          own(before.get(change.blockId)!),
          own(after.get(change.blockId)!),
          { blockId: change.blockId },
        ),
      );
    else if (change.type === "block.added")
      entries.push({
        type: "block.added",
        blockId: change.blockId,
        parentId: change.parentId,
        afterId: change.afterId,
        node: change.node,
      });
    else if (change.type === "block.removed")
      entries.push({
        type: "block.removed",
        blockId: change.blockId,
        parentId: change.parentId,
        node: change.node,
      });
    else entries.push(change);
  }
  return entries;
}

function summarize(entries: DiffEntry[]) {
  const blocks = new Map<string, Set<string>>();
  const records = { set: 0, insert: 0, remove: 0, move: 0 };
  let pageFields = 0;
  for (const entry of entries) {
    if (entry.type === "page.changed") {
      pageFields++;
      continue;
    }
    const kinds = blocks.get(entry.blockId) ?? new Set<string>();
    kinds.add(entry.type.slice("block.".length));
    blocks.set(entry.blockId, kinds);
    if (entry.type === "block.changed") records[entry.op]++;
  }
  const count = (kind: string) =>
    [...blocks.values()].filter((kinds) => kinds.has(kind)).length;
  return {
    entries: entries.length,
    pageFields,
    blocks: {
      added: count("added"),
      removed: count("removed"),
      changed: count("changed"),
      moved: count("moved"),
    },
    recordChanges: records,
    changedBlockIds: [...blocks.keys()].slice(0, 200),
  };
}

/**
 * One page of entries within limit and maxBytes; values are compacted unless
 * full. The receipt keeps the identities of the core diff.
 */
/** One page of change entries within limit and maxBytes, values compacted unless full. */
export function pageEntries<T extends object>(
  entries: T[],
  options: DiffViewOptions = {},
) {
  const offset = Math.max(0, options.offset ?? 0);
  // Full output (files) is not paged; conversation pages are bounded.
  const limit = options.full
    ? Number.POSITIVE_INFINITY
    : Math.min(DIFF_MAX_LIMIT, Math.max(1, options.limit ?? DIFF_DEFAULT_LIMIT));
  const maxBytes = options.maxBytes ?? DIFF_DEFAULT_BYTES;
  const counter = { omitted: 0 };
  const page: unknown[] = [];
  let bytes = 0;
  let index = offset;
  for (; index < entries.length && page.length < limit; index++) {
    const entry = entries[index];
    const shown = options.full
      ? entry
      : Object.fromEntries(
          Object.entries(entry).map(([key, value]) => [
            key,
            ["before", "after", "node"].includes(key)
              ? compactValue(value, counter)
              : value,
          ]),
        );
    const size = JSON.stringify(shown).length;
    if (!options.full && page.length && bytes + size > maxBytes) break;
    page.push(shown);
    bytes += size;
  }
  return {
    changes: page,
    offset,
    nextOffset: index < entries.length ? index : null,
    omittedValues: counter.omitted,
  };
}

/** Record-level changes between two values of a dataset (or any JSON value). */
export function valueDiffEntries(
  before: unknown,
  after: unknown,
  prefix: DataPath = [],
) {
  return diffValues(before, after, prefix).map((operation) => {
    const path = formatPath(operation.path as DataPath);
    if (operation.op === "set")
      return {
        op: operation.op,
        path,
        ...("before" in operation ? { before: operation.before } : {}),
        after: operation.value,
      };
    if (operation.op === "remove")
      return { op: operation.op, path, before: operation.before };
    if (operation.op === "insert")
      return {
        op: operation.op,
        path,
        after: operation.value,
        afterId: operation.after ?? null,
      };
    return { op: operation.op, path, afterId: operation.after };
  });
}

/** Datasets bound in a document, with the blocks that show them. */
export function boundDatasets(document: ShowDocument, projectId: string) {
  const found = new Map<
    string,
    { datasetId: string; projectId?: string; blockIds: string[] }
  >();
  for (const node of nodes(document).values()) {
    const binding = (
      node.attrs?.data as { $binding?: { dataset?: unknown; project?: unknown } }
    )?.$binding;
    if (node.type !== "widget" || typeof binding?.dataset !== "string")
      continue;
    const project =
      typeof binding.project === "string" && binding.project !== projectId
        ? binding.project
        : undefined;
    const key = `${project ?? ""}/${binding.dataset}`;
    const entry = found.get(key) ?? {
      datasetId: binding.dataset,
      ...(project ? { projectId: project } : {}),
      blockIds: [],
    };
    entry.blockIds.push(String(node.attrs!.id));
    found.set(key, entry);
  }
  return [...found.values()];
}

export function pageDiffView(
  diff: PageDiff,
  entries: DiffEntry[],
  options: DiffViewOptions & { current?: ShowDocument } = {},
) {
  const selected = options.blockIds?.length
    ? entries.filter(
        (entry) =>
          entry.type !== "page.changed" &&
          options.blockIds!.includes(entry.blockId),
      )
    : entries;
  const page = pageEntries(selected, options);
  const { changes: _changes, ...identity } = diff;
  // Values of bound blocks live in datasets, which page hashes do not cover.
  const datasets = options.current
    ? boundDatasets(options.current, diff.projectId).filter(
        (dataset) =>
          !options.blockIds?.length ||
          dataset.blockIds.some((id) => options.blockIds!.includes(id)),
      )
    : [];
  return {
    ...identity,
    summary: summarize(selected),
    changes: page.changes,
    offset: page.offset,
    nextOffset: page.nextOffset,
    ...(page.omittedValues
      ? {
          omittedValues: page.omittedValues,
          note: 'Long text, embedded files and large values are summarized as {"$omitted":…,sha256}. Read the block with page_read blockIds for the full current value, or write the full diff with out.',
        }
      : {}),
    ...(datasets.length
      ? {
          boundDatasets: datasets,
          boundDataNote:
            'These blocks show shared datasets; their data changes are not part of the page. Compare each with dataset_read {action:"read", datasetId, sinceHash} using the hash from your earlier page_read datasetBases.',
        }
      : {}),
  };
}
