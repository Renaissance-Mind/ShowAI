import type { SnapIndex, SnapGuide } from "./geometry.mjs";
import { creationPoints, snapCreation } from "./drawing-geometry.mjs";
import { finishBoardDrawing } from "./board-drawing.mjs";
import { fingerNavigatesBoard } from "./board-input.mjs";
import { flushSync } from "react-dom";
import { ObjectContext } from "./SurfaceObject";
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import type { JSONContent } from "@tiptap/core";
import type { BoardDrawingTool, DrawingTool, NodeLayout } from "./types";
import type { Camera } from "./model";
import "./native-ink.css";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
type Point = { x: number; y: number };
export function Drawing({
  node,
  frame,
}: {
  node: JSONContent;
  frame?: NodeLayout;
}) {
  const t = useTranslator(messages);
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
    layer: Element;
    origin: Point;
    original: Point;
    next: Point;
    source: JSONContent;
    frame: NodeLayout;
  } | null>(null);
  const latest = useRef({ node, frame, connect: actions.connect });
  latest.current = { node, frame, connect: actions.connect };
  const endpointPoint = (x: number, y: number) => {
    const d = drag.current!;
    const origin = d.layer.getBoundingClientRect();
    return {
      x:
        d.original.x +
        ((x - d.x - origin.left + d.origin.x) / d.scale / d.frame.width) *
          d.source.attrs!.extent[0],
      y:
        d.original.y +
        ((y - d.y - origin.top + d.origin.y) /
          d.scale /
          (d.frame.height ?? 1)) *
          d.source.attrs!.extent[1],
    };
  };
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
  const {
    tool,
    points,
    color,
    fillColor = "none",
    strokeWidth,
    extent,
  } = node.attrs! as {
    tool: DrawingTool;
    points: Point[];
    color: string;
    fillColor?: string;
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
        data-native-ink={node.attrs!.ink ? "" : undefined}
        data-native-ink-id={node.attrs!.ink ? node.attrs!.id : undefined}
        viewBox={`0 0 ${extent[0]} ${extent[1]}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={node.attrs!.name || tool}
      >
        <g
          fill={tool === "rectangle" || tool === "ellipse" ? fillColor : "none"}
          stroke={color}
          opacity={tool === "highlighter" ? 0.35 : 1}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {node.attrs!.ink ? (
            <>
              <image
                className={
                  node.attrs!.ink.darkPreview ? "board-ink-light" : undefined
                }
                href={node.attrs!.ink.preview}
                width={extent[0]}
                height={extent[1]}
                preserveAspectRatio="none"
              />
              {node.attrs!.ink.darkPreview && (
                <image
                  className="board-ink-dark"
                  href={node.attrs!.ink.darkPreview}
                  width={extent[0]}
                  height={extent[1]}
                  preserveAspectRatio="none"
                />
              )}
            </>
          ) : tool === "rectangle" ? (
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
              aria-label={
                key === "start"
                  ? t("drawing.arrowStart")
                  : t("drawing.arrowEnd")
              }
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
                const layer =
                    event.currentTarget.closest(
                      "[data-surface-id]",
                    )!.parentElement!,
                  origin = layer.getBoundingClientRect();
                setDragging(true);
                drag.current = {
                  key,
                  x: event.clientX,
                  y: event.clientY,
                  scale: rect.width / frame.width,
                  layer,
                  origin: { x: origin.left, y: origin.top },
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
                d.next = endpointPoint(event.clientX, event.clientY);
                setPreview({ key, point: d.next });
              }}
              onPointerUp={(event) => {
                const d = drag.current;
                if (!d) return;
                event.stopPropagation();
                d.next = endpointPoint(event.clientX, event.clientY);
                const valid =
                  JSON.stringify(latest.current.node) ===
                    JSON.stringify(d.source) &&
                  JSON.stringify(latest.current.frame) ===
                    JSON.stringify(d.frame);
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
  fillColor = "none",
  strokeWidth = 2.5,
  camera,
  panHeld,
  ruler = false,
  makeSnapIndex,
  point,
  onDraw,
  onExit,
}: {
  tool: BoardDrawingTool;
  color: string;
  fillColor?: string;
  strokeWidth?: number;
  camera: { current: Camera };
  panHeld: { current: boolean };
  ruler?: boolean;
  makeSnapIndex: () => SnapIndex;
  point: (x: number, y: number) => Point;
  onDraw: (node: JSONContent, frame: NodeLayout) => void;
  onExit: () => void;
}) {
  const t = useTranslator(messages);
  const [points, setPoints] = useState<Point[]>([]);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const pending = useRef<{
    id: number;
    points: Point[];
    origin: Point;
    cursor: Point;
    snap: SnapIndex;
    moved: boolean;
    modifiers: { shiftKey: boolean; altKey: boolean };
  } | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const freehand = tool === "pen" || tool === "highlighter";
  const cancel = () => {
    const id = pending.current?.id;
    pending.current = null;
    setPoints([]);
    setGuides([]);
    if (id !== undefined && surface.current?.hasPointerCapture(id))
      surface.current.releasePointerCapture(id);
  };
  const latest = useRef({ tool, color, fillColor, strokeWidth, point, onDraw });
  latest.current = { tool, color, fillColor, strokeWidth, point, onDraw };
  const finish = (
    release?: Point,
    modifiers?: { shiftKey?: boolean; altKey?: boolean },
  ) => {
    const current = pending.current;
    if (!current) return;
    const { tool, color, fillColor, strokeWidth, onDraw } = latest.current;
    const scale =
      camera.current.scale *
      (surface.current!.getBoundingClientRect().width /
        surface.current!.clientWidth || 1);
    const result = finishBoardDrawing(
      tool,
      { color, fillColor, strokeWidth },
      {
        ...current,
        release: release ?? current.cursor,
        scale,
      },
      modifiers ?? current.modifiers,
    );
    // Retire the gesture first, but replace its preview with the committed object
    // in one paint. Capture-loss events cannot discard or commit it twice.
    pending.current = null;
    flushSync(() => {
      onDraw(result.node, result.frame);
      setPoints([]);
      setGuides([]);
    });
    if (surface.current?.hasPointerCapture(current.id))
      surface.current.releasePointerCapture(current.id);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const blur = () => {
      if (pending.current?.moved) finishRef.current();
      else cancel();
    };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);
  const add = (event: PointerEvent<SVGSVGElement>) => {
    if (pending.current?.id !== event.pointerId) return;
    const next = point(event.clientX, event.clientY),
      last = pending.current.points.at(-1)!;
    pending.current.cursor = next;
    pending.current.modifiers = {
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
    const scale =
      camera.current.scale *
      (surface.current!.getBoundingClientRect().width /
        surface.current!.clientWidth || 1);
    pending.current.moved ||=
      Math.hypot(
        next.x - pending.current.origin.x,
        next.y - pending.current.origin.y,
      ) *
        scale >=
      3;
    if (
      freehand &&
      !ruler &&
      Math.hypot(next.x - last.x, next.y - last.y) * scale < 0.7
    )
      return;
    let values = freehand
      ? ruler
        ? [pending.current.origin, next]
        : [...pending.current.points, next]
      : creationPoints(
          tool === "region" ? "rectangle" : tool,
          pending.current.origin,
          next,
          event,
        );
    if (
      (tool === "rectangle" || tool === "ellipse" || tool === "region") &&
      !event.altKey
    ) {
      const snapped = snapCreation(
        values,
        pending.current.snap,
        scale,
        event.shiftKey,
      );
      values = snapped.points;
      setGuides(snapped.guides);
    } else setGuides([]);
    pending.current.points = values.slice(0, 20000);
    setPoints(pending.current.points);
  };
  const preview =
    points.length > 1
      ? {
          type: "drawing",
          attrs: {
            tool: tool === "region" ? "rectangle" : tool,
            points,
            color,
            fillColor,
            strokeWidth,
            extent: [1, 1],
          },
        }
      : null;
  return (
    <svg
      ref={surface}
      className="board-drawing-input"
      data-drawing-active={points.length > 0}
      data-board-drawing-input
      aria-label={t("drawing.area")}
      tabIndex={0}
      onPointerDown={(event) => {
        if (fingerNavigatesBoard(event.pointerType)) return;
        if (event.button !== 0 || panHeld.current || pending.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = point(event.clientX, event.clientY);
        pending.current = {
          id: event.pointerId,
          points: [start],
          origin: start,
          cursor: start,
          snap: makeSnapIndex(),
          moved: false,
          modifiers: { shiftKey: event.shiftKey, altKey: event.altKey },
        };
        setPoints([start]);
      }}
      onPointerMove={add}
      onPointerUp={(event) => {
        const current = pending.current;
        if (!current || current.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        finish(point(event.clientX, event.clientY), event);
      }}
      onPointerCancel={(event) => {
        if (pending.current?.id !== event.pointerId) return;
        if (pending.current.moved) finish();
        else cancel();
      }}
      onLostPointerCapture={(event) => {
        if (
          pending.current?.id !== event.pointerId ||
          event.currentTarget.hasPointerCapture(event.pointerId)
        )
          return;
        if (pending.current.moved) finish();
        else cancel();
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          ((event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "z" &&
            pending.current)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (pending.current) cancel();
          else onExit();
        } else if (pending.current && ["Shift", "Alt"].includes(event.key)) {
          pending.current.modifiers = {
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          };
          const values = pending.current.points;
          if (!freehand && values.length > 1) {
            const next = creationPoints(
              tool === "region" ? "rectangle" : tool,
              pending.current.origin,
              pending.current.cursor,
              event,
            );
            pending.current.points = next;
            setPoints(next);
          }
        }
      }}
      onKeyUp={(event) => {
        if (
          pending.current &&
          !freehand &&
          ["Shift", "Alt"].includes(event.key)
        ) {
          pending.current.modifiers = {
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          };
          const next = creationPoints(
            tool === "region" ? "rectangle" : tool,
            pending.current.origin,
            pending.current.cursor,
            event,
          );
          pending.current.points = next;
          setPoints(next);
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
        <g stroke="#e06b52" strokeWidth={1} pointerEvents="none">
          {guides.map((guide, i) => (
            <line
              key={i}
              vectorEffect="non-scaling-stroke"
              x1={guide.axis === "x" ? guide.value : guide.from}
              x2={guide.axis === "x" ? guide.value : guide.to}
              y1={guide.axis === "y" ? guide.value : guide.from}
              y2={guide.axis === "y" ? guide.value : guide.to}
            />
          ))}
        </g>
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
  const {
    points,
    tool,
    color,
    fillColor = "none",
    strokeWidth = 2.5,
  } = node.attrs!;
  const a = points[0],
    b = points.at(-1);
  let path = points
    .map((p: Point, i: number) => `${i ? "L" : "M"} ${p.x} ${p.y}`)
    .join(" ");
  if (tool === "arrow") {
    const angle = Math.atan2(b.y - a.y, b.x - a.x),
      head = Math.min(20, Math.hypot(b.x - a.x, b.y - a.y) * 0.3);
    path = `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${b.x - head * Math.cos(angle - 0.5)} ${b.y - head * Math.sin(angle - 0.5)} L ${b.x} ${b.y} L ${b.x - head * Math.cos(angle + 0.5)} ${b.y - head * Math.sin(angle + 0.5)}`;
  }
  return (
    <g
      stroke={color}
      strokeWidth={strokeWidth}
      fill={tool === "rectangle" || tool === "ellipse" ? fillColor : "none"}
      opacity={tool === "highlighter" ? 0.35 : 1}
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
        <path d={path} />
      )}
    </g>
  );
}
