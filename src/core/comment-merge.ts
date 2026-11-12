import { mergeValues, type MergeChoices } from "./catalog-merge";
import type { MergeConflict } from "../contract/types";
import type { PageComment } from "../types";

/**
 * Three-way merge of page comments record by record, so two people working
 * on different threads (or adding replies to the same thread) never conflict.
 * Only the same comment changed in different ways on both sides conflicts,
 * at /page/comments/<id>/<field>.
 */
export function mergeComments(
  base: readonly PageComment[] = [],
  ours: readonly PageComment[] = [],
  theirs: readonly PageComment[] = [],
  choices: MergeChoices = {},
): { value: PageComment[]; conflicts: MergeConflict[] } {
  const byId = (list: readonly PageComment[]) =>
    new Map(list.map((comment) => [comment.id, comment]));
  const b = byId(base),
    o = byId(ours),
    t = byId(theirs);
  const order = [
    ...ours.map((comment) => comment.id),
    ...theirs.map((comment) => comment.id).filter((id) => !o.has(id)),
    ...base.map((comment) => comment.id).filter((id) => !o.has(id) && !t.has(id)),
  ];
  const value: PageComment[] = [];
  const conflicts: MergeConflict[] = [];
  for (const id of order) {
    const merged = mergeValues(
      b.get(id),
      o.get(id),
      t.get(id),
      `/page/comments/${id.replaceAll("~", "~0").replaceAll("/", "~1")}`,
      choices,
    );
    conflicts.push(...merged.conflicts);
    if (merged.value !== undefined) value.push(merged.value as PageComment);
  }
  // A thread deleted on one side drops the replies the other side added to it.
  const roots = new Set(value.filter((c) => !c.threadId).map((c) => c.id));
  const deletedRoots = new Set(
    [...b.keys()].filter((id) => !b.get(id)!.threadId && !roots.has(id)),
  );
  return {
    value: value.filter(
      (comment) => !comment.threadId || !deletedRoots.has(comment.threadId),
    ),
    conflicts,
  };
}
