// Pointer reordering of database properties: a same-size preview follows the
// pointer, the other columns or rows slide into place, and one move is saved
// on release. Alt+Shift+arrow keys move a property one step.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Axis = "horizontal" | "vertical";
type Point = { x: number; y: number };
const easing = "cubic-bezier(.2,.8,.2,1)";
const motionDuration = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 170;
// The preview lives outside the component, so it carries the component's colors.
const THEME = [
  "--sb-surface",
  "--sb-soft",
  "--sb-line",
  "--sb-text",
  "--sb-muted",
  "--sb-accent",
  "--sb-accent-soft",
  "--sb-hover",
];

/** A same-size, inert snapshot, anchored at the original grab point. */
class DragPreview {
  private ghost: HTMLDivElement;
  private origin: DOMRect;
  private offset: Point;
  private point: Point;
  private settling: Animation | null = null;
  private disposed = false;

  constructor(
    private source: HTMLElement,
    root: HTMLElement,
    private axis: Axis,
    point: Point,
  ) {
    this.origin = source.getBoundingClientRect();
    this.offset = { x: point.x - this.origin.x, y: point.y - this.origin.y };
    this.point = point;
    this.ghost = document.createElement("div");
    this.ghost.className = `sb-block sb-database sb-database-drag-layer sb-database-drag-${axis}`;
    this.ghost.setAttribute("aria-hidden", "true");
    this.ghost.inert = true;
    const theme = getComputedStyle(source);
    for (const name of THEME)
      this.ghost.style.setProperty(name, theme.getPropertyValue(name));
    this.ghost.style.width = `${this.origin.width}px`;
    this.ghost.style.font = theme.font;
    if (axis === "horizontal") {
      const height = Math.max(
        this.origin.height,
        Math.min(root.getBoundingClientRect().bottom, window.innerHeight) -
          this.origin.top,
      );
      this.ghost.style.height = `${height}px`;
      const table = document.createElement("table");
      table.className = "sb-database-table";
      table.createTHead().insertRow().append(this.clone(source));
      const body = table.createTBody();
      const id = source.dataset.propertyId;
      for (const cell of root.querySelectorAll<HTMLElement>(
        "tbody [data-property-cell]",
      )) {
        if (cell.dataset.propertyCell !== id) continue;
        if (cell.getBoundingClientRect().top >= this.origin.top + height) break;
        body.insertRow().append(this.clone(cell));
      }
      this.ghost.append(table);
    } else {
      this.ghost.style.height = `${this.origin.height}px`;
      const row = this.clone(source);
      row.style.margin = "0";
      this.ghost.append(row);
    }
    document.body.append(this.ghost);
    this.move(point);
  }
  private clone(source: HTMLElement) {
    const clone = source.cloneNode(true) as HTMLElement;
    const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    copies.forEach((node, index) => {
      for (const attribute of [...node.attributes])
        if (
          attribute.name === "id" ||
          attribute.name === "name" ||
          attribute.name === "for" ||
          attribute.name.startsWith("aria-") ||
          attribute.name.startsWith("data-")
        )
          node.removeAttribute(attribute.name);
      const original = originals[index];
      if (
        node instanceof HTMLInputElement &&
        original instanceof HTMLInputElement
      ) {
        node.value = original.value;
        node.checked = original.checked;
      } else if (
        node instanceof HTMLSelectElement &&
        original instanceof HTMLSelectElement
      )
        node.selectedIndex = original.selectedIndex;
      node.style.transform = "none";
    });
    return clone;
  }
  move(point: Point) {
    if (this.disposed) return;
    this.point = point;
    const sourceRect = this.source.getBoundingClientRect();
    const x =
      this.axis === "horizontal" ? point.x - this.offset.x : sourceRect.x;
    const y = this.axis === "vertical" ? point.y - this.offset.y : sourceRect.y;
    this.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  center() {
    return this.axis === "horizontal"
      ? this.point.x - this.offset.x + this.origin.width / 2
      : this.point.y - this.offset.y + this.origin.height / 2;
  }
  async settle(target: HTMLElement) {
    if (this.disposed) return;
    const from = this.ghost.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    this.settling = this.ghost.animate(
      [
        { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
        { transform: `translate3d(${to.x}px, ${to.y}px, 0)` },
      ],
      { duration: motionDuration(), easing, fill: "forwards" },
    );
    await this.settling.finished.catch(() => {});
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.settling?.cancel();
    this.ghost.remove();
  }
}

/** React owns the order. FLIP translates existing cells or rows between those layouts. */
class LayoutMotion {
  private animations = new Map<HTMLElement, Animation>();
  private before = new Map<HTMLElement, DOMRect>();
  constructor(private elements: () => HTMLElement[]) {}
  capture() {
    this.before = new Map(
      this.elements().map((element) => [
        element,
        element.getBoundingClientRect(),
      ]),
    );
  }
  layoutRect(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    if (!this.animations.has(element)) return rect;
    const transform = getComputedStyle(element).transform;
    const matrix = new DOMMatrixReadOnly(
      transform === "none" ? undefined : transform,
    );
    return new DOMRect(
      rect.x - matrix.m41,
      rect.y - matrix.m42,
      rect.width,
      rect.height,
    );
  }
  play(sourceId?: string) {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    const duration = motionDuration();
    for (const element of this.elements()) {
      const before = this.before.get(element);
      const id = element.dataset.propertyId ?? element.dataset.propertyCell;
      if (!before || id === sourceId || !duration) continue;
      const next = element.getBoundingClientRect();
      const x = before.x - next.x,
        y = before.y - next.y;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const animation = element.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration, easing },
      );
      this.animations.set(element, animation);
      animation.onfinish = () => {
        if (this.animations.get(element) === animation)
          this.animations.delete(element);
      };
    }
    this.before.clear();
  }
  dispose() {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    this.before.clear();
  }
}

/** Preview the order locally while dragging; report one move after landing. */
export function usePropertyReorder<T extends HTMLElement = HTMLDivElement>({
  ids,
  disabled,
  axis,
  onMove,
}: {
  ids: string[];
  disabled: boolean;
  axis: Axis;
  onMove: (id: string, target: string, placement: "before" | "after") => void;
}) {
  const container = useRef<T>(null);
  const latest = useRef({ ids, disabled, onMove });
  latest.current = { ids, disabled, onMove };
  const gesture = useRef<{
    id: string;
    pointerId: number;
    handle: HTMLElement;
    root: HTMLElement;
    start: Point;
    point: Point;
    originalIds: string[];
    active: boolean;
    settling: boolean;
  } | null>(null);
  const visual = useRef<DragPreview | null>(null);
  const layout = useRef<LayoutMotion | null>(null);
  const projected = useRef<string[] | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const orderedIds = order
    ? [
        ...order.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !order.includes(id)),
      ]
    : ids;
  const items = () => [
    ...(container.current?.querySelectorAll<HTMLElement>(
      "[data-property-id]",
    ) ?? []),
  ];
  const source = (id: string) =>
    items().find((element) => element.dataset.propertyId === id);
  const motion = () =>
    (layout.current ??= new LayoutMotion(() => [
      ...(container.current?.querySelectorAll<HTMLElement>(
        "[data-property-id], [data-property-cell]",
      ) ?? []),
    ]));
  const project = (next: string[]) => {
    if (
      next.join("\0") === (projected.current ?? latest.current.ids).join("\0")
    )
      return;
    motion().capture();
    projected.current = next;
    setOrder(next);
  };
  useLayoutEffect(() => {
    layout.current?.play(dragging ?? undefined);
  }, [orderedIds.join("\0")]);
  const clean = (restoreFocus = false) => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.active) suppressClick.current = true;
    if (current?.root.hasPointerCapture(current.pointerId))
      current.root.releasePointerCapture(current.pointerId);
    visual.current?.dispose();
    visual.current = null;
    layout.current?.dispose();
    projected.current = null;
    document.body.classList.remove("sb-database-reordering");
    setOrder(null);
    setDragging(null);
    if (restoreFocus && current?.handle.isConnected)
      current.handle.focus({ preventScroll: true });
  };
  const inside = (point: Point) => {
    const root = container.current;
    if (!root) return false;
    const bounds = root.getBoundingClientRect();
    return (
      point.x >= Math.max(bounds.left, 0) &&
      point.x <= Math.min(bounds.right, window.innerWidth) &&
      point.y >= Math.max(bounds.top, 0) &&
      point.y <= Math.min(bounds.bottom, window.innerHeight)
    );
  };
  const update = () => {
    const current = gesture.current;
    if (!current?.active || current.settling || !visual.current) return;
    visual.current.move(current.point);
    if (!inside(current.point)) return;
    const center = visual.current.center();
    const others = (projected.current ?? latest.current.ids).filter(
      (id) => id !== current.id,
    );
    let index = 0;
    for (const id of others) {
      const element = source(id);
      if (!element) continue;
      const rect = motion().layoutRect(element);
      if (
        center >
        (axis === "horizontal"
          ? rect.left + rect.width / 2
          : rect.top + rect.height / 2)
      )
        index++;
    }
    const next = [...others];
    next.splice(index, 0, current.id);
    project(next);
  };
  const land = async (commit: boolean) => {
    const current = gesture.current;
    if (!current || current.settling) return;
    if (!current.active) return clean();
    current.settling = true;
    suppressClick.current = true;
    if (current.root.hasPointerCapture(current.pointerId))
      current.root.releasePointerCapture(current.pointerId);
    if (!commit) project([...latest.current.ids]);
    // Let React place the placeholder before measuring its destination.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (gesture.current !== current) return;
    const target = source(current.id);
    if (target) await visual.current?.settle(target);
    if (gesture.current !== current) return;
    const next = projected.current ?? current.originalIds;
    if (
      commit &&
      !latest.current.disabled &&
      next.join("\0") !== latest.current.ids.join("\0")
    ) {
      const index = next.indexOf(current.id);
      const neighbor = next[index + 1] ?? next[index - 1];
      if (neighbor)
        latest.current.onMove(
          current.id,
          neighbor,
          next[index + 1] ? "before" : "after",
        );
    }
    clean(true);
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.settling || event.pointerId !== current.pointerId)
        return;
      if (latest.current.disabled || !current.handle.isConnected)
        return clean();
      current.point = { x: event.clientX, y: event.clientY };
      if (!current.active) {
        if (
          Math.hypot(
            current.point.x - current.start.x,
            current.point.y - current.start.y,
          ) < 5
        )
          return;
        const element = source(current.id);
        if (!element) return clean();
        visual.current = new DragPreview(
          element,
          current.root,
          axis,
          current.start,
        );
        current.root.setPointerCapture(current.pointerId);
        projected.current = [...latest.current.ids];
        current.active = true;
        setDragging(current.id);
        document.body.classList.add("sb-database-reordering");
      }
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.settling || event.pointerId !== current.pointerId)
        return;
      current.point = { x: event.clientX, y: event.clientY };
      update();
      void land(inside(current.point));
    };
    const cancel = () => clean();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        void land(false);
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      clean();
    };
  }, [axis]);
  useEffect(() => {
    const current = gesture.current;
    if (
      current?.active &&
      (disabled ||
        (!current.settling &&
          ids.join("\0") !== current.originalIds.join("\0")))
    )
      clean();
  }, [disabled, ids.join("\0")]);
  useEffect(() => {
    if (!dragging) return;
    let frame = 0,
      previousTime = 0;
    const tick = (time: number) => {
      const current = gesture.current;
      if (!current || current.settling) return;
      const scroller = current.root;
      if (inside(current.point)) {
        const bounds = scroller.getBoundingClientRect();
        const coordinate =
          axis === "horizontal" ? current.point.x : current.point.y;
        const start = axis === "horizontal" ? bounds.left : bounds.top;
        const end = axis === "horizontal" ? bounds.right : bounds.bottom;
        const edge =
          coordinate < start + 40
            ? (coordinate - start - 40) / 40
            : coordinate > end - 40
              ? (coordinate - end + 40) / 40
              : 0;
        const distance =
          Math.max(-1, Math.min(1, edge)) *
          Math.min(previousTime ? time - previousTime : 16, 32) *
          0.6;
        if (axis === "horizontal") scroller.scrollLeft += distance;
        else scroller.scrollTop += distance;
      }
      previousTime = time;
      update();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, axis]);
  return {
    container,
    dragging,
    orderedIds,
    itemProps: (id: string) => ({
      "data-property-id": id,
      "data-dragging": dragging === id || undefined,
    }),
    cellProps: (id: string) => ({
      "data-property-cell": id,
      "data-dragging": dragging === id || undefined,
    }),
    containerProps: {
      onPointerDownCapture: () => {
        suppressClick.current = false;
      },
      onLostPointerCapture: () => {
        if (gesture.current && !gesture.current.settling) void land(false);
      },
      onClickCapture: (event: ReactMouseEvent) => {
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
    handleProps: (id: string) => ({
      "data-reorderable": (!disabled && ids.length > 1) || undefined,
      onDragStart: (event: { preventDefault(): void }) =>
        event.preventDefault(),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (
          disabled ||
          ids.length < 2 ||
          event.button !== 0 ||
          !event.isPrimary ||
          gesture.current ||
          !container.current
        )
          return;
        gesture.current = {
          id,
          pointerId: event.pointerId,
          handle: event.currentTarget,
          root: container.current,
          start: { x: event.clientX, y: event.clientY },
          point: { x: event.clientX, y: event.clientY },
          originalIds: [...ids],
          active: false,
          settling: false,
        };
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (disabled || gesture.current || !event.altKey || !event.shiftKey)
          return;
        const offset = (
          axis === "horizontal"
            ? event.key === "ArrowLeft"
            : event.key === "ArrowUp"
        )
          ? -1
          : (
                axis === "horizontal"
                  ? event.key === "ArrowRight"
                  : event.key === "ArrowDown"
              )
            ? 1
            : 0;
        if (!offset) return;
        event.preventDefault();
        event.stopPropagation();
        const target = ids[ids.indexOf(id) + offset];
        if (target) {
          motion().capture();
          onMove(id, target, offset < 0 ? "before" : "after");
        }
      },
    }),
  };
}
