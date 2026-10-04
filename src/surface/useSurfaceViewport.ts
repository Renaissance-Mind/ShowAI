import { useEffect, useRef, useState } from "react";
import {
  advanceEscape,
  canDock,
  GESTURE_IDLE,
  normalizedWheel,
  resistance,
  zoomAt,
  type Camera,
  type EscapeGesture,
} from "./model";

const editable = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"]',
  );
const interactive = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest(
    'button, a, input, textarea, select, summary, [contenteditable="true"], [role="slider"], iframe, [data-surface-gesture="own"], .react-flow',
  );

/** Embedded controls and scroll areas keep the whole gesture, including its tail. */
function ownsWheel(
  target: EventTarget | null,
  boundary: HTMLElement,
  x: number,
  y: number,
) {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      '[data-surface-ui], [data-surface-gesture="own"], .react-flow, input[type="range"], select',
    )
  )
    return true;
  for (
    let element: Element | null = target;
    element && element !== boundary;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element);
    if (
      Math.abs(x) > Math.abs(y) &&
      /auto|scroll/.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth + 1
    )
      return true;
    if (
      Math.abs(y) >= Math.abs(x) &&
      /auto|scroll/.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight + 1
    )
      return true;
  }
  return false;
}

export function useSurfaceViewport(hasItems: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const modeRef = useRef(hasItems ? "canvas" : "document");
  const itemsRef = useRef(hasItems);
  itemsRef.current = hasItems;
  const [mode, setMode] = useState(modeRef.current);
  const [scale, setScale] = useState(1);
  const controls = useRef({
    enter: () => {},
    home: () => {},
    zoom: (_scale: number) => {},
    settle: () => {},
    paint: () => {},
  });

  useEffect(() => {
    const root = rootRef.current!,
      scroll = scrollRef.current!,
      world = worldRef.current!,
      body = documentRef.current!;
    let frame = 0,
      idle = 0,
      transition = 0;
    let gesture: EscapeGesture | null = null;
    let nestedGesture = false;
    let lastWheel = -Infinity;
    let rubber = 0;
    let space = false;
    let drag: {
      id: number;
      x: number;
      y: number;
      camera: Camera;
      scroll: number;
      mode: string;
    } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: {
      distance: number;
      center: { x: number; y: number };
      camera: Camera;
    } | null = null;
    const offset = () => (scroll.clientWidth - world.offsetWidth) / 2;
    const maxScroll = () =>
      Math.max(0, body.offsetHeight - scroll.clientHeight);
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const c = camera.current;
        const transform =
          modeRef.current === "canvas"
            ? `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.scale})`
            : `translate3d(${-rubber}px, 0, 0)`;
        if (world.style.transform && world.style.transform !== transform)
          root.dispatchEvent(
            new Event("showai:viewport-change", { bubbles: true }),
          );
        world.style.transform = transform;
        root.style.setProperty("--surface-grid-x", `${offset() + c.x}px`);
        root.style.setProperty("--surface-grid-y", `${c.y}px`);
        root.style.setProperty("--surface-grid-size", `${24 * c.scale}px`);
        root.style.setProperty(
          "--surface-pull",
          String(Math.min(1, Math.abs(rubber) / 70)),
        );
        root.dataset.pull = rubber > 0 ? "right" : "left";
        setScale(c.scale);
      });
    };
    const animate = () => {
      root.classList.add("is-settling");
      clearTimeout(transition);
      transition = window.setTimeout(
        () => root.classList.remove("is-settling"),
        200,
      );
    };
    const changeMode = (next: string) => {
      modeRef.current = next;
      root.dataset.mode = next;
      setMode(next);
    };
    const enter = () => {
      if (modeRef.current === "canvas") return;
      camera.current = { x: -rubber, y: -scroll.scrollTop, scale: 1 };
      changeMode("canvas");
      scroll.scrollTop = 0;
      rubber = 0;
      gesture = null;
      paint();
    };
    const dock = () => {
      const y = Math.max(0, Math.min(maxScroll(), -camera.current.y));
      rubber = 0;
      camera.current = { x: 0, y: 0, scale: 1 };
      changeMode("document");
      // CSS mode changes synchronously, before restoring native scroll position.
      world.style.transform = "none";
      scroll.scrollTop = y;
      paint();
    };
    const settle = () => {
      gesture = null;
      if (modeRef.current === "document") {
        animate();
        rubber = 0;
        paint();
      } else if (canDock(camera.current, maxScroll(), itemsRef.current)) dock();
    };
    const later = () => {
      clearTimeout(idle);
      idle = window.setTimeout(settle, GESTURE_IDLE);
    };
    const home = () => {
      clearTimeout(idle);
      gesture = null;
      rubber = 0;
      if (modeRef.current === "document") {
        paint();
        return;
      }
      // Keep the reader's vertical location when returning from a side excursion.
      camera.current = {
        x: 0,
        y: Math.max(
          -maxScroll(),
          Math.min(0, camera.current.y / camera.current.scale),
        ),
        scale: 1,
      };
      if (!itemsRef.current) dock();
      else {
        animate();
        paint();
      }
    };
    const zoom = (
      value: number,
      point = { x: root.clientWidth / 2 - offset(), y: root.clientHeight / 2 },
    ) => {
      enter();
      camera.current = zoomAt(camera.current, point, value);
      paint();
    };
    controls.current = { enter, home, zoom, settle, paint };
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || drag || pinch) return;
      const delta = normalizedWheel(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        root.clientHeight,
        event.shiftKey,
      );
      const now = performance.now();
      if (now - lastWheel > GESTURE_IDLE) nestedGesture = false;
      lastWheel = now;
      nestedGesture ||= ownsWheel(event.target, scroll, delta.x, delta.y);
      if (nestedGesture) return;
      root.classList.remove("is-settling");
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = root.getBoundingClientRect();
        zoom(
          camera.current.scale *
            Math.exp(-Math.max(-100, Math.min(100, delta.y)) * 0.008),
          {
            x: event.clientX - rect.left - offset(),
            y: event.clientY - rect.top,
          },
        );
        later();
        return;
      }
      if (modeRef.current === "document") {
        const next = advanceEscape(gesture, delta.x, delta.y, now);
        gesture = next.gesture;
        if (gesture.axis === "x") {
          event.preventDefault();
          rubber = resistance(gesture.distance);
          if (next.escaped) enter();
          paint();
        }
      } else {
        event.preventDefault();
        camera.current = {
          ...camera.current,
          x: camera.current.x - delta.x,
          y: camera.current.y - delta.y,
        };
        paint();
      }
      later();
    };
    const localPoint = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      return {
        x: event.clientX - rect.left - offset(),
        y: event.clientY - rect.top,
      };
    };
    const pinchMetrics = () => {
      const [a, b] = [...touches.values()];
      return {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    };
    const down = (event: PointerEvent) => {
      if (
        (event.target as Element).closest(
          '[data-surface-ui], [data-surface-handle], [data-surface-gesture="own"], .react-flow',
        )
      )
        return;
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, localPoint(event));
        if (touches.size === 2 && modeRef.current === "canvas") {
          event.preventDefault();
          drag = null;
          pinch = { ...pinchMetrics(), camera: { ...camera.current } };
          root.setPointerCapture(event.pointerId);
          return;
        }
      }
      if (
        drag ||
        event.button > 1 ||
        (interactive(event.target) &&
          !(event.button === 1 || (space && !editable(event.target))))
      )
        return;
      const background = !(event.target as Element).closest(
        "[data-surface-content]",
      );
      if (!background && !space && event.button !== 1) return;
      if (event.pointerType !== "touch") event.preventDefault();
      clearTimeout(idle);
      root.classList.remove("is-settling");
      root.focus({ preventScroll: true });
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        camera: { ...camera.current },
        scroll: scroll.scrollTop,
        mode: modeRef.current,
      };
      root.setPointerCapture(event.pointerId);
      root.classList.add("is-panning");
    };
    const move = (event: PointerEvent) => {
      if (touches.has(event.pointerId))
        touches.set(event.pointerId, localPoint(event));
      if (pinch && touches.size >= 2) {
        const metrics = pinchMetrics();
        const next = zoomAt(
          pinch.camera,
          pinch.center,
          (pinch.camera.scale * metrics.distance) / pinch.distance,
        );
        camera.current = {
          ...next,
          x: next.x + metrics.center.x - pinch.center.x,
          y: next.y + metrics.center.y - pinch.center.y,
        };
        paint();
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (modeRef.current === "document") {
        scroll.scrollTop = drag.scroll - dy;
        if (Math.abs(dx) > Math.abs(dy) * 1.6) {
          rubber = resistance(-dx);
          if (Math.abs(dx) >= 280) {
            enter();
            drag = {
              ...drag,
              x: event.clientX,
              y: event.clientY,
              camera: { ...camera.current },
            };
          }
        }
      } else {
        camera.current = {
          ...camera.current,
          x: drag.camera.x + dx,
          y: drag.camera.y + dy,
        };
      }
      paint();
    };
    const finish = (event?: PointerEvent, cancelled = false) => {
      const active =
        !!pinch || !!(drag && (!event || drag.id === event.pointerId));
      if (event) touches.delete(event.pointerId);
      else touches.clear();
      if (!active) return;
      if (pinch) {
        if (cancelled) camera.current = pinch.camera;
        if (touches.size < 2) pinch = null;
        paint();
      }
      if (drag && (!event || drag.id === event.pointerId)) {
        if (cancelled) {
          camera.current = drag.camera;
          changeMode(drag.mode);
          if (drag.mode === "document") scroll.scrollTop = drag.scroll;
        }
        const id = drag.id;
        drag = null;
        if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
      }
      root.classList.remove("is-panning");
      if (cancelled) {
        rubber = 0;
        paint();
      } else settle();
    };
    const up = (event: PointerEvent) => finish(event);
    const cancel = (event: PointerEvent) => finish(event, true);
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || editable(event.target))
        return;
      if (event.code === "Space" && !interactive(event.target)) {
        event.preventDefault();
        space = true;
        root.classList.add("is-hand");
      }
      if (event.key === "Escape") {
        if (drag || pinch) finish(undefined, true);
        else home();
      }
      if (event.target !== root || modeRef.current !== "canvas") return;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [80, 0],
        ArrowRight: [-80, 0],
        ArrowUp: [0, 80],
        ArrowDown: [0, -80],
      };
      if (arrows[event.key]) {
        event.preventDefault();
        const [x, y] = arrows[event.key];
        camera.current = {
          ...camera.current,
          x: camera.current.x + x,
          y: camera.current.y + y,
        };
        paint();
        later();
      }
      if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        zoom(camera.current.scale * (event.key === "-" ? 1 / 1.2 : 1.2));
      }
      if (event.key === "0") {
        event.preventDefault();
        home();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        space = false;
        root.classList.remove("is-hand");
      }
    };
    const blur = () => {
      space = false;
      root.classList.remove("is-hand");
      finish(undefined, true);
      clearTimeout(idle);
    };
    const nativeScroll = () => {
      if (
        modeRef.current !== "canvas" ||
        (!scroll.scrollTop && !scroll.scrollLeft)
      )
        return;
      // Focus and editor caret navigation can request native scroll even with
      // overflow hidden. Incorporate it into the camera before clearing it.
      camera.current = {
        ...camera.current,
        x: camera.current.x - scroll.scrollLeft,
        y: camera.current.y - scroll.scrollTop,
      };
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      paint();
    };
    const resize = new ResizeObserver(paint);
    resize.observe(root);
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("keydown", keydown);
    scroll.addEventListener("scroll", nativeScroll);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    paint();
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      clearTimeout(transition);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", cancel);
      root.removeEventListener("keydown", keydown);
      scroll.removeEventListener("scroll", nativeScroll);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    if (hasItems) controls.current.enter();
  }, [hasItems]);

  return {
    rootRef,
    scrollRef,
    worldRef,
    documentRef,
    mode,
    scale,
    camera,
    controls,
  };
}
