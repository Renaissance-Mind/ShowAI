import { expect, it } from "vitest";
import { shapeIntersectsPolygon } from "./drawing-geometry.mjs";
import { rotatePoint } from "./geometry.mjs";
const frame = { x: 100, y: 100, width: 120, height: 80 };
const shape = (tool: string) => ({
  type: "drawing",
  attrs: {
    tool,
    color: "#123456",
    fillColor: "none",
    strokeWidth: 2,
    extent: [120, 80],
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 80 },
    ],
  },
});
it.each(["rectangle", "ellipse"])(
  "selects a %s when a narrow lasso touches its edge without enclosing its bounds",
  (tool) => {
    expect(
      shapeIntersectsPolygon(shape(tool), frame, [
        { x: 219.5, y: 138 },
        { x: 225, y: 138 },
        { x: 225, y: 142 },
        { x: 219.5, y: 142 },
      ]),
    ).toBe(true);
  },
);
it("does not select an ellipse from a lasso in the empty corner of its bounds", () => {
  expect(
    shapeIntersectsPolygon(shape("ellipse"), frame, [
      { x: 217, y: 101 },
      { x: 220, y: 101 },
      { x: 220, y: 104 },
      { x: 217, y: 104 },
    ]),
  ).toBe(false);
});
it.each(["pen", "arrow"])(
  "selects a %s crossed by an open lasso trace",
  (tool) => {
    expect(
      shapeIntersectsPolygon(shape(tool), frame, [
        { x: 127, y: 123 },
        { x: 133, y: 117 },
      ]),
    ).toBe(true);
  },
);
it("keeps contact selection accurate for a rotated ellipse", () => {
  const pivot = { x: 160, y: 140 },
    point = rotatePoint({ x: 220, y: 140 }, pivot, 45);
  expect(
    shapeIntersectsPolygon(shape("ellipse"), { ...frame, rotation: 45 }, [
      { x: point.x - 3, y: point.y },
      { x: point.x + 3, y: point.y },
    ]),
  ).toBe(true);
});
