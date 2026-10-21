import { beforeAll, afterAll, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CompiledInkStroke,
  type InkStrokeSegment,
  type StrokePoint as P,
  type InkStrokeOptions,
} from "./ink-stroke-kernel.mjs";
import { CompiledInkInput } from "./compiled-ink-input.mjs";
import { AnalyticPathKernel } from "./analytic-path.mjs";
import { CompiledInkKernel, inkKernelProvenance } from "./compiled-ink.mjs";
const kernel = new CompiledInkStroke(),
  analytic = new AnalyticPathKernel();
let folder: string, executable: string, progressExecutable: string;
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "showai-circular-stroke-"));
  executable = join(folder, "stroke");
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
    "src/surface/ink-kernel/stroke-native-parity.cpp",
    "-o",
    executable,
  ]);
  progressExecutable = join(folder, "progress-contract");
  execFileSync("clang++", [
    "-std=c++17",
    "-O3",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-ffp-contract=off",
    "-fno-exceptions",
    "-fno-rtti",
    "src/surface/ink-kernel/stroke-progress-contract.cpp",
    "src/surface/ink-kernel/analytic-path.cpp",
    "-o",
    progressExecutable,
  ]);
});
afterAll(() => rmSync(folder, { recursive: true, force: true }));
function native(segments: InkStrokeSegment[], options: InkStrokeOptions = {}) {
  const input = Buffer.alloc(28 + segments.length * 88);
  input.writeUInt32LE(segments.length);
  input.writeDoubleLE(options.tolerance ?? 0.02, 4);
  [
    options.geometryVersion ?? 1,
    options.maxDepth ?? 20,
    options.maxLeaves ?? 100000,
    options.maxCommands ?? 1000000,
  ].forEach((v, i) => input.writeUInt32LE(v, 12 + i * 4));
  segments.forEach((s, i) => {
    const at = 28 + i * 88;
    s.points.flat().forEach((v, k) => input.writeDoubleLE(v, at + k * 8));
    s.radius.forEach((v, k) => input.writeDoubleLE(v, at + 64 + k * 8));
    input.writeUInt32LE(s.points.length - 1, at + 80);
  });
  return execFileSync(executable, [], { input, maxBuffer: 256 * 1024 * 1024 });
}
function wasmBytes(
  segments: InkStrokeSegment[],
  options: InkStrokeOptions = {},
) {
  const { commands, result } = kernel.build(segments, options),
    output = Buffer.alloc(60 + commands.length * 56);
  const ints = [
    result.commands,
    result.contours,
    result.envelopeCurves,
    result.fallbackLeaves,
    result.sampledChecks,
    result.leaves,
    result.maximumDepth,
    result.fallbackContours,
  ];
  ints.forEach((v, i) => output.writeUInt32LE(v, 4 + i * 4));
  [
    result.sampledEnvelopeError,
    result.fallbackCenterBound,
    result.arcErrorBound,
  ].forEach((v, i) => output.writeDoubleLE(v, 36 + i * 8));
  const op = { M: 0, L: 1, Q: 2, C: 3, Z: 4 };
  commands.forEach((c, i) => {
    output.writeUInt32LE(op[c[0]], 60 + i * 56);
    c.slice(1).forEach((v, k) =>
      output.writeDoubleLE(v as number, 68 + i * 56 + k * 8),
    );
  });
  return output;
}
// Independent geometric oracle: squared distance to the moving disk is a
// degree<=6 polynomial. Its global minimum is at an endpoint or derivative
// root. Root isolation partitions by recursively isolated derivative roots;
// it uses neither the envelope formula nor any compiled renderer coefficients.
function evalPoly(c: number[], t: number) {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * t + c[i];
  return v;
}
function roots(coeff: number[]): number[] {
  const c = [...coeff];
  while (c.length > 1 && Math.abs(c.at(-1)!) < 1e-13) c.pop();
  if (c.length <= 1) return [];
  if (c.length === 2) {
    const t = -c[0] / c[1];
    return t > 0 && t < 1 ? [t] : [];
  }
  const critical = roots(c.slice(1).map((v, i) => v * (i + 1))),
    breaks = [0, ...critical, 1],
    out: number[] = [];
  for (const t of critical) if (Math.abs(evalPoly(c, t)) < 1e-9) out.push(t);
  for (let i = 1; i < breaks.length; i++) {
    let lo = breaks[i - 1],
      hi = breaks[i],
      a = evalPoly(c, lo),
      b = evalPoly(c, hi);
    if (a * b >= 0) continue;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2,
        v = evalPoly(c, mid);
      if (mid === lo || mid === hi) break;
      if (a < 0 === v < 0) {
        lo = mid;
        a = v;
      } else {
        hi = mid;
        b = v;
      }
    }
    out.push((lo + hi) / 2);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
function power(points: P[], axis: number) {
  const v = points.map((p) => p[axis]);
  if (v.length === 1) return v;
  if (v.length === 2) return [v[0], v[1] - v[0]];
  if (v.length === 3) return [v[0], 2 * (v[1] - v[0]), v[0] - 2 * v[1] + v[2]];
  return [
    v[0],
    3 * (v[1] - v[0]),
    3 * (v[0] - 2 * v[1] + v[2]),
    -v[0] + 3 * v[1] - 3 * v[2] + v[3],
  ];
}
function square(c: number[]) {
  const out = Array(c.length * 2 - 1).fill(0) as number[];
  for (let i = 0; i < c.length; i++)
    for (let j = 0; j < c.length; j++) out[i + j] += c[i] * c[j];
  return out;
}
function sweepMinimum(s: InkStrokeSegment, p: P) {
  const x = power(s.points, 0),
    y = power(s.points, 1);
  x[0] -= p[0];
  y[0] -= p[1];
  const a = square(x),
    b = square(y),
    r = square([s.radius[0], s.radius[1] - s.radius[0]]),
    f = Array.from(
      { length: Math.max(a.length, b.length, 3) },
      (_, i) => (a[i] ?? 0) + (b[i] ?? 0) - (r[i] ?? 0),
    );
  return Math.min(
    ...[0, 1, ...roots(f.slice(1).map((v, i) => v * (i + 1)))].map((t) =>
      evalPoly(f, t),
    ),
  );
}
function oracle(segments: InkStrokeSegment[], points: P[], tolerance = 0.01) {
  const prepared = kernel.build(segments, { tolerance }),
    maxRadius = Math.max(...segments.flatMap((s) => s.radius)),
    band = 8 * tolerance * (maxRadius + 1),
    mesh = analytic.build(prepared.commands),
    hits = analytic.meshWinding(mesh, points),
    failures: unknown[] = [];
  points.forEach((p, i) => {
    const minimum = Math.min(...segments.map((s) => sweepMinimum(s, p)));
    if (Math.abs(minimum) > band && hits[i].inside !== minimum < 0)
      failures.push({ p, minimum, hit: hits[i] });
  });
  expect(failures).toEqual([]);
  return prepared;
}
function grid(
  x0: number,
  y0: number,
  width: number,
  height: number,
  n = 18,
): P[] {
  return Array.from({ length: n * n }, (_, i) => [
    x0 + (width * (i % n)) / (n - 1),
    y0 + (height * Math.floor(i / n)) / (n - 1),
  ]);
}
const cases: InkStrokeSegment[][] = [
  [
    {
      points: [
        [0, 0],
        [100, 0],
      ],
      radius: [2, 7],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [25, 25],
        [70, 25],
        [100, 0],
      ],
      radius: [2, 4],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [30, 80],
        [70, -80],
        [100, 0],
      ],
      radius: [3, 2],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 0],
        [0, 0],
      ],
      radius: [2, 2],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [1, 0],
      ],
      radius: [1, 10],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      radius: [2, 5],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 0],
      ],
      radius: [2, 2],
    },
    {
      points: [
        [20, 0],
        [0, 0],
      ],
      radius: [2, 2],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 0],
      ],
      radius: [2, 4],
    },
    {
      points: [
        [20, 0],
        [20, 20],
      ],
      radius: [4, 2],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 0],
      ],
      radius: [4, 2],
    },
    {
      points: [
        [20, 0],
        [40, 0],
      ],
      radius: [2, 4],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 0],
      ],
      radius: [2, 4],
    },
    {
      points: [
        [20, 0],
        [40, 0],
      ],
      radius: [4, 2],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [0, 0],
        [30, 0],
        [30, 0],
      ],
      radius: [1, 10],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 0],
      ],
      radius: [0, 4],
    },
  ],
  [
    {
      points: [
        [0, 0],
        [20, 20],
      ],
      radius: [2, 2],
    },
    {
      points: [
        [20, 0],
        [0, 20],
      ],
      radius: [3, 3],
    },
  ],
];
it("is byte-identical native/Wasm for actual vector output, degeneracies and diagnostic measurements", () => {
  for (const segments of [
    ...cases,
    [],
    [{ points: [[3, 7]], radius: [4, 4] }] as InkStrokeSegment[],
    [{ points: [[0, 0]], radius: [0, 0] }] as InkStrokeSegment[],
  ])
    expect(native(segments).equals(wasmBytes(segments))).toBe(true);
  const generated = readFileSync(
      "src/surface/ink-kernel/ink-kernel-wasm.mjs",
      "utf8",
    ),
    bytes = JSON.parse(
      generated.match(/export const inkKernelWasmBase64 = (".*");/)![1],
    );
  expect(inkKernelProvenance.imports).toEqual([]);
  expect(
    WebAssembly.Module.imports(
      new WebAssembly.Module(Buffer.from(bytes, "base64")),
    ),
  ).toEqual([]);
});
it("matches an independent global moving-disk oracle through caps, changing radius, cusps, reversals and zero velocity", () => {
  for (const segments of cases) {
    const points = segments.flatMap((s) => s.points),
      xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      r = Math.max(...segments.flatMap((s) => s.radius)) + 1;
    oracle(
      segments,
      grid(
        Math.min(...xs) - r,
        Math.min(...ys) - r,
        Math.max(...xs) - Math.min(...xs) + 2 * r,
        Math.max(...ys) - Math.min(...ys) + 2 * r,
      ),
    );
  }
}, 30000);
it("prepares long regular cubics as continuous curve outlines instead of nib polygons", () => {
  const segment: InkStrokeSegment = {
      points: [
        [0, 0],
        [300, 40],
        [700, 40],
        [1000, 0],
      ],
      radius: [2, 4],
    },
    result = kernel.build([segment]);
  expect(result.result.fallbackLeaves).toBe(0);
  expect(result.result.contours).toBeLessThanOrEqual(3);
  expect(result.result.envelopeCurves).toBeLessThanOrEqual(8);
  expect(result.result.commands).toBeLessThan(48);
  expect(analytic.build(result.commands).vertices.length / 15).toBeLessThan(
    120,
  );
  expect(result.commands.some((c) => c[0] === "C")).toBe(true);
  expect(result.result.sampledEnvelopeError).toBeLessThanOrEqual(0.01);
  expect(result.result.arcErrorBound).toBeLessThanOrEqual(0.005);
});
it("keeps all actual input pressure knots when preparing real coalesced input curves", () => {
  const input = new CompiledInkInput(
      { width: 4, positionWindow: 0, jitterWindow: 0, mode: 1 },
      64,
    ),
    raw = Array.from({ length: 37 }, (_, i) => ({
      id: i + 1,
      x: i * 3,
      y: Math.sin(i / 9) * 8,
      time: i / 240,
      force: 0.6 + Math.sin(i / 12) * 0.1,
    }));
  for (let i = 0; i < raw.length; i += 4)
    input.push(raw.slice(i, i + 4), raw.slice(i + 4, i + 6));
  input.finish();
  expect(input.snapshot().predictedCount).toBe(0);
  const samples = input.samples(),
    segments: InkStrokeSegment[] = [];
  for (const c of input.curves())
    for (let i = c.firstRaw; i < c.lastRaw; i++) {
      const span = c.lastRaw - c.firstRaw,
        lo = (i - c.firstRaw) / span,
        hi = (i + 1 - c.firstRaw) / span,
        points = Array.from(
          { length: 4 },
          (_, k) => [c.points[2 * k], c.points[2 * k + 1]] as P,
        ),
        part = section(points, lo, hi),
        stride = c.steps / span,
        index = c.sampleOffset - 1 + (i - c.firstRaw) * stride;
      segments.push({
        points: part,
        radius: [samples[index][3] / 2, samples[index + stride][3] / 2],
      });
    }
  expect(segments.length).toBe(raw.length - 1);
  const result = kernel.build(segments);
  expect(native(segments).equals(wasmBytes(segments))).toBe(true);
  expect(result.result.fallbackLeaves).toBe(0);
  expect(result.result.contours).toBeLessThanOrEqual(segments.length * 3);
  // Actual37-sample portable-v1 footprint is590triangles; positive derived
  // strip/cap pieces must retain a real geometry advantage at this workload.
  expect(analytic.build(result.commands).vertices.length / 15).toBeLessThan(
    590,
  );
  oracle(segments, grid(-5, -6, 120, 22, 13));
});
function split(points: P[], t: number) {
  const a = [points[0]],
    b = [points.at(-1)!];
  let p = points;
  while (p.length > 1) {
    p = p
      .slice(1)
      .map((q, i) => [
        (1 - t) * p[i][0] + t * q[0],
        (1 - t) * p[i][1] + t * q[1],
      ]);
    a.push(p[0]);
    b.unshift(p.at(-1)!);
  }
  return [a, b];
}
it("measures dense envelope probes against actual output without claiming a global bound", () => {
  const source: InkStrokeSegment = {
      points: [
        [0, 0],
        [30, 12],
        [65, 12],
        [100, 0],
      ],
      radius: [2, 4],
    },
    prepared = kernel.build([source]),
    paths: InkStrokeSegment[] = [];
  let start: P = [0, 0];
  for (const c of prepared.commands) {
    if (c[0] === "M") start = [c[1], c[2]];
    else if (c[0] === "L") start = [c[1], c[2]];
    else if (c[0] === "C") {
      paths.push({
        points: [start, [c[1], c[2]], [c[3], c[4]], [c[5], c[6]]],
        radius: [0, 0],
      });
      start = [c[5], c[6]];
    }
  }
  const x = power(source.points, 0),
    y = power(source.points, 1),
    dx = x.slice(1).map((v, i) => v * (i + 1)),
    dy = y.slice(1).map((v, i) => v * (i + 1)),
    q = source.radius[1] - source.radius[0];
  let measured = 0;
  for (let i = 0; i <= 192; i++) {
    const t = i / 192,
      a = evalPoly(dx, t),
      b = evalPoly(dy, t),
      s = a * a + b * b,
      z = Math.sqrt(s - q * q),
      r = source.radius[0] + q * t;
    for (const side of [-1, 1]) {
      const p: P = [
        evalPoly(x, t) + (r * (-q * a + side * z * b)) / s,
        evalPoly(y, t) + (r * (-q * b - side * z * a)) / s,
      ];
      measured = Math.max(
        measured,
        Math.sqrt(
          Math.max(0, Math.min(...paths.map((c) => sweepMinimum(c, p)))),
        ),
      );
    }
  }
  expect(measured).toBeLessThan(0.02);
  expect(prepared.result.fallbackLeaves).toBe(0);
});
it("prepares affected elements independently while preserving single-opacity union coverage", () => {
  const segments: InkStrokeSegment[] = [
      {
        points: [
          [0, 0],
          [10, 0],
          [20, 2],
          [30, 2],
        ],
        radius: [2, 3],
      },
      {
        points: [
          [30, 2],
          [40, 2],
          [50, 0],
          [60, 0],
        ],
        radius: [3, 2],
      },
    ],
    whole = kernel.build(segments),
    parts = segments.flatMap((segment) => kernel.build([segment]).commands),
    points = grid(-5, -6, 70, 15, 23),
    a = analytic.meshWinding(analytic.build(whole.commands), points),
    b = analytic.meshWinding(analytic.build(parts), points);
  for (let i = 0; i < points.length; i++) {
    const minimum = Math.min(
      ...segments.map((s) => sweepMinimum(s, points[i])),
    );
    if (Math.abs(minimum) > 0.5) expect(a[i].inside).toBe(b[i].inside);
  }
});
function section(points: P[], lo: number, hi: number) {
  const front = hi === 1 ? points : split(points, hi)[0],
    part = lo === 0 ? front : split(front, lo / hi)[1];
  // Both adjacent pieces evaluate the SAME original polynomial at their common
  // parameter; nested splitting must not introduce two different endpoint bits.
  const at = (t: number) => {
    let p = points;
    while (p.length > 1)
      p = p
        .slice(1)
        .map((q, i) => [
          (1 - t) * p[i][0] + t * q[0],
          (1 - t) * p[i][1] + t * q[1],
        ]);
    return p[0];
  };
  part[0] = at(lo);
  part[part.length - 1] = at(hi);
  return part;
}
it("retains exact disk coverage when the radius grows faster than the center moves", () => {
  const segments: InkStrokeSegment[] = [
      {
        points: [
          [0, 0],
          [1, 0],
        ],
        radius: [1, 10],
      },
    ],
    result = oracle(segments, grid(-11, -11, 24, 22));
  expect(result.result.envelopeCurves).toBe(0);
  expect(result.result.fallbackLeaves).toBe(1);
  expect(result.result.fallbackCenterBound).toBe(0);
  expect(result.result.contours).toBe(1);
});
it("removes only provably contained fallback proxies without changing disk-union coverage", () => {
  const segments: InkStrokeSegment[] = Array.from({ length: 16 }, (_, i) => ({
    points: [
      [i * 0.01, 0],
      [i * 0.01 + 0.01, 0],
    ],
    radius: [i + 1, i + 2],
  }));
  const result = oracle(segments, grid(-19, -19, 39, 38));
  expect(result.result.fallbackLeaves).toBe(16);
  expect(result.result.fallbackContours).toBe(1);
  expect(result.result.contours).toBe(1);
  expect(native(segments).equals(wasmBytes(segments))).toBe(true);
});
it("certifies nonuniform straight motion without treating tangential acceleration as folded ink", () => {
  const segments: InkStrokeSegment[] = [
    {
      points: [
        [0, 0],
        [0.25, 0],
        [1.5, 0],
        [2, 0],
      ],
      radius: [1.75, 1.75],
    },
  ];
  const input = structuredClone(segments),
    prepared = oracle(segments, grid(-2, -2, 6, 4, 31), 0.0025);
  expect(prepared.result.fallbackLeaves).toBe(0);
  expect(prepared.result.contours).toBeLessThanOrEqual(3);
  expect(prepared.result.commands).toBeLessThan(48);
  expect(segments).toEqual(input);
  expect(
    native(segments, { tolerance: 0.0025 }).equals(
      wasmBytes(segments, { tolerance: 0.0025 }),
    ),
  ).toBe(true);
});
it("executes the real native interval normal/subnormal/overflow and strict-positivity contract", () => {
  expect(execFileSync(progressExecutable, { encoding: "utf8" })).toContain(
    "STROKE_PROGRESS_INTERVAL_CONTRACT_OK",
  );
});
it("preserves nonnegative coverage of an actual fitted negative-pocket regression and a second genuine disk block", () => {
  // Exact dyadic/Sturm verification of the former8-command output gives -1
  // at this off-boundary point, despite true-source regularity. Position
  // sampling alone therefore cannot authorize signed block composition.
  const segments: InkStrokeSegment[] = [
    {
      points: [
        [0, 0],
        [0.00003367778537142461, -0.012859080612437065],
        [0.009293639021512949, 0.013488575661669581],
        [0.009327316806884374, 0],
      ],
      radius: [9.85587254061633e-7, 9.85587254061633e-7],
    },
  ];
  const point: P = [0.0014658802756783362, -0.0035283613106323656],
    disk: InkStrokeSegment = { points: [point], radius: [5e-7, 5e-7] },
    options = { tolerance: 0.0025 };
  const input = structuredClone(segments),
    A = kernel.build(segments, options),
    B = kernel.build([disk], options),
    whole = kernel.build([...segments, disk], options);
  const wa = analytic.pathWinding(A.commands, point),
    wb = analytic.pathWinding(B.commands, point),
    w = analytic.pathWinding(whole.commands, point);
  expect(wa.boundary).toBe(false);
  expect(wa.winding).toBeGreaterThanOrEqual(0);
  expect(wb.winding).toBe(1);
  expect(w.winding).toBeGreaterThan(0);
  expect(w.inside).toBe(true);
  const reflected = analytic.pathWinding(
      A.commands,
      [-point[0], point[1]],
      [-1, 0, 0, 1, 0, 0],
    ),
    reflectedDisk = analytic.pathWinding(
      B.commands,
      [-point[0], point[1]],
      [-1, 0, 0, 1, 0, 0],
    );
  expect(reflected.winding).toBe(-wa.winding);
  expect(reflectedDisk.winding).toBe(-1);
  expect(reflected.winding + reflectedDisk.winding).toBeLessThan(0);
  expect(segments).toEqual(input);
  expect(
    native([...segments, disk], options).equals(
      wasmBytes([...segments, disk], options),
    ),
  ).toBe(true);
});
it("covers zero-radius endpoints, empty radius profiles, reversals and varying-width joins using only positive output", () => {
  const cases: InkStrokeSegment[][] = [
    [
      {
        points: [
          [0, 0],
          [2, 0],
        ],
        radius: [0, 0.1],
      },
      {
        points: [
          [2, 0],
          [3, 1],
        ],
        radius: [0.1, 0],
      },
    ],
    [
      {
        points: [
          [0, 0],
          [2, 0],
        ],
        radius: [0, 0],
      },
    ],
    [
      {
        points: [
          [0, 0],
          [2, 0],
        ],
        radius: [0.25, 0.4],
      },
      {
        points: [
          [2, 0],
          [1, 0],
        ],
        radius: [0.4, 0.1],
      },
    ],
    [
      {
        points: [
          [0, 0],
          [2, 0],
        ],
        radius: [0.5, 0.4],
      },
      {
        points: [
          [2, 0],
          [2.5, 1.5],
        ],
        radius: [0.4, 0.6],
      },
    ],
  ];
  for (const segments of cases) {
    const out = oracle(segments, grid(-1, -1, 5, 4, 31), 0.0025);
    const points = grid(-1, -1, 5, 4, 31),
      hits = analytic.meshWinding(analytic.build(out.commands), points);
    expect(hits.every((hit) => hit.winding >= 0)).toBe(true);
    expect(
      native(segments, { tolerance: 0.0025 }).equals(
        wasmBytes(segments, { tolerance: 0.0025 }),
      ),
    ).toBe(true);
  }
  expect(kernel.build(cases[1]).commands).toEqual([]);
});
it("applies command budgets to the final certified band rather than its unmerged planning pieces", () => {
  const segments: InkStrokeSegment[] = [
    {
      points: [
        [0, 0],
        [30, 12],
        [65, 12],
        [100, 0],
      ],
      radius: [2, 4],
    },
  ];
  const prepared = kernel.build(segments),
    options = { maxCommands: prepared.commands.length };
  expect(kernel.build(segments, options).commands).toEqual(prepared.commands);
  expect(native(segments, options).equals(wasmBytes(segments, options))).toBe(
    true,
  );
  expect(() =>
    kernel.build(segments, { maxCommands: prepared.commands.length - 1 }),
  ).toThrow();
});
it("proves both curved envelopes below the real curvature fold and keeps actual folds on the fallback", () => {
  const points: P[] = [
    [0, 0],
    [1, 1],
    [2, 0],
  ];
  // |curvature| reaches exactly1 at t=1/2. Radius0.8 has
  // s^3-r^2*C^2>0 everywhere; radius1 touches a fold and1.2 folds.
  for (const radius of [0.8, 1, 1.2]) {
    const segments: InkStrokeSegment[] = [{ points, radius: [radius, radius] }];
    const result = oracle(segments, grid(-1.5, -1.5, 5, 4, 37), 0.0025);
    if (radius < 1) expect(result.result.fallbackLeaves).toBe(0);
    else expect(result.result.fallbackLeaves).toBeGreaterThan(0);
    expect(
      native(segments, { tolerance: 0.0025 }).equals(
        wasmBytes(segments, { tolerance: 0.0025 }),
      ),
    ).toBe(true);
  }
});
it("keeps every authored varying-radius knot through the polynomial progress certificate", () => {
  const radii = [0.5, 0.65, 0.57, 0.7, 0.55],
    segments: InkStrokeSegment[] = radii.slice(1).map((r, i) => ({
      points: [
        [i * 3, 0],
        [i * 3 + 0.5, 0],
        [i * 3 + 2.5, 0],
        [i * 3 + 3, 0],
      ],
      radius: [radii[i], r],
    }));
  const original = structuredClone(segments);
  const result = oracle(segments, grid(-1, -1, 14, 2, 41), 0.0025);
  expect(result.result.fallbackLeaves).toBe(0);
  expect(result.result.envelopeCurves).toBeGreaterThanOrEqual(
    segments.length * 2,
  );
  expect(segments).toEqual(original);
  expect(
    native(segments, { tolerance: 0.0025 }).equals(
      wasmBytes(segments, { tolerance: 0.0025 }),
    ),
  ).toBe(true);
});
it("conservatively falls back when interval polynomial products underflow and remains native/Wasm identical", () => {
  const scale = 1e-120,
    segments: InkStrokeSegment[] = [
      {
        points: [
          [0, 0],
          [0.25 * scale, 0],
          [1.5 * scale, 0],
          [2 * scale, 0],
        ],
        radius: [1.75 * scale, 1.75 * scale],
      },
    ];
  const result = kernel.build(segments, { tolerance: 0.0025 });
  expect(result.result.fallbackLeaves).toBeGreaterThan(0);
  expect(
    result.commands.flatMap((c) => c.slice(1)).every(Number.isFinite),
  ).toBe(true);
  expect(
    native(segments, { tolerance: 0.0025 }).equals(
      wasmBytes(segments, { tolerance: 0.0025 }),
    ),
  ).toBe(true);
});
it("matches the independent oracle on deterministic varied cubic/pressure geometry including tight folds", () => {
  let state = 59374;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 16; i++) {
    const segment: InkStrokeSegment = {
      points: [
        [0, 0],
        [random() * 70 - 20, random() * 100 - 50],
        [random() * 70 - 20, random() * 100 - 50],
        [50, 0],
      ],
      radius: [random() * 8 + 0.1, random() * 8 + 0.1],
    };
    oracle([segment], grid(-30, -55, 110, 110, 17), 0.02);
    expect(native([segment]).equals(wasmBytes([segment]))).toBe(true);
  }
}, 30000);
it("preserves explicit closed sweeps even when their radius covers the whole center loop", () => {
  const k = (4 * (Math.sqrt(2) - 1)) / 3,
    R = 10;
  const points: P[][] = [
    [
      [R, 0],
      [R, R * k],
      [R * k, R],
      [0, R],
    ],
    [
      [0, R],
      [-R * k, R],
      [-R, R * k],
      [-R, 0],
    ],
    [
      [-R, 0],
      [-R, -R * k],
      [-R * k, -R],
      [0, -R],
    ],
    [
      [0, -R],
      [R * k, -R],
      [R, -R * k],
      [R, 0],
    ],
  ];
  for (const radius of [2, 20]) {
    const segments = points.map((points) => ({
      points,
      radius: [radius, radius] as [number, number],
    }));
    const prepared = oracle(segments, grid(-32, -32, 64, 64, 27), 0.02);
    if (radius === 20)
      expect(analytic.pathWinding(prepared.commands, [0, 0]).inside).toBe(true);
    expect(native(segments).equals(wasmBytes(segments))).toBe(true);
  }
});
it("reports an independently measurable circular arc bound separately from sampled envelope error", () => {
  const { commands, result } = kernel.build([
    { points: [[1000000, -1000000]], radius: [10000, 10000] },
  ]);
  let p: P = [0, 0],
    maximum = 0;
  for (const c of commands) {
    if (c[0] === "M") p = [c[1], c[2]];
    else if (c[0] === "C") {
      const q = [p, [c[1], c[2]], [c[3], c[4]], [c[5], c[6]]] as P[];
      for (let i = 0; i <= 32; i++) {
        const v = section(q, 0, i / 32).at(-1)!;
        maximum = Math.max(
          maximum,
          Math.abs(Math.hypot(v[0] - 1000000, v[1] + 1000000) - 10000),
        );
      }
      p = q[3];
    }
  }
  expect(maximum).toBeLessThanOrEqual(result.arcErrorBound);
  expect(result.arcErrorBound).toBeLessThanOrEqual(0.005);
  expect(result.sampledEnvelopeError).toBe(0);
  const coarse = kernel.build([{ points: [[0, 0]], radius: [0.1, 0.1] }], {
    tolerance: 1000,
  });
  expect(
    coarse.commands.filter((c) => c[0] === "C").length,
  ).toBeGreaterThanOrEqual(4);
  expect(analytic.pathWinding(coarse.commands, [0, 0]).inside).toBe(true);
});
it("rejects aliases and exhausted budgets without writing any caller bytes in the actual Wasm ABI", () => {
  const core = new CompiledInkKernel(),
    api = core.api,
    input = core.allocate(88),
    config = core.allocate(24),
    out = core.allocate(56),
    commands = core.allocate(4096),
    view = new DataView(api.memory.buffer);
  new Uint8Array(api.memory.buffer, input, 88).fill(0);
  view.setFloat64(input + 16, 100, true);
  view.setFloat64(input + 64, 2, true);
  view.setFloat64(input + 72, 2, true);
  view.setUint32(input + 80, 1, true);
  view.setFloat64(config, 0.02, true);
  [1, 20, 100000, 1000000].forEach((v, i) =>
    view.setUint32(config + 8 + i * 4, v, true),
  );
  const build = api.sa_stroke_path_build as (...args: number[]) => number,
    counts = api.sa_stroke_path_counts as (...args: number[]) => number;
  new Uint8Array(api.memory.buffer, out, 56).fill(0x5a);
  new Uint8Array(api.memory.buffer, commands, 4096).fill(0x5b);
  const before = new Uint8Array(api.memory.buffer, input, 88).slice();
  expect(build(input, 1, config, commands, 0, out)).toBe(2);
  expect(build(input, 1, config, input, 64, out)).toBe(1);
  expect(build(input, 1, config, commands, 64, commands)).toBe(1);
  expect(counts(0xfffffff0, 1, config, out)).toBe(1);
  expect(new Uint8Array(api.memory.buffer, input, 88)).toEqual(before);
  expect(
    new Uint8Array(api.memory.buffer, out, 56).every((v) => v === 0x5a),
  ).toBe(true);
  expect(
    new Uint8Array(api.memory.buffer, commands, 4096).every((v) => v === 0x5b),
  ).toBe(true);
});
it("rejects invalid batches, budgets and aliasing atomically in the real native ABI", () => {
  execFileSync(executable, ["--contract"]);
  const good = kernel.build(cases[1]);
  expect(() => kernel.build(cases[1], { maxCommands: 1 })).toThrow();
  expect(() => kernel.build(cases[1], { maxLeaves: 1 })).toThrow();
  expect(() => kernel.build([{ points: [[0, 0]], radius: [1, 2] }])).toThrow();
  expect(() =>
    kernel.build([{ points: [[NaN, 0]], radius: [1, 1] }]),
  ).toThrow();
  expect(() =>
    kernel.build([{ points: [, [1, 0]] as unknown as P[], radius: [1, 1] }]),
  ).toThrow();
  expect(() =>
    kernel.build(cases[0], { cap: "square" } as InkStrokeOptions),
  ).toThrow();
  expect(kernel.build(cases[1])).toEqual(good);
});

it("resolves authored radius styles with byte-identical native and WASM semantics", () => {
  const segments: InkStrokeSegment[] = [
    { points: [[1, 2]], radius: [1, 1] },
    {
      points: [
        [2, 3],
        [4, 8],
        [9, 2],
      ],
      radius: [0.5, 2],
    },
  ];
  for (const pressure of [false, true]) {
    const bytes = Buffer.alloc(28 + segments.length * 88);
    bytes.writeUInt32LE(segments.length);
    bytes.writeDoubleLE(4, 4);
    bytes.writeDoubleLE(8, 12);
    bytes.writeUInt32LE(pressure ? 1 : 0, 20);
    segments.forEach((s, i) => {
      const at = 28 + i * 88;
      s.points.flat().forEach((v, j) => bytes.writeDoubleLE(v, at + j * 8));
      s.radius.forEach((v, j) => bytes.writeDoubleLE(v, at + 64 + j * 8));
      bytes.writeUInt32LE(s.points.length - 1, at + 80);
    });
    const actual = execFileSync(executable, ["--style"], { input: bytes }),
      resolved = kernel.resolve(segments, {
        sourceWidth: 4,
        width: 8,
        pressure,
      }),
      expected = Buffer.alloc(4 + segments.length * 88);
    resolved.forEach((s, i) => {
      const at = 4 + i * 88;
      s.points.flat().forEach((v, j) => expected.writeDoubleLE(v, at + j * 8));
      s.radius.forEach((v, j) => expected.writeDoubleLE(v, at + 64 + j * 8));
      expected.writeUInt32LE(s.points.length - 1, at + 80);
    });
    expect(actual).toEqual(expected);
  }
});
