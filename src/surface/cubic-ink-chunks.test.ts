import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CompiledInkStroke,
  type InkStrokeResult,
} from "./ink-kernel/ink-stroke-kernel.mjs";
import {
  cubicInkGeometry,
  cubicInkChunks,
  cubicInkBounds,
  cubicInkHit,
  cubicInkQueryGeometry,
  CUBIC_INK_CHUNK_SEGMENTS,
  CUBIC_INK_MAX_COMMANDS,
  CUBIC_INK_MAX_CHUNK_COMMANDS,
  CUBIC_INK_MAX_LEAVES,
} from "./cubic-ink.mjs";
import { longCubicInputFixture } from "./cubic-ink-chunks.fixture.mjs";
import {
  validatePortableInk,
  createPortableInk,
  portableInkGeometry,
  portableInkHit,
  type PortableInkV2,
} from "./portable-ink.mjs";
import { PortableInkPaths } from "./PortableInkPaths";
function source(count = 129): PortableInkV2 {
  return {
    format: "showai-ink-v2",
    geometryVersion: 1,
    brushVersion: 1,
    brush: "marker",
    strokeCount: 1,
    width: 4,
    opacity: 0.35,
    extent: [count * 10 + 20, 40],
    transform: [1, 0, 0, 1, 0, 0],
    outlineTolerance: 0.0025,
    segments: Array.from({ length: count }, (_, i) => ({
      points: [
        [i * 10, 20],
        [(i + 1) * 10, 20],
      ],
      radius: [3, 3],
    })),
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const sumFields = [
  "commands",
  "contours",
  "envelopeCurves",
  "fallbackLeaves",
  "sampledChecks",
  "leaves",
  "fallbackContours",
] as const;
const maxFields = [
  "maximumDepth",
  "sampledEnvelopeError",
  "fallbackCenterBound",
  "arcErrorBound",
] as const;
it("uses the exact fixed128 source partition, whole budgets and actual C++ style/counts/build/bounds", () => {
  const ink = source(263),
    kernel = new CompiledInkStroke();
  for (const [width, pressure] of [
    [4, true],
    [12, false],
    [8, true],
  ] as const) {
    const geometry = cubicInkGeometry(ink, width, pressure),
      total = Object.fromEntries(
        [...sumFields, ...maxFields].map((k) => [k, 0]),
      ) as unknown as InkStrokeResult;
    expect(geometry.chunks.map((c) => [c.start, c.end])).toEqual([
      [0, 128],
      [128, 256],
      [256, 263],
    ]);
    for (const chunk of geometry.chunks) {
      const options = {
        tolerance: ink.outlineTolerance,
        maxDepth: 20,
        maxCommands: Math.min(
          CUBIC_INK_MAX_CHUNK_COMMANDS,
          CUBIC_INK_MAX_COMMANDS - total.commands,
        ),
        maxLeaves: CUBIC_INK_MAX_LEAVES - total.leaves,
      };
      const segments = ink.segments.slice(chunk.start, chunk.end),
        style = { sourceWidth: ink.width, width, pressure },
        counts = kernel.counts(segments, options, style),
        actual = kernel.build(segments, options, style);
      expect(chunk.commands).toEqual(actual.commands);
      expect(chunk.statistics).toEqual(counts);
      expect(chunk.statistics).toEqual(actual.result);
      expect(chunk.bounds).toEqual(
        kernel.pathBounds(actual.commands, ink.transform),
      );
      for (const field of sumFields) total[field] += counts[field];
      for (const field of maxFields)
        total[field] = Math.max(total[field], counts[field]);
    }
    expect(geometry.statistics).toEqual(total);
    expect(geometry.commands).toEqual(
      geometry.chunks.flatMap((c) => c.commands),
    );
  }
  expect(CUBIC_INK_CHUNK_SEGMENTS).toBe(128);
});
it("reads a real coalesced/prediction input stroke above100k commands without discarding actual pressure knots", () => {
  const ink = freeze(longCubicInputFixture()),
    geometry = cubicInkGeometry(ink);
  expect(ink.capture!.raw).toHaveLength(20001);
  expect(ink.capture!.raw.at(-1)![6]).toBe(20001);
  expect(ink.segments).toHaveLength(20000);
  expect(geometry.commands.length).toBeGreaterThan(100000);
  expect(geometry.commands.length).toBeLessThanOrEqual(CUBIC_INK_MAX_COMMANDS);
  expect(geometry.chunks).toHaveLength(157);
  expect(
    geometry.chunks.every(
      (c) => c.end - c.start <= 128 && c.commands.length <= 100000,
    ),
  ).toBe(true);
  expect(geometry.statistics.commands).toBe(geometry.commands.length);
  expect(cubicInkChunks(ink)).toBe(geometry.chunks);
  expect(portableInkGeometry(ink).path).toBe(geometry.path);
  expect(
    cubicInkHit(ink, { x: 200, y: 100 + Math.sin(100 / 80) * 20 }).inside,
  ).toBe(true);
  const external = cubicInkHit(ink, { x: -100, y: 100 });
  expect(external.inside).toBe(false);
  expect(
    Math.abs(external.distance - (100 - ink.segments[0].radius[0])),
  ).toBeLessThan(0.0025);
  const query = cubicInkQueryGeometry(ink);
  expect(query.polygons.length).toBe(geometry.statistics.contours);
  expect(query.polygons.reduce((n, p) => n + p.length, 0)).toBeLessThanOrEqual(
    1000000,
  );
});
it("keeps transformed cross-block joins as the same nonzero union and distance, including reflection", () => {
  const ink = source(129);
  ink.transform = [-1, 0.25, 0.3, 1, 1400, 10];
  const geometry = cubicInkGeometry(ink),
    kernel = new CompiledInkStroke(),
    point = { x: 1400 - 1280 + 0.3 * 20, y: 10 + 0.25 * 1280 + 20 };
  const expected = geometry.chunks.map((c) =>
    kernel.pathHit(
      c.commands,
      point,
      ink.transform,
      ink.outlineTolerance * 0.25,
    ),
  );
  expect(expected.some((h) => h.inside)).toBe(true);
  expect(cubicInkHit(ink, point).inside).toBe(true);
  const outside = { x: -200, y: -200 },
    parts = geometry.chunks.map((c) =>
      kernel.pathHit(
        c.commands,
        outside,
        ink.transform,
        ink.outlineTolerance * 0.25,
      ),
    ),
    hit = cubicInkHit(ink, outside);
  expect(hit.inside).toBe(parts.some((p) => p.inside));
  expect(hit.distance).toBe(Math.min(...parts.map((p) => p.distance)));
  const box = cubicInkBounds(ink);
  for (const chunk of geometry.chunks) {
    expect(chunk.bounds.x).toBeGreaterThanOrEqual(box.x);
    expect(chunk.bounds.y).toBeGreaterThanOrEqual(box.y);
    expect(chunk.bounds.x + chunk.bounds.width).toBeLessThanOrEqual(
      box.x + box.width + 1e-10,
    );
  }
  const markup = renderToStaticMarkup(
    createElement(
      "svg",
      null,
      createElement(PortableInkPaths, { ink, color: "#ff0000" }),
    ),
  );
  expect(markup.match(/<path /g)).toHaveLength(2);
  expect(markup.match(/opacity="0.35"/g)).toHaveLength(2);
  expect(markup).not.toContain("<image");
});
it("rejects real whole-stroke and per-block exhaustion atomically without resetting caps or degrading the source", () => {
  const previous = freeze(source(1)),
    cached = cubicInkGeometry(previous),
    ink = source(1);
  ink.extent = [1e6, 100];
  ink.segments = Array.from({ length: 60000 }, (_, i) => ({
    points: [[(i % 30000) * 20, Math.floor(i / 30000) * 20]],
    radius: [1, 1],
  }));
  expect(validatePortableInk(ink)).toBe(ink);
  expect(() => cubicInkGeometry(ink)).toThrow(/kernel|budget/);
  expect(ink.segments).toHaveLength(60000);
  expect(cubicInkGeometry(previous)).toBe(cached);
  const huge = source(128);
  huge.outlineTolerance = 1e-6;
  huge.segments = Array.from({ length: 128 }, (_, i) => ({
    points: [[i * 20000, 20]],
    radius: [10000, 10000],
  }));
  huge.segments.forEach((s, i) => {
    s.points[0][0] = (i % 40) * 20000;
  });
  huge.extent = [1e6, 40000];
  expect(validatePortableInk(huge)).toBe(huge);
  expect(() => cubicInkGeometry(huge)).toThrow(/kernel|budget/);
});
it("never treats mutable, shallow-frozen or accessor sources as an immutable cache proof", () => {
  const ink = source(129),
    first = cubicInkGeometry(ink);
  ink.segments[128].radius = [5, 5];
  expect(cubicInkGeometry(ink).path).not.toBe(first.path);
  Object.freeze(ink);
  const second = cubicInkGeometry(ink);
  ink.segments[0].points[0][1] = 25;
  expect(cubicInkGeometry(ink).path).not.toBe(second.path);
  const holder = source(1);
  let current = freeze(holder.segments);
  const accessor = { ...holder };
  Object.defineProperty(accessor, "segments", {
    enumerable: true,
    get: () => current,
  });
  Object.freeze(accessor);
  const old = cubicInkGeometry(accessor).path;
  current = freeze([
    {
      points: [
        [0, 20],
        [100, 20],
      ] as [number, number][],
      radius: [3, 3] as [number, number],
    },
  ]);
  expect(cubicInkGeometry(accessor).path).not.toBe(old);
  const inherited = source(1),
    prototype = {
      points: [
        [0, 20],
        [10, 20],
      ],
      radius: [3, 3],
    };
  inherited.segments = [Object.freeze(Object.create(prototype))];
  freeze(inherited);
  const inheritedBefore = cubicInkGeometry(inherited).path;
  prototype.points = [
    [0, 20],
    [100, 20],
  ];
  expect(cubicInkGeometry(inherited).path).not.toBe(inheritedBefore);
  const fixed = freeze(source(1));
  cubicInkGeometry(fixed);
  expect(() => cubicInkGeometry(fixed, "4" as any, true)).toThrow(/style/);
  expect(() => cubicInkGeometry(fixed, 4, 1 as any)).toThrow(/style/);
});
it("bounds retained derived entries while leaving exact old callers and zero-radius coverage intact", () => {
  const first = freeze(source(1)),
    prior = cubicInkGeometry(first);
  for (let i = 0; i < 130; i++) {
    const ink = source(1);
    ink.transform[4] = i + 1;
    cubicInkGeometry(freeze(ink));
  }
  expect(cubicInkGeometry(first)).not.toBe(prior);
  expect(cubicInkGeometry(first).path).toBe(prior.path);
  const empty = source(257);
  empty.segments = empty.segments.map((s) => ({
    ...s,
    points: [s.points[0]],
    radius: [0, 0],
  }));
  expect(cubicInkGeometry(empty).commands).toEqual([]);
  expect(cubicInkBounds(empty)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  expect(portableInkHit(empty, { x: 0, y: 0 }).inside).toBe(false);
});

it("preserves real varying-pressure knots in all fixed partitions and constant-width style resolution", () => {
  const ink = longCubicInputFixture(321, true),
    before = JSON.stringify(ink),
    kernel = new CompiledInkStroke();
  expect(ink.capture!.raw).toHaveLength(321);
  expect(new Set(ink.capture!.raw.map((r) => r[3])).size).toBeGreaterThan(300);
  expect(new Set(ink.segments.flatMap((s) => s.radius)).size).toBeGreaterThan(
    300,
  );
  const geometry = cubicInkGeometry(ink, 10, false);
  for (const chunk of geometry.chunks) {
    const segments = ink.segments.slice(chunk.start, chunk.end),
      resolved = kernel.resolve(segments, {
        sourceWidth: ink.width,
        width: 10,
        pressure: false,
      });
    expect(resolved.every((s) => s.radius[0] === 5 && s.radius[1] === 5)).toBe(
      true,
    );
    expect(chunk.commands).toEqual(
      kernel.build(resolved, { tolerance: ink.outlineTolerance }).commands,
    );
  }
  expect(JSON.stringify(ink)).toBe(before);
});
const browserExecutable =
  process.env.SHOWAI_BROWSER_EXECUTABLE ??
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
it.skipIf(!existsSync(browserExecutable))(
  "paints shared cross-block marker coverage once and applies ancestor clipping in a real browser",
  async () => {
    const ink = source(129),
      geometry = cubicInkGeometry(ink),
      browser = await chromium.launch({
        executablePath: browserExecutable,
        headless: true,
      });
    try {
      const page = await browser.newPage();
      const result = await page.evaluate(
        async ({ path, opacity }) => {
          const draw = async (clipped: boolean) => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="1200 0 100 40"><defs><clipPath id="ancestor"><rect x="1200" y="0" width="81" height="40"/></clipPath></defs><g${clipped ? ' clip-path="url(#ancestor)"' : ""}><path d="${path}" fill="red" opacity="${opacity}"/></g></svg>`;
            const image = new Image(),
              url = URL.createObjectURL(
                new Blob([svg], { type: "image/svg+xml" }),
              );
            try {
              image.src = url;
              await image.decode();
              const canvas = document.createElement("canvas");
              canvas.width = 100;
              canvas.height = 40;
              const context = canvas.getContext("2d")!;
              context.drawImage(image, 0, 0);
              return [70, 79, 80, 81, 90].map(
                (x) => context.getImageData(x, 20, 1, 1).data[3],
              );
            } finally {
              URL.revokeObjectURL(url);
            }
          };
          return { normal: await draw(false), clipped: await draw(true) };
        },
        { path: geometry.path, opacity: ink.opacity },
      );
      expect(result.normal).toEqual([89, 89, 89, 89, 89]);
      expect(result.clipped).toEqual([89, 89, 89, 0, 0]);
    } finally {
      await browser.close();
    }
  },
  30000,
);

it("retains mixed v1/v2 editable sources through real causal replay, selective undo and FileStore save/reopen", async () => {
  const {
    bootstrapInkOperation,
    createInkOperation,
    materializeInkOperations,
    compensateInkOperation,
  } = await import("./ink-operations.mjs");
  const ink = source(129),
    frame = { x: 0, y: 0, width: 1310, height: 40 };
  const cubic = {
    type: "drawing",
    attrs: {
      id: "curve",
      tool: "highlighter",
      color: "#111111",
      strokeWidth: 4,
      extent: ink.extent,
      points: [
        { x: 0, y: 20 },
        { x: 1290, y: 20 },
      ],
      ink,
    },
  };
  const legacy = {
    type: "drawing",
    attrs: {
      id: "legacy",
      tool: "pen",
      color: "#111111",
      strokeWidth: 4,
      extent: [40, 40],
      points: [
        { x: 1, y: 2 },
        { x: 30, y: 20 },
      ],
      ink: createPortableInk(
        [
          { x: 1, y: 2 },
          { x: 30, y: 20 },
        ],
        4,
        [40, 40],
      ),
    },
  };
  const seed = bootstrapInkOperation({
    actor: "seed",
    pageId: "page",
    boardId: "board",
    nodes: [cubic, legacy],
    layout: { curve: frame, legacy: { ...frame, width: 40 } },
  })!;
  const local = createInkOperation({
    actor: "ipad",
    sequence: 1,
    pageId: "page",
    boardId: "board",
    parents: [seed.id],
    changes: [
      {
        kind: "edit",
        strokeId: "curve",
        patch: { strokeWidth: 8, pressure: false },
      },
    ],
  });
  const remote = createInkOperation({
    actor: "windows",
    sequence: 1,
    pageId: "page",
    boardId: "board",
    parents: [seed.id],
    changes: [{ kind: "edit", strokeId: "curve", patch: { color: "#ff0000" } }],
  });
  const ordered = [seed, local, remote],
    initial = materializeInkOperations(ordered);
  expect(materializeInkOperations([remote, seed, local])).toEqual(initial);
  const undo = compensateInkOperation(ordered, local.id, {
      actor: "ipad",
      sequence: 2,
    }),
    restored = materializeInkOperations([...ordered, undo.operation!]);
  expect(restored.strokes[0].node.attrs).toMatchObject({
    color: "#ff0000",
    strokeWidth: 4,
  });
  expect(restored.strokes[0].node.attrs!.ink).toEqual(ink);
  expect(restored.strokes[1].node.attrs!.ink.format).toBe("showai-ink-v1");
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { FileStore } = await import("../core/store"),
    { addNode } = await import("./editing");
  const root = await mkdtemp(join(tmpdir(), "cubic-chunk-source-"));
  try {
    const store = new FileStore(root),
      project = await store.createProject({ name: "Mixed editable sources" }),
      page = await store.createPage(project.id, { kind: "board" });
    let document = page.document;
    for (const stroke of restored.strokes)
      document = addNode(
        document,
        stroke.node,
        stroke.layout,
        document.content.attrs!.id,
      ) as typeof document;
    const saved = await store.savePage(
        project.id,
        document.id,
        document,
        page.hash,
        page.revision,
      ),
      reopened = await new FileStore(root).readPage(project.id, document.id);
    expect(reopened.document).toEqual(saved.document);
    const nodes = reopened.document.content.content!;
    expect(nodes.find((n) => n.attrs?.id === "curve")!.attrs!.ink).toEqual(ink);
    expect(nodes.find((n) => n.attrs?.id === "legacy")!.attrs!.ink).toEqual(
      legacy.attrs.ink,
    );
    expect(
      Object.keys(nodes.find((n) => n.attrs?.id === "curve")!.attrs!.ink),
    ).not.toContain("chunks");
    expect(
      cubicInkGeometry(nodes.find((n) => n.attrs?.id === "curve")!.attrs!.ink)
        .chunks,
    ).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
