import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PropertyDragPreview,
  PropertyLayoutMotion,
} from "./PropertyDragPreview";

type Axis = "horizontal" | "vertical";
type Point = { x: number; y: number };

/** Preview locally; save one id-addressed dataset move after landing. */
export function usePropertyReorder({
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
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef({ ids, disabled, onMove });
  latest.current = { ids, disabled, onMove };
  const gesture = useRef<{
    id: string;
    pointerId: number;
    handle: HTMLButtonElement;
    root: HTMLDivElement;
    start: Point;
    point: Point;
    originalIds: string[];
    active: boolean;
    settling: boolean;
  } | null>(null);
  const visual = useRef<PropertyDragPreview | null>(null);
  const layout = useRef<PropertyLayoutMotion | null>(null);
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
    (layout.current ??= new PropertyLayoutMotion(() => [
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
    document.body.classList.remove("project-db-reordering");
    setOrder(null);
    setDragging(null);
    if (restoreFocus && current?.handle.isConnected)
      current.handle.focus({ preventScroll: true });
  };
  const inside = (point: Point) => {
    const root = container.current;
    if (!root) return false;
    const bounds = root.getBoundingClientRect();
    const viewport = root
      .closest(".studio-database-library")
      ?.getBoundingClientRect();
    return (
      point.x >= Math.max(bounds.left, viewport?.left ?? 0) &&
      point.x <= Math.min(bounds.right, viewport?.right ?? window.innerWidth) &&
      point.y >= Math.max(bounds.top, viewport?.top ?? 0) &&
      point.y <= Math.min(bounds.bottom, viewport?.bottom ?? window.innerHeight)
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
        visual.current = new PropertyDragPreview(
          element,
          current.root,
          axis,
          current.start,
        );
        current.root.setPointerCapture(current.pointerId);
        projected.current = [...latest.current.ids];
        current.active = true;
        setDragging(current.id);
        document.body.classList.add("project-db-reordering");
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
      const scroller =
        axis === "horizontal"
          ? current.root
          : (current.root.closest<HTMLElement>(".studio-database-library") ??
            current.root.closest<HTMLElement>(".project-database"));
      if (scroller && inside(current.point)) {
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
      onClickCapture: (event: React.MouseEvent) => {
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
    handleProps: (id: string) => ({
      "data-reorderable": (!disabled && ids.length > 1) || undefined,
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
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
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
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
