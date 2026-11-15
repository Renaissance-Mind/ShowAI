const navigationKeys =
  /^(Tab|Arrow(Up|Down|Left|Right)|Home|End|Page(Up|Down))$/;

export function installKeyboardFocus(doc: Document) {
  const root = doc.documentElement;
  const key = (event: KeyboardEvent) => {
    if (!navigationKeys.test(event.key)) return;
    const target = event.composedPath()[0];
    if (
      event.key !== "Tab" &&
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    root.dataset.keyboardFocus = "";
  };
  const pointer = () => delete root.dataset.keyboardFocus;
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("pointerdown", pointer, true);
  return () => {
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("pointerdown", pointer, true);
    pointer();
  };
}
