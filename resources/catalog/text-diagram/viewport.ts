import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

export const PADDING = 16;
export function diagramSize(html: string) {
  const box = html.match(/<svg[^>]*viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return { width: Number(box?.[1] ?? 800), height: Number(box?.[2] ?? 400) };
}
export function fitScale(width: number, naturalWidth: number) {
  return Math.min(1, Math.max(1, width - PADDING * 2) / naturalWidth);
}

/** Preserve the diagram point under an anchor, including centered small drawings. */
export function zoomScroll(
  scroll: number,
  anchor: number,
  viewport: number,
  natural: number,
  before: number,
  after: number,
) {
  const offset = (scale: number) =>
    PADDING + Math.max(0, (viewport - PADDING * 2 - natural * scale) / 2);
  return Math.max(
    0,
    ((scroll + anchor - offset(before)) / before) * after +
      offset(after) -
      anchor,
  );
}

export function useDiagramViewport(
  size: { width: number; height: number },
  identity: string,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [manual, setManual] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fit = fitScale(width || size.width + PADDING * 2, size.width);
  const scale = manual ?? fit;
  const height = Math.min(640, Math.max(180, size.height * fit + PADDING * 2));
  const pending = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    ratio: number;
  } | null>(null);
  const latest = useRef({ scale, fit, size });
  latest.current = { scale, fit, size };

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [identity]);
  useLayoutEffect(() => {
    pending.current = null;
    setManual(null);
    if (ref.current) ref.current.scrollTo(0, 0);
  }, [identity]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    if (pending.current) {
      ref.current.scrollTo(pending.current.x, pending.current.y);
      pending.current = null;
    } else if (manual === null) ref.current.scrollTo(0, 0);
  }, [scale, height, manual]);

  function zoomTo(next: number, anchor?: { x: number; y: number }) {
    const element = ref.current;
    if (!element) return;
    const current = latest.current;
    next = Math.min(8, Math.max(Math.min(0.05, current.fit), next));
    const x = anchor?.x ?? element.clientWidth / 2;
    const y = anchor?.y ?? element.clientHeight / 2;
    pending.current = {
      x: zoomScroll(
        element.scrollLeft,
        x,
        element.clientWidth,
        current.size.width,
        current.scale,
        next,
      ),
      // Drawings are centered horizontally, but start at the top vertically.
      y: Math.max(
        0,
        ((element.scrollTop + y - PADDING) / current.scale) * next +
          PADDING -
          y,
      ),
    };
    latest.current = { ...current, scale: next };
    setManual(next);
  }
  function fitWidth() {
    pending.current = null;
    setManual(null);
    ref.current?.scrollTo(0, 0);
  }
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const ratio = rect.width / element.clientWidth || 1;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      zoomTo(latest.current.scale * Math.exp(-delta * 0.002), {
        x: (event.clientX - rect.left) / ratio,
        y: (event.clientY - rect.top) / ratio,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [identity]);

  function stopDrag() {
    const active = drag.current;
    drag.current = null;
    setDragging(false);
    if (active && ref.current?.hasPointerCapture(active.id))
      ref.current.releasePointerCapture(active.id);
  }
  useEffect(() => {
    window.addEventListener("blur", stopDrag);
    return () => window.removeEventListener("blur", stopDrag);
  }, []);
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !ref.current) return;
    const element = ref.current;
    if (
      element.scrollWidth <= element.clientWidth &&
      element.scrollHeight <= element.clientHeight
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    element.focus({ preventScroll: true });
    element.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
      ratio: element.getBoundingClientRect().width / element.clientWidth || 1,
    };
    setDragging(true);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId || !ref.current) return;
    ref.current.scrollTo(
      active.left - (event.clientX - active.x) / active.ratio,
      active.top - (event.clientY - active.y) / active.ratio,
    );
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const element = ref.current!;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-60, 0],
      ArrowRight: [60, 0],
      ArrowUp: [0, -60],
      ArrowDown: [0, 60],
    };
    if (directions[event.key]) {
      event.preventDefault();
      event.stopPropagation();
      const [x, y] = directions[event.key];
      element.scrollBy(x, y);
    } else if (event.key === "Escape") stopDrag();
    else if (event.key === "Home" || event.key === "0") {
      event.preventDefault();
      event.stopPropagation();
      fitWidth();
    } else if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      zoomTo(scale * (event.key === "-" ? 1 / 1.25 : 1.25));
    }
  }
  return {
    ref,
    scale,
    fit,
    height,
    dragging,
    zoomTo,
    fitWidth,
    handlers: {
      onPointerDown: pointerDown,
      onPointerMove: pointerMove,
      onPointerUp: stopDrag,
      onPointerCancel: stopDrag,
      onLostPointerCapture: stopDrag,
      onKeyDown: keyDown,
    },
  };
}
