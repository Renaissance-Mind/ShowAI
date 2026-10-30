import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompiledInkInput } from "./compiled-ink-input.mjs";
it("actually seeks a tiny interval suffix logarithmically without scanning retained fitted curves", () => {
  const directory = mkdtempSync(join(tmpdir(), "showai-input-lookup-"));
  try {
    const executable = join(
      directory,
      process.platform === "win32" ? "lookup.exe" : "lookup",
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
      "src/surface/ink-kernel/input-stroke-lookup.cpp",
      "-o",
      executable,
    ]);
    const rows = execFileSync(executable, [], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => line.split(" ").map(Number));
    expect(rows.map((r) => r[0])).toEqual([1, 2, 1200, 12000]);
    for (const [
      n,
      curves,
      count,
      comparisons,
      advances,
      emitted,
      worst,
    ] of rows) {
      expect(emitted).toBe(count);
      expect(count).toBeLessThanOrEqual(8);
      expect(comparisons).toBeLessThanOrEqual(Math.ceil(Math.log2(curves + 1)));
      expect(worst).toBeLessThanOrEqual(Math.ceil(Math.log2(curves + 1)));
      expect(advances).toBeLessThanOrEqual(count);
      if (n === 12000) {
        expect(curves).toBeGreaterThan(10000);
        expect(comparisons).toBeLessThanOrEqual(14);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("WASM range results preserve every radius knot at shared fitted-curve endpoints and empty truncations", () => {
  const input = new CompiledInkInput(
      {
        width: 4,
        mode: 1,
        fitTolerance: 0.2,
        positionWindow: 0,
        jitterWindow: 0,
      },
      2048,
    ),
    raw = Array.from({ length: 1200 }, (_, i) => ({
      id: i + 1,
      x: i * 0.8,
      y: i % 2 ? 8 : -8,
      time: i / 240,
      force: 0.6 + (i % 13) / 30,
    }));
  input.push(raw, [{ id: 0, x: 970, y: 30, time: 1202 / 240, force: 1 }]);
  for (const finish of [false, true]) {
    if (finish) input.finish();
    const all = input.strokeSegments(),
      starts = [
        0,
        all.length,
        all.length - 8,
        ...input
          .curves()
          .slice(0, 20)
          .flatMap((c) => [c.firstRaw, c.lastRaw])
          .filter((i) => i <= all.length),
      ];
    for (const start of starts) {
      const count = Math.min(8, all.length - start);
      expect(input.strokeSegments(start, count)).toEqual(
        all.slice(start, start + count),
      );
    }
    expect(input.strokeSegments(all.length, 0)).toEqual([]);
  }
});
