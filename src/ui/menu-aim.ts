export interface MenuAimPoint {
  x: number;
  y: number;
}

export interface MenuAimBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function cross(a: MenuAimPoint, b: MenuAimPoint, point: MenuAimPoint): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

export function inSubmenuCorridor(
  point: MenuAimPoint,
  previous: MenuAimPoint,
  bounds: MenuAimBounds,
  side: "left" | "right",
): boolean {
  if (side === "right" ? point.x < previous.x : point.x > previous.x)
    return false;
  const edge = {
    x: side === "right" ? bounds.left : bounds.right,
    top: bounds.top,
    bottom: bounds.bottom,
  };
  const top = { x: edge.x, y: edge.top };
  const bottom = { x: edge.x, y: edge.bottom };
  const area = cross(previous, top, bottom);
  if (Math.abs(area) < 1) return false;
  const first = cross(previous, top, point);
  const second = cross(top, bottom, point);
  const third = cross(bottom, previous, point);
  return area > 0
    ? first >= 0 && second >= 0 && third >= 0
    : first <= 0 && second <= 0 && third <= 0;
}
