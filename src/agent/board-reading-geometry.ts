export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface BoardTile {
  tileId: string;
  row: number;
  column: number;
  rectPx: BoardRect;
  bounds: BoardRect;
}
export interface BoardGrid {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  overlap: number;
  columns: number;
  rows: number;
  total: number;
}
export function intersectRects(a: BoardRect, b: BoardRect): BoardRect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
export function unionRects(rects: BoardRect[], margin = 0): BoardRect {
  if (!rects.length) return { x: 0, y: 0, width: 1000, height: 700 };
  const x = Math.floor(Math.min(...rects.map((r) => r.x)) - margin),
    y = Math.floor(Math.min(...rects.map((r) => r.y)) - margin);
  return {
    x,
    y,
    width: Math.max(
      1,
      Math.ceil(Math.max(...rects.map((r) => r.x + r.width)) + margin) - x,
    ),
    height: Math.max(
      1,
      Math.ceil(Math.max(...rects.map((r) => r.y + r.height)) + margin) - y,
    ),
  };
}
export function boardGrid(
  bounds: BoardRect,
  scale: number,
  width: number,
  height: number,
  overlap: number,
): BoardGrid {
  if (!(overlap >= 0 && overlap < Math.min(width, height)))
    throw new Error("Overlap must be smaller than both tile dimensions.");
  const w = Math.max(1, Math.ceil(bounds.width * scale)),
    h = Math.max(1, Math.ceil(bounds.height * scale));
  const columns = Math.max(1, Math.ceil((w - overlap) / (width - overlap))),
    rows = Math.max(1, Math.ceil((h - overlap) / (height - overlap)));
  return {
    width: w,
    height: h,
    tileWidth: width,
    tileHeight: height,
    overlap,
    columns,
    rows,
    total: columns * rows,
  };
}
export function boardTile(
  grid: BoardGrid,
  bounds: BoardRect,
  scale: number,
  number: number,
): BoardTile {
  if (!Number.isSafeInteger(number) || number < 1 || number > grid.total)
    throw new Error("Unknown tile number.");
  const row = Math.floor((number - 1) / grid.columns),
    column = (number - 1) % grid.columns;
  const x = column * (grid.tileWidth - grid.overlap),
    y = row * (grid.tileHeight - grid.overlap);
  const rectPx = {
    x,
    y,
    width: Math.min(grid.tileWidth, grid.width - x),
    height: Math.min(grid.tileHeight, grid.height - y),
  };
  return {
    tileId: `T${number}`,
    row,
    column,
    rectPx,
    bounds: {
      x: bounds.x + x / scale,
      y: bounds.y + y / scale,
      width: rectPx.width / scale,
      height: rectPx.height / scale,
    },
  };
}
/** Compact row intervals avoid materializing a million empty windows on sparse boards. */
export function occupiedTiles(
  grid: BoardGrid,
  bounds: BoardRect,
  scale: number,
  objects: BoardRect[],
): [number, number][] {
  if (!objects.length) return [[1, 1]];
  const ranges: [number, number][] = [];
  for (const box of objects) {
    const a = {
      x: (box.x - bounds.x) * scale,
      y: (box.y - bounds.y) * scale,
      width: box.width * scale,
      height: box.height * scale,
    };
    const sx = grid.tileWidth - grid.overlap,
      sy = grid.tileHeight - grid.overlap;
    const firstColumn = Math.max(
        0,
        Math.floor((a.x - grid.tileWidth) / sx) + 1,
      ),
      lastColumn = Math.min(
        grid.columns - 1,
        Math.ceil((a.x + a.width) / sx) - 1,
      );
    const firstRow = Math.max(0, Math.floor((a.y - grid.tileHeight) / sy) + 1),
      lastRow = Math.min(grid.rows - 1, Math.ceil((a.y + a.height) / sy) - 1);
    if (firstColumn === 0 && lastColumn === grid.columns - 1)
      ranges.push([firstRow * grid.columns + 1, (lastRow + 1) * grid.columns]);
    else
      for (let row = firstRow; row <= lastRow; row++)
        ranges.push([
          row * grid.columns + firstColumn + 1,
          row * grid.columns + lastColumn + 1,
        ]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
export function tileBatch(
  ranges: [number, number][],
  offset: number,
  limit: number,
) {
  const total = ranges.reduce((n, [a, b]) => n + b - a + 1, 0),
    result: number[] = [];
  let skip = offset;
  for (const [a, b] of ranges) {
    if (skip >= b - a + 1) {
      skip -= b - a + 1;
      continue;
    }
    for (let n = a + skip; n <= b && result.length < limit; n++) result.push(n);
    skip = 0;
    if (result.length >= limit) break;
  }
  return {
    numbers: result,
    total,
    nextOffset: offset + result.length < total ? offset + result.length : null,
  };
}
export const imageToBoard = (bounds: BoardRect, scale: number) => [
  1 / scale,
  0,
  0,
  1 / scale,
  bounds.x,
  bounds.y,
];
