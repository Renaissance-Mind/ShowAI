import type { ShowDocument } from "../types";
import type { InkUpdate } from "./inline-ink";
import { applyInkUpdate } from "./inline-ink";
import {
  canonicalInkJSON,
  createInkOperation,
  inkNodeMetadata,
  type InkEditPatch,
  type InkMaterialization,
  type InkOperationChange,
  type InkOperationIdentity,
} from "./ink-operations.mjs";

const same = (a: unknown, b: unknown) =>
  canonicalInkJSON(a ?? null) === canonicalInkJSON(b ?? null);

/** The baseline must be the causal view actually seen by the input author,
 * rather than a later remote snapshot. Dispatch and durability run off input. */
export function inkUpdateToOperation(
  value: InkUpdate,
  baseline: InkMaterialization,
  identity: InkOperationIdentity,
) {
  if (value.pageId !== baseline.pageId || value.boardId !== baseline.boardId)
    throw new Error("Ink operation baseline belongs to a different Board.");
  const previous = new Map(baseline.strokes.map(stroke => [stroke.id, stroke]));
  const next = new Set(value.nodes.map(node => node.attrs!.id as string));
  const changes: InkOperationChange[] = [], skippedDeletedIds: string[] = [];
  for (const strokeId of value.removedIds ?? baseline.strokes.filter(stroke => !stroke.deleted && !next.has(stroke.id)).map(stroke => stroke.id)) {
    const before = previous.get(strokeId);
    if (before && !before.deleted) changes.push({ kind: "delete", strokeId });
  }
  for (const node of value.nodes) {
    const strokeId = node.attrs!.id as string, before = previous.get(strokeId);
    if (before?.deleted) { skippedDeletedIds.push(strokeId); continue; }
    if (!before) {
      if (!value.layout[strokeId]) throw new Error(`New ink has no layout: ${strokeId}`);
      changes.push({ kind: "create", strokeId, node, layout: value.layout[strokeId] });
      continue;
    }
    const patch: InkEditPatch = {};
    if (!same(inkNodeMetadata(before.node), inkNodeMetadata(node))) patch.node = inkNodeMetadata(node);
    for (const key of ["ink", "color", "strokeWidth", "pressure"] as const)
      if (!same(before.node.attrs?.[key], node.attrs?.[key])) Object.assign(patch, { [key]: node.attrs?.[key] ?? null });
    if (value.layout[strokeId] && !same(before.layout, value.layout[strokeId])) patch.layout = value.layout[strokeId];
    if (Object.keys(patch).length) changes.push({ kind: "edit", strokeId, patch });
  }
  const parents = [...new Set([...baseline.frontier, ...(identity.sequence > 1 ? [`${identity.actor}:${identity.sequence - 1}`] : [])])];
  return {
    operation: changes.length ? createInkOperation({ ...identity, pageId: value.pageId, boardId: value.boardId, parents, changes }) : null,
    skippedDeletedIds,
  };
}

/** A conflict-bearing materialization is never silently committed as a snapshot. */
export function applyInkMaterialization(document: ShowDocument, value: InkMaterialization): ShowDocument {
  if (value.conflicts.length) throw new Error(`Unresolved ink operation conflicts: ${value.conflicts.map(conflict => `${conflict.strokeId}/${conflict.field}`).join(", ")}`);
  const visible = value.strokes.filter(stroke => !stroke.deleted);
  return applyInkUpdate(document, {
    pageId: value.pageId, boardId: value.boardId,
    nodes: visible.map(stroke => stroke.node),
    layout: Object.fromEntries(visible.map(stroke => [stroke.id, stroke.layout])),
  });
}
