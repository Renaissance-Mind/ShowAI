export type DockEdge = "top" | "bottom" | "left" | "right";
export interface ToolbarDock {
  edge: DockEdge;
  position: number;
}
const edges: DockEdge[] = ["bottom", "top", "left", "right"];
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function readToolbarDock(saved: string | null): ToolbarDock {
  const [edge, raw] = (saved ?? "").split(":");
  const position = Number(raw);
  return edges.includes(edge as DockEdge) && raw && Number.isFinite(position)
    ? { edge: edge as DockEdge, position: clamp(position, 0, 1) }
    : { edge: "bottom", position: 0.5 };
}

export function snapToolbar(
  point: { x: number; y: number },
  bounds: { width: number; height: number },
): ToolbarDock {
  const distances = {
    top: point.y,
    bottom: bounds.height - point.y,
    left: point.x,
    right: bounds.width - point.x,
  };
  const edge = edges.reduce((best, next) =>
    distances[next] < distances[best] ? next : best,
  );
  const horizontal = edge === "top" || edge === "bottom";
  return {
    edge,
    position: clamp(
      horizontal
        ? point.x / Math.max(1, bounds.width)
        : point.y / Math.max(1, bounds.height),
      0,
      1,
    ),
  };
}

export function toolbarCenter(
  dock: ToolbarDock,
  bounds: { width: number; height: number },
  size: { width: number; height: number },
  reserve = 0,
) {
  bounds = { ...bounds, height: Math.max(1, bounds.height - reserve) };
  const horizontal = dock.edge === "top" || dock.edge === "bottom";
  const xInset = Math.min(bounds.width / 2, size.width / 2 + 12),
    yInset = Math.min(bounds.height / 2, size.height / 2 + 12);
  return {
    x: horizontal
      ? clamp(bounds.width * dock.position, xInset, bounds.width - xInset)
      : dock.edge === "left"
        ? xInset
        : bounds.width - xInset,
    y: horizontal
      ? dock.edge === "top"
        ? yInset
        : bounds.height - yInset
      : clamp(bounds.height * dock.position, yInset, bounds.height - yInset),
  };
}

export const toolbarPropertiesReserve = (edge: DockEdge) =>
  edge === "left" || edge === "right" ? 264 : 108;
