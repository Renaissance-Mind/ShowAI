import type { SnapIndex, SnapGuide } from "./geometry.mjs";
import {
  arrowPath,
  creationPoints,
  smoothPath,
  snapCreation,
} from "./drawing-geometry.mjs";
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
    if (drag.current) actions.highlightTarget?.(null);
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
  const path =
    tool === "arrow" ? arrowPath(first, last, strokeWidth) : smoothPath(points);
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
                actions.highlightTarget?.(
                  event.clientX,
                  event.clientY,
                  node.attrs!.id,
                );
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
                actions.highlightTarget?.(null);
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
  onTarget,
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
  /** Arrow tool: highlight the object an endpoint at this client point would bind to. */
  onTarget?: (x: number, y: number) => void;
}) {
  const t = useTranslator(messages);
  // Points live in the gesture; a version counter repaints without copying
  // the whole stroke on every pointer sample.
  const [, setVersion] = useState(0);
  const repaint = () => setVersion((value) => value + 1);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const pending = useRef<{
    id: number;
    points: Point[];
    origin: Point;
    cursor: Point;
    snap: SnapIndex;
    moved: boolean;
    modifiers: Modifiers;
  } | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const freehand = tool === "pen" || tool === "highlighter";
  const cancel = () => {
    const id = pending.current?.id;
    pending.current = null;
    repaint();
    setGuides([]);
    if (id !== undefined && surface.current?.hasPointerCapture(id))
      surface.current.releasePointerCapture(id);
  };
  const latest = useRef({ tool, color, fillColor, strokeWidth, point, onDraw });
  latest.current = { tool, color, fillColor, strokeWidth, point, onDraw };
  const scaleNow = () =>
    camera.current.scale *
    (surface.current!.getBoundingClientRect().width /
      surface.current!.clientWidth || 1);
  const finish = (release?: Point, modifiers?: Modifiers) => {
    const current = pending.current;
    if (!current) return;
    const { tool, color, fillColor, strokeWidth, onDraw } = latest.current;
    const result = finishBoardDrawing(
      tool,
      { color, fillColor, strokeWidth },
      {
        ...current,
        release: release ?? current.cursor,
        scale: scaleNow(),
      },
      modifiers ?? current.modifiers,
    );
    // Retire the gesture first, but replace its preview with the committed object
    // in one paint. Capture-loss events cannot discard or commit it twice.
    pending.current = null;
    flushSync(() => {
      onDraw(result.node, result.frame);
      repaint();
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
    const root = surface.current?.closest(".page-surface");
    root?.addEventListener("showai-board-pinch", cancel);
    // Panning while drawing keeps the preview attached to the content.
    root?.addEventListener("showai:viewport-change", repaint);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      root?.removeEventListener("showai-board-pinch", cancel);
      root?.removeEventListener("showai:viewport-change", repaint);
    };
  }, []);
  const modifiersOf = (event: Modifiers): Modifiers => ({
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  });
  const reshape = (current: NonNullable<typeof pending.current>) => {
    let values = creationPoints(
      tool === "region" ? "rectangle" : tool,
      current.origin,
      current.cursor,
      current.modifiers,
    );
    if (
      (tool === "rectangle" || tool === "ellipse" || tool === "region") &&
      !current.modifiers.ctrlKey &&
      !current.modifiers.metaKey
    ) {
      const snapped = snapCreation(
        values,
        current.snap,
        scaleNow(),
        current.modifiers.shiftKey,
      );
      values = snapped.points;
      setGuides(snapped.guides);
    } else setGuides([]);
    current.points = values;
  };
  const add = (event: PointerEvent<SVGSVGElement>) => {
    if (tool === "arrow") onTarget?.(event.clientX, event.clientY);
    const current = pending.current;
    if (current?.id !== event.pointerId) return;
    const samples = freehand
      ? (event.nativeEvent.getCoalescedEvents?.() ?? []).filter(
          (sample) => sample.pointerId === event.pointerId,
        )
      : [];
    if (!samples.length) samples.push(event.nativeEvent);
    const scale = scaleNow();
    for (const sample of samples) {
      const next = point(sample.clientX, sample.clientY),
        last = current.points.at(-1)!;
      current.cursor = next;
      current.moved ||=
        Math.hypot(next.x - current.origin.x, next.y - current.origin.y) *
          scale >=
        3;
      if (freehand && ruler) {
        // The ruler keeps a straight stroke from the start point.
        current.points = [current.origin, next];
        continue;
      }
      if (
        freehand &&
        (Math.hypot(next.x - last.x, next.y - last.y) * scale < 0.7 ||
          current.points.length >= 20000)
      )
        continue;
      if (freehand) current.points.push(next);
    }
    current.modifiers = modifiersOf(event);
    if (!freehand) reshape(current);
    repaint();
  };
  const points = pending.current?.points ?? [];
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
          modifiers: modifiersOf(event),
        };
        repaint();
      }}
      onPointerMove={add}
      onPointerLeave={() => tool === "arrow" && onTarget?.(NaN, NaN)}
      onPointerUp={(event) => {
        const current = pending.current;
        if (!current || current.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        finish(point(event.clientX, event.clientY), modifiersOf(event));
        if (tool === "arrow") onTarget?.(NaN, NaN);
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
        } else if (
          pending.current &&
          ["Shift", "Alt", "Control", "Meta"].includes(event.key)
        ) {
          pending.current.modifiers = modifiersOf(event);
          if (!freehand && pending.current.points.length > 1) {
            reshape(pending.current);
            repaint();
          }
        }
      }}
      onKeyUp={(event) => {
        if (
          pending.current &&
          !freehand &&
          ["Shift", "Alt", "Control", "Meta"].includes(event.key)
        ) {
          pending.current.modifiers = modifiersOf(event);
          reshape(pending.current);
          repaint();
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
type Modifiers = {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};
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
  const path =
    tool === "arrow" ? arrowPath(a, b, strokeWidth) : smoothPath(points);
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
