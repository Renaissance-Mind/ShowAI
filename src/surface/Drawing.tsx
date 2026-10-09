import { ObjectContext } from "./SurfaceObject";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { JSONContent } from "@tiptap/core";
import type { DrawingTool, NodeLayout } from "./types";
import type { Camera } from "./model";
type Point = { x: number; y: number };
export function Drawing({
  node,
  frame,
}: {
  node: JSONContent;
  frame?: NodeLayout;
}) {
  const actions = useContext(ObjectContext);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{
    key: "start" | "end";
    point: Point;
  } | null>(null);
  const drag = useRef<{
    key: "start" | "end";
    x: number;
    y: number;
    scale: number;
    original: Point;
    next: Point;
    source: JSONContent;
    frame: NodeLayout;
  } | null>(null);
  const latest = useRef({ node, frame, connect: actions.connect });
  latest.current = { node, frame, connect: actions.connect };
  const cancel = () => {
    drag.current = null;
    setDragging(false);
    setPreview(null);
  };
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, [dragging]);
  const { tool, points, color, strokeWidth, extent } = node.attrs! as {
    tool: DrawingTool;
    points: Point[];
    color: string;
    strokeWidth: number;
    extent: [number, number];
  };
  const first = preview?.key === "start" ? preview.point : points[0],
    last = preview?.key === "end" ? preview.point : points.at(-1)!;
  let path = points
    .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
    .join(" ");
  if (tool === "arrow") {
    const angle = Math.atan2(last.y - first.y, last.x - first.x),
      head = Math.min(20, Math.hypot(last.x - first.x, last.y - first.y) * 0.3);
    path = `M ${first.x} ${first.y} L ${last.x} ${last.y} M ${last.x - head * Math.cos(angle - 0.5)} ${last.y - head * Math.sin(angle - 0.5)} L ${last.x} ${last.y} L ${last.x - head * Math.cos(angle + 0.5)} ${last.y - head * Math.sin(angle + 0.5)}`;
  }
  return (
    <>
      <svg
        className="board-drawing"
        viewBox={`0 0 ${extent[0]} ${extent[1]}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={node.attrs!.name || tool}
      >
        <g
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {tool === "rectangle" ? (
            <rect
              x={Math.min(first.x, last.x)}
              y={Math.min(first.y, last.y)}
              width={Math.abs(last.x - first.x)}
              height={Math.abs(last.y - first.y)}
            />
          ) : tool === "ellipse" ? (
            <ellipse
              cx={(first.x + last.x) / 2}
              cy={(first.y + last.y) / 2}
              rx={Math.abs(last.x - first.x) / 2}
              ry={Math.abs(last.y - first.y) / 2}
            />
          ) : (
            <path d={path} />
          )}
        </g>
      </svg>
      {tool === "arrow" &&
        frame &&
        !actions.readOnly &&
        actions.connect &&
        (actions.board?.ids.has(node.attrs!.id) ??
          actions.selected === node.attrs!.id) &&
        (["start", "end"] as const).map((key) => {
          const endpoint = key === "start" ? first : last;
          return (
            <button
              key={key}
              type="button"
              className="board-arrow-endpoint"
              data-surface-ui
              data-surface-handle
              aria-label={key === "start" ? "调整箭头起点" : "调整箭头终点"}
              style={{
                left: `${(endpoint.x / extent[0]) * 100}%`,
                top: `${(endpoint.y / extent[1]) * 100}%`,
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                const rect = event.currentTarget
                  .closest("[data-surface-id]")!
                  .getBoundingClientRect();
                setDragging(true);
                drag.current = {
                  key,
                  x: event.clientX,
                  y: event.clientY,
                  scale: rect.width / frame.width,
                  original: endpoint,
                  next: endpoint,
                  source: node,
                  frame,
                };
              }}
              onPointerMove={(event) => {
                const d = drag.current;
                if (!d) return;
                event.stopPropagation();
                d.next = {
                  x:
                    d.original.x +
                    ((event.clientX - d.x) / d.scale / frame.width) * extent[0],
                  y:
                    d.original.y +
                    ((event.clientY - d.y) /
                      d.scale /
                      (frame.height ?? extent[1])) *
                      extent[1],
                };
                setPreview({ key, point: d.next });
              }}
              onPointerUp={(event) => {
                const d = drag.current;
                if (!d) return;
                event.stopPropagation();
                const valid =
                  latest.current.node === d.source &&
                  latest.current.frame === d.frame;
                cancel();
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                if (
                  valid &&
                  (d.next.x !== d.original.x || d.next.y !== d.original.y)
                )
                  latest.current.connect?.(node.attrs!.id, key, {
                    x: frame.x + (d.next.x / extent[0]) * frame.width,
                    y:
                      frame.y +
                      (d.next.y / extent[1]) * (frame.height ?? extent[1]),
                  });
              }}
              onPointerCancel={cancel}
              onLostPointerCapture={cancel}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancel();
                  return;
                }
                const step = (
                  {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  } as Record<string, number[]>
                )[event.key];
                if (!step) return;
                event.preventDefault();
                event.stopPropagation();
                cancel();
                const amount = event.shiftKey ? 10 : 1;
                actions.connect?.(node.attrs!.id, key, {
                  x:
                    frame.x +
                    (endpoint.x / extent[0]) * frame.width +
                    step[0] * amount,
                  y:
                    frame.y +
                    (endpoint.y / extent[1]) * (frame.height ?? extent[1]) +
                    step[1] * amount,
                });
              }}
            />
          );
        })}
    </>
  );
}
export function DrawingInput({
  tool,
  color,
  camera,
  point,
  onDraw,
  onExit,
}: {
  tool: DrawingTool;
  color: string;
  camera: { current: Camera };
  point: (x: number, y: number) => Point;
  onDraw: (node: JSONContent, frame: NodeLayout) => void;
  onExit: () => void;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const pending = useRef<{ id: number; points: Point[] } | null>(null);
  const cancel = () => {
    pending.current = null;
    setPoints([]);
  };
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);
  const add = (event: PointerEvent<SVGSVGElement>) => {
    if (pending.current?.id !== event.pointerId) return;
    const next = point(event.clientX, event.clientY),
      last = pending.current.points.at(-1)!;
    if (Math.hypot(next.x - last.x, next.y - last.y) < 0.7) return;
    const values =
      tool === "pen"
        ? [...pending.current.points, next]
        : [pending.current.points[0], next];
    pending.current.points = values.slice(0, 20000);
    setPoints(pending.current.points);
  };
  const preview =
    points.length > 1
      ? {
          type: "drawing",
          attrs: { tool, points, color, strokeWidth: 2.5, extent: [1, 1] },
        }
      : null;
  return (
    <svg
      className="board-drawing-input"
      data-board-drawing-input
      aria-label="绘画区域"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = point(event.clientX, event.clientY);
        pending.current = { id: event.pointerId, points: [start] };
        setPoints([start]);
      }}
      onPointerMove={add}
      onPointerUp={(event) => {
        const current = pending.current;
        if (!current || current.id !== event.pointerId) return;
        add(event);
        const values = current.points;
        cancel();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (values.length < 2) return;
        const xs = values.map((p) => p.x),
          ys = values.map((p) => p.y),
          x = Math.min(...xs) - 4,
          y = Math.min(...ys) - 4,
          width = Math.max(...xs) - x + 4,
          height = Math.max(...ys) - y + 4;
        onDraw(
          {
            type: "drawing",
            attrs: {
              id: crypto.randomUUID(),
              name: {
                pen: "笔画",
                rectangle: "矩形",
                ellipse: "椭圆",
                arrow: "箭头",
              }[tool],
              tool,
              color,
              strokeWidth: 2.5,
              extent: [width, height],
              points: values.map((p) => ({ x: p.x - x, y: p.y - y })),
            },
          },
          { x, y, width, height },
        );
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (pending.current) cancel();
          else onExit();
        }
      }}
      onWheelCapture={(event) => {
        if (pending.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <g
        transform={`translate(${camera.current.x} ${camera.current.y}) scale(${camera.current.scale})`}
      >
        {preview && (
          <g style={{ pointerEvents: "none" }}>
            <DrawingPreview node={preview} />
          </g>
        )}
      </g>
    </svg>
  );
}
function DrawingPreview({ node }: { node: JSONContent }) {
  const { points, tool, color } = node.attrs!;
  const a = points[0],
    b = points.at(-1);
  return (
    <g
      stroke={color}
      strokeWidth={2.5}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tool === "rectangle" ? (
        <rect
          x={Math.min(a.x, b.x)}
          y={Math.min(a.y, b.y)}
          width={Math.abs(b.x - a.x)}
          height={Math.abs(b.y - a.y)}
        />
      ) : tool === "ellipse" ? (
        <ellipse
          cx={(a.x + b.x) / 2}
          cy={(a.y + b.y) / 2}
          rx={Math.abs(b.x - a.x) / 2}
          ry={Math.abs(b.y - a.y) / 2}
        />
      ) : (
        <path
          d={points
            .map((p: Point, i: number) => `${i ? "L" : "M"} ${p.x} ${p.y}`)
            .join(" ")}
        />
      )}
    </g>
  );
}
