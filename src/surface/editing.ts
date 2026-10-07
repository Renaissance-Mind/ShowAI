import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { LayoutMode, NodeLayout } from "./types";
import {
  findSurfaceNode,
  reconcileSurface,
  upgradeDocument,
  visitNodes,
} from "./document.mjs";

export function createRegion(name = "内容区域", mode: LayoutMode = "flow") {
  const id = crypto.randomUUID();
  return {
    node: {
      type: "region",
      attrs: { id, name },
      content:
        mode === "flow"
          ? [{ type: "paragraph", attrs: { id: crypto.randomUUID() } }]
          : [],
    } as JSONContent,
    frame: {
      x: 0,
      y: 0,
      width: 920,
      mode,
      columns: 2,
      gap: 24,
    } satisfies NodeLayout,
  };
}

export function editNode(
  source: ShowDocument,
  id: string,
  update: (node: JSONContent) => void,
) {
  let changed = false;
  const walk = (node: JSONContent): JSONContent => {
    if (node.attrs?.id === id) {
      const copy = structuredClone(node);
      update(copy);
      changed = true;
      return copy;
    }
    if (!node.content) return node;
    const children = node.content.map(walk);
    return children.some((child, index) => child !== node.content![index])
      ? { ...node, content: children }
      : node;
  };
  const content = walk(source.content);
  if (!changed) return source;
  return reconcileSurface(
    {
      ...source,
      content,
      ...(source.layout ? { layout: { ...source.layout } } : {}),
    },
    { clone: false },
  );
}

export function replaceChildren(
  source: ShowDocument,
  parentId: string,
  ids: string[],
  replacement: JSONContent[],
) {
  return editNode(source, parentId, (node) => {
    const selected = new Set(ids);
    const content = node.content ?? [],
      start = content.findIndex((child) => selected.has(child.attrs?.id));
    const index = start < 0 ? content.length : start;
    node.content = [
      ...content.slice(0, index),
      ...replacement,
      ...content.slice(index).filter((child) => !selected.has(child.attrs?.id)),
    ];
  });
}

export function addNode(
  source: ShowDocument,
  node: JSONContent,
  frame: NodeLayout,
  parentId: string | null = null,
) {
  const document = upgradeDocument(source);
  const parent = parentId
    ? findSurfaceNode(document, parentId)?.node
    : document.content;
  if (!parent || !["surface", "region"].includes(parent.type ?? ""))
    throw new Error("目标区域不存在。");
  parent.content = [...(parent.content ?? []), node];
  document.layout![node.attrs!.id] = frame;
  return reconcileSurface(document);
}

export function removeNode<T extends ShowDocument>(source: T, id: string) {
  const document = structuredClone(source),
    target = findSurfaceNode(document, id);
  if (!target?.parent) return source;
  target.parent.content = target.parent.content!.filter(
    (node) => node.attrs?.id !== id,
  );
  return reconcileSurface(document);
}

export function moveNode<T extends ShowDocument>(
  source: T,
  id: string,
  parentId: string | null,
  frame?: NodeLayout,
  index?: number,
) {
  const document = structuredClone(source),
    target = findSurfaceNode(document, id);
  const parent = parentId
    ? findSurfaceNode(document, parentId)?.node
    : document.content;
  if (
    !target?.parent ||
    !parent ||
    !["surface", "region"].includes(parent.type ?? "")
  )
    throw new Error("无法移动到这个区域。");
  const descendants = new Set<string>();
  visitNodes(target.node, (node) => {
    if (node.attrs?.id) descendants.add(node.attrs.id);
  });
  if (parentId && descendants.has(parentId))
    throw new Error("区域不能移入自身或子区域。");
  target.parent.content = target.parent.content!.filter(
    (node) => node.attrs?.id !== id,
  );
  const children = parent.content ?? [];
  children.splice(index ?? children.length, 0, target.node);
  parent.content = children;
  if (frame) document.layout![id] = frame;
  return reconcileSurface(document);
}

export function detachBlock(
  source: ShowDocument,
  parentId: string,
  block: JSONContent,
  frame: NodeLayout,
) {
  const document = structuredClone(source),
    parent = findSurfaceNode(document, parentId)?.node;
  if (!parent) return source;
  parent.content = parent.content?.filter(
    (node) => node.attrs?.id !== block.attrs?.id,
  );
  const node: JSONContent = ["widget", "image"].includes(block.type ?? "")
    ? block
    : {
        type: "richText",
        attrs: { id: crypto.randomUUID(), name: "文本" },
        content: [block],
      };
  return addNode(document, node, frame);
}

export function regionOptions(document: ShowDocument, excludedId?: string) {
  const excluded = new Set<string>();
  const node = excludedId && findSurfaceNode(document, excludedId)?.node;
  if (node)
    visitNodes(node, (item) => {
      if (item.attrs?.id) excluded.add(item.attrs.id);
    });
  const result: { id: string; name: string }[] = [];
  visitNodes(document.content, (item) => {
    if (item.type === "region" && !excluded.has(item.attrs!.id))
      result.push({ id: item.attrs!.id, name: item.attrs?.name || "内容区域" });
  });
  return result;
}

export interface DeletedNode {
  node: JSONContent;
  parentId: string | null;
  index: number;
  layout: NonNullable<ShowDocument["layout"]>;
  views: NonNullable<ShowDocument["views"]>;
}
export function captureDeletion(
  document: ShowDocument,
  id: string,
): DeletedNode | undefined {
  const target = findSurfaceNode(document, id);
  if (!target?.parent) return;
  const ids = new Set<string>();
  visitNodes(target.node, (node) => {
    if (node.attrs?.id) ids.add(node.attrs.id);
  });
  return {
    node: structuredClone(target.node),
    parentId: target.parent.type === "surface" ? null : target.parent.attrs!.id,
    index: target.parent.content!.indexOf(target.node),
    layout: Object.fromEntries(
      Object.entries(document.layout ?? {}).filter(([key]) => ids.has(key)),
    ),
    views: structuredClone(document.views!),
  };
}
export function restoreDeletion(source: ShowDocument, deleted: DeletedNode) {
  if (findSurfaceNode(source, deleted.node.attrs!.id)) return source;
  const document = structuredClone(source);
  const parent =
    (deleted.parentId && findSurfaceNode(document, deleted.parentId)?.node) ||
    document.content;
  parent.content ??= [];
  parent.content.splice(deleted.index, 0, structuredClone(deleted.node));
  Object.assign(document.layout!, deleted.layout);
  const restoredIds = new Set<string>();
  visitNodes(deleted.node, (node) => {
    if (node.attrs?.id) restoredIds.add(node.attrs.id);
  });
  for (const previous of deleted.views.saved) {
    const targets = previous.targets.filter((id) => restoredIds.has(id));
    if (!targets.length) continue;
    const current = document.views!.saved.find(
      (view) => view.id === previous.id,
    );
    if (current)
      current.targets = [...new Set([...current.targets, ...targets])];
    else document.views!.saved.push(structuredClone(previous));
  }
  if (
    !document.views!.initial &&
    document.views!.saved.some((view) => view.id === deleted.views.initial)
  )
    document.views!.initial = deleted.views.initial;
  const id = deleted.node.attrs!.id;
  if (parent.type === "surface") {
    const order = document.views!.readingOrder.filter((entry) => entry !== id);
    const index = deleted.views.readingOrder.indexOf(id);
    order.splice(index < 0 ? order.length : index, 0, id);
    document.views!.readingOrder = order;
  }
  return reconcileSurface(document);
}
