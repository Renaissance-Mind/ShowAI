import { beforeAll, afterAll, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompiledInkStroke,
  type InkStrokeCommand,
} from "./ink-stroke-kernel.mjs";
let directory: string, executable: string;
const kernel = new CompiledInkStroke();
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "showai-stroke-query-"));
  executable = join(
    directory,
    process.platform === "win32" ? "query.exe" : "query",
  );
  execFileSync("clang++", [
    "-std=c++17",
    "-O3",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-ffp-contract=off",
    "-fno-exceptions",
    "-fno-rtti",
    "src/surface/ink-kernel/ink-stroke-kernel.cpp",
    "src/surface/ink-kernel/analytic-path.cpp",
    "src/surface/ink-kernel/stroke-query-native-parity.cpp",
    "-o",
    executable,
  ]);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function native(
  commands: InkStrokeCommand[],
  matrix: number[],
  x: number,
  y: number,
) {
  const b = Buffer.alloc(80 + commands.length * 56);
  b.writeUInt32LE(commands.length);
  matrix.forEach((v, i) => b.writeDoubleLE(v, 4 + i * 8));
  b.writeDoubleLE(0.001, 52);
  b.writeUInt32LE(1000000, 60);
  b.writeDoubleLE(x, 64);
  b.writeDoubleLE(y, 72);
  commands.forEach((c, i) => {
    b.writeUInt32LE(["M", "L", "Q", "C", "Z"].indexOf(c[0]), 80 + i * 56);
    c.slice(1).forEach((v, j) =>
      b.writeDoubleLE(v as number, 88 + i * 56 + j * 8),
    );
  });
  return execFileSync(executable, [], {
    input: b,
    maxBuffer: 256 * 1024 * 1024,
  });
}
function wasm(
  commands: InkStrokeCommand[],
  matrix: number[],
  x: number,
  y: number,
) {
  const g = kernel.pathGeometry(commands, matrix, 0.001),
    bounds = kernel.pathBounds(commands, matrix),
    hit = kernel.pathHit(commands, { x, y }, matrix, 0.001),
    np = g.polygons.reduce((n, p) => n + p.length, 0),
    out = Buffer.alloc(88 + np * 16 + g.polygons.length * 8);
  out.writeUInt32LE(np);
  out.writeUInt32LE(g.polygons.length, 4);
  [g.bounds, bounds].forEach((b, k) =>
    [b.x, b.y, b.width, b.height].forEach((v, i) =>
      out.writeDoubleLE(v, 8 + k * 32 + i * 8),
    ),
  );
  out.writeUInt32LE(hit.inside ? 1 : 0, 72);
  out.writeDoubleLE(hit.distance, 80);
  let offset = 0;
  g.polygons.forEach((p, i) => {
    out.writeUInt32LE(offset, 88 + np * 16 + i * 8);
    out.writeUInt32LE(p.length, 92 + np * 16 + i * 8);
    p.forEach((v, j) => {
      out.writeDoubleLE(v.x, 88 + (offset + j) * 16);
      out.writeDoubleLE(v.y, 96 + (offset + j) * 16);
    });
    offset += p.length;
  });
  return out;
}
it("uses byte-identical Native/WASM affine Bezier extrema, flattening, nonzero coverage and distances", () => {
  const path: InkStrokeCommand[] = [
    ["M", 0, 0],
    ["C", 0, 30, 30, 30, 30, 0],
    ["L", 0, 0],
    ["Z"],
    ["M", 10, 5],
    ["L", 20, 5],
    ["L", 20, 10],
    ["L", 10, 10],
    ["Z"],
  ];
  for (const matrix of [
    [1, 0, 0, 1, 0, 0],
    [2, 0.3, -0.2, 3, 7, 11],
    [-1, 0, 0, 1, 40, 3],
  ])
    for (const [x, y] of [
      [1, 1],
      [15, 7],
      [100, 100],
    ])
      expect(native(path, matrix, x, y)).toEqual(wasm(path, matrix, x, y));
  expect(kernel.pathBounds(path).height).toBe(22.5);
  expect(kernel.pathHit(path, { x: 15, y: 7 }).inside).toBe(false);
  expect(kernel.pathHit(path, { x: 15, y: 20 }).inside).toBe(true);
});
it("handles extended exact analytic winding, real boundaries and bounded outputs", () => {
  const path: InkStrokeCommand[] = [];
  for (let i = 0; i < 25001; i++)
    path.push(["M", 0, 0], ["L", 10, 0], ["L", 0, 10], ["Z"]);
  expect(
    kernel.pathHit(path, { x: 1, y: 1 }, undefined, 0.001, 200000).inside,
  ).toBe(true);
  expect(
    kernel.pathHit(path, { x: 11, y: 11 }, undefined, 0.001, 200000).inside,
  ).toBe(false);
  expect(
    kernel.pathHit(path, { x: 0, y: 0 }, undefined, 0.001, 200000).inside,
  ).toBe(true);
  expect(native(path, [1, 0, 0, 1, 0, 0], 0, 0)).toEqual(
    wasm(path, [1, 0, 0, 1, 0, 0], 0, 0),
  );
});
it("rejects invalid budgets, sparse transforms and aliases atomically in real native exports", () => {
  expect(execFileSync(executable, ["--contract"])).toEqual(Buffer.alloc(0));
  expect(() => kernel.pathGeometry([["M", 0, 0]], Array(6))).toThrow();
  expect(() =>
    kernel.pathGeometry([["M", 0, 0]], undefined, 0.01, 1.5),
  ).toThrow();
  expect(() =>
    kernel.pathHit([["M", 0, 0]], { x: 0, y: 0 }, undefined, NaN),
  ).toThrow();
  expect(() =>
    kernel.pathGeometry(
      [
        ["M", 0, 0],
        ["C", 0, 10, 10, 10, 10, 0],
      ],
      undefined,
      0.001,
      1,
    ),
  ).toThrow();
});
