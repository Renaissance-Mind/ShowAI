import { describe, it, expect } from "vitest";
import {
  PortableCubicInputOwner,
  type CubicInputOptions,
  type CubicPaintChunk,
} from "./portable-cubic-worker-model";
import { CompiledInkInput } from "./ink-kernel/compiled-ink-input.mjs";
import {
  cubicInkFromInput,
  cubicInkGeometry,
  cubicInkHit,
} from "./cubic-ink-core.mjs";
import { validateCubicInk } from "./portable-ink-v2.mjs";
import { PortablePointerInput } from "./portable-pointer-input";
const options: CubicInputOptions = {
  strokeId: "actual-stroke",
  pageId: "page",
  boardId: "board",
  tool: "pen",
  color: "#123456",
  width: 3,
  pressure: true,
  creationZoom: 1.5,
  origin: { x: 120, y: -15 },
  name: "Writing",
};
const point = (id: number) => ({
  id,
  x: id * 0.5,
  y: Math.sin(id / 17) * 4,
  time: id / 120,
  force: 0.1 + (id % 13) / 14,
  azimuth: 0.3,
  altitude: 0.8,
});

describe("actual portable cubic author kernel", () => {
  it("retains every actual raw sensor knot and matches the independent same C++ export after sealing", () => {
    const owner = new PortableCubicInputOwner(),
      input = new CompiledInkInput({ width: 3, creationZoom: 1.5, mode: 1 });
    const batches = Array.from({ length: 11 }, (_, batch) => ({
      actual: Array.from({ length: 29 }, (_, i) => point(batch * 29 + i + 1)),
      predicted: [],
    }));
    const display: CubicPaintChunk[] = [];
    const install = (value: ReturnType<typeof owner.execute>) => {
      if (value.paint) {
        display.length = value.paint.firstChunk;
        display.push(...value.paint.chunks);
        expect(display.length).toBe(value.paint.chunkCount);
      }
    };
    input.push(batches[0].actual);
    install(owner.execute({ kind: "begin", options, batch: batches[0] }));
    for (const batch of batches.slice(1)) {
      input.push(batch.actual);
      install(
        owner.execute({
          kind: "push",
          strokeId: options.strokeId,
          batches: [batch],
        }),
      );
    }
    input.finish();
    const response = owner.execute({
      kind: "seal",
      strokeId: options.strokeId,
      batches: [],
    });
    install(response);
    const sealed = response.sealed!;
    validateCubicInk(sealed.source);
    const independent = cubicInkFromInput(input, {
      sourceID: options.strokeId,
      extent: sealed.source.extent,
      brush: "pen",
      capture: true,
    });
    independent.transform = sealed.source.transform;
    expect(sealed.source).toEqual(independent);
    expect(sealed.source.capture!.raw).toHaveLength(319);
    const full = cubicInkGeometry(sealed.source, 3, true);
    expect(sealed.geometry.commands).toEqual(full.commands);
    expect(
      sealed.geometry.chunks.map(({ path, ...chunk }) => {
        void path;
        return chunk;
      }),
    ).toEqual(full.chunks);
    expect(sealed.geometry.statistics).toEqual(full.statistics);
    expect(sealed.geometry.bounds).toEqual(full.bounds);
    expect(sealed.geometry.path).toEqual(full.path);
    expect(sealed.frame.x + sealed.source.transform[4]).toBeCloseTo(
      options.origin.x,
      12,
    );
    expect(sealed.frame.y + sealed.source.transform[5]).toBeCloseTo(
      options.origin.y,
      12,
    );
    const probe = {
      x: point(60).x + sealed.source.transform[4],
      y: point(60).y + sealed.source.transform[5],
    };
    expect(cubicInkHit(sealed.source, probe, 3, true).inside).toBe(true);
  });
  it("replaces predicted suffix and honors an actual early pressure correction", () => {
    const owner = new PortableCubicInputOwner();
    owner.execute({
      kind: "begin",
      options,
      batch: {
        actual: [point(1), point(2)],
        predicted: [
          { ...point(3), id: 0 },
          { ...point(4), id: 0 },
        ],
      },
    });
    owner.execute({
      kind: "push",
      strokeId: options.strokeId,
      batches: [
        {
          actual: [point(3)],
          predicted: [],
          corrections: [{ ...point(1), force: 0.91 }],
        },
      ],
    });
    const sealed = owner.execute({
      kind: "seal",
      strokeId: options.strokeId,
      batches: [],
    }).sealed!;
    expect(sealed.source.capture!.raw).toHaveLength(3);
    expect(sealed.source.capture!.raw[0][3]).toBe(0.91);
    expect(sealed.source.capture!.raw.some((row) => row[6] === 0)).toBe(false);
  });
  it("uses fixed pressure and all received knots without the old 0.7px filtering", () => {
    const owner = new PortableCubicInputOwner();
    const actual = Array.from({ length: 100 }, (_, i) => ({
      ...point(i + 1),
      x: i * 0.01,
      y: 0,
    }));
    owner.execute({
      kind: "begin",
      options: { ...options, pressure: false },
      batch: { actual, predicted: [] },
    });
    const sealed = owner.execute({
      kind: "seal",
      strokeId: options.strokeId,
      batches: [],
    }).sealed!;
    expect(sealed.source.capture!.raw).toHaveLength(100);
    expect(sealed.source.segments).toHaveLength(99);
    expect(
      sealed.source.segments.every(
        (segment) => segment.radius[0] === 1.5 && segment.radius[1] === 1.5,
      ),
    ).toBe(true);
  });
});

it("does not truncate actual writing at 20,000 knots and copies only a bounded changed suffix", () => {
  const owner = new PortableCubicInputOwner(),
    o = { ...options, width: 4, creationZoom: 1 },
    count = 20003;
  const actual = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    x: i * 2,
    y: 100 + Math.sin(i / 80) * 20,
    time: i / 240,
    force: 1.5,
    azimuth: 0.4,
    altitude: 1.2,
  }));
  owner.execute({
    kind: "begin",
    options: o,
    batch: { actual: actual.slice(0, 20001), predicted: [] },
  });
  const suffix = owner.execute({
    kind: "push",
    strokeId: o.strokeId,
    batches: [{ actual: actual.slice(20001), predicted: [] }],
  });
  expect(suffix.paint!.work.copiedSegments).toBeLessThan(256);
  expect(suffix.paint!.firstChunk).toBeGreaterThan(150);
  const value = owner.execute({
    kind: "seal",
    strokeId: o.strokeId,
    batches: [],
  }).sealed!;
  expect(value.source.capture!.raw).toHaveLength(count);
  expect(value.source.segments).toHaveLength(count - 1);
  expect(value.source.capture!.raw.at(-1)![6]).toBe(count);
  expect(value.source).not.toHaveProperty("samples");
  expect(value.geometry.chunks.length).toBe(Math.ceil((count - 1) / 128));
});

it("binds style handles only to actual validated worker sources and rejects missing/stale registry entries", () => {
  const owner = new PortableCubicInputOwner();
  expect(() =>
    owner.execute({
      kind: "prepare",
      sourceHandle: "self-asserted",
      width: 3,
      pressure: true,
    }),
  ).toThrow(/evicted/);
  owner.execute({
    kind: "begin",
    options,
    batch: { actual: [point(1), point(2), point(3)], predicted: [] },
  });
  const sealed = owner.execute({
      kind: "seal",
      strokeId: options.strokeId,
      batches: [],
    }),
    handle = sealed.sourceHandle!;
  const source = sealed.sealed!.source,
    before = JSON.stringify(source);
  const styled = owner.execute({
    kind: "prepare",
    sourceHandle: handle,
    width: 7,
    pressure: false,
  });
  expect(styled.geometry!.path).toBe(cubicInkGeometry(source, 7, false).path);
  expect(styled.sourceHandle).toBe(handle);
  expect(JSON.stringify(source)).toBe(before);
  expect(() =>
    owner.execute({
      kind: "prepare",
      sourceHandle: handle,
      width: NaN,
      pressure: false,
    }),
  ).toThrow(/style/);
  for (let i = 0; i < 129; i++)
    owner.execute({ kind: "prepare", ink: source, width: 3, pressure: true });
  expect(() =>
    owner.execute({
      kind: "prepare",
      sourceHandle: handle,
      width: 3,
      pressure: true,
    }),
  ).toThrow(/evicted/);
});

describe("Pointer Events actual source adapter", () => {
  const sample = (time: number, x: number, pressure = 0.3) => ({
    pointerId: 1,
    pointerType: "pen",
    timeStamp: time,
    clientX: x,
    clientY: 20,
    pressure,
    tiltX: 0,
    tiltY: 0,
  });
  it("uses frozen coordinates, original coalesced order, real time/force and ephemeral forecasts", () => {
    let camera = 2;
    const first = sample(100, 10);
    const adapter = new PortablePointerInput(first, (x, y) => ({
      x: x / camera,
      y: y / camera,
    }));
    const a = adapter.batch(first);
    camera = 4;
    const b = adapter.batch({
      ...sample(110, 13),
      getCoalescedEvents: () => [
        sample(105, 10.01, 0.01),
        sample(110, 12, 0.8),
      ],
      getPredictedEvents: () => [sample(115, 14, 0.7)],
    });
    expect(a.actual[0]).toMatchObject({
      id: 1,
      x: 0,
      y: 0,
      time: 0,
      force: 0.3,
    });
    expect(b.actual.map((p) => p.id)).toEqual([2, 3]);
    expect(b.actual[1]).toMatchObject({ x: 1, time: 0.01, force: 0.8 });
    expect(b.predicted[0]).toMatchObject({ id: 0, x: 2, time: 0.015 });
    const correction = adapter.batch(sample(110, 12, 0.92));
    expect(correction.actual).toHaveLength(0);
    expect(correction.corrections).toHaveLength(1);
    expect(correction.corrections![0]).toMatchObject({
      id: 3,
      x: 1,
      force: 0.92,
    });
  });
  it("preserves zero pen force and every actual point while bounding disposable forecasts", () => {
    const first = sample(1, 10, 0),
      adapter = new PortablePointerInput(first, (x, y) => ({ x, y }));
    expect(adapter.batch(first).actual[0].force).toBe(0);
    const bounded = adapter.batch({
      ...sample(2, 12),
      getPredictedEvents: () =>
        Array.from({ length: 129 }, (_, i) => sample(3 + i, 13 + i)),
    });
    expect(bounded.actual).toHaveLength(1);
    expect(bounded.actual[0].x).toBe(2);
    expect(bounded.predicted).toHaveLength(128);
    expect(bounded.predicted.at(-1)!.id).toBe(0);
  });
});
