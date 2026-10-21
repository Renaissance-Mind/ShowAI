import type { ShowDocument } from "../types";
import { hasInkWireContent, inkWireClockForActor, stampInkDocument, resolveInkWireFields, type InkWireChoice } from "../surface/ink-wire.mjs";
import { InkOperationJournal } from "./ink-operation-journal";

/** Called after the page's author baseline passes CAS, before canonical write. */
export async function stampSavedInk(root: string, document: ShowDocument, baseline: ShowDocument) {
  if (!hasInkWireContent(document) && !hasInkWireContent(baseline)) return document;
  const journal = await InkOperationJournal.open(root);
  try {
    const actor = `wire-${journal.actor}`;
    const identity = journal.reserveWireIdentity(document.id, Math.max(inkWireClockForActor(document, actor), inkWireClockForActor(baseline, actor)));
    return stampInkDocument(document, baseline, identity);
  } finally { journal.close(); }
}

/** Prepare an authored resolution without bypassing the editor's normal CAS
 * save. Burning a reserved counter after a stale editor is harmless. */
export async function prepareSavedInkResolution(root: string, baseline: ShowDocument, choices: InkWireChoice[]) {
  const journal = await InkOperationJournal.open(root);
  try {
    const actor = `wire-${journal.actor}`;
    const identity = journal.reserveWireIdentity(baseline.id, inkWireClockForActor(baseline, actor));
    return resolveInkWireFields(baseline, choices, identity);
  } finally { journal.close(); }
}
