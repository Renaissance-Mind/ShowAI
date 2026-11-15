import { useLayoutEffect, useState } from "react";

export function useSlidingIndicator<T extends HTMLElement>(active: unknown) {
  const [container, setContainer] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!container) return;
    const place = () => {
      const selected = container.querySelector<HTMLElement>(
        ':scope > [aria-selected="true"], :scope > [aria-pressed="true"]',
      );
      container.style.setProperty(
        "--indicator-x",
        `${selected?.offsetLeft ?? 0}px`,
      );
      container.style.setProperty(
        "--indicator-y",
        `${selected?.offsetTop ?? 0}px`,
      );
      container.style.setProperty(
        "--indicator-width",
        `${selected?.offsetWidth ?? 0}px`,
      );
      container.style.setProperty(
        "--indicator-height",
        `${selected?.offsetHeight ?? 0}px`,
      );
    };
    place();
    const frame = requestAnimationFrame(() => {
      container.dataset.indicator = "ready";
    });
    const observer = new ResizeObserver(place);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, active]);
  return setContainer;
}
