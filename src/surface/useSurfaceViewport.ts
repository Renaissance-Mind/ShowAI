import { useEffect, useRef, useState } from "react";
import { GESTURE_IDLE, normalizedWheel, zoomAt, type Camera } from "./model";
import {
  clamp,
  nearestSnap,
  panFrom,
  springStep,
  type SurfaceAnchor,
  type SurfaceRegion,
} from "./physics";

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
  zoom: boolean,
) {
  if (!(target instanceof Element)) return false;
  const locked = target.closest('[data-viewport-locked="true"]');
  const ownership =
    target
      .closest("[data-surface-gesture]")
      ?.getAttribute("data-surface-gesture")
      ?.split(/\s+/) ?? [];
  if (
    ownership.includes("own") ||
    (zoom
      ? ownership.includes("zoom")
      : ownership.includes(Math.abs(x) > Math.abs(y) ? "x" : "y"))
  )
    return true;
  if (
    target.closest(
      '[data-surface-ui], [data-surface-gesture="own"], input[type="range"], select',
    )
  )
    return true;
  if (!locked && target.closest(".react-flow")) return true;
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

interface PanGesture {
  origin: Camera;
  anchor: SurfaceAnchor | null;
  delta: { x: number; y: number };
  released: boolean;
}

export function useSurfaceViewport(
  layoutKey: string,
  storageKey?: string,
  enabled = true,
) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const [scale, setScale] = useState(1);
  const controls = useRef({
    fit: (_ids?: string[], _immediate?: boolean) => {},
    focus: (_id: string, _immediate?: boolean) => {},
    point: (_x: number, _y: number) => ({ x: 0, y: 0 }),
    restored: false,
    restoredTargets: [] as string[],
    restoredAnchor: null as string | null,
    restore: () => {},
    zoom: (_scale: number) => {},
    moveTo: (_camera: Camera) => {},
    refresh: () => {},
    cancel: () => {},
  });

  useEffect(() => {
    const root = rootRef.current!,
      scroll = scrollRef.current!,
      world = worldRef.current!;
    const ownsInput = (target: EventTarget | null) =>
      enabledRef.current &&
      (!(target instanceof Element) ||
        !target.closest("[data-input-surface]") ||
        target.closest("[data-input-surface]") === root);
    const outerScale = () =>
      root.getBoundingClientRect().width / root.clientWidth || 1;
    const clientPoint = (x: number, y: number) => {
      const rect = root.getBoundingClientRect(),
        scale = outerScale();
      return { x: (x - rect.left) / scale, y: (y - rect.top) / scale };
    };
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      springFrame = 0,
      idle = 0;
    let anchor: SurfaceAnchor | null = null;
    let objectGesture = false;
    let gesture: PanGesture | null = null;
    let lastWheel = -Infinity,
      nestedGesture = false,
      space = false;
    let drag: {
      id: number;
      x: number;
      y: number;
      started: boolean;
      touch: boolean;
      gesture: PanGesture;
    } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: {
      distance: number;
      center: { x: number; y: number };
      camera: Camera;
      anchor: SurfaceAnchor | null;
    } | null = null;
    const bounds = () => ({
      width: scroll.clientWidth,
      height: root.clientHeight,
      offsetX: 0,
    });
    const regions = (): SurfaceRegion[] => {
      const base = world.getBoundingClientRect(),
        scale = camera.current.scale;
      return [...world.querySelectorAll<HTMLElement>("[data-surface-id]")]
        .filter(
          (element) =>
            element.closest(".surface-world") === world &&
            element.closest("[data-container-root]") ===
              world.closest("[data-container-root]"),
        )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.dataset.surfaceId!,
            label: element.dataset.surfaceName || "内容区域",
            x: (rect.left - base.left) / scale,
            y: (rect.top - base.top) / scale,
            width: rect.width / scale,
            height: rect.height / scale,
          };
        });
    };
    let previousAnchor: { id: string; x: number; y: number } | null = null;
    const remember = () => {
      if (!storageKey) return;
      const visible = regions()
        .filter((item) => {
          const c = camera.current;
          return (
            item.x * c.scale + c.x < root.clientWidth &&
            (item.x + item.width) * c.scale + c.x > 0 &&
            item.y * c.scale + c.y < root.clientHeight &&
            (item.y + item.height) * c.scale + c.y > 0
          );
        })
        .slice(0, 100);
      const anchorId = anchor?.id;
      const anchored =
        anchorId && regions().find((item) => item.id === anchorId);
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            ...camera.current,
            visibleIds: visible.map((item) => item.id),
            anchor: anchored
              ? { id: anchored.id, x: anchored.x, y: anchored.y }
              : null,
          }),
        );
      } catch {
        /* Personal view state is disposable; content uses the normal save path. */
      }
    };
    if (storageKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (
          saved &&
          [saved.x, saved.y, saved.scale].every(Number.isFinite) &&
          saved.scale >= 0.25 &&
          saved.scale <= 2 &&
          Array.isArray(saved.visibleIds) &&
          saved.visibleIds.length <= 100 &&
          saved.visibleIds.every((id: unknown) => typeof id === "string")
        ) {
          camera.current = { x: saved.x, y: saved.y, scale: saved.scale };
          controls.current.restored = true;
          controls.current.restoredTargets = saved.visibleIds;
          if (
            saved.anchor &&
            typeof saved.anchor.id === "string" &&
            [saved.anchor.x, saved.anchor.y].every(Number.isFinite)
          )
            previousAnchor = saved.anchor;
        }
      } catch {
        /* Ignore unavailable or invalid personal view state. */
      }
    }
    const targetRegion = (id: string): SurfaceRegion | undefined => {
      const region = regions().find((candidate) => candidate.id === id);
      if (region) return region;
      const element = world.querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(id)}"]`,
      );
      if (!element) return;
      const rect = element.getBoundingClientRect(),
        base = world.getBoundingClientRect(),
        scale = camera.current.scale;
      return {
        id,
        label: "内容",
        x: (rect.left - base.left) / scale,
        y: (rect.top - base.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      };
    };
    const setAnchor = (next: SurfaceAnchor | null) => {
      anchor = next;
      root.dataset.anchor = next?.id ?? "";
    };
    const paintNow = () => {
      const c = camera.current;
      const transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.scale})`;
      if (world.style.transform && world.style.transform !== transform)
        root.dispatchEvent(
          new Event("showai:viewport-change", { bubbles: true }),
        );
      world.style.transform = transform;
      setScale(c.scale);
    };
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paintNow);
    };
    const stopSpring = () => {
      cancelAnimationFrame(springFrame);
      springFrame = 0;
      delete root.dataset.settling;
    };
    const springTo = (target: Camera, complete?: () => void) => {
      stopSpring();
      cancelAnimationFrame(frame);
      if (reducedMotion.matches) {
        camera.current = target;
        paintNow();
        complete?.();
        remember();
        return;
      }
      root.dataset.settling = "true";
      let previous = performance.now();
      const velocity = { x: 0, y: 0, scale: 0 };
      const step = (time: number) => {
        const elapsed = (time - previous) / 1000;
        previous = time;
        const next = { ...camera.current };
        let settled = true;
        for (const key of ["x", "y", "scale"] as const) {
          const updated = springStep(
            next[key],
            velocity[key],
            target[key],
            elapsed,
          );
          next[key] = updated.position;
          velocity[key] = updated.velocity;
          const tolerance = key === "scale" ? 0.0002 : 0.15;
          if (
            Math.abs(next[key] - target[key]) > tolerance ||
            Math.abs(velocity[key]) > tolerance * 8
          )
            settled = false;
        }
        camera.current = settled ? target : next;
        paintNow();
        if (settled) {
          stopSpring();
          complete?.();
          remember();
        } else springFrame = requestAnimationFrame(step);
      };
      springFrame = requestAnimationFrame(step);
    };
    const refresh = () => {
      if (gesture) gesture.released = true;
      const visible = nearestSnap(regions(), camera.current, bounds());
      // Content edits/resize may change geometry. Refresh resistance without
      // dragging the user's camera along with a moving or resizing card.
      setAnchor(visible ? { ...visible.anchor, x: camera.current.x } : null);
      paint();
    };
    const settle = () => {
      clearTimeout(idle);
      const current = gesture;
      gesture = null;
      if (
        current?.anchor &&
        !current.released &&
        regions().some((region) => region.id === current.anchor!.id)
      ) {
        setAnchor(current.anchor);
        springTo({
          ...camera.current,
          x: current.anchor.x,
          y: clamp(camera.current.y, current.anchor.minY, current.anchor.maxY),
        });
        return;
      }
      const snap = nearestSnap(regions(), camera.current, bounds());
      setAnchor(snap?.anchor ?? null);
      if (snap) springTo(snap.camera);
      else remember();
    };
    const later = () => {
      clearTimeout(idle);
      idle = window.setTimeout(settle, GESTURE_IDLE);
    };
    const interrupt = () => {
      clearTimeout(idle);
      stopSpring();
      gesture = null;
    };
    const beginPan = (): PanGesture => {
      interrupt();
      return {
        origin: { ...camera.current },
        anchor,
        delta: { x: 0, y: 0 },
        released: false,
      };
    };
    const pan = (current: PanGesture) => {
      const next = panFrom(current.origin, current.delta, current.anchor);
      current.released ||= next.released;
      camera.current = next.camera;
      if (current.released) setAnchor(null);
      paint();
    };
    const moveTo = (target: Camera, immediate = false) => {
      interrupt();
      setAnchor(null);
      if (immediate) {
        camera.current = target;
        paintNow();
        refresh();
      } else springTo(target, refresh);
    };
    const fit = (ids?: string[], immediate = false) => {
      const all = regions(),
        chosen = ids?.length
          ? ids
              .map(targetRegion)
              .filter((region): region is SurfaceRegion => !!region)
          : all;
      if (!chosen.length) {
        moveTo({ x: 64, y: 64, scale: 1 }, immediate);
        return;
      }
      const minX = Math.min(...chosen.map((item) => item.x)),
        minY = Math.min(...chosen.map((item) => item.y));
      const maxX = Math.max(...chosen.map((item) => item.x + item.width)),
        maxY = Math.max(...chosen.map((item) => item.y + item.height));
      const scale = Math.max(
        0.25,
        Math.min(
          1,
          (root.clientWidth - 96) / Math.max(1, maxX - minX),
          (root.clientHeight - 140) / Math.max(1, maxY - minY),
        ),
      );
      moveTo(
        {
          x: root.clientWidth / 2 - ((minX + maxX) / 2) * scale,
          y: 64 - minY * scale,
          scale,
        },
        immediate,
      );
    };
    const focus = (id: string, immediate = false) => {
      const target = targetRegion(id);
      if (!target) return;
      const scale = Math.max(
        0.25,
        Math.min(1, (root.clientWidth - 96) / target.width),
      );
      moveTo(
        {
          x: root.clientWidth / 2 - (target.x + target.width / 2) * scale,
          y: 64 - target.y * scale,
          scale,
        },
        immediate,
      );
    };
    const zoom = (
      value: number,
      point = {
        x: bounds().width / 2 - bounds().offsetX,
        y: root.clientHeight / 2,
      },
    ) => {
      interrupt();
      setAnchor(null);
      camera.current = zoomAt(camera.current, point, value);
      paint();
      later();
    };
    controls.current = {
      fit,
      focus,
      zoom,
      moveTo,
      refresh,
      cancel: controls.current.cancel,
      restored: controls.current.restored,
      restoredTargets: controls.current.restoredTargets,
      restoredAnchor: previousAnchor?.id ?? null,
      restore: () => {
        const next =
          previousAnchor &&
          regions().find((item) => item.id === previousAnchor!.id);
        if (next && previousAnchor)
          camera.current = {
            ...camera.current,
            x:
              camera.current.x +
              (previousAnchor.x - next.x) * camera.current.scale,
            y:
              camera.current.y +
              (previousAnchor.y - next.y) * camera.current.scale,
          };
        paintNow();
        refresh();
      },
      point: (x, y) => {
        const local = clientPoint(x, y);
        return {
          x: (local.x - camera.current.x) / camera.current.scale,
          y: (local.y - camera.current.y) / camera.current.scale,
        };
      },
    };

    const wheel = (event: WheelEvent) => {
      if (!ownsInput(event.target)) return;
      if (objectGesture) {
        event.preventDefault();
        return;
      }
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
      nestedGesture ||= ownsWheel(
        event.target,
        scroll,
        delta.x,
        delta.y,
        event.ctrlKey || event.metaKey,
      );
      if (nestedGesture) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = root.getBoundingClientRect();
        zoom(
          camera.current.scale * Math.exp(-clamp(delta.y, -100, 100) * 0.008),
          {
            x: (event.clientX - rect.left) / outerScale() - bounds().offsetX,
            y: (event.clientY - rect.top) / outerScale(),
          },
        );
        return;
      }
      if (!gesture) gesture = beginPan();
      gesture.delta.x -= delta.x / outerScale();
      gesture.delta.y -= delta.y / outerScale();
      pan(gesture);
      later();
    };
    const localPoint = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / outerScale() - bounds().offsetX,
        y: (event.clientY - rect.top) / outerScale(),
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
        !ownsInput(event.target) ||
        event.defaultPrevented ||
        (event.target as Element).closest("[data-board-drawing-input]")
      )
        return;
      if (springFrame || gesture) interrupt();
      const target = event.target as Element;
      if (target.closest("[data-surface-handle]")) {
        if (event.button === 0) {
          interrupt();
          objectGesture = true;
        }
        return;
      }
      if (
        target.closest(
          '[data-surface-ui], [data-surface-handle], [data-surface-gesture="own"], .react-flow',
        )
      )
        return;
      const touch = event.pointerType === "touch";
      if (touch) {
        touches.set(event.pointerId, localPoint(event));
        if (touches.size === 2) {
          event.preventDefault();
          interrupt();
          drag = null;
          pinch = { ...pinchMetrics(), camera: { ...camera.current }, anchor };
          setAnchor(null);
          for (const id of touches.keys()) root.setPointerCapture(id);
          return;
        }
      }
      const touchReading =
        touch &&
        !target.closest(
          'button, a, input, textarea, select, summary, [role="slider"], iframe',
        );
      if (
        drag ||
        event.button > 1 ||
        (interactive(target) &&
          !touchReading &&
          !(event.button === 1 || (space && !editable(target))))
      )
        return;
      const background = !target.closest("[data-surface-content]");
      if (!background && !touchReading && !space && event.button !== 1) return;
      if (!touch) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        root.setPointerCapture(event.pointerId);
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        touch,
        started: !touch,
        gesture: beginPan(),
      };
      if (!touch) root.classList.add("is-panning");
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
      const dx = (event.clientX - drag.x) / outerScale(),
        dy = (event.clientY - drag.y) / outerScale();
      if (!drag.started) {
        if (Math.hypot(dx, dy) < 8 || !window.getSelection()?.isCollapsed)
          return;
        drag.started = true;
        root.setPointerCapture(event.pointerId);
        root.classList.add("is-panning");
      }
      drag.gesture.delta = { x: dx, y: dy };
      pan(drag.gesture);
    };
    const finish = (event?: PointerEvent, cancelled = false) => {
      objectGesture = false;
      if (event) touches.delete(event.pointerId);
      else touches.clear();
      if (pinch) {
        const initial = pinch;
        pinch = null;
        if (cancelled) {
          setAnchor(initial.anchor);
          springTo(initial.camera);
        } else settle();
      }
      if (drag && (!event || drag.id === event.pointerId)) {
        const initial = drag;
        drag = null;
        if (root.hasPointerCapture(initial.id))
          root.releasePointerCapture(initial.id);
        if (initial.started) {
          if (cancelled) {
            setAnchor(initial.gesture.anchor);
            springTo(initial.gesture.origin);
          } else {
            gesture = initial.gesture;
            settle();
          }
        }
      }
      root.classList.remove("is-panning");
    };
    const up = (event: PointerEvent) => finish(event);
    controls.current.cancel = () => {
      interrupt();
      if (drag && root.hasPointerCapture(drag.id))
        root.releasePointerCapture(drag.id);
      drag = null;
      pinch = null;
      touches.clear();
      objectGesture = false;
      nestedGesture = false;
      space = false;
      root.classList.remove("is-panning", "is-hand");
    };
    const cancel = (event: PointerEvent) => finish(event, true);
    const lostCapture = (event: PointerEvent) => {
      objectGesture = false;
      if (drag?.id === event.pointerId) finish(event, true);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!ownsInput(event.target)) return;
      if (springFrame) stopSpring();
      if (editable(event.target) && gesture) {
        interrupt();
        refresh();
      }
      if (event.defaultPrevented || event.isComposing || editable(event.target))
        return;
      if (event.code === "Space" && !interactive(event.target)) {
        event.preventDefault();
        space = true;
        root.classList.add("is-hand");
      }
      if (event.key === "Escape") {
        if (drag || pinch) finish(undefined, true);
      }
      if (event.target !== root) return;
      const step = event.shiftKey ? 320 : 120;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
        PageUp: [0, root.clientHeight * 0.8],
        PageDown: [0, -root.clientHeight * 0.8],
      };
      if (arrows[event.key]) {
        event.preventDefault();
        const [x, y] = arrows[event.key];
        moveTo({
          ...camera.current,
          x: camera.current.x + x,
          y:
            anchor && !x
              ? clamp(camera.current.y + y, anchor.minY, anchor.maxY)
              : camera.current.y + y,
        });
      }
      if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        zoom(camera.current.scale * (event.key === "-" ? 1 / 1.2 : 1.2));
      }
      if (event.key === "0" || event.key === "Home") {
        event.preventDefault();
        fit();
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
      if (gesture) settle();
    };
    const nativeScroll = () => {
      if (matchMedia("print").matches) return;
      if (!scroll.scrollTop && !scroll.scrollLeft) return;
      const x = scroll.scrollLeft,
        y = scroll.scrollTop;
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      if (!enabledRef.current) return;
      // Editor transactions may request scroll while a region is being revealed.
      // The camera owns that transition; a real pointer/key event interrupts it.
      if (springFrame) {
        paint();
        return;
      }
      // Browser find, caret navigation and focus still request native scroll.
      // Keep those movements in the same camera coordinates as pointer gestures.
      interrupt();
      camera.current = {
        ...camera.current,
        x: camera.current.x - x,
        y: camera.current.y - y,
      };
      refresh();
    };
    const resize = new ResizeObserver(() => {
      if (!gesture && !drag && !pinch && !springFrame && !objectGesture)
        refresh();
    });
    resize.observe(root);
    const observedCards = new Set<HTMLElement>();
    const refreshLayout = () => {
      const cards = new Set(
        [...world.querySelectorAll<HTMLElement>("[data-surface-id]")].filter(
          (element) =>
            element.closest(".surface-world") === world &&
            element.closest("[data-container-root]") ===
              world.closest("[data-container-root]"),
        ),
      );
      for (const card of observedCards) {
        if (!cards.has(card)) {
          resize.unobserve(card);
          observedCards.delete(card);
        }
      }
      for (const card of cards) {
        if (!observedCards.has(card)) {
          resize.observe(card);
          observedCards.add(card);
        }
      }
      refresh();
    };
    controls.current.refresh = refreshLayout;
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("lostpointercapture", lostCapture);
    root.addEventListener("keydown", keydown);
    scroll.addEventListener("scroll", nativeScroll);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    refreshLayout();
    return () => {
      remember();
      resize.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(springFrame);
      clearTimeout(idle);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", cancel);
      root.removeEventListener("lostpointercapture", lostCapture);
      root.removeEventListener("keydown", keydown);
      scroll.removeEventListener("scroll", nativeScroll);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    controls.current.refresh();
  }, [layoutKey]);
  useEffect(() => {
    if (!enabled) controls.current.cancel();
  }, [enabled]);
  return { rootRef, scrollRef, worldRef, scale, camera, controls };
}
