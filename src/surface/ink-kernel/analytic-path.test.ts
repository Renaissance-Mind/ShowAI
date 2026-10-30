import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalyticPathKernel } from "./analytic-path.mjs";
const kernel = new AnalyticPathKernel();
const operation: Record<string, number> = { M: 0, L: 1, Q: 2, C: 3, Z: 4 };
const identity = [1, 0, 0, 1, 0, 0];
let temporary: string, executable: string;
beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), "showai-analytic-"));
  executable = join(
    temporary,
    process.platform === "win32" ? "parity.exe" : "parity",
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
    "src/surface/ink-kernel/analytic-path.cpp",
    "src/surface/ink-kernel/analytic-native-parity.cpp",
    "-o",
    executable,
  ]);
});
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
type Point = [number, number];
type Command = (string | number)[];
function native(
  commands: Command[],
  points: Point[],
  affine = identity,
  fill = 0,
) {
  const input = Buffer.alloc(76 + commands.length * 56 + points.length * 16);
  [commands.length, points.length, fill].forEach((x, i) =>
    input.writeUInt32LE(x, i * 4),
  );
  affine.forEach((x, i) => input.writeDoubleLE(x, 12 + i * 8));
  [100000, 1000000, 16, 0].forEach((x, i) =>
    input.writeUInt32LE(x, 60 + i * 4),
  );
  commands.forEach((c, i) => {
    const at = 76 + i * 56;
    input.writeUInt32LE(operation[c[0] as string], at);
    c.slice(1).forEach((x, j) =>
      input.writeDoubleLE(x as number, at + 8 + j * 8),
    );
  });
  points.forEach((p, i) =>
    p.forEach((x, j) =>
      input.writeDoubleLE(x, 76 + commands.length * 56 + i * 16 + j * 8),
    ),
  );
  const out = execFileSync(executable, [], {
    input,
    maxBuffer: 128 * 1024 * 1024,
  });
  expect(out.readUInt32LE(0)).toBe(0);
  expect(out.readUInt32LE(4)).toBe(120);
  expect(out.readUInt32LE(8)).toBe(20);
  const pc = out.readUInt32LE(16),
    vc = out.readUInt32LE(20),
    rayPatches = out.readUInt32LE(24);
  const patches = Array.from({ length: pc }, (_, i) => {
    const at = 32 + i * 120;
    return {
      origin: [out.readDoubleLE(at), out.readDoubleLE(at + 8)],
      controls: Array.from({ length: 8 }, (_, j) =>
        out.readDoubleLE(at + 16 + j * 8),
      ),
      parameterStart: out.readDoubleLE(at + 80),
      parameterEnd: out.readDoubleLE(at + 88),
      firstVertex: out.readUInt32LE(at + 96),
      vertexCount: out.readUInt32LE(at + 100),
      commandIndex: out.readUInt32LE(at + 104),
      mode: out.readUInt32LE(at + 108),
      winding: out.readInt32LE(at + 112),
      sign: out.readFloatLE(at + 116),
    };
  });
  const at = 32 + pc * 120,
    vertices = Float32Array.from({ length: vc * 5 }, (_, i) =>
      out.readFloatLE(at + i * 4),
    );
  const read = (at: number) => ({
    winding: out.readInt32LE(at),
    inside: out.readUInt32LE(at + 4) !== 0,
    boundary: out.readUInt32LE(at + 8) !== 0,
  });
  const hits = points.map((_, i) => ({
    path: read(at + vc * 20 + i * 32),
    mesh: read(at + vc * 20 + i * 32 + 16),
  }));
  expect(out.length).toBe(at + vc * 20 + points.length * 32);
  return { patches, vertices, rayPatches, hits };
}
function map(p: Point, m: number[]): Point {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
// Mathematical oracle in test code: Bernstein evaluation + derivative partition.
// No tessellated polygon, compiled module, or mesh implicit coefficients used.
function value(p: Point[], t: number): Point {
  let a = p.map((q) => [...q] as Point);
  while (a.length > 1)
    a = a
      .slice(1)
      .map((q, i) => [
        (1 - t) * a[i][0] + t * q[0],
        (1 - t) * a[i][1] + t * q[1],
      ]);
  return a[0];
}
function crossings(p: Point[], query: Point) {
  const degree = p.length - 1;
  let breaks = [0, 1];
  if (degree === 2) {
    const den = p[0][1] - 2 * p[1][1] + p[2][1];
    if (den) {
      const t = (p[0][1] - p[1][1]) / den;
      if (t > 0 && t < 1) breaks.push(t);
    }
  } else if (degree === 3) {
    let a = -p[0][1] + 3 * p[1][1] - 3 * p[2][1] + p[3][1],
      b = 2 * (p[0][1] - 2 * p[1][1] + p[2][1]),
      c = p[1][1] - p[0][1];
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
    if (scale) {
      a /= scale;
      b /= scale;
      c /= scale;
      if (a === 0) {
        if (b !== 0) breaks.push(-c / b);
      } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const q = -(b + Math.sign(b || 1) * Math.sqrt(disc)) / 2;
          breaks.push(q / a);
          if (q !== 0) breaks.push(c / q);
        }
      }
    }
  }
  breaks = [...new Set(breaks.filter((t) => t >= 0 && t <= 1))].sort(
    (a, b) => a - b,
  );
  let w = 0,
    near = false;
  for (let i = 1; i < breaks.length; i++) {
    let lo = breaks[i - 1],
      hi = breaks[i];
    const ay = value(p, lo)[1],
      by = value(p, hi)[1],
      dir = Math.sign(by - ay);
    if (query[1] < Math.min(ay, by) || query[1] >= Math.max(ay, by)) continue;
    for (let j = 0; j < 100; j++) {
      const t = lo + (hi - lo) / 2;
      if (t === lo || t === hi) break;
      if (value(p, t)[1] < query[1] === dir > 0) lo = t;
      else hi = t;
    }
    const x = value(p, (lo + hi) / 2)[0];
    near ||= Math.abs(x - query[0]) < 1e-4;
    if (x > query[0]) w += dir;
  }
  return { w, near };
}
function oracle(commands: Command[], query: Point, m = identity) {
  let at: Point = [0, 0],
    start: Point = at,
    open = false,
    w = 0,
    near = false;
  const segment = (p: Point[]) => {
    const q = crossings(p, query);
    w += q.w;
    near ||= q.near;
  };
  for (const c of [...commands, ["M", 0, 0]]) {
    const op = c[0];
    if ((op === "M" || op === "Z") && open) {
      segment([at, start]);
      open = false;
      at = start;
    }
    if (op === "M") {
      at = start = map([c[1] as number, c[2] as number], m);
      open = true;
    } else if (op === "L") {
      const z = map([c[1] as number, c[2] as number], m);
      segment([at, z]);
      at = z;
    } else if (op === "Q") {
      const q = map([c[1] as number, c[2] as number], m),
        z = map([c[3] as number, c[4] as number], m);
      segment([at, q, z]);
      at = z;
    } else if (op === "C") {
      const a = map([c[1] as number, c[2] as number], m),
        b = map([c[3] as number, c[4] as number], m),
        z = map([c[5] as number, c[6] as number], m);
      segment([at, a, b, z]);
      at = z;
    }
  }
  return { w, near };
}
const fixtures: Command[][] = [
  [["M", 0, 0], ["L", 100, 0], ["L", 100, 100], ["L", 0, 100], ["Z"]],
  [
    ["M", 0, 0],
    ["Q", 50, 120, 100, 0],
    ["L", 100, -30],
    ["L", 0, -30],
  ],
  [["M", 0, 0], ["C", 0, 100, 100, 100, 100, 0], ["Z"]],
  [["M", 0, 0], ["C", 100, 100, -100, 100, 0, 0], ["Z"]], // loop with closed endpoints
  [["M", 0, 0], ["C", 100, 200, -100, -200, 100, 0], ["Z"]], // serpentine
  [["M", 0, 0], ["C", 100, 100, -100, -100, 0, 0], ["Z"]], // line, retraced
  [["M", 0, 0], ["C", 0, 0, 0, 0, 0, 0], ["Z"]], // point
  [["M", 1, -1], ["C", -1 / 3, 1, -1 / 3, -1, 1, 1], ["Z"]], // cusp
  [["M", 0, 0], ["C", 0, 0, 100, 100, 100, 100], ["Z"]], // repeated endpoints
  [["M", 0, 0], ["C", 0, 100, 100, 0, 100, 100], ["Z"]], // cusp at infinity
  [["M", 0, 0], ["C", 1 / 3, 2 / 3, 2 / 3, 2 / 3, 1, 0], ["Z"]], // degree-elevated quadratic
  [["M", 0, 0], ["C", 10, 1e-12, 20, -1e-12, 30, 0], ["Z"]],
  [
    ["M", -100, -100],
    ["L", 100, -100],
    ["L", 100, 100],
    ["L", -100, 100],
    ["Z"],
    ["M", -30, -30],
    ["L", -30, 30],
    ["Q", 0, 60, 30, 30],
    ["L", 30, -30],
    ["Z"],
  ],
  [
    ["M", -100, -100],
    ["L", 100, 100],
    ["L", -100, 100],
    ["L", 100, -100],
    ["Z"],
  ], // bowtie
];
function check(
  commands: Command[],
  points: Point[],
  affine = identity,
  fill = 0,
  nativeParity = true,
) {
  const mesh = kernel.build(commands, affine),
    hits = kernel.meshWinding(mesh, points, fill);
  if (nativeParity) {
    const n = native(commands, points, affine, fill);
    expect(mesh.patches).toEqual(n.patches);
    expect(mesh.vertices).toEqual(n.vertices);
    expect(mesh.rayPatches).toBe(n.rayPatches);
    expect(hits).toEqual(n.hits.map((h) => h.mesh));
    points.forEach((p, i) =>
      expect(kernel.pathWinding(commands, p, affine, fill)).toEqual(
        n.hits[i].path,
      ),
    );
  }
  let compared = 0;
  points.forEach((p, i) => {
    const expected = oracle(commands, p, affine),
      actual = hits[i],
      path = kernel.pathWinding(commands, p, affine, fill);
    if (expected.near || actual.boundary || path.boundary) return;
    expect(path.winding, JSON.stringify({ commands, p, affine })).toBe(
      expected.w,
    );
    expect(
      actual.winding,
      JSON.stringify({ commands, p, affine, patches: mesh.patches }),
    ).toBe(expected.w);
    expect(actual.inside).toBe(
      fill === 1 ? expected.w % 2 !== 0 : expected.w !== 0,
    );
    compared++;
  });
  return { mesh, compared };
}

describe("shared analytic Bezier path kernel", () => {
  it("retains a valid near-collinear large-origin cubic when repeated loop classification reaches the depth budget", () => {
    // Minimal three-command numerical trace: local translation alone changes
    // binary64 subdivision rounding, so keep the canonical origin as well.
    const commands: Command[] = [
      ["M", 100804.83027921774, 100760.40385414359],
      [
        "C",
        100804.85297524599,
        100760.42590444384,
        100804.86432325804,
        100760.43692959195,
        100804.86857876956,
        100760.4410640293,
      ],
      ["Z"],
    ];
    const original = structuredClone(commands);
    const points: Point[] = Array.from({ length: 25 }, (_, i) => [
      100804.8 + (i % 5) * 0.025,
      100760.38 + Math.floor(i / 5) * 0.025,
    ]);
    const result = check(commands, points);
    expect(result.mesh.rayPatches).toBeGreaterThan(0);
    expect(result.compared).toBeGreaterThan(10);
    expect(commands).toEqual(original);
    const bounded = kernel.build(commands, identity, { maxDepth: 1 });
    expect(bounded.rayPatches).toBeGreaterThan(0);
    expect(bounded.patches.length).toBeLessThan(result.mesh.patches.length);
    const hits = kernel.meshWinding(bounded, points);
    points.forEach((point, i) =>
      expect(hits[i].inside).toBe(kernel.pathWinding(commands, point).inside),
    );
  });
  it("keeps both directed lobes of a near-collinear cubic and an interior loop double point", () => {
    const near: Command[] = [
      ["M", 0, 0],
      ["C", 10, 1e-12, 20, -1e-12, 30, 0],
      ["Z"],
    ];
    const m = kernel.build(near);
    expect(m.rayPatches).toBe(1);
    check(near, [
      [5, 1e-13],
      [25, -1e-13],
      [5, -1e-13],
      [25, 1e-13],
    ]);
    expect(
      kernel
        .meshWinding(m, [
          [5, 1e-13],
          [25, -1e-13],
        ])
        .map((h) => h.winding),
    ).toEqual([-1, 1]);
    const loop: Command[] = [
      ["M", -44.11077229306102, -36.03751282207668],
      [
        "C",
        -93.81657261401415,
        16.68325266800821,
        -61.639189068228006,
        76.02980234660208,
        -46.03542760014534,
        -72.9125373531133,
      ],
      ["Z"],
    ];
    check(loop, [
      [-64.48929691687226, 0.26303776539862156],
      [-50, -30],
      [-70, 20],
    ]);
    expect(
      kernel.meshWinding(kernel.build(loop), [
        [-64.48929691687226, 0.26303776539862156],
      ])[0].winding,
    ).toBe(-1);
  });

  it("normalizes geometric predicates before products for tiny canonical coordinates and large finite affine maps", () => {
    for (const scale of [1e-120, 1e-200]) {
      const path: Command[] = [
        ["M", 0, 0],
        ["C", 0, 100 * scale, 100 * scale, 100 * scale, 100 * scale, 0],
        ["Z"],
      ];
      const affine = [1 / scale, 0, 0, 1 / scale, 0, 0];
      const result = check(
        path,
        [
          [50, 30],
          [50, 90],
          [15, 20],
          [115, 30],
        ],
        affine,
      );
      expect(result.compared).toBe(4);
      expect(result.mesh.rayPatches).toBe(0);
    }
    expect(() => kernel.meshWinding(kernel.build([]), [[NaN, 0]])).toThrow();
  });

  it("executes native atomic error and mathematical contracts", () => {
    const contract = join(
      temporary,
      process.platform === "win32" ? "contract.exe" : "contract",
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
      "src/surface/ink-kernel/analytic-path.cpp",
      "src/surface/ink-kernel/analytic-native-contract.cpp",
      "-o",
      contract,
    ]);
    execFileSync(contract);
  });
  it("evaluates the analytic implicit value, screen chain gradient and singular boundary without finite differencing", () => {
    const k = kernel.kernel;
    k.reset();
    const coords = k.allocate(24),
      x = k.allocate(24),
      y = k.allocate(24),
      out = k.allocate(32);
    const klm = [0.5, 0.2, 0.4],
      dx = [0.3, -0.2, 0.1],
      dy = [-0.4, 0.2, 0.3];
    new Float64Array(kernel.api.memory.buffer, coords, 3).set(klm);
    new Float64Array(kernel.api.memory.buffer, x, 3).set(dx);
    new Float64Array(kernel.api.memory.buffer, y, 3).set(dy);
    for (const mode of [1, 2])
      for (const sign of [-1, 1]) {
        expect(
          kernel.api.sa_analytic_implicit_evaluate(
            mode,
            sign,
            coords,
            x,
            y,
            out,
          ),
        ).toBe(0);
        const values = Array.from(
          new Float64Array(kernel.api.memory.buffer, out, 4),
        );
        const f = mode === 1 ? 0.5 * 0.5 - 0.2 : 0.5 * 0.5 * 0.5 - 0.2 * 0.4;
        const fx =
          mode === 1
            ? 2 * 0.5 * 0.3 - -0.2
            : 3 * 0.5 * 0.5 * 0.3 - 0.4 * -0.2 - 0.2 * 0.1;
        const fy =
          mode === 1
            ? 2 * 0.5 * -0.4 - 0.2
            : 3 * 0.5 * 0.5 * -0.4 - 0.4 * 0.2 - 0.2 * 0.3;
        expect(values.slice(0, 3)).toEqual([f, fx, fy]);
        expect(values[3]).toBeCloseTo(
          Math.min(1, Math.max(0, 0.5 + (sign * f) / Math.hypot(fx, fy))),
          14,
        );
      }
    new Float64Array(kernel.api.memory.buffer, coords, 3).fill(0);
    new Float64Array(kernel.api.memory.buffer, x, 3).fill(0);
    new Float64Array(kernel.api.memory.buffer, y, 3).fill(0);
    expect(
      kernel.api.sa_analytic_implicit_evaluate(2, 1, coords, x, y, out),
    ).toBe(0);
    expect(new Float64Array(kernel.api.memory.buffer, out, 4)[3]).toBe(0.5);
  });
  it("retains reverse-contour cancellation and winding beyond an eight-bit stencil", () => {
    const shape: Command[] = [
        ["M", 0, 0],
        ["C", 0, 100, 100, 100, 100, 0],
        ["Z"],
      ],
      reverse: Command[] = [
        ["M", 100, 0],
        ["C", 100, 100, 0, 100, 0, 0],
        ["Z"],
      ];
    check(
      [...shape, ...reverse],
      [
        [50, 30],
        [20, 20],
        [60, 80],
      ],
    );
    const many = Array.from({ length: 257 }, () => shape).flat();
    const m = kernel.build(many);
    expect(kernel.meshWinding(m, [[50, 30]], 0)[0]).toMatchObject({
      winding: -257,
      inside: true,
    });
    expect(kernel.meshWinding(m, [[50, 30]], 1)[0].inside).toBe(true);
    const even = kernel.build(many.slice(0, -shape.length));
    expect(kernel.meshWinding(even, [[50, 30]], 1)[0].inside).toBe(false);
  });
  it("renders dyadic finite cusps and cusps at infinity analytically and closes paths after CLOSE", () => {
    const cusp: Command[] = [["M", 3, -3], ["C", -1, 3, -1, -3, 3, 3], ["Z"]];
    const infinity: Command[] = [["M", 0, 0], ["C", 1, 0, 2, 0, 3, 1], ["Z"]];
    const points = Array.from(
      { length: 120 },
      (_, i) =>
        [
          -1.137 + (i % 12) * 0.517,
          -3.173 + Math.floor(i / 12) * 0.753,
        ] as Point,
    );
    check(cusp, points);
    check(infinity, points);
    expect(kernel.build(cusp).patches.some((p: any) => p.mode === 2)).toBe(
      true,
    );
    expect(kernel.build(infinity).rayPatches).toBe(0);
    for (const affine of [
      [1, 0, 0, 1, 0, 0],
      [0.87, 0.23, -0.13, 0.94, 5, 20],
      [-0.87, 0.23, -0.13, 0.94, 5, 20],
    ]) {
      const mesh = kernel.build(cusp, affine);
      expect(mesh.rayPatches).toBe(0);
      check(
        cusp,
        points.map((p) => map(p, affine)),
        affine,
      );
    }
    const continued: Command[] = [
      ["M", 0, 0],
      ["L", 10, 0],
      ["L", 10, 10],
      ["Z"],
      ["L", -10, 0],
      ["L", -10, -10],
      ["Z"],
    ];
    const m = kernel.build(continued);
    const h = kernel.meshWinding(m, [
      [8, 2],
      [-8, -2],
    ]);
    expect(h.map((q: any) => q.inside)).toEqual([true, true]);
    expect(() => kernel.build([["Z"]])).toThrow();
    expect(kernel.build([], identity).vertices.length).toBe(0);
  });

  it("matches native and WASM output and independent curve winding across degeneracies, loops, holes and both fills", () => {
    const points = Array.from(
      { length: 300 },
      (_, i) =>
        [
          -113.137 + (i % 20) * 12.371,
          -109.173 + Math.floor(i / 20) * 15.753,
        ] as Point,
    );
    for (const path of fixtures)
      for (const fill of [0, 1])
        expect(check(path, points, identity, fill).compared).toBeGreaterThan(
          280,
        );
  });
  it("preserves reflected affine direction and large-world local precision", () => {
    for (const affine of [
      [1.3, 0.23, -0.17, 0.8, 29, -37],
      [-1.1, 0.3, 0.2, 0.9, 83, -11],
      [1, 0, 0, 1, 1e12, -1e12],
    ]) {
      const path = fixtures[2];
      const points = Array.from({ length: 200 }, (_, i) =>
        map(
          [-10.137 + (i % 20) * 6.371, -10.173 + Math.floor(i / 20) * 10.753],
          affine,
        ),
      );
      check(path, points, affine);
      const mesh = kernel.build(path, affine);
      expect(
        Math.max(
          ...Array.from(mesh.vertices)
            .filter((_, i) => i % 5 < 2)
            .map(Math.abs),
        ),
      ).toBeLessThan(200);
    }
  });
  it("keeps analytic patches instead of zoom-dependent polygon sampling", () => {
    const q = kernel.build(fixtures[1]),
      c = kernel.build(fixtures[2]);
    expect(q.patches.some((p: any) => p.mode === 1)).toBe(true);
    expect(c.patches.some((p: any) => p.mode === 2)).toBe(true);
    expect(c.rayPatches).toBe(0);
    expect(c.vertices.length / 5).toBeLessThanOrEqual(9);
    for (const s of [1, 32, 1 / 32])
      expect(
        kernel.build(fixtures[2], [s, 0, 0, s, 0, 0]).vertices.length,
      ).toBe(c.vertices.length);
  });
  it("covers deterministic random cubics against the actual mathematical curve", () => {
    let seed = 58199;
    const random = () =>
      ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) *
        200 -
      100;
    let count = 0,
      rays = 0;
    for (let i = 0; i < 256; i++) {
      const p: Command[] = [
        ["M", random(), random()],
        ["C", random(), random(), random(), random(), random(), random()],
        ["Z"],
      ];
      const points = Array.from(
        { length: 96 },
        () => [random(), random()] as Point,
      );
      const result = check(p, points, identity, i % 2, i < 16);
      count += result.compared;
      rays += result.mesh.rayPatches;
    }
    expect(count).toBeGreaterThan(24000);
    expect(rays).toBeLessThan(32);
  });
  it("retains long mixed paths and explicit depth/output budgets without v1 changes", () => {
    const commands: Command[] = [["M", 0, 0]];
    for (let i = 0; i < 4096; i++)
      commands.push(["C", i * 2, 30, i * 2 + 1, -30, i * 2 + 2, 0]);
    commands.push(["Z"]);
    const mesh = kernel.build(commands);
    expect(mesh.patches.length).toBeGreaterThan(4096);
    expect(mesh.vertices.length).toBeGreaterThan(4096 * 15);
    expect(() => kernel.build(commands, identity, { maxPatches: 10 })).toThrow(
      /\(3\)/,
    );
    const n = native(commands, [
      [100, 0.123],
      [8000, 60],
    ]);
    expect(mesh.patches).toEqual(n.patches);
    expect(mesh.vertices).toEqual(n.vertices);
  });
  it("evaluates public linear/quadratic/cubic position and derivatives mathematically", () => {
    for (const degree of [1, 2, 3]) {
      const controls = [
        [0, 0],
        [20, 80],
        [70, -30],
        [100, 20],
      ].slice(0, degree + 1) as Point[];
      const k = kernel.kernel;
      k.reset();
      const c = k.allocate(64),
        pos = k.allocate(16),
        der = k.allocate(16);
      new Float64Array(kernel.api.memory.buffer, c, controls.length * 2).set(
        controls.flat(),
      );
      for (const t of [0, 0.125, 0.5, 0.875, 1]) {
        expect(
          kernel.api.sa_analytic_bezier_evaluate(c, degree, t, pos, der),
        ).toBe(0);
        expect(
          Array.from(new Float64Array(kernel.api.memory.buffer, pos, 2)),
        ).toEqual(value(controls, t));
        const d = controls
          .slice(1)
          .map(
            (q, i) =>
              [
                (q[0] - controls[i][0]) * degree,
                (q[1] - controls[i][1]) * degree,
              ] as Point,
          );
        expect(
          Array.from(new Float64Array(kernel.api.memory.buffer, der, 2)),
        ).toEqual(value(d, t));
      }
    }
  });
  it("rejects invalid/capacity/aliased buffers atomically instead of returning partial mesh", () => {
    expect(() => kernel.build([["L", 1, 2]])).toThrow();
    expect(() =>
      kernel.build([
        ["M", 0, 0],
        ["C", 1, 2, 3, 4, NaN, 5],
      ]),
    ).toThrow();
    expect(() =>
      kernel.build([
        ["M", 0, 0],
        ["Q", 1, 2, 3],
      ]),
    ).toThrow();
    const k = kernel.kernel,
      { command, transform, limit } = kernel.input(fixtures[2], identity, {}),
      count = k.allocate(16),
      patch = k.allocate(2048),
      vertex = k.allocate(2048);
    new Uint8Array(kernel.api.memory.buffer, patch, 2048).fill(0x5a);
    new Uint8Array(kernel.api.memory.buffer, vertex, 2048).fill(0x61);
    new Uint32Array(kernel.api.memory.buffer, count, 4).fill(0x777);
    expect(
      kernel.api.sa_analytic_path_build(
        command,
        fixtures[2].length,
        transform,
        limit,
        patch,
        0,
        vertex,
        0,
        count,
      ),
    ).toBe(2);
    expect(
      new Uint8Array(kernel.api.memory.buffer, patch, 2048).every(
        (x: number) => x === 0x5a,
      ),
    ).toBe(true);
    expect(
      Array.from(new Uint32Array(kernel.api.memory.buffer, count, 4)),
    ).toEqual([0x777, 0x777, 0x777, 0x777]);
    expect(
      kernel.api.sa_analytic_path_build(
        command,
        fixtures[2].length,
        transform,
        limit,
        patch,
        16,
        patch,
        32,
        count,
      ),
    ).toBe(1);
    expect(
      new Uint8Array(kernel.api.memory.buffer, patch, 2048).every(
        (x: number) => x === 0x5a,
      ),
    ).toBe(true);
  });
});
