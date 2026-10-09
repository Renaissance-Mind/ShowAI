import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  creationPoints,
  geometryFrame,
  frameFromGeometry,
  pickShape,
  shapeHit,
  shapeIntersects,
  snapCreation,
} from "./drawing-geometry.mjs";
import {
  createSnapIndex,
  frameAnchor,
  resizeFrame,
  snapFrame,
} from "./geometry.mjs";
import { bindingAtPoint } from "./connections.mjs";

const shape = (id: string, tool = "rectangle", size = 100): JSONContent => ({
  type: "drawing",
  attrs: {
    id,
    tool,
    extent: [size, size],
    points: [
      { x: 4, y: 4 },
      { x: size - 4, y: size - 4 },
    ],
    strokeWidth: 2.5,
  },
});
const frame = { x: 0, y: 0, width: 100, height: 100 };
const candidate = (
  id: string,
  size: number,
  point: { x: number; y: number },
  scale = 1,
) => ({
  id,
  node: shape(id, "rectangle", size),
  frame: { ...frame, width: size, height: size },
  point,
  tolerance: 6 / scale,
  scale,
});

describe("painted drawing geometry", () => {
  it("lets a smaller hollow shape win through a later, larger empty shape", () => {
    for (const point of [
      { x: 96, y: 50 },
      { x: 50, y: 50 },
    ])
      expect(
        pickShape([
          candidate("small", 100, point),
          candidate("large", 300, point),
        ])?.id,
      ).toBe("small");
    expect(
      pickShape([candidate("small", 100, { x: 50, y: 50 })], false),
    ).toBeNull();
  });
  it("chooses the closest stroke and keeps paint order for coincident strokes", () => {
    const point = { x: 4, y: 50 },
      a = candidate("a", 100, point),
      b = candidate("b", 100, point);
    b.frame.x = 3;
    expect(pickShape([a, b])?.id).toBe("a");
    b.frame.x = 0;
    expect(pickShape([a, b])?.id).toBe("b");
  });
  it("lets native content occlude geometry behind it without a hollow overlay intercepting its body", () => {
    const point = { x: 50, y: 50 },
      native = {
        ...candidate("page", 100, point),
        node: { type: "surface", attrs: { id: "page", kind: "page" } },
      };
    expect(
      pickShape([
        candidate("behind", 100, point),
        native,
        candidate("hollow", 300, point),
      ])?.id,
    ).toBe("page");
  });
  it("keeps hit tolerance in screen pixels at different zoom levels", () => {
    for (const scale of [0.25, 1, 4]) {
      expect(
        pickShape([candidate("a", 100, { x: 4 - 5 / scale, y: 50 }, scale)])
          ?.id,
      ).toBe("a");
      expect(
        pickShape([candidate("a", 100, { x: 4 - 7 / scale, y: 50 }, scale)]),
      ).toBeNull();
    }
  });
  it("tests ellipses and diagonals by their paths rather than rectangular viewports", () => {
    expect(
      shapeHit(shape("ellipse", "ellipse"), frame, { x: 4, y: 4 }).inside,
    ).toBe(false);
    expect(
      shapeHit(shape("ellipse", "ellipse"), frame, { x: 50, y: 4 }).distance,
    ).toBeCloseTo(0);
    expect(
      shapeHit(shape("arrow", "arrow"), frame, { x: 90, y: 10 }).distance,
    ).toBeGreaterThan(40);
    expect(
      shapeHit(shape("arrow", "arrow"), frame, { x: 50, y: 50 }).distance,
    ).toBeCloseTo(0);
  });
  it("hits a large ellipse accurately between coarse polygon sample angles", () => {
    const node = shape("large", "ellipse", 10000),
      large = { ...frame, width: 10000, height: 10000 };
    const angle = Math.PI / 96,
      p = {
        x: 5000 + 4996 * Math.cos(angle),
        y: 5000 + 4996 * Math.sin(angle),
      };
    expect(shapeHit(node, large, p).distance).toBeLessThan(0.0001);
    expect(
      shapeIntersects(node, large, {
        x: p.x - 0.01,
        y: p.y - 0.01,
        width: 0.02,
        height: 0.02,
      }),
    ).toBe(true);
  });
  it("aligns legacy padded and newly tight viewports by their visible edges", () => {
    const padded = geometryFrame(shape("legacy"), frame),
      tight = { x: 200, y: 200, width: 92, height: 92 };
    expect(padded).toMatchObject({ x: 4, y: 4, width: 92, height: 92 });
    const snapped = snapFrame(
      { ...padded, x: 198, y: 198 },
      createSnapIndex([{ id: "target", frame: tight }]),
      1,
    ).frame;
    const stored = frameFromGeometry(shape("legacy"), frame, snapped);
    expect(geometryFrame(shape("legacy"), stored)).toMatchObject({
      x: 200,
      y: 200,
      width: 92,
      height: 92,
    });
  });
  it("resizes a rotated legacy shape around its painted opposite handle", () => {
    const source = { ...frame, x: 120, y: 80, rotation: 37 },
      node = shape("legacy"),
      visual = geometryFrame(node, source);
    const fixed = frameAnchor(visual, { x: 0, y: 0.5 });
    const resized = resizeFrame(visual, { x: 30, y: 20 }, "e", {
      width: 1,
      height: 1,
    });
    const result = geometryFrame(
      node,
      frameFromGeometry(node, source, resized),
    );
    const final = frameAnchor(result, { x: 0, y: 0.5 });
    expect(final.x).toBeCloseTo(fixed.x);
    expect(final.y).toBeCloseTo(fixed.y);
    expect(result.width).toBeCloseTo(resized.width);
  });
  it("binds an arrow to the same nested hollow shape selected by a pointer", () => {
    const small = candidate("small", 100, { x: 96, y: 50 }),
      large = candidate("large", 300, small.point);
    const document = {
      content: {
        type: "surface",
        attrs: { id: "board", kind: "board" },
        content: [small.node, large.node],
      },
      layout: { small: small.frame, large: large.frame },
    };
    expect(
      bindingAtPoint(document as never, "board", small.point, 6)?.targetId,
    ).toBe("small");
  });
  it("brushes strokes without selecting the empty interior of a surrounding rectangle", () => {
    const node = shape("outer", "rectangle", 300),
      outer = { ...frame, width: 300, height: 300 };
    expect(
      shapeIntersects(node, outer, { x: 50, y: 50, width: 100, height: 100 }),
    ).toBe(false);
    expect(
      shapeIntersects(node, outer, { x: 0, y: 50, width: 10, height: 100 }),
    ).toBe(true);
    expect(
      shapeIntersects(shape("arrow", "arrow"), frame, {
        x: 0,
        y: 80,
        width: 10,
        height: 10,
      }),
    ).toBe(false);
    expect(
      shapeIntersects(shape("arrow", "arrow"), frame, {
        x: 45,
        y: 45,
        width: 10,
        height: 10,
      }),
    ).toBe(true);
  });
  it("uses the same visible target edge while creating a shape", () => {
    const index = createSnapIndex([
      {
        id: "target",
        frame: geometryFrame(shape("target"), { ...frame, x: 200, y: 200 }),
      },
    ]);
    const result = snapCreation(
      [
        { x: 100, y: 100 },
        { x: 202, y: 202 },
      ],
      index,
      1,
      true,
    );
    expect(result.points).toEqual([
      { x: 100, y: 100 },
      { x: 204, y: 204 },
    ]);
    expect(result.guides.length).toBeGreaterThan(0);
  });
  it("does not use a hollow shape covering the entire viewport as an interior fallback", () => {
    const item = {
      ...candidate("cover", 1000, { x: 100, y: 100 }),
      viewport: { x: 20, y: 20, width: 300, height: 300 },
    };
    expect(pickShape([item])).toBeNull();
    expect(pickShape([{ ...item, point: { x: 4, y: 100 } }])?.id).toBe("cover");
  });
  it("requires enclosing native containers when brushing and supports wrap selection", () => {
    const native = { type: "surface", attrs: { id: "page", kind: "page" } };
    expect(
      shapeIntersects(native, frame, { x: 50, y: 50, width: 100, height: 100 }),
    ).toBe(false);
    expect(
      shapeIntersects(native, frame, { x: -1, y: -1, width: 102, height: 102 }),
    ).toBe(true);
    expect(
      shapeIntersects(
        shape("rect"),
        frame,
        { x: 0, y: 50, width: 10, height: 100 },
        true,
      ),
    ).toBe(false);
  });
  it("creates squares from either direction and centered geometry with Alt", () => {
    const origin = { x: 100, y: 100 };
    expect(
      creationPoints(
        "rectangle",
        origin,
        { x: 70, y: 110 },
        { shiftKey: true },
      ),
    ).toEqual([origin, { x: 70, y: 130 }]);
    expect(
      creationPoints("ellipse", origin, { x: 130, y: 120 }, { altKey: true }),
    ).toEqual([
      { x: 70, y: 80 },
      { x: 130, y: 120 },
    ]);
  });
  it("constrains arrow direction to 15-degree steps", () => {
    const [a, b] = creationPoints(
      "arrow",
      { x: 0, y: 0 },
      { x: 100, y: 30 },
      { shiftKey: true },
    );
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(15);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(100, 30));
  });
});
