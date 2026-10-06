import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripHorizontal, Settings2, Trash2, Maximize2 } from "lucide-react";
import type { NodeLayout } from "./types";

export interface ObjectActions {
  scale: number;
  selected: string | null;
  select: (id: string | null) => void;
  inspect?: (id: string) => void;
  expand?: (id: string) => void;
  remove?: (id: string) => void;
  move?: (id: string, frame: NodeLayout) => void;
  readOnly: boolean;
  revealAll: boolean;
  revealed: Set<string>;
}
export const ObjectContext = createContext<ObjectActions>({
  scale: 1,
  selected: null,
  select: () => {},
  readOnly: true,
  revealAll: false,
  revealed: new Set(),
});

export function SurfaceObject({
  id,
  name,
  frame,
  positioned,
  region = false,
  container = false,
  drawing = false,
  fixedHeight = false,
  children,
}: {
  id: string;
  name: string;
  frame?: NodeLayout;
  positioned: boolean;
  region?: boolean;
  container?: boolean;
  drawing?: boolean;
  fixedHeight?: boolean;
  children: ReactNode;
}) {
  const actions = useContext(ObjectContext);
  const element = useRef<HTMLElement>(null),
    handle = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false),
    [moving, setMoving] = useState(false);
  const latest = useRef({ frame, move: actions.move });
  latest.current = { frame, move: actions.move };
  const pending = useRef<{
    id: number;
    x: number;
    y: number;
    start: NodeLayout;
    next: NodeLayout;
    resize: boolean;
    scale: number;
  } | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        root: element.current!.closest(".surface-scroll"),
        rootMargin: "600px",
      },
    );
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, []);
  const apply = (value: NodeLayout) => {
    const node = element.current!;
    node.style.left = `${value.x}px`;
    node.style.top = `${value.y}px`;
    node.style.width =
      container && !positioned
        ? `min(100%, ${value.width}px)`
        : `${value.width}px`;
    if (fixedHeight && value.height) node.style.height = `${value.height}px`;
  };
  const cancel = () => {
    const drag = pending.current;
    if (!drag) return;
    pending.current = null;
    setMoving(false);
    if (latest.current.frame) apply(latest.current.frame);
    if (handle.current?.hasPointerCapture(drag.id))
      handle.current.releasePointerCapture(drag.id);
  };
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);
  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    resize = false,
  ) => {
    if (
      event.button !== 0 ||
      (!positioned && !resize) ||
      !frame ||
      !actions.move
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    actions.select(id);
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    handle.current = event.currentTarget;
    pending.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: frame,
      next: frame,
      resize,
      scale:
        element.current!.getBoundingClientRect().width / frame.width ||
        actions.scale,
    };
    setMoving(true);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = (event.clientX - drag.x) / drag.scale,
      dy = (event.clientY - drag.y) / drag.scale;
    drag.next = drag.resize
      ? {
          ...drag.start,
          width: Math.max(
            drawing ? 1 : 120,
            Math.min(10000, drag.start.width + dx),
          ),
          ...(fixedHeight
            ? {
                height: Math.max(
                  container ? 180 : 1,
                  Math.min(1000000, (drag.start.height ?? 420) + dy),
                ),
              }
            : {}),
        }
      : {
          ...drag.start,
          x: Math.max(-1000000, Math.min(1000000, drag.start.x + dx)),
          y: Math.max(-1000000, Math.min(1000000, drag.start.y + dy)),
        };
    apply(drag.next);
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = pending.current;
    if (!drag || drag.id !== event.pointerId) return;
    const actual = latest.current.frame;
    const unchanged =
      actual &&
      actual.x === drag.start.x &&
      actual.y === drag.start.y &&
      actual.width === drag.start.width &&
      actual.height === drag.start.height;
    pending.current = null;
    setMoving(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      unchanged &&
      (drag.next.x !== drag.start.x ||
        drag.next.y !== drag.start.y ||
        drag.next.width !== drag.start.width ||
        drag.next.height !== drag.start.height)
    )
      latest.current.move?.(id, drag.next);
    else if (actual) apply(actual);
  };
  const handlers = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  };
  const style: CSSProperties =
    positioned && frame
      ? {
          position: "absolute",
          left: frame.x,
          top: frame.y,
          width: frame.width,
          minHeight: frame.height,
        }
      : { position: "relative", minWidth: 0 };
  if (container && !positioned && frame)
    style.width = `min(100%, ${frame.width}px)`;
  if (frame) {
    (style as Record<string, unknown>)["--frame-width"] = `${frame.width}px`;
    (style as Record<string, unknown>)["--frame-x"] = `${frame.x}px`;
    (style as Record<string, unknown>)["--frame-y"] = `${frame.y}px`;
  }
  if (frame?.height)
    (style as Record<string, unknown>)["--frame-height"] = `${frame.height}px`;
  if (fixedHeight) {
    style.height = frame?.height ?? 460;
    style.minHeight = undefined;
  }
  const mount =
    visible ||
    actions.revealAll ||
    actions.revealed.has(id) ||
    actions.selected === id;
  return (
    <section
      ref={element}
      style={style}
      className={`surface-object${region ? " is-region" : ""}${container ? " is-container" : ""}${drawing ? " is-drawing" : ""}${moving ? " is-moving" : ""}${actions.selected === id ? " is-selected" : ""}`}
      data-surface-id={id}
      data-surface-name={name}
      data-surface-content
      aria-label={name}
      onPointerDown={(event) => {
        if (
          (event.target as Element).closest("[data-surface-id]") ===
          event.currentTarget
        )
          actions.select(id);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && pending.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {(!actions.readOnly || container) && (
        <div className="surface-object-header" data-surface-ui>
          {actions.readOnly ? (
            <span className="surface-object-grip">{name}</span>
          ) : (
            <button
              type="button"
              className="surface-object-grip"
              data-surface-handle={positioned || undefined}
              aria-label={`移动 ${name}`}
              title={positioned ? "拖动移动；方向键微调" : "选择内容"}
              onPointerDown={(event) =>
                positioned ? start(event) : actions.select(id)
              }
              {...handlers}
              onKeyDown={(event) => {
                if (!positioned || !frame || !actions.move) return;
                const steps: Record<string, [number, number]> = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                };
                const step = steps[event.key];
                if (!step) return;
                event.preventDefault();
                event.stopPropagation();
                const amount = event.shiftKey ? 50 : 10;
                actions.move(id, {
                  ...frame,
                  x: Math.max(
                    -1000000,
                    Math.min(1000000, frame.x + step[0] * amount),
                  ),
                  y: Math.max(
                    -1000000,
                    Math.min(1000000, frame.y + step[1] * amount),
                  ),
                });
              }}
            >
              <GripHorizontal size={14} />
              <span>{name}</span>
            </button>
          )}
          {container && (
            <button
              type="button"
              aria-label={`展开 ${name}`}
              onClick={() => actions.expand?.(id)}
            >
              <Maximize2 size={14} />
            </button>
          )}
          {!actions.readOnly && (
            <>
              <button
                type="button"
                aria-label={`设置 ${name}`}
                onClick={() => actions.inspect?.(id)}
              >
                <Settings2 size={14} />
              </button>
              <button
                type="button"
                aria-label={`删除 ${name}`}
                onClick={() => actions.remove?.(id)}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      )}
      <div className="surface-object-content">
        {mount ? (
          children
        ) : (
          <div
            className="surface-object-placeholder"
            style={{ minHeight: frame?.height ?? (region ? 240 : 160) }}
          />
        )}
      </div>
      {!actions.readOnly && (positioned || fixedHeight) && (
        <button
          type="button"
          className="surface-object-resize"
          data-surface-handle
          aria-label={`调整 ${name} ${fixedHeight ? "尺寸" : "宽度"}`}
          title="拖动调宽；左右方向键微调"
          onPointerDown={(event) => start(event, true)}
          {...handlers}
          onKeyDown={(event) => {
            if (
              !frame ||
              !actions.move ||
              !["ArrowLeft", "ArrowRight"].includes(event.key)
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            actions.move(id, {
              ...frame,
              width: Math.max(
                120,
                Math.min(
                  10000,
                  frame.width + (event.key === "ArrowLeft" ? -20 : 20),
                ),
              ),
            });
          }}
        >
          ↔
        </button>
      )}
    </section>
  );
}
