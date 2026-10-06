import { describe, expect, it } from "vitest";
import {
  elasticDisplacement,
  nearestSnap,
  panFrom,
  snapRegion,
  springStep,
} from "./physics";

const bounds = { width: 1200, height: 900, offsetX: 100 };
const body = {
  id: "document",
  label: "正文",
  x: 0,
  y: 0,
  width: 1000,
  height: 1800,
};
const card = {
  id: "note",
  label: "内容区域",
  x: 1080,
  y: 300,
  width: 360,
  height: 240,
};
const origin = { x: 0, y: -300, scale: 1 };

describe("unified whiteboard resistance", () => {
  it("moves visibly under small input, resisting symmetrically without a position discontinuity", () => {
    for (const distance of [1, 20, 60, 239, 240, 241, 900]) {
      const moved = elasticDisplacement(distance);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(distance);
      expect(elasticDisplacement(-distance)).toBeCloseTo(-moved);
    }
    expect(elasticDisplacement(60)).toBeGreaterThan(18);
    expect(elasticDisplacement(241) - elasticDisplacement(239)).toBeLessThan(2);
  });
  it("uses the same resistance after snapping to the body or a peripheral region", () => {
    const bodySnap = snapRegion(body, origin, bounds)!;
    const cardSnap = snapRegion(card, { x: -760, y: 0, scale: 1 }, bounds)!;
    for (const snap of [bodySnap, cardSnap]) {
      const small = panFrom(snap.camera, { x: 60, y: 0 }, snap.anchor);
      expect(small.camera.x - snap.camera.x).toBeCloseTo(
        elasticDisplacement(60),
      );
      expect(small.released).toBe(false);
      const far = panFrom(snap.camera, { x: 400, y: 0 }, snap.anchor);
      expect(far.released).toBe(true);
    }
  });
  it("keeps vertical reading fluid within the region and dampens edge overscroll", () => {
    const snap = snapRegion(body, origin, bounds)!;
    expect(panFrom(origin, { x: 0, y: -200 }, snap.anchor).camera.y).toBe(-500);
    const edge = panFrom(
      origin,
      { x: 0, y: snap.anchor.maxY - origin.y + 40 },
      snap.anchor,
    );
    expect(edge.camera.y).toBeGreaterThan(snap.anchor.maxY);
    expect(edge.camera.y).toBeLessThan(snap.anchor.maxY + 40);
    expect(edge.released).toBe(false);
  });
  it("retains horizontal drag resistance between regions", () => {
    const moved = panFrom(origin, { x: 100, y: 100 }, null);
    expect(moved.camera.x).toBe(72);
    expect(moved.camera.y).toBe(-200);
  });
  it("continues an interrupted spring at its actual position", () => {
    const snap = snapRegion(body, origin, bounds)!;
    const displayed = { ...snap.camera, x: snap.camera.x + 23 };
    expect(
      panFrom(displayed, { x: 0, y: 0 }, snap.anchor).camera.x,
    ).toBeCloseTo(displayed.x, 6);
    const moved = panFrom(displayed, { x: 1, y: 0 }, snap.anchor).camera.x;
    expect(moved).toBeGreaterThan(displayed.x);
    expect(moved).toBeLessThan(displayed.x + 1);
  });
});

describe("gentle alignment and return motion", () => {
  it("nudges a nearly aligned, fully visible card into place", () => {
    const snap = nearestSnap(
      [body, card],
      { x: -736, y: 0, scale: 1 },
      bounds,
    )!;
    expect(snap.anchor.id).toBe("note");
    expect(snap.camera.x).toBe(-760);
    expect(Math.abs(snap.camera.y)).toBeLessThanOrEqual(40);
  });
  it("never pulls a distant, mostly clipped or zoomed-in region into view", () => {
    expect(nearestSnap([card], origin, bounds)).toBeNull();
    expect(nearestSnap([body], { x: 0, y: 0, scale: 2 }, bounds)).toBeNull();
    expect(
      nearestSnap([card], { x: -760, y: -600, scale: 1 }, bounds),
    ).toBeNull();
  });
  it("keeps an off-center but completely visible region in place", () => {
    const snap = snapRegion(card, { x: -900, y: 0, scale: 1 }, bounds)!;
    expect(snap.camera.x).toBe(-900);
    expect(snap.anchor.x).toBe(-900);
  });
  it.each([60, 120])(
    "returns through multiple visible frames and converges at %s Hz",
    (hz) => {
      let position = 40,
        velocity = 0;
      const first = springStep(position, velocity, 0, 1 / hz);
      expect(first.position).toBeGreaterThan(0);
      expect(first.position).toBeLessThan(40);
      for (let i = 0; i < hz; i++)
        ({ position, velocity } = springStep(position, velocity, 0, 1 / hz));
      expect(Math.abs(position)).toBeLessThan(0.01);
      expect(Math.abs(velocity)).toBeLessThan(0.05);
    },
  );
});
