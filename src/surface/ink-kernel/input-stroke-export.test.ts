import { afterAll, beforeAll, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompiledInkInput,
  inkInputConfiguration,
  type InkInputPoint,
} from "./compiled-ink-input.mjs";
let directory: string, executable: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "showai-input-stroke-"));
  executable = join(directory, "export");
  execFileSync("clang++", [
    "-std=c++17",
    "-O3",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-ffp-contract=off",
    "-fno-exceptions",
    "-fno-rtti",
    "src/surface/ink-kernel/ink-input-kernel.cpp",
    "src/surface/ink-kernel/input-stroke-native-parity.cpp",
    "-o",
    executable,
  ]);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const point = (id: number): InkInputPoint => ({
  id,
  x: id * 0.7,
  y: Math.sin(id * 0.13) * 8,
  time: id / 240,
  force: 0.2 + (id % 11) / 9,
  azimuth: 0.4,
  altitude: 1,
  estimationIndex: id,
  expectedProperties: 0,
});
function pack(
  points: InkInputPoint[],
  predicted: InkInputPoint[],
  correction: InkInputPoint | undefined,
  config: ReturnType<typeof inkInputConfiguration>,
) {
  const b = Buffer.alloc(
    124 + (points.length + predicted.length + (correction ? 1 : 0)) * 64,
  );
  [points.length, predicted.length, correction ? 1 : 0].forEach((v, i) =>
    b.writeUInt32LE(v, i * 4),
  );
  const keys = [
    "width",
    "creationZoom",
    "fitTolerance",
    "flattenTolerance",
    "positionWindow",
    "jitterWindow",
    "forceBackward",
    "forceForward",
    "forceTime",
    "minimumFraction",
    "maximumFraction",
    "curveBlend",
    "estimateTimeout",
  ] as const;
  keys.forEach((k, i) => b.writeDoubleLE(config[k], 12 + i * 8));
  b.writeUInt32LE(config.mode, 116);
  b.writeUInt32LE(1, 120);
  [...points, ...predicted, ...(correction ? [correction] : [])].forEach(
    (p, i) => {
      const at = 124 + i * 64;
      [
        p.x,
        p.y,
        p.time,
        p.force ?? 1,
        p.azimuth ?? 0,
        p.altitude ?? Math.PI / 2,
      ].forEach((v, j) => b.writeDoubleLE(v, at + j * 8));
      [
        p.id ?? 0,
        p.expectedProperties ?? 0,
        p.estimationIndex ?? 0,
        p.updatesTimedOut ? 1 : 0,
      ].forEach((v, j) => b.writeUInt32LE(v, at + 48 + j * 4));
    },
  );
  return b;
}
function segmentsBytes(input: CompiledInkInput) {
  const rows = input.strokeSegments(),
    b = Buffer.alloc(4 + rows.length * 104);
  b.writeUInt32LE(rows.length);
  rows.forEach((r, i) => {
    const at = 4 + i * 104;
    r.points.flat().forEach((v, j) => b.writeDoubleLE(v, at + j * 8));
    r.radius.forEach((v, j) => b.writeDoubleLE(v, at + 64 + j * 8));
    [
      r.points.length - 1,
      0,
      r.firstRaw,
      r.lastRaw,
      r.containsPredictions ? 1 : 0,
      0,
    ].forEach((v, j) => b.writeUInt32LE(v, at + 80 + j * 4));
  });
  return b;
}
it("exports native/WASM identical original filtered values and every pressure interval through predictions and late estimates", () => {
  const actual = Array.from({ length: 37 }, (_, i) => point(i + 1)),
    predicted = [point(38), { ...point(39), x: 200 }],
    correction = { ...point(9), force: 2.7, y: -10 };
  for (const mode of [0, 1, 2] as const) {
    const config = inkInputConfiguration({ mode, width: 4, creationZoom: 3 }),
      input = new CompiledInkInput(config, 8);
    for (let i = 0; i < actual.length; i += 4)
      input.push(
        actual.slice(i, i + 4),
        i + 4 >= actual.length ? predicted : [],
      );
    const live = segmentsBytes(input);
    expect(input.strokeSegments().some((s) => s.containsPredictions)).toBe(
      true,
    );
    input.finish();
    input.correct(correction);
    const filtered = input.filtered(),
      fb = Buffer.alloc(4 + filtered.length * 72);
    fb.writeUInt32LE(filtered.length);
    filtered.forEach((r, i) =>
      r.forEach((v, j) => fb.writeDoubleLE(v, 4 + i * 72 + j * 8)),
    );
    const sealed = segmentsBytes(input),
      native = execFileSync(executable, [], {
        input: pack(actual, predicted, correction, config),
      });
    expect(native).toEqual(Buffer.concat([live, fb, sealed]));
    expect(filtered).toHaveLength(actual.length);
    expect(input.strokeSegments()).toHaveLength(actual.length - 1);
    input.strokeSegments().forEach((s, i) => {
      expect(s.radius).toEqual([filtered[i][3] / 2, filtered[i + 1][3] / 2]);
      if (i)
        expect(s.points[0]).toEqual(
          input.strokeSegments()[i - 1].points.at(-1),
        );
      expect(s.containsPredictions).toBe(false);
    });
  }
});
it("exports a singleton disk and rejects output aliases without mutating the real native state", () => {
  const actual = [point(1)],
    config = inkInputConfiguration({ mode: 1 }),
    input = new CompiledInkInput(config);
  input.push(actual);
  const live = segmentsBytes(input);
  input.finish();
  const filtered = input.filtered(),
    fb = Buffer.alloc(76);
  fb.writeUInt32LE(1);
  filtered[0].forEach((v, i) => fb.writeDoubleLE(v, 4 + i * 8));
  expect(
    execFileSync(executable, [], {
      input: pack(actual, [], undefined, config),
    }),
  ).toEqual(Buffer.concat([live, fb, segmentsBytes(input)]));
  expect(input.strokeSegments()[0].points).toHaveLength(1);
  expect(input.strokeSegments()[0].radius[0]).toBe(
    input.strokeSegments()[0].radius[1],
  );
});
