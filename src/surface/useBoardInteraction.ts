import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import type { Camera } from "./model";
import {
  createSnapIndex,
  resizeFrame,
  frameBounds,
  pointsBounds,
  snapFrame,
  intersectsFrame,
  type SnapIndex,
  type Point,
} from "./geometry.mjs";
import { boundEndpoints, indexSurfaceTree } from "./connections.mjs";

export type BoardGesture = "move" | "resize" | `resize-${string}` | "rotate";
export interface BoardGestureInput {
  clientX: number;
  clientY: number;
  altKey: boolean;
  shiftKey: boolean;
}
export interface BoardInteraction {
  ids: Set<string>;
  select: (id: string | null, additive?: boolean) => void;
  start: (id: string, kind: BoardGesture, point: BoardGestureInput) => boolean;
  update: (point: BoardGestureInput) => void;
  finish: () => void;
  cancel: () => void;
}
export function useBoardInteraction({
  document,
  containerId,
  world,
  camera,
  onTransform,
  onSelect,
  selected,
}: {
  document?: ShowDocument;
  containerId?: string;
  world: RefObject<HTMLDivElement | null>;
  camera: RefObject<Camera>;
  onTransform?: (frames: Record<string, NodeLayout>) => void;
  onSelect: (id: string | null) => void;
  selected: string | null;
}): BoardInteraction & {
  marquee: (rect: NodeLayout, additive: boolean) => void;
} {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const current = useRef({ document, onTransform, onSelect, selected });
  current.current = { document, onTransform, onSelect, selected };
  const selectionIndex = useMemo(
    () => (document ? indexSurfaceTree(document.content) : new Map()),
    [document?.content],
  );
  const local = (id: string) =>
    selectionIndex.get(id)?.parent?.attrs?.id === containerId;
  const ids = new Set(
    [
      ...(selected && selection.has(selected)
        ? selection
        : new Set(selected ? [selected] : [])),
    ].filter(local),
  );
  const currentIds = useRef(ids);
  currentIds.current = ids;
  const pending = useRef<{
    source: ShowDocument;
    id: string;
    kind: BoardGesture;
    start: Point;
    scale: number;
    frames: Record<string, NodeLayout>;
    measured: Record<string, NodeLayout>;
    next: Record<string, NodeLayout>;
    elements: Map<string, HTMLElement>;
    snap: SnapIndex;
    bounds: NodeLayout;
    guides: SVGSVGElement;
    arrows: ReturnType<typeof indexSurfaceTree>;
    raf: number;
    input: BoardGestureInput | null;
    moved: boolean;
  } | null>(null);
  const select = (id: string | null, additive = false) => {
    const next = additive ? new Set(currentIds.current) : new Set<string>();
    if (id) {
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
    }
    currentIds.current = next;
    setSelection(next);
    onSelect(next.has(id!) ? id : ([...next].at(-1) ?? null));
  };
  const apply = (el: HTMLElement, frame: NodeLayout) => {
    el.style.left = `${frame.x}px`;
    el.style.top = `${frame.y}px`;
    el.style.width = `${frame.width}px`;
    if (el.dataset.boardFixedHeight === "true")
      el.style.height = `${frame.height}px`;
    el.style.transform = frame.rotation ? `rotate(${frame.rotation}deg)` : "";
  };
  const restore = () => {
    const drag = pending.current;
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.guides.remove();
    const latest = current.current.document;
    for (const [id, el] of drag.elements) {
      const frame = latest?.layout?.[id];
      if (frame) apply(el, frame);
      if (drag.arrows.get(id)?.node.attrs?.tool === "arrow") {
        const path = el.querySelector(".board-drawing path"),
          original = el.dataset.boardOriginalPath;
        if (path && original !== undefined) path.setAttribute("d", original);
        delete el.dataset.boardOriginalPath;
      }
    }
    pending.current = null;
  };
  useEffect(() => () => restore(), []);
  const paint = () => {
    const drag = pending.current,
      input = drag?.input;
    if (!drag || !input) return;
    if (
      !drag.moved &&
      Math.hypot(input.clientX - drag.start.x, input.clientY - drag.start.y) < 3
    )
      return;
    drag.moved = true;
    const dx = (input.clientX - drag.start.x) / drag.scale,
      dy = (input.clientY - drag.start.y) / drag.scale;
    const resizing = drag.kind.startsWith("resize");
    const resizeHandle = drag.kind === "resize" ? "se" : drag.kind.slice(7);
    let candidate = resizing
      ? resizeFrame(
          drag.bounds,
          { x: dx, y: dy },
          resizeHandle,
          undefined,
          input.shiftKey,
        )
      : { ...drag.bounds, x: drag.bounds.x + dx, y: drag.bounds.y + dy };
    const snap =
      input.altKey ||
      drag.kind === "rotate" ||
      (resizing && resizeHandle !== "se")
        ? { frame: candidate, guides: [] }
        : snapFrame(candidate, drag.snap, drag.scale, resizing);
    candidate = snap.frame;
    drag.guides.replaceChildren();
    for (const guide of snap.guides) {
      const line = window.document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      const vertical = guide.axis === "x";
      line.setAttribute("x1", String(vertical ? guide.value : guide.from));
      line.setAttribute("x2", String(vertical ? guide.value : guide.to));
      line.setAttribute("y1", String(vertical ? guide.from : guide.value));
      line.setAttribute("y2", String(vertical ? guide.to : guide.value));
      line.setAttribute("vector-effect", "non-scaling-stroke");
      if (guide.kind === "gap") line.setAttribute("stroke-dasharray", "4 3");
      drag.guides.append(line);
    }
    const index = drag.arrows;
    for (const [id, frame] of Object.entries(drag.frames)) {
      let next: NodeLayout;
      if (drag.kind === "rotate") {
        const el = drag.elements.get(id)!,
          box = el.getBoundingClientRect();
        const cx = box.left + box.width / 2,
          cy = box.top + box.height / 2;
        const angle =
          Math.atan2(input.clientY - cy, input.clientX - cx) -
          Math.atan2(drag.start.y - cy, drag.start.x - cx);
        let rotation = (frame.rotation ?? 0) + (angle * 180) / Math.PI;
        if (input.shiftKey) rotation = Math.round(rotation / 15) * 15;
        next = { ...frame, rotation: ((rotation + 540) % 360) - 180 };
      } else if (resizing) {
        const node = index.get(id)!.node,
          drawing = node.type === "drawing";
        const sx = candidate.width / drag.bounds.width,
          sy = (candidate.height ?? 1) / (drag.bounds.height || 1);
        next = {
          ...frame,
          x: candidate.x + (frame.x - drag.bounds.x) * sx,
          y: candidate.y + (frame.y - drag.bounds.y) * sy,
          width: Math.max(drawing ? 1 : 120, Math.min(10000, frame.width * sx)),
          ...(drag.elements.get(id)?.dataset.boardFixedHeight === "true"
            ? {
                height: Math.max(
                  node.type === "surface" ? 180 : 1,
                  Math.min(1000000, (drag.measured[id].height ?? 1) * sy),
                ),
              }
            : {}),
        };
        if (Object.keys(drag.frames).length === 1) {
          const fixed =
            drag.elements.get(id)?.dataset.boardFixedHeight === "true";
          const delta =
            resizeHandle === "se" && !frame.rotation
              ? {
                  x: candidate.width - drag.bounds.width,
                  y: (candidate.height ?? 0) - (drag.bounds.height ?? 0),
                }
              : { x: dx, y: dy };
          next = resizeFrame(
            drag.measured[id],
            delta,
            resizeHandle,
            {
              width: drawing ? 1 : 120,
              height: node.type === "surface" ? 180 : 1,
            },
            input.shiftKey,
          );
          if (!fixed) {
            next.height = frame.height;
            next.y = frame.y;
          }
        }
      } else
        next = {
          ...frame,
          x: frame.x + candidate.x - drag.bounds.x,
          y: frame.y + candidate.y - drag.bounds.y,
        };
      drag.next[id] = next;
      apply(drag.elements.get(id)!, next);
    }
    // Preview only affected connections, without rerendering rich component trees.
    const layout = { ...drag.source.layout, ...drag.next };
    for (const [id, entry] of index) {
      if (
        entry.node.type !== "drawing" ||
        entry.node.attrs?.tool !== "arrow" ||
        !entry.node.attrs.bindings ||
        !drag.elements.has(id)
      )
        continue;
      if (
        !Object.values(entry.node.attrs.bindings).some(
          (b) => drag.frames[(b as { targetId: string }).targetId],
        )
      )
        continue;
      const el = drag.elements.get(id)!,
        svg = el.querySelector(".board-drawing"),
        path = svg?.querySelector("path");
      if (!svg || !path) continue;
      if (el.dataset.boardOriginalPath === undefined)
        el.dataset.boardOriginalPath = path.getAttribute("d") ?? "";
      // Preserve the SVG viewbox, expressing world endpoints in its existing local coordinates.
      const [a, b] = boundEndpoints(entry.node, layout[id], index, layout).map(
        (p) => ({
          x:
            ((p.x - layout[id].x) * entry.node.attrs!.extent[0]) /
            layout[id].width,
          y:
            ((p.y - layout[id].y) * entry.node.attrs!.extent[1]) /
            (layout[id].height ?? 1),
        }),
      );
      const angle = Math.atan2(b.y - a.y, b.x - a.x),
        head = Math.min(20, Math.hypot(b.x - a.x, b.y - a.y) * 0.3);
      path.setAttribute(
        "d",
        `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${b.x - head * Math.cos(angle - 0.5)} ${b.y - head * Math.sin(angle - 0.5)} L ${b.x} ${b.y} L ${b.x - head * Math.cos(angle + 0.5)} ${b.y - head * Math.sin(angle + 0.5)}`,
      );
    }
  };
  return {
    ids,
    select,
    start(id, kind, point) {
      const source = current.current.document,
        root = world.current;
      if (!source || !root || !current.current.onTransform) return false;
      restore();
      const index = indexSurfaceTree(source.content),
        parent = index.get(id)?.parent;
      if (!parent || parent.attrs?.id !== containerId) return false;
      const chosen =
        kind === "rotate"
          ? new Set([id])
          : currentIds.current.has(id)
            ? currentIds.current
            : new Set([id]);
      if (!chosen.has(current.current.selected!)) {
        setSelection(chosen);
        currentIds.current = chosen;
        onSelect(id);
      }
      const elements = new Map<string, HTMLElement>();
      for (const child of root.children)
        if (child instanceof HTMLElement && child.dataset.surfaceId)
          elements.set(child.dataset.surfaceId, child);
      const frames: Record<string, NodeLayout> = {},
        measured: Record<string, NodeLayout> = {};
      for (const [nodeId, el] of elements) {
        const frame = source.layout?.[nodeId];
        if (!frame) continue;
        measured[nodeId] = { ...frame, height: el.offsetHeight };
        if (chosen.has(nodeId)) frames[nodeId] = frame;
      }
      if (!frames[id]) return false;
      const bounds = pointsBounds(
        Object.keys(frames).flatMap((key) => {
          const b = frameBounds(measured[key]);
          return [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
          ];
        }),
      )!;
      const guides = window.document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      guides.classList.add("board-snap-guides");
      guides.setAttribute("aria-hidden", "true");
      root.append(guides);
      pending.current = {
        source,
        id,
        kind,
        start: { x: point.clientX, y: point.clientY },
        scale:
          elements.get(id)!.getBoundingClientRect().width /
            frameBounds(measured[id]).width || camera.current.scale,
        frames,
        measured,
        next: { ...frames },
        elements,
        bounds,
        guides,
        arrows: index,
        raf: 0,
        input: null,
        moved: false,
        snap: createSnapIndex(
          Object.entries(measured)
            .filter(
              ([key]) =>
                !chosen.has(key) &&
                index.get(key)?.node.attrs?.tool !== "arrow",
            )
            .map(([key, frame]) => ({ id: key, frame })),
        ),
      };
      return true;
    },
    update(input) {
      const drag = pending.current;
      if (!drag) return;
      drag.input = input;
      if (!drag.raf)
        drag.raf = requestAnimationFrame(() => {
          drag.raf = 0;
          paint();
        });
    },
    finish() {
      const drag = pending.current;
      if (!drag) return;
      paint();
      const latest = current.current.document;
      const valid =
        latest?.content === drag.source.content &&
        Object.keys(drag.frames).every(
          (id) => latest?.layout?.[id] === drag.frames[id],
        );
      const changed = Object.keys(drag.frames).some(
        (id) =>
          JSON.stringify(drag.next[id]) !== JSON.stringify(drag.frames[id]),
      );
      const frames = drag.next;
      restore();
      if (valid && changed) current.current.onTransform?.(frames);
    },
    cancel: restore,
    marquee(rect, additive) {
      const next = additive ? new Set(currentIds.current) : new Set<string>();
      for (const child of world.current?.children ?? []) {
        if (!(child instanceof HTMLElement)) continue;
        const id = child.dataset.surfaceId,
          frame = id && current.current.document?.layout?.[id];
        if (
          id &&
          frame &&
          intersectsFrame({ ...frame, height: child.offsetHeight }, rect)
        )
          next.add(id);
      }
      setSelection(next);
      currentIds.current = next;
      onSelect([...next].at(-1) ?? null);
    },
  };
}
