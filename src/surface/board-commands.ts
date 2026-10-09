import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import {
  indexSurfaceTree,
  type ArrowBindings,
  transformedBindings,
} from "./connections.mjs";
import { reconcileSurface, visitNodes } from "./document.mjs";

/** One logical transform, with untouched nodes and frames retaining identity. */
export function transformObjects<T extends ShowDocument>(
  source: T,
  frames: Record<string, NodeLayout>,
): T {
  const index = indexSurfaceTree(source.content);
  for (const id of Object.keys(frames)) {
    if (!index.get(id)?.parent || !source.layout?.[id])
      throw new Error(`Object has no editable frame: ${id}`);
  }
  const replace = new Map<string, JSONContent>();
  for (const id of Object.keys(frames)) {
    const node = index.get(id)!.node;
    if (
      node.type !== "drawing" ||
      node.attrs?.tool !== "arrow" ||
      !node.attrs.bindings
    )
      continue;
    const bindings = transformedBindings(
      node.attrs.bindings,
      new Set(Object.keys(frames)),
    );
    const attrs = { ...node.attrs };
    if (Object.keys(bindings).length) attrs.bindings = bindings;
    else delete attrs.bindings;
    replace.set(id, { ...node, attrs });
  }
  const walk = (node: JSONContent): JSONContent => {
    if (replace.has(node.attrs?.id)) return replace.get(node.attrs!.id)!;
    if (!node.content) return node;
    const content = node.content.map(walk);
    return content.some((child, i) => child !== node.content![i])
      ? { ...node, content }
      : node;
  };
  return reconcileSurface(
    {
      ...source,
      content: replace.size ? walk(source.content) : source.content,
      layout: { ...source.layout, ...frames },
      surfaceViews: { ...source.surfaceViews },
    },
    { clone: false },
  );
}

export function duplicateObjects<T extends ShowDocument>(
  source: T,
  ids: string[],
  offset = { x: 24, y: 24 },
): { document: T; ids: string[] } {
  const index = indexSurfaceTree(source.content),
    selected = new Set(ids);
  const roots = ids.filter((id) => {
    let parent = index.get(id)?.parent;
    while (parent) {
      if (selected.has(parent.attrs?.id)) return false;
      parent = index.get(parent.attrs?.id)?.parent ?? null;
    }
    return true;
  });
  if (!roots.length) return { document: source, ids: [] };
  const parent = index.get(roots[0])?.parent;
  if (!parent || roots.some((id) => index.get(id)?.parent !== parent))
    throw new Error("Copy selection must share a parent.");
  const document = structuredClone(source),
    target = indexSurfaceTree(document.content).get(parent.attrs!.id)!.node;
  const mapping = new Map<string, string>(),
    copies = roots.map((id) => structuredClone(index.get(id)!.node));
  for (const copy of copies)
    visitNodes(copy, (node) => {
      if (node.attrs?.id) {
        const id = crypto.randomUUID();
        mapping.set(node.attrs.id, id);
        node.attrs = { ...node.attrs, id };
      }
    });
  for (const copy of copies)
    visitNodes(copy, (node) => {
      if (!node.attrs?.bindings) return;
      const bindings: ArrowBindings = {};
      for (const key of ["start", "end"] as const) {
        const binding = node.attrs.bindings[key],
          targetId = binding && mapping.get(binding.targetId);
        if (targetId) bindings[key] = { ...binding, targetId };
      }
      if (Object.keys(bindings).length) node.attrs.bindings = bindings;
      else delete node.attrs.bindings;
    });
  for (const [old, id] of mapping) {
    const frame = source.layout?.[old];
    if (frame)
      document.layout![id] = {
        ...frame,
        ...(roots.includes(old)
          ? { x: frame.x + offset.x, y: frame.y + offset.y }
          : {}),
      };
    const views = source.surfaceViews?.[old];
    if (views) {
      const viewIds = new Map(
        views.saved.map((v) => [v.id, crypto.randomUUID()]),
      );
      document.surfaceViews![id] = {
        initial: viewIds.get(views.initial!) ?? null,
        saved: views.saved.map((v) => ({
          ...v,
          id: viewIds.get(v.id)!,
          targets: v.targets
            .map((target) => mapping.get(target)!)
            .filter(Boolean),
        })),
        readingOrder: views.readingOrder
          .map((target) => mapping.get(target)!)
          .filter(Boolean),
      };
    }
  }
  target.content = [...(target.content ?? []), ...copies];
  return {
    document: reconcileSurface(document),
    ids: roots.map((id) => mapping.get(id)!),
  };
}

export function removeObjects<T extends ShowDocument>(
  source: T,
  ids: string[],
): T {
  const selected = new Set(ids);
  const walk = (node: JSONContent): JSONContent => {
    if (!node.content) return node;
    const content = node.content
      .filter((child) => !selected.has(child.attrs?.id))
      .map(walk);
    return content.length !== node.content.length ||
      content.some((child, i) => child !== node.content![i])
      ? { ...node, content }
      : node;
  };
  return reconcileSurface(
    {
      ...source,
      content: walk(source.content),
      layout: { ...source.layout },
      surfaceViews: { ...source.surfaceViews },
    },
    { clone: false },
  );
}

/** Reloading identical JSON must not invalidate a gesture; actual edits must. */
export function canCommitBoardGesture(
  original: ShowDocument,
  latest: ShowDocument | undefined,
  ids: string[],
) {
  if (!latest) return false;
  const same = (a: unknown, b: unknown) =>
    a === b || JSON.stringify(a) === JSON.stringify(b);
  if (!same(original.content, latest.content)) return false;
  const index = indexSurfaceTree(original.content),
    frames = new Set<string>();
  for (const id of ids) {
    if (!latest.layout?.[id]) return false;
    let entry = index.get(id);
    while (entry) {
      const key = entry.node.attrs?.id;
      if (key && (original.layout?.[key] || latest.layout?.[key]))
        frames.add(key);
      entry = entry.parent?.attrs?.id
        ? index.get(entry.parent.attrs.id)
        : undefined;
    }
  }
  return [...frames].every((id) =>
    same(original.layout?.[id], latest.layout?.[id]),
  );
}

/** Selection stays among siblings in the active Board's explicit coordinate layers. */
export function boardSelectionScope(
  index: ReturnType<typeof indexSurfaceTree>,
  layout: ShowDocument["layout"],
  surfaceId: string | undefined,
  id: string,
) {
  const parent = index.get(id)?.parent;
  if (!parent || !surfaceId) return null;
  if (parent.type === "surface")
    return parent.attrs?.id === surfaceId && parent.attrs?.kind === "board"
      ? surfaceId
      : null;
  if (parent.type !== "region" || layout?.[parent.attrs!.id]?.mode !== "free")
    return null;
  let owner: JSONContent | null = parent;
  while (owner && owner.type !== "surface")
    owner = index.get(owner.attrs?.id)?.parent ?? null;
  return owner?.attrs?.id === surfaceId ? (parent.attrs!.id as string) : null;
}
