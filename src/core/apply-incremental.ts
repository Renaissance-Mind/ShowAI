import type { JSONContent } from "@tiptap/core";
import { canonicalJson } from "./canonical";
import type { PageOperation, ShowDocument } from "./model";
import type { NodeLayout } from "../document/types";
import { isResource, surfaceKind } from "../document/containers.mjs";
import { reconcileSurface, stableId } from "../document/document.mjs";
import { walk, widgetDocuments } from "../document/walk.mjs";
import { validateSubtree } from "../portable/validation.mjs";
import { CAPACITY, measureContent } from "../portable/capacity.mjs";
import { builtinComponent } from "../contract/catalog";
import { componentBlock } from "../surface/component-insertion";

export interface BatchState {
  document: ShowDocument;
  ids: Set<string>;
  count: number;
  sizes: { structureBytes: number; resourceBytes: number; jsonBytes: number };
}

const reserved = new Set(["__proto__", "prototype", "constructor"]);
const INCREMENTAL = new Set(["block.insert", "component.insert", "block.text.set"]);

export const incrementalCandidate = (operation: PageOperation) =>
  !!operation &&
  typeof operation === "object" &&
  INCREMENTAL.has(operation.type);

export function batchState(document: ShowDocument): BatchState | undefined {
  if (!isResource(document)) return undefined;
  if (canonicalJson(reconcileSurface(document)) !== canonicalJson(document))
    return undefined;
  const ids = new Set<string>();
  walk(document.content, (node) => {
    if (typeof node.attrs?.id === "string") ids.add(node.attrs.id);
  }, { scope: "content" });
  let count = 0;
  walk(document.content, () => {
    count++;
  }, { scope: "tree" });
  const measured = measureContent(document);
  return {
    document,
    ids,
    count,
    sizes: {
      structureBytes: measured.structureBytes,
      resourceBytes: measured.resourceBytes,
      jsonBytes: measured.jsonBytes,
    },
  };
}

interface Located {
  node: JSONContent;
  parent: JSONContent | null;
  index: number;
  path: string;
  depth: number;
}

function locate(root: JSONContent, id: string): Located | undefined {
  const stack: Located[] = [{ node: root, parent: null, index: -1, path: "", depth: 0 }];
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.parent && entry.node.type !== "text" && entry.node.attrs?.id === id)
      return entry;
    const children = entry.node.content ?? [];
    for (let index = children.length - 1; index >= 0; index--)
      stack.push({
        node: children[index],
        parent: entry.node,
        index,
        path: `${entry.path}/${index}`,
        depth: entry.depth + 1,
      });
  }
  return undefined;
}

function selfContained(node: JSONContent): boolean {
  let plain = true;
  walk(node, (item) => {
    if (
      ["surface", "region", "drawing", "doc", "step"].includes(item.type ?? "") ||
      (item.attrs &&
        ["canvas", "outline", "inkArchiveGroup", "bindings", "nativeInk"].some(
          (key) => Object.hasOwn(item.attrs!, key),
        )) ||
      ((item.type === "widget" || item.type === "inlineWidget") &&
        (widgetDocuments(item.attrs?.data).length > 0 ||
          JSON.stringify(item.attrs?.data ?? null).includes('"$binding"')))
    )
      plain = false;
  }, { scope: "tree" });
  return plain;
}

function addedBytes(value: unknown) {
  const measured = measureContent(value);
  if (measured.resourceCount) return undefined;
  return { structureBytes: measured.structureBytes + 1, jsonBytes: measured.jsonBytes + 1 };
}

function withinCapacity(state: BatchState, additions: ({ structureBytes: number; jsonBytes: number } | undefined)[]) {
  if (additions.some((item) => !item)) return undefined;
  const next = { ...state.sizes };
  for (const item of additions) {
    next.structureBytes += item!.structureBytes;
    next.jsonBytes += item!.jsonBytes;
  }
  if (
    next.structureBytes > CAPACITY.pageStructureBytes ||
    next.jsonBytes > CAPACITY.authoringRequestBytes ||
    next.resourceBytes > CAPACITY.pageResourceBytes
  )
    return undefined;
  return next;
}

function assignIds(state: BatchState, node: JSONContent, path: string) {
  const explicit = new Set<string>();
  let valid = true;
  walk(node, (item) => {
    if (item.type === "text") return;
    const id = item.attrs?.id;
    if (id === undefined || id === null || id === "") return;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 200 ||
      reserved.has(id) ||
      state.ids.has(id) ||
      explicit.has(id)
    )
      valid = false;
    else explicit.add(id);
  }, { scope: "tree" });
  if (!valid) return undefined;
  const used = new Set([...explicit]);
  const generated: string[] = [];
  const descend = (item: JSONContent, at: string): JSONContent => {
    let next = item;
    if (!["doc", "text"].includes(item.type ?? "") && !item.attrs?.id) {
      let id = stableId(`${state.document.id}:${at}`);
      while (state.ids.has(id) || used.has(id)) id += "-copy";
      used.add(id);
      generated.push(id);
      next = { ...item, attrs: { ...item.attrs, id } };
    }
    if (Array.isArray(next.content)) {
      const content = next.content.map((child, index) => descend(child, `${at}/${index}`));
      if (content.some((child, index) => child !== next.content![index]))
        next = { ...next, content };
    }
    return next;
  };
  return { node: descend(node, path), ids: [...explicit, ...generated] };
}

const placeholderPage = (parent: JSONContent) => {
  const only = parent.content?.length === 1 ? parent.content[0] : undefined;
  return (
    parent.type === "surface" &&
    parent.attrs?.kind === "page" &&
    only?.type === "richText" &&
    (only.content ?? []).every(
      (child) => child.type === "paragraph" && !child.content?.length,
    )
  );
};

function insertBlock(
  state: BatchState,
  incoming: JSONContent,
  parentId: string | null | undefined,
  afterId: string | null | undefined,
  frame?: NodeLayout,
): boolean {
  const document = state.document;
  const root = document.content;
  const target =
    parentId && parentId !== root.attrs?.id
      ? locate(root, parentId)
      : { node: root, parent: null, index: -1, path: "", depth: 0 };
  if (!target) return false;
  const parent = target.node;
  if (!["surface", "region"].includes(parent.type ?? "")) return false;
  if (parent.type === "surface" && surfaceKind(parent) !== "page") return false;
  if (parent.type === "region" && document.layout?.[parent.attrs!.id]?.mode === "free")
    return false;
  if (parent !== root && placeholderPage(parent)) return false;
  if (!selfContained(incoming)) return false;
  const children = parent.content ?? [];
  let index = children.length;
  if (afterId === null) index = 0;
  else if (afterId !== undefined) {
    const sibling = children.findIndex((child) => child.attrs?.id === afterId);
    if (sibling < 0) return false;
    index = sibling + 1;
  }
  const assigned = assignIds(state, incoming, `${target.path}/${index}`);
  if (!assigned) return false;
  const node = assigned.node;
  const nodeId = node.attrs!.id as string;
  const views = parent.type === "surface" ? document.surfaceViews?.[parent.attrs!.id] : undefined;
  if (parent.type === "surface" && !views) return false;
  const sizes = withinCapacity(state, [
    addedBytes(node),
    frame ? addedBytes({ [nodeId]: frame }) : { structureBytes: 0, jsonBytes: 0 },
    views ? addedBytes(nodeId) : { structureBytes: 0, jsonBytes: 0 },
  ]);
  if (!sizes) return false;
  let counted: number;
  try {
    counted = validateSubtree(node, {
      path: "document.content",
      parentPath: "document.content",
      parentType: parent.type!,
      depth: target.depth + 1,
      count: state.count,
      surface: true,
      resource: true,
    });
  } catch {
    return false;
  }
  parent.content = [...children.slice(0, index), node, ...children.slice(index)];
  if (frame) document.layout = { ...document.layout, [nodeId]: { ...frame } };
  if (views) {
    const roots = parent.content.map((child) => child.attrs!.id as string);
    const rootIds = new Set(roots);
    views.readingOrder = [
      ...new Set([...views.readingOrder.filter((id) => rootIds.has(id)), ...roots]),
    ];
  }
  for (const id of assigned.ids) state.ids.add(id);
  state.count += counted;
  state.sizes = sizes;
  return true;
}

function setText(state: BatchState, blockId: string, text: unknown): boolean {
  if (typeof text !== "string") return false;
  const found = locate(state.document.content, blockId);
  if (!found || !found.parent) return false;
  const node = found.node;
  if (!["paragraph", "heading", "codeBlock"].includes(node.type ?? "")) return false;
  if ((node.content ?? []).some((child) => child.type !== "text")) return false;
  if (
    (state.document.comments ?? []).some(
      (comment) => comment.anchor?.blockId === blockId && comment.anchor.quote,
    )
  )
    return false;
  const next: JSONContent = { ...node, content: text ? [{ type: "text", text }] : [] };
  const sizes = withinCapacity(state, [addedBytes(next.content)]);
  if (!sizes) return false;
  const before = 1 + (node.content?.length ?? 0);
  let counted: number;
  try {
    counted = validateSubtree(next, {
      path: "document.content",
      parentPath: "document.content",
      parentType: found.parent.type!,
      depth: found.depth,
      count: state.count - before,
      surface: true,
      resource: true,
    });
  } catch {
    return false;
  }
  found.parent.content![found.index] = next;
  state.count += counted - before;
  state.sizes = sizes;
  return true;
}

export function applyIncrementally(state: BatchState, operation: PageOperation): boolean {
  switch (operation.type) {
    case "block.insert": {
      const node = operation.node;
      if (
        !node ||
        typeof node !== "object" ||
        Array.isArray(node) ||
        typeof node.type !== "string"
      )
        return false;
      return insertBlock(state, structuredClone(node), operation.parentId, operation.afterId);
    }
    case "component.insert": {
      const { kind, data } = operation;
      if (typeof kind !== "string" || !data || typeof data !== "object" || Array.isArray(data))
        return false;
      if (kind === "stepper") return false;
      const definition = builtinComponent(kind);
      if ((!definition && kind !== "custom") || definition?.insertion) return false;
      let block: ReturnType<typeof componentBlock>;
      try {
        block = componentBlock(kind, data as Record<string, unknown>);
      } catch {
        return false;
      }
      const { node, frame } = block;
      return insertBlock(state, node, operation.parentId ?? null, operation.afterId, frame);
    }
    case "block.text.set":
      return setText(state, operation.blockId, operation.text);
    default:
      return false;
  }
}
