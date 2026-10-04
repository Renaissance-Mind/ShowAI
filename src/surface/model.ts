import type { JSONContent } from "@tiptap/core";

/** Positions are document-relative CSS pixels, independent of the camera. */
export interface CanvasPlacement {
  x: number;
  y: number;
  width: number;
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ESCAPE_DISTANCE = 280;
export const GESTURE_IDLE = 220;

export function placement(node: JSONContent): CanvasPlacement | undefined {
  return node.attrs?.canvas ?? undefined;
}

export function splitContent(content: JSONContent) {
  const items = (content.content ?? []).filter((node) => placement(node));
  const body = (content.content ?? []).filter((node) => !placement(node));
  return { items, body: { ...content, content: body } };
}

export function replaceBody(content: JSONContent, body: JSONContent) {
  return {
    ...body,
    content: [...(body.content ?? []), ...splitContent(content).items],
  };
}

export function makeCanvasItem(
  content: JSONContent[],
  position: CanvasPlacement,
): JSONContent {
  return {
    type: "callout",
    attrs: {
      id: crypto.randomUUID(),
      icon: "",
      tone: "neutral",
      canvas: { ...position },
    },
    content: content.length ? content : [{ type: "paragraph" }],
  };
}

export function dockItem(content: JSONContent, id: string): JSONContent {
  const item = content.content?.find((node) => node.attrs?.id === id);
  if (!item) return content;
  const { body, items } = splitContent(content);
  return {
    ...content,
    content: [
      ...(body.content ?? []),
      ...(item.content ?? []),
      ...items.filter((node) => node !== item),
    ],
  };
}

export function normalizedWheel(
  dx: number,
  dy: number,
  mode: number,
  height: number,
  shift = false,
) {
  const unit = mode === 1 ? 16 : mode === 2 ? height : 1;
  return {
    x: (shift && !dx ? dy : dx) * unit,
    y: (shift && !dx ? 0 : dy) * unit,
  };
}

export function resistance(distance: number) {
  return Math.sign(distance) * 88 * (1 - Math.exp(-Math.abs(distance) / 160));
}

export function zoomAt(
  camera: Camera,
  point: { x: number; y: number },
  scale: number,
): Camera {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  return {
    x: point.x - ((point.x - camera.x) * next) / camera.scale,
    y: point.y - ((point.y - camera.y) * next) / camera.scale,
    scale: next,
  };
}

export function canDock(camera: Camera, maxScroll: number, hasItems: boolean) {
  return (
    !hasItems &&
    Math.abs(camera.x) <= 42 &&
    Math.abs(camera.scale - 1) <= 0.025 &&
    camera.y <= 32 &&
    camera.y >= -maxScroll - 32
  );
}

/** A new gesture starts after inactivity; a vertical gesture stays vertical. */
export interface EscapeGesture {
  time: number;
  start: number;
  distance: number;
  samples: number;
  axis: "x" | "y";
}
export function advanceEscape(
  previous: EscapeGesture | null,
  dx: number,
  dy: number,
  now: number,
) {
  const fresh = !previous || now - previous.time > GESTURE_IDLE;
  const axis = fresh
    ? Math.abs(dx) > Math.max(2, Math.abs(dy) * 1.6)
      ? "x"
      : "y"
    : previous.axis;
  const distance =
    (fresh ? 0 : previous.distance) +
    (axis === "x" ? Math.max(-80, Math.min(80, dx)) : 0);
  const gesture: EscapeGesture = {
    time: now,
    start: fresh ? now : previous.start,
    distance,
    samples: fresh ? 1 : previous.samples + 1,
    axis,
  };
  return {
    gesture,
    escaped:
      axis === "x" &&
      Math.abs(distance) >= ESCAPE_DISTANCE &&
      gesture.samples >= 4 &&
      now - gesture.start >= 80,
  };
}
