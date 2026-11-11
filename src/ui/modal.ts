/**
 * Which dialog has the keyboard. Every workbench dialog, the export and
 * packaging dialogs included, is a [role="dialog"] in the document; the last
 * one is on top. Exit snapshots drop their role, so a closing dialog never
 * counts. Keyboard handlers ask here instead of tracking their own state, so a
 * shortcut never opens one surface on top of another's modal.
 */

/** The dialog on top, if any. */
export function topDialog(doc: Document = document): HTMLElement | null {
  return [...doc.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1) ?? null;
}

/** Whether a modal dialog (aria-modal) is open anywhere in the document. */
export function modalOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
