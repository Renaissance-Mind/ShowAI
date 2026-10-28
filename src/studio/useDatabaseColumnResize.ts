import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import {
  MAX_DATABASE_COLUMN_WIDTH,
  MIN_DATABASE_COLUMN_WIDTH,
} from "../core/project-database";
import { TITLE_PROPERTY } from "./project-database-view";

interface ColumnWidth {
  id: string;
  width: number;
  savedWidth: number | undefined;
}
const clamp = (width: number) =>
  Math.round(
    Math.max(
      MIN_DATABASE_COLUMN_WIDTH,
      Math.min(MAX_DATABASE_COLUMN_WIDTH, width),
    ),
  );

/** Change only colgroup geometry during a gesture; commit one undoable edit on release. */
export function useDatabaseColumnResize({
  viewId,
  columns,
  disabled,
  onCommit,
}: {
  viewId: string;
  columns: ColumnWidth[];
  disabled: boolean;
  onCommit: (
    id: string,
    width: number | undefined,
    before: number | undefined,
  ) => void;
}) {
  const table = useRef<HTMLTableElement>(null);
  const latest = useRef({ viewId, columns, disabled, onCommit });
  latest.current = { viewId, columns, disabled, onCommit };
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
    before: number | undefined;
  } | null>(null);
  const frame = useRef(0);
  const [resizing, setResizing] = useState<string | null>(null);
  const paint = () => {
    const element = table.current;
    if (!element) return;
    const current = gesture.current;
    let total = 0;
    const colElements = [
      ...element.querySelectorAll<HTMLTableColElement>(
        "col[data-column-width-id]",
      ),
    ];
    for (const column of latest.current.columns) {
      const width = current?.id === column.id ? current.width : column.width;
      const col = colElements.find(
        (item) => item.dataset.columnWidthId === column.id,
      );
      if (col) col.style.width = `${width}px`;
      total += width;
    }
    // The two trailing utility columns retain their fixed sizes.
    total +=
      latest.current.disabled &&
      !element.querySelector("col[data-add-property]")
        ? 38
        : 173;
    element.style.width = `${total}px`;
    const titleWidth =
      current?.id === TITLE_PROPERTY
        ? current.width
        : (latest.current.columns.find((column) => column.id === TITLE_PROPERTY)
            ?.width ?? 280);
    element.toggleAttribute(
      "data-wide-title",
      titleWidth > (element.parentElement?.clientWidth ?? Infinity) * 0.65,
    );
    if (current) {
      current.handle.setAttribute("aria-valuenow", String(current.width));
      element.style.setProperty(
        "--db-resize-guide-height",
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
    table.current?.removeAttribute("data-resizing-column");
    table.current?.style.removeProperty("--db-resize-guide-height");
    document.body.classList.remove("project-db-resizing");
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
        (current.id === TITLE_PROPERTY
          ? 0
          : current.scroller.scrollLeft - current.startScroll),
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
      const { id, width, startWidth, before } = current;
      clean();
      if (width !== startWidth) latest.current.onCommit(id, width, before);
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
        "aria-valuemin": MIN_DATABASE_COLUMN_WIDTH,
        "aria-valuemax": MAX_DATABASE_COLUMN_WIDTH,
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
            before: currentColumn.savedWidth,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
          table.current.dataset.resizingColumn = id;
          document.body.classList.add("project-db-resizing");
          setResizing(id);
          const tick = () => {
            const current = gesture.current;
            if (!current) return;
            const bounds = current.scroller.getBoundingClientRect();
            if (
              current.id !== TITLE_PROPERTY &&
              Math.abs(current.pointX - current.startX) > 3
            ) {
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
          if (!latest.current.disabled)
            latest.current.onCommit(id, undefined, column.savedWidth);
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
          const next =
            event.key === "Home"
              ? undefined
              : clamp(
                  column.width +
                    (event.key === "ArrowLeft" ? -1 : 1) *
                      (event.shiftKey ? 50 : 10),
                );
          latest.current.onCommit(id, next, column.savedWidth);
        },
      };
    },
  };
}
