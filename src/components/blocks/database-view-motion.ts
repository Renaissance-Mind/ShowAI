import { useLayoutEffect, useRef } from "react";

const easing = "cubic-bezier(.22,1,.36,1)";

/** Animate the selected tab and committed view; keep the surrounding page and record preview mounted. */
export function useDatabaseViewMotion(viewId: string, ready: boolean) {
  const tabs = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const selectionAnimation = useRef<Animation | null>(null);
  const viewAnimations = useRef<Animation[]>([]);
  const exit = useRef<HTMLElement | null>(null);
  const snapshot = useRef<{
    clone?: HTMLElement;
    height: number;
    opacity: string;
    transform: string;
  } | null>(null);
  const previous = useRef<{ id: string; index: number } | null>(null);
  const stopView = () => {
    for (const animation of viewAnimations.current) animation.cancel();
    viewAnimations.current = [];
    exit.current?.remove();
    exit.current = null;
    if (panel.current) panel.current.style.overflow = "";
  };
  const capture = () => {
    const element = content.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const saved = {
      height: (panel.current ?? element).getBoundingClientRect().height,
      opacity: style.opacity,
      transform: style.transform,
    };
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      element.querySelectorAll("*").length > 1200
    ) {
      snapshot.current = saved;
      return;
    }
    const clone = element.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.classList.add("sb-database-view-exit");
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    const originals = [...element.querySelectorAll<HTMLElement>("*")];
    [...clone.querySelectorAll<HTMLElement>("*")].forEach((node, index) => {
      for (const attribute of [...node.attributes])
        if (
          attribute.name === "id" ||
          attribute.name === "name" ||
          (attribute.name.startsWith("data-") &&
            attribute.name !== "data-active")
        )
          node.removeAttribute(attribute.name);
      if (
        node instanceof HTMLInputElement &&
        originals[index] instanceof HTMLInputElement
      ) {
        node.value = (originals[index] as HTMLInputElement).value;
        node.checked = (originals[index] as HTMLInputElement).checked;
      } else if (
        node instanceof HTMLSelectElement &&
        originals[index] instanceof HTMLSelectElement
      )
        node.selectedIndex = (
          originals[index] as HTMLSelectElement
        ).selectedIndex;
    });
    snapshot.current = { ...saved, clone };
  };
  useLayoutEffect(() => {
    const root = tabs.current,
      plate = indicator.current;
    const selected = root?.querySelector<HTMLButtonElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const index = root && selected
      ? [...root.querySelectorAll('[role="tab"]')].indexOf(selected) : 0;
    const from = previous.current;
    const changed = !!from && from.id !== viewId;
    let geometry = "";
    const measure = (animate = false) => {
      if (!root || !plate || !selected) return;
      const left = selected.offsetLeft,
        top = selected.offsetTop;
      const width = selected.offsetWidth,
        height = selected.offsetHeight;
      if (left < root.scrollLeft + 4) root.scrollLeft = Math.max(0, left - 4);
      else if (left + width > root.scrollLeft + root.clientWidth - 4)
        root.scrollLeft = left + width - root.clientWidth + 4;
      const before = plate.getBoundingClientRect(),
        bounds = root.getBoundingClientRect();
      selectionAnimation.current?.cancel();
      Object.assign(plate.style, {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${left}px, ${top}px, 0)`,
        opacity: "1",
      });
      if (animate && !reduced.matches && before.width) {
        selectionAnimation.current = plate.animate(
          [
            {
              transform: `translate3d(${before.left - bounds.left - root.clientLeft + root.scrollLeft}px, ${before.top - bounds.top - root.clientTop}px, 0) scale(${before.width / width}, ${before.height / height})`,
            },
            { transform: `translate3d(${left}px, ${top}px, 0) scale(1)` },
          ],
          { duration: 230, easing },
        );
      }
      geometry = `${root.clientWidth}:${left}:${top}:${width}:${height}`;
    };
    const observer = ready && root && selected ? new ResizeObserver(() => {
      const next = `${root.clientWidth}:${selected.offsetLeft}:${selected.offsetTop}:${selected.offsetWidth}:${selected.offsetHeight}`;
      if (next !== geometry) measure();
    }) : null;
    if (ready && root && selected && plate) {
      measure(changed);
      root.dataset.motionReady = "true";
      observer?.observe(root);
      observer?.observe(selected);
    }
    previous.current = { id: viewId, index };

    const saved = snapshot.current;
    snapshot.current = null;
    stopView();
    if (changed && !reduced.matches && panel.current && content.current) {
      const incoming = content.current,
        outer = panel.current;
      const direction = Math.sign(index - from!.index) || 1;
      if (saved?.clone) {
        exit.current = saved.clone;
        outer.append(saved.clone);
        viewAnimations.current.push(
          saved.clone.animate(
            [
              {
                opacity: Number(saved.opacity),
                transform:
                  saved.transform === "none"
                    ? "translate3d(0,0,0)"
                    : saved.transform,
              },
              { opacity: 0, transform: `translate3d(${-direction * 5}px,0,0)` },
            ],
            { duration: 125, easing, fill: "forwards" },
          ),
        );
      }
      viewAnimations.current.push(
        incoming.animate(
          [
            {
              opacity: saved?.clone ? 0 : 0.3,
              transform: `translate3d(${direction * 7}px,0,0)`,
            },
            { opacity: 1, transform: "translate3d(0,0,0)" },
          ],
          { duration: 190, easing },
        ),
      );
      const height = incoming.getBoundingClientRect().height;
      if (saved && Math.abs(saved.height - height) > 1) {
        outer.style.overflow = "clip";
        viewAnimations.current.push(
          outer.animate(
            [{ height: `${saved.height}px` }, { height: `${height}px` }],
            { duration: 190, easing },
          ),
        );
      }
      const animations = viewAnimations.current;
      void Promise.all(
        animations.map((animation) => animation.finished.catch(() => {})),
      ).then(() => {
        if (viewAnimations.current === animations) stopView();
      });
    }
    const cancel = () => {
      selectionAnimation.current?.cancel();
      stopView();
    };
    const outer = panel.current;
    outer?.addEventListener("pointerdown", cancel, { capture: true });
    outer?.addEventListener("keydown", cancel, { capture: true });
    outer?.addEventListener("wheel", cancel, { passive: true });
    reduced.addEventListener("change", cancel);
    return () => {
      observer?.disconnect();
      outer?.removeEventListener("pointerdown", cancel, true);
      outer?.removeEventListener("keydown", cancel, true);
      outer?.removeEventListener("wheel", cancel);
      reduced.removeEventListener("change", cancel);
    };
  }, [viewId, ready]);
  useLayoutEffect(
    () => () => {
      selectionAnimation.current?.cancel();
      stopView();
    },
    [],
  );
  return { tabs, indicator, panel, content, capture };
}
