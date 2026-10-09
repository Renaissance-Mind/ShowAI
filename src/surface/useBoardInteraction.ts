import { canCommitBoardGesture } from "./board-commands";
import type { SurfaceGeometryStore } from "./geometry-store";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ShowDocument } from "../types";
import type { NodeLayout } from "./types";
import type { Camera } from "./model";
import {
  createSnapIndex,
  resizeFrame,
  selectionMinimum,
  frameBounds,
  frameHeight,
  pointsBounds,
  snapFrame,
  snapResizeFrame,
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
  selectAll: () => void;
  selectIds: (ids: string[]) => void;
  nudge: (x: number, y: number) => void;
  start: (id: string, kind: BoardGesture, point: BoardGestureInput) => boolean;
  update: (point: BoardGestureInput) => void;
  finish: () => void;
  cancel: () => void;
}
export function useBoardInteraction({
  document,
  geometry,
  containerId,
  world,
  camera,
  onTransform,
  onSelect,
  selected,
}: {
  document?: ShowDocument;
  geometry?: SurfaceGeometryStore;
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
    original: ShowDocument;
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
    affectedArrows: string[];
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
  const measureFrame = (frame: NodeLayout, el: HTMLElement): NodeLayout => ({
    ...frame,
    contentSize: undefined,
    height:
      el.dataset.surfaceMounted === "false"
        ? frameHeight(frame) || el.offsetHeight
        : el.offsetHeight,
  });
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
    const latest =
      current.current.document &&
      (geometry?.materialize(current.current.document) ??
        current.current.document);
    for (const id of new Set([
      ...Object.keys(drag.frames),
      ...drag.affectedArrows,
    ])) {
      const el = drag.elements.get(id)!;
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
    geometry?.endGesture();
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
    const selectedIds = Object.keys(drag.frames),
      single = selectedIds.length === 1;
    const singleNode = single
      ? drag.arrows.get(selectedIds[0])!.node
      : undefined;
    const minimum = single
      ? {
          width: singleNode?.type === "drawing" ? 1 : 120,
          height: singleNode?.type === "surface" ? 180 : 1,
        }
      : !resizing
        ? { width: 1, height: 1 }
        : selectionMinimum(
            drag.bounds,
            selectedIds.map((id) => ({
              frame: drag.measured[id],
              minWidth: drag.arrows.get(id)!.node.type === "drawing" ? 1 : 120,
              minHeight: drag.arrows.get(id)!.node.type === "surface" ? 180 : 1,
              resizeHeight:
                drag.elements.get(id)?.dataset.boardFixedHeight === "true",
            })),
          );
    const resizeOrigin = single ? drag.measured[selectedIds[0]] : drag.bounds;
    const keepAspect =
      resizing &&
      (input.shiftKey ||
        (!single && selectedIds.some((id) => !!drag.frames[id].rotation)));
    let candidate = resizing
      ? resizeFrame(
          resizeOrigin,
          { x: dx, y: dy },
          resizeHandle,
          minimum,
          keepAspect,
        )
      : { ...drag.bounds, x: drag.bounds.x + dx, y: drag.bounds.y + dy };
    const snap =
      input.altKey || drag.kind === "rotate"
        ? { frame: candidate, guides: [] }
        : resizing
          ? snapResizeFrame(
              candidate,
              drag.snap,
              drag.scale,
              resizeHandle,
              minimum,
              keepAspect,
            )
          : snapFrame(candidate, drag.snap, drag.scale);
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
        if (single) {
          next = { ...candidate };
          if (drag.elements.get(id)?.dataset.boardFixedHeight !== "true") {
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
    // Only connections touching the gesture participate in the per-frame preview.
    if (!drag.affectedArrows.length) return;
    const layout = { ...drag.source.layout, ...drag.next };
    for (const id of drag.affectedArrows) {
      const entry = index.get(id)!;
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
    selectIds(ids) {
      const next = new Set(ids);
      setSelection(next);
      currentIds.current = next;
      onSelect([...next].at(-1) ?? null);
    },
    selectAll() {
      const source = current.current.document;
      const parent =
        source && indexSurfaceTree(source.content).get(containerId!)?.node;
      const next = new Set<string>(
        (parent?.content ?? [])
          .map((node) => node.attrs?.id)
          .filter((id) => !!source?.layout?.[id]),
      );
      setSelection(next);
      currentIds.current = next;
      onSelect([...next].at(-1) ?? null);
    },
    nudge(x, y) {
      const source = current.current.document;
      if (!source || !current.current.onTransform) return;
      const frames: Record<string, NodeLayout> = {};
      for (const id of currentIds.current) {
        const frame = source.layout?.[id];
        if (frame)
          frames[id] = {
            ...frame,
            x: Math.max(-1000000, Math.min(1000000, frame.x + x)),
            y: Math.max(-1000000, Math.min(1000000, frame.y + y)),
          };
      }
      if (Object.keys(frames).length) current.current.onTransform(frames);
    },
    start(id, kind, point) {
      const original = current.current.document,
        root = world.current;
      if (!original || !root || !current.current.onTransform) return false;
      const source = geometry?.materialize(original) ?? original;
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
        measured[nodeId] = measureFrame(frame, el);
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
      geometry?.beginGesture();
      pending.current = {
        source,
        original,
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
        affectedArrows: [...index]
          .filter(
            ([id, entry]) =>
              entry.node.type === "drawing" &&
              entry.node.attrs?.tool === "arrow" &&
              elements.has(id) &&
              Object.values(entry.node.attrs.bindings ?? {}).some(
                (binding) => frames[(binding as { targetId: string }).targetId],
              ),
          )
          .map(([id]) => id),
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
      const valid = canCommitBoardGesture(
        drag.original,
        latest,
        Object.keys(drag.frames),
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
        if (id && frame && intersectsFrame(measureFrame(frame, child), rect))
          next.add(id);
      }
      setSelection(next);
      currentIds.current = next;
      onSelect([...next].at(-1) ?? null);
    },
  };
}
