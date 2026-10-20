import { expect, it } from "vitest";
import {
  readToolbarDock,
  snapToolbar,
  toolbarCenter,
  toolbarSnapTarget,
  toolbarPanelRect,
  toolbarRectSnapTarget,
} from "./toolbar-dock";

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

it("follows freely in the middle, snaps live near every edge, and releases outside the band", () => {
  const bounds = { width: 1000, height: 700 };
  expect(toolbarSnapTarget({ x: 500, y: 350 }, bounds)).toBeNull();
  for (const [edge, inside, held, outside] of [
    ["top", { x: 500, y: 35 }, { x: 500, y: 55 }, { x: 500, y: 80 }],
    ["bottom", { x: 500, y: 665 }, { x: 500, y: 645 }, { x: 500, y: 620 }],
    ["left", { x: 35, y: 350 }, { x: 55, y: 350 }, { x: 80, y: 350 }],
    ["right", { x: 965, y: 350 }, { x: 945, y: 350 }, { x: 920, y: 350 }],
  ] as const) {
    expect(toolbarSnapTarget(inside, bounds)?.edge).toBe(edge);
    expect(toolbarSnapTarget(held, bounds, edge)?.edge).toBe(edge);
    expect(toolbarSnapTarget(outside, bounds, edge)).toBeNull();
  }
});

it("restores floating placement and keeps it inside a resized viewport", () => {
  const dock = readToolbarDock("bottom:0.4:0.4:0.45");
  expect(dock.floating).toEqual({ x: 0.4, y: 0.45 });
  expect(
    toolbarCenter(
      dock,
      { width: 1000, height: 800 },
      { width: 400, height: 54 },
    ),
  ).toEqual({ x: 400, y: 360 });
  expect(
    toolbarCenter(
      dock,
      { width: 390, height: 700 },
      { width: 360, height: 54 },
    ),
  ).toEqual({ x: 192, y: 315 });
  expect(readToolbarDock("bottom:0.5:NaN:0.2")).toEqual({
    edge: "bottom",
    position: 0.5,
  });
});

it("uses the wider iPad edge band while still allowing a drag to detach", () => {
  const bounds = { width: 1024, height: 768 };
  expect(toolbarSnapTarget({ x: 70, y: 300 }, bounds, null, 72)?.edge).toBe(
    "left",
  );
  expect(toolbarSnapTarget({ x: 954, y: 300 }, bounds, null, 72)?.edge).toBe(
    "right",
  );
  expect(toolbarSnapTarget({ x: 500, y: 70 }, bounds, null, 72)?.edge).toBe(
    "top",
  );
  expect(toolbarSnapTarget({ x: 500, y: 698 }, bounds, null, 72)?.edge).toBe(
    "bottom",
  );
  expect(toolbarSnapTarget({ x: 95, y: 300 }, bounds, "left", 72)?.edge).toBe(
    "left",
  );
  expect(toolbarSnapTarget({ x: 115, y: 300 }, bounds, "left", 72)).toBeNull();
});

it("snaps a long toolbar when its body reaches an edge, even with the grab point far away", () => {
  const bounds = { width: 1024, height: 1000 };
  expect(
    toolbarRectSnapTarget({ x: 80, y: 400, width: 400, height: 54 }, bounds)
      ?.edge,
  ).toBe("left");
  expect(
    toolbarRectSnapTarget({ x: 544, y: 400, width: 400, height: 54 }, bounds)
      ?.edge,
  ).toBe("right");
  expect(
    toolbarRectSnapTarget({ x: 400, y: 80, width: 54, height: 400 }, bounds)
      ?.edge,
  ).toBe("top");
  expect(
    toolbarRectSnapTarget({ x: 400, y: 520, width: 54, height: 400 }, bounds)
      ?.edge,
  ).toBe("bottom");
  expect(
    toolbarRectSnapTarget({ x: 300, y: 400, width: 400, height: 100 }, bounds),
  ).toBeNull();
});

it("includes the joined secondary strip in the docking footprint", () => {
  const bounds = { width: 1024, height: 1000 },
    center = { x: 850, y: 500 },
    size = { width: 54, height: 300 };
  expect(
    toolbarRectSnapTarget(
      toolbarPanelRect(center, size, "left", false),
      bounds,
    ),
  ).toBeNull();
  expect(
    toolbarRectSnapTarget(toolbarPanelRect(center, size, "left", true), bounds)
      ?.edge,
  ).toBe("right");
  expect(
    toolbarPanelRect(
      { x: 500, y: 500 },
      { width: 400, height: 54 },
      "bottom",
      true,
    ),
  ).toEqual({ x: 300, y: 419, width: 400, height: 108 });
  expect(
    toolbarPanelRect(
      { x: 500, y: 500 },
      { width: 54, height: 300 },
      "right",
      true,
    ),
  ).toEqual({ x: 419, y: 350, width: 108, height: 300 });
});
