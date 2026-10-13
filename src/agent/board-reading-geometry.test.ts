import { expect, test } from "vitest";
import {
  boardGrid,
  boardTile,
  occupiedTiles,
  tileBatch,
  imageToBoard,
  intersectRects,
} from "./board-reading-geometry";
test("windows cover the full image with exact overlap and reversible negative-origin mapping", () => {
  const b = { x: -200, y: -100, width: 3000, height: 2000 };
  const g = boardGrid(b, 2, 1600, 1600, 200);
  const all = Array.from({ length: g.total }, (_, i) =>
    boardTile(g, b, 2, i + 1),
  );
  expect(all[0].bounds.x + all[0].bounds.width - all[1].bounds.x).toBe(100);
  const last = all.at(-1)!;
  expect(last.rectPx.x + last.rectPx.width).toBe(6000);
  expect(last.rectPx.y + last.rectPx.height).toBe(4000);
  expect(imageToBoard(all[1].bounds, 2)).toEqual([0.5, 0, 0, 0.5, 500, -100]);
  expect(() => boardGrid(b, 1, 320, 320, 320)).toThrow();
});
test("sparse range indexing agrees with actual intersection and resumes without duplicates", () => {
  const bounds = { x: -100, y: 0, width: 9000, height: 5000 },
    scale = 1;
  const grid = boardGrid(bounds, scale, 1600, 1600, 200);
  const objects = [
    { x: 1300, y: 1300, width: 200, height: 200 },
    { x: 8100, y: 4000, width: 200, height: 200 },
  ];
  const ranges = occupiedTiles(grid, bounds, scale, objects);
  const expected = Array.from({ length: grid.total }, (_, i) => i + 1).filter(
    (n) =>
      objects.some((b) =>
        intersectRects(boardTile(grid, bounds, scale, n).bounds, b),
      ),
  );
  const result: number[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const b = tileBatch(ranges, offset, 2);
    result.push(...b.numbers);
    offset = b.nextOffset;
  }
  expect(result).toEqual(expected);
  expect(new Set(result).size).toBe(result.length);
  expect(tileBatch(ranges, 0, 0)).toMatchObject({ numbers: [], nextOffset: 0 });
});
test("very wide sparse boards allocate ranges for occupied rows only", () => {
  const bounds = { x: 0, y: 0, width: 1_000_000, height: 1_000_000 };
  const grid = boardGrid(bounds, 1, 1600, 1600, 200);
  const ranges = occupiedTiles(grid, bounds, 1, [
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 999900, y: 999900, width: 20, height: 20 },
  ]);
  expect(grid.total).toBeGreaterThan(500000);
  expect(ranges).toHaveLength(2);
  expect(tileBatch(ranges, 0, 8).numbers).toHaveLength(2);
});
