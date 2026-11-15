export function topDialog(doc: Document = document): HTMLElement | null {
  return [...doc.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1) ?? null;
}

export function modalOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
