export function shown(element) {
  return (
    !!element?.isConnected &&
    !element.closest("[hidden],[inert],[data-exit-ghost]") &&
    element.getClientRects().length > 0 &&
    (element.checkVisibility?.({ visibilityProperty: true }) ?? true)
  );
}

export function first(selector, root = document) {
  return [...(root?.querySelectorAll(selector) ?? [])].find(shown) ?? null;
}

export function named(root, selector, name) {
  return (
    [...(root?.querySelectorAll(selector) ?? [])].find(
      (element) =>
        shown(element) &&
        (element.getAttribute("aria-label") === name ||
          element.textContent.trim() === name),
    ) ?? null
  );
}
