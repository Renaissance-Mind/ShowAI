import { useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { BoardInteraction } from "./useBoardInteraction";
import { fingerNavigatesBoard } from "./board-input.mjs";
import { polygonContains } from "./lasso";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

type Point = { x: number; y: number };
/** Common stroke eraser and freeform selection for every Board renderer. */
export function BoardGestureInput({
  tool,
  board,
  world,
  onDelete,
  onExit,
}: {
  tool: "eraser" | "lasso";
  board: BoardInteraction;
  world: React.RefObject<HTMLDivElement | null>;
  onDelete: (ids: string[]) => void;
  onExit: () => void;
}) {
  const t = useTranslator(messages),
    [preview, setPreview] = useState<Point[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const local = (p: Point) => {
    const m = svg.current?.getScreenCTM();
    return m ? new DOMPoint(p.x, p.y).matrixTransform(m.inverse()) : p;
  };
  const gesture = useRef<{
    id: number;
    points: Point[];
    erased: Set<string>;
    last: Point;
  } | null>(null);
  const isInk = (node: JSONContent) =>
    node.type === "drawing" || !!node.attrs?.data?.nativeInk;
  const erase = (p: Point) => {
    const hit = board.hitTest(p.x, p.y);
    if (hit && isInk(hit.node)) gesture.current?.erased.add(hit.id);
  };
  const add = (p: Point) => {
    const value = gesture.current;
    if (!value) return;
    if (tool === "eraser") {
      const n = Math.ceil(
        Math.hypot(p.x - value.last.x, p.y - value.last.y) / 4,
      );
      for (let i = 0; i <= n; i++)
        erase({
          x: value.last.x + ((p.x - value.last.x) * i) / (n || 1),
          y: value.last.y + ((p.y - value.last.y) * i) / (n || 1),
        });
    } else if (Math.hypot(p.x - value.last.x, p.y - value.last.y) >= 2) {
      value.points.push(p);
      setPreview([...value.points]);
    }
    value.last = p;
  };
  const finish = () => {
    const value = gesture.current;
    if (!value) return;
    gesture.current = null;
    setPreview([]);
    if (tool === "eraser") {
      if (value.erased.size) onDelete([...value.erased]);
      return;
    }
    if (value.points.length < 3) return;
    const selected: string[] = [];
    for (const element of world.current?.querySelectorAll<HTMLElement>(
      ".surface-object[data-surface-id]",
    ) ?? []) {
      if (
        element.closest(".page-surface") !==
        world.current?.closest(".page-surface")
      )
        continue;
      const rect = element.getBoundingClientRect();
      const samples = [
        { x: rect.left, y: rect.top },
        { x: rect.right, y: rect.top },
        { x: rect.right, y: rect.bottom },
        { x: rect.left, y: rect.bottom },
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      ];
      if (samples.some((p) => polygonContains(value.points, p)))
        selected.push(element.dataset.surfaceId!);
    }
    board.selectIds(selected);
  };
  return (
    <svg
      ref={svg}
      className="board-drawing-input"
      data-board-drawing-input
      data-drawing-active={!!gesture.current}
      aria-label={t(tool === "eraser" ? "tool.eraser" : "tool.lasso")}
      tabIndex={0}
      onPointerDown={(e) => {
        if (
          e.button !== 0 ||
          fingerNavigatesBoard(e.pointerType) ||
          gesture.current
        )
          return;
        const hit = board.hitTest(e.clientX, e.clientY);
        if (
          tool === "lasso" &&
          (board.selectionHit(e.clientX, e.clientY) ||
            (hit && board.ids.has(hit.id)))
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = { x: e.clientX, y: e.clientY };
        gesture.current = {
          id: e.pointerId,
          points: [p],
          erased: new Set(),
          last: p,
        };
        if (tool === "eraser") erase(p);
        else setPreview([p]);
      }}
      onPointerMove={(e) => {
        if (gesture.current?.id === e.pointerId) {
          e.preventDefault();
          add({ x: e.clientX, y: e.clientY });
        }
      }}
      onPointerUp={(e) => {
        if (gesture.current?.id !== e.pointerId) return;
        e.preventDefault();
        add({ x: e.clientX, y: e.clientY });
        finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          gesture.current = null;
          setPreview([]);
          onExit();
        }
      }}
    >
      {preview.length > 1 && (
        <path
          d={
            preview
              .map((p, i) => `${i ? "L" : "M"}${local(p).x},${local(p).y}`)
              .join(" ") + " Z"
          }
          fill="#7194ff18"
          stroke="#7194ff"
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
