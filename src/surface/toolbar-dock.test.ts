import { expect, it } from "vitest";
import { readToolbarDock, snapToolbar, toolbarCenter } from "./toolbar-dock";

it("docks on all four edges and remembers the position along that edge", () => {
  const bounds = { width: 1000, height: 700 };
  expect(snapToolbar({ x: 350, y: 20 }, bounds)).toEqual({
    edge: "top",
    position: 0.35,
  });
  expect(snapToolbar({ x: 350, y: 690 }, bounds)).toEqual({
    edge: "bottom",
    position: 0.35,
  });
  expect(snapToolbar({ x: 10, y: 350 }, bounds)).toEqual({
    edge: "left",
    position: 0.5,
  });
  expect(snapToolbar({ x: 990, y: 350 }, bounds)).toEqual({
    edge: "right",
    position: 0.5,
  });
  expect(readToolbarDock("left:0.3")).toEqual({ edge: "left", position: 0.3 });
  expect(readToolbarDock("unknown:NaN")).toEqual({
    edge: "bottom",
    position: 0.5,
  });
});

it("keeps the toolbar within small and resized viewports including near corners", () => {
  const bounds = { width: 390, height: 700 },
    size = { width: 360, height: 90 };
  expect(toolbarCenter({ edge: "top", position: 0 }, bounds, size)).toEqual({
    x: 192,
    y: 57,
  });
  expect(toolbarCenter({ edge: "bottom", position: 1 }, bounds, size)).toEqual({
    x: 198,
    y: 643,
  });
  expect(
    toolbarCenter({ edge: "right", position: 1 }, bounds, {
      width: 130,
      height: 620,
    }),
  ).toEqual({ x: 313, y: 378 });
});

it("anchors only the fixed primary strip and reserves space for properties below it", () => {
  const bounds = { width: 1000, height: 800 },
    primary = { width: 54, height: 420 };
  const center = toolbarCenter(
    { edge: "left", position: 0.5 },
    bounds,
    primary,
    240,
  );
  expect(center.y - primary.height / 2).toBeGreaterThanOrEqual(12);
  expect(center.y + primary.height / 2 + 240).toBeLessThanOrEqual(
    bounds.height - 12,
  );
  const row = toolbarCenter(
    { edge: "bottom", position: 0.5 },
    bounds,
    { width: 700, height: 44 },
    108,
  );
  expect(row.y).toBe(658);
});
