import type { ShowDocument } from "../types";
import { mergePageContent } from "../core/page-merge-model";

interface History<T> { past: T[]; future: T[]; group: string; at: number }
const contentKey = (document: ShowDocument) => JSON.stringify([document.content, document.layout, document.surfaceViews, document.icon]);

/** Rebase local undo/redo ownership over a foreign source receipt. Native
 * receipts enter current state before their parent echo, so they need the
 * same rebase as external document props at this boundary. */
export function rebaseHistorySnapshots<T extends ShowDocument, A>(history: History<T>, actions: Map<T, A>, before: T, incoming: T): void {
  const rebased = new Map<T, T | null>(), incomingKey = contentKey(incoming);
  const rebase = (snapshot: T): T | null => {
    if (rebased.has(snapshot)) return rebased.get(snapshot)!;
    const next = mergePageContent(before, incoming, snapshot, "history").document as T;
    const keep = contentKey(next) !== incomingKey, action = actions.get(snapshot);
    actions.delete(snapshot);
    if (keep && action !== undefined) actions.set(next, action);
    const result = keep ? next : null; rebased.set(snapshot, result); return result;
  };
  const retained = (snapshot: T | null): snapshot is T => snapshot !== null;
  history.past = history.past.map(rebase).filter(retained);
  history.future = history.future.map(rebase).filter(retained);
  history.group = ""; history.at = 0;
}
