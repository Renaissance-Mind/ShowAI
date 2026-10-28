// Table column resizing: a gesture changes only the colgroup geometry and
// commits one edit on release. The handle is a focusable separator: arrow keys
// change the width by 10px (50px with Shift), Home restores the default width
// and Escape cancels a drag.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "./database-contract.mjs";

export interface ColumnWidth {
  id: string;
  width: number;
  savedWidth: number | undefined;
}
const clamp = (width: number) =>
  Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)));

export function useColumnResize({
  viewId,
  columns,
  trailing,
  disabled,
  onCommit,
}: {
  viewId: string;
  columns: ColumnWidth[];
  /** Width of the columns after the properties, such as row actions. */
  trailing: number;
  disabled: boolean;
  /** A width, or undefined to restore the default. */
  onCommit: (id: string, width: number | undefined) => void;
}) {
  const table = useRef<HTMLTableElement>(null);
  const latest = useRef({ viewId, columns, trailing, disabled, onCommit });
  latest.current = { viewId, columns, trailing, disabled, onCommit };
  const gesture = useRef<{
    id: string;
    viewId: string;
    pointerId: number;
    handle: HTMLDivElement;
    scroller: HTMLElement;
    startX: number;
    pointX: number;
    startScroll: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const frame = useRef(0);
  const [resizing, setResizing] = useState<string | null>(null);
  const paint = () => {
    const element = table.current;
    if (!element) return;
    const current = gesture.current;
    let total = latest.current.trailing;
    const cols = [
      ...element.querySelectorAll<HTMLTableColElement>(
        "col[data-column-width-id]",
      ),
    ];
    for (const column of latest.current.columns) {
      const width = current?.id === column.id ? current.width : column.width;
      const col = cols.find((item) => item.dataset.columnWidthId === column.id);
      if (col) col.style.width = `${width}px`;
      total += width;
    }
    element.style.width = `${total}px`;
    if (current) {
      current.handle.setAttribute("aria-valuenow", String(current.width));
      element.style.setProperty(
        "--sb-resize-guide-height",
        `${element.offsetHeight}px`,
      );
    }
  };
  useLayoutEffect(paint);
  const clean = (updateState = true) => {
    const current = gesture.current;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (current?.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    table.current?.style.removeProperty("--sb-resize-guide-height");
    document.body.classList.remove("sb-database-resizing");
    if (current) {
      paint();
      current.handle.setAttribute(
        "aria-valuenow",
        String(
          latest.current.columns.find((column) => column.id === current.id)
            ?.width ?? current.startWidth,
        ),
      );
    }
    if (updateState) setResizing(null);
  };
  const update = () => {
    const current = gesture.current;
    if (!current) return;
    current.width = clamp(
      current.startWidth +
        current.pointX -
        current.startX +
        current.scroller.scrollLeft -
        current.startScroll,
    );
    paint();
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      current.pointX = event.clientX;
    };
    const up = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.pointX = event.clientX;
      update();
      const { id, width, startWidth } = current;
      clean();
      if (width !== startWidth) latest.current.onCommit(id, width);
    };
    const cancel = () => clean();
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      clean();
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
      clean(false);
    };
  }, []);
  useEffect(() => {
    const current = gesture.current;
    if (
      current &&
      (disabled ||
        current.viewId !== viewId ||
        !columns.some((column) => column.id === current.id))
    )
      clean();
  }, [disabled, viewId, columns.map((column) => column.id).join("\0")]);

  return {
    table,
    resizing,
    handleProps: (id: string): HTMLAttributes<HTMLDivElement> => {
      const column = columns.find((item) => item.id === id)!;
      return {
        role: "separator",
        "aria-orientation": "vertical",
        "aria-valuemin": MIN_COLUMN_WIDTH,
        "aria-valuemax": MAX_COLUMN_WIDTH,
        "aria-valuenow": column.width,
        tabIndex: disabled ? -1 : 0,
        "aria-disabled": disabled || undefined,
        onPointerDown: (event) => {
          if (
            latest.current.disabled ||
            event.button !== 0 ||
            !event.isPrimary ||
            gesture.current ||
            !table.current
          )
            return;
          const scroller = table.current.parentElement;
          if (!scroller) return;
          event.preventDefault();
          event.stopPropagation();
          const currentColumn = latest.current.columns.find(
            (item) => item.id === id,
          )!;
          gesture.current = {
            id,
            viewId,
            pointerId: event.pointerId,
            handle: event.currentTarget,
            scroller,
            startX: event.clientX,
            pointX: event.clientX,
            startScroll: scroller.scrollLeft,
            startWidth: currentColumn.width,
            width: currentColumn.width,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
          document.body.classList.add("sb-database-resizing");
          setResizing(id);
          // Keep widening while the pointer rests near an edge of the scroller.
          const tick = () => {
            const current = gesture.current;
            if (!current) return;
            const bounds = current.scroller.getBoundingClientRect();
            if (Math.abs(current.pointX - current.startX) > 3) {
              const distance =
                current.pointX > bounds.right - 24
                  ? Math.min(12, (current.pointX - bounds.right + 24) / 2)
                  : current.pointX < bounds.left + 24
                    ? -Math.min(12, (bounds.left + 24 - current.pointX) / 2)
                    : 0;
              current.scroller.scrollLeft += distance;
            }
            update();
            frame.current = requestAnimationFrame(tick);
          };
          frame.current = requestAnimationFrame(tick);
        },
        onLostPointerCapture: () => {
          if (gesture.current) clean();
        },
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
        },
        onDoubleClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!latest.current.disabled && column.savedWidth !== undefined)
            latest.current.onCommit(id, undefined);
        },
        onKeyDown: (event) => {
          if (
            latest.current.disabled ||
            gesture.current ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          latest.current.onCommit(
            id,
            event.key === "Home"
              ? undefined
              : clamp(
                  column.width +
                    (event.key === "ArrowLeft" ? -1 : 1) *
                      (event.shiftKey ? 50 : 10),
                ),
          );
        },
      };
    },
  };
}
