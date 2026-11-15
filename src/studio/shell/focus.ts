export function focusAssistantInput(started = Date.now()) {
  const input = document.querySelector<HTMLTextAreaElement>(
    ".assistant-input textarea",
  );
  if (input && !input.disabled) {
    input.focus();
    return;
  }
  if (Date.now() - started < 3000)
    window.setTimeout(() => focusAssistantInput(started), 100);
}

export function focusPageTitle(
  isShown: () => boolean,
  started = Date.now(),
  held = 0,
) {
  if (!isShown() || Date.now() - started > 1500) return;
  const usable = (selector: string) =>
    [
      ...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
        selector,
      ),
    ].find((element) => !element.disabled && element.offsetParent !== null);
  const title =
    usable(".studio-scroll textarea.studio-page-heading-title") ??
    usable(".studio-topbar .studio-page-title-input");
  const focused = !!title && document.activeElement === title;
  if (title && !focused) title.focus();
  if (focused && held >= 1) return;
  window.setTimeout(
    () => focusPageTitle(isShown, started, focused ? held + 1 : 0),
    100,
  );
}
