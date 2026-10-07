/** Self-contained so the same runtime can run inside existing sandboxed packages. */
export function installIconTooltips(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const win = doc.defaultView;
  const mount = root.nodeType === 9 ? doc.body : root;
  const style = doc.createElement("style");
  style.textContent = `
    .showai-icon-tooltip {
      position: fixed; inset: auto; margin: 0; box-sizing: border-box;
      max-width: min(280px, calc(100vw - 16px)); padding: 7px 10px;
      border: 1px solid #ffffff20; border-radius: 8px;
      background: #222; color: #fff; box-shadow: 0 4px 14px #0003;
      font: 500 12px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      text-align: left; white-space: normal; overflow-wrap: anywhere;
      letter-spacing: normal; z-index: 2147483647; pointer-events: none;
    }
    .showai-icon-tooltip::backdrop { pointer-events: none; }
    @media print { .showai-icon-tooltip { display: none !important; } }
  `;
  const tip = doc.createElement("div");
  tip.className = "showai-icon-tooltip";
  tip.id = `showai-icon-tooltip-${win.crypto.randomUUID()}`;
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  mount.append(style, tip);
  let active = null;
  let nativeTitle = null;
  let timer = 0;
  let hideTimer = 0;
  let focusTimer = 0;
  let pointerFocus = false;
  let hovered = null;
  let focused = null;

  const label = (element) =>
    element.getAttribute("data-icon-tooltip")?.trim() ||
    (element === active
      ? nativeTitle
      : element.getAttribute("title")
    )?.trim() ||
    element.getAttribute("aria-label")?.trim() ||
    [...(element.getAttribute("aria-labelledby") || "").split(/\s+/)]
      .map((id) => root.getElementById(id)?.textContent || "")
      .join(" ")
      .trim() ||
    element.textContent?.trim();
  const target = (event) => {
    for (const element of event.composedPath()) {
      if (!element?.matches || element.getRootNode() !== root) continue;
      if (element === tip) return tip;
      if (
        element.matches(
          "[data-icon-tooltip], svg[aria-label], [role='img'][aria-label]",
        )
      )
        return label(element) ? element : null;
      if (element.matches("button, summary, a, [role='button']"))
        return (element.querySelector("svg, img") ||
          !element.textContent?.trim() ||
          element.hasAttribute("aria-label") ||
          element.hasAttribute("title")) &&
          label(element)
          ? element
          : null;
    }
    return null;
  };
  const hide = () => {
    win.clearTimeout(timer);
    win.clearTimeout(hideTimer);
    if (active) {
      const ids = (active.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== tip.id);
      if (ids.length) active.setAttribute("aria-describedby", ids.join(" "));
      else active.removeAttribute("aria-describedby");
      if (nativeTitle !== null && !active.hasAttribute("title"))
        active.setAttribute("title", nativeTitle);
    }
    tip.hidePopover();
    active = null;
    nativeTitle = null;
  };
  const show = (element, immediate = false) => {
    win.clearTimeout(hideTimer);
    if (element === active) return;
    hide();
    if (!element || element === tip) return;
    active = element;
    nativeTitle = element.getAttribute("title");
    // Suppress the browser's second tooltip while this trigger is active.
    element.removeAttribute("title");
    timer = win.setTimeout(
      () => {
        if (!element.isConnected || !element.getClientRects().length)
          return hide();
        tip.textContent = label(element);
        tip.showPopover();
        const rect = element.getBoundingClientRect();
        const bounds = tip.getBoundingClientRect();
        const width = doc.documentElement.clientWidth;
        const height = doc.documentElement.clientHeight;
        const below = rect.bottom + 6;
        const top =
          below + bounds.height <= height - 8
            ? below
            : rect.top - bounds.height - 6;
        tip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - bounds.width) / 2, width - bounds.width - 8))}px`;
        tip.style.top = `${Math.max(8, Math.min(top, height - bounds.height - 8))}px`;
        const ids = (element.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter(Boolean);
        element.setAttribute(
          "aria-describedby",
          [...new Set([...ids, tip.id])].join(" "),
        );
      },
      immediate ? 0 : 350,
    );
  };
  const leave = () => {
    win.clearTimeout(hideTimer);
    hideTimer = win.setTimeout(() => {
      if (hovered !== tip) show(hovered || focused);
    }, 90);
  };
  const over = (event) => {
    if (event.pointerType === "touch") return;
    hovered = target(event);
    if (hovered === tip) win.clearTimeout(hideTimer);
    else show(hovered || focused);
  };
  const out = (event) => {
    if (
      active?.contains(event.relatedTarget) ||
      tip.contains(event.relatedTarget)
    )
      return;
    hovered = null;
    leave();
  };
  const focus = (event) => {
    if (pointerFocus) return;
    focused = target(event);
    show(focused, true);
  };
  const blur = () => {
    focused = null;
    leave();
  };
  const key = (event) => {
    if (event.key === "Escape") hide();
  };
  const dismiss = () => {
    hovered = null;
    focused = null;
    hide();
  };
  const pointerDown = () => {
    dismiss();
    pointerFocus = true;
    win.clearTimeout(focusTimer);
    focusTimer = win.setTimeout(() => {
      pointerFocus = false;
    }, 0);
  };
  const observer = new win.MutationObserver(() => {
    if (!active) return;
    if (active.hasAttribute("title")) {
      nativeTitle = active.getAttribute("title");
      active.removeAttribute("title");
    }
    if (!active.isConnected || !active.getClientRects().length) hide();
    else if (tip.textContent !== label(active)) tip.textContent = label(active);
  });
  observer.observe(mount, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "aria-label",
      "title",
      "data-icon-tooltip",
      "hidden",
      "class",
      "style",
    ],
  });
  const listeners = [
    ["pointerover", over],
    ["pointerout", out],
    ["focusin", focus],
    ["focusout", blur],
    ["keydown", key],
    ["pointerdown", pointerDown],
    ["contextmenu", dismiss],
    ["wheel", dismiss],
    ["scroll", dismiss],
  ];
  for (const [name, handler] of listeners)
    root.addEventListener(name, handler, true);
  win.addEventListener("resize", dismiss);
  win.addEventListener("blur", dismiss);
  return () => {
    win.clearTimeout(focusTimer);
    hide();
    observer.disconnect();
    for (const [name, handler] of listeners)
      root.removeEventListener(name, handler, true);
    win.removeEventListener("resize", dismiss);
    win.removeEventListener("blur", dismiss);
    tip.remove();
    style.remove();
  };
}
