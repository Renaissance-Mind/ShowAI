import { expect, it } from "vitest";
import {
  captureOwnedJSON,
  parseOwnedJSON,
  freezeOwnedJSON,
  capturedContentSummary,
  ownedJSONMetrics,
  shareCapturedJSON,
} from "./owned-json.mjs";
import {
  measureContent,
  contentMeasurementDepth,
  utf8Bytes,
} from "./capacity.mjs";
import { longCubicInputFixture } from "../surface/cubic-ink-chunks.fixture.mjs";
import { parseArtifactConsumingForSourceSnapshot } from "./validation.mjs";
import { createResource } from "../surface/containers.mjs";
import { blankDocument } from "../core/catalog";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function compare<T>(value: T) {
  const captured = captureOwnedJSON(value),
    actual = measureContent(captured),
    independent = measureContent(plain(value));
  expect(actual).toEqual(independent);
  expect(contentMeasurementDepth(actual)).toBe(
    contentMeasurementDepth(independent),
  );
  expect(actual.jsonBytes).toBe(utf8Bytes(JSON.stringify(value)));
  expect(actual.prettyJsonBytes).toBe(
    utf8Bytes(JSON.stringify(value, null, 2)),
  );
  return captured;
}
it("matches independent full traversal and actual JSON bytes for nested arrays, Unicode, literal keys and numeric values", () => {
  const cases = [
    {},
    [],
    { array: [] },
    [{}, [], null, true, false, 0, -0, 1.25, 1e-7, 1e21],
    JSON.parse(
      '{"__proto__":{"safe":true},"constructor":1,"é":"NFC","é":"NFD"}',
    ),
    {
      a: [1, { b: ["\ud800", "é", "é", "\n\t\u0001", '\\"', [null, {}]] }],
      value: { empty: {} },
    },
  ];
  let state = 7391;
  for (let i = 0; i < 120; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    cases.push({
      root: [
        state,
        state / 3,
        {
          a: "x".repeat(state % 67),
          b: [state % 2 === 0, null, { c: state / 1e9 }],
        },
      ],
    } as any);
  }
  for (const value of cases) compare(value);
});
it("deduplicates exact resource URLs across independent and shared branches and preserves malformed URLs as ordinary strings", () => {
  const uri = "data:image/png;base64,AQ==",
    other = "data:application/octet-stream;base64,AQ==",
    empty = "data:image/png;base64,";
  const old = captureOwnedJSON({
    one: { uri },
    two: [uri, other, empty],
    code: `const image='${uri}'`,
    bad: [
      "data:image/png;base64,AB==",
      "data:image/png;base64,AQ=",
      "data:中文;base64,AQ==",
    ],
  });
  const next = compare({ ...old, three: [old.one, old.two, { uri }] });
  const actual = measureContent(next);
  expect(actual.resourceCount).toBe(3);
  expect(actual.resourceBytes).toBe(2);
  expect(capturedContentSummary(next.one)).toBe(
    capturedContentSummary(old.one),
  );
  const summary = capturedContentSummary(next)!;
  expect(Object.isFrozen(summary)).toBe(true);
  expect(Object.isFrozen(summary.resources)).toBe(true);
  expect(() => {
    (summary as any).structureBytes = 0;
  }).toThrow();
});
it("measures only the actual independently captured accessor result and never grants summaries by caller freezing", () => {
  let reads = 0,
    size = 9;
  const caller = {
    get payload() {
      reads++;
      return { value: "x".repeat(size) };
    },
  };
  freezeOwnedJSON(caller);
  const captured = captureOwnedJSON(caller),
    before = reads;
  size = 900;
  expect(capturedContentSummary(caller)).toBeUndefined();
  expect(capturedContentSummary(captured)).toBeDefined();
  for (let i = 0; i < 25; i++)
    expect(measureContent(captured)).toEqual(
      measureContent({ payload: { value: "x".repeat(9) } }),
    );
  expect(reads).toBe(before);
  expect(measureContent(caller).jsonBytes).toBeGreaterThan(
    measureContent(captured).jsonBytes,
  );
});
it("checks absolute depth when an actual sealed subtree is embedded below a new root", () => {
  let value: any = "leaf";
  for (let i = 0; i < 64; i++) value = { child: value };
  const held = compare(value);
  expect(contentMeasurementDepth(measureContent(held))).toBe(64);
  const tooDeep = captureOwnedJSON({ newRoot: held });
  expect(capturedContentSummary(tooDeep)!.maximumDepth).toBe(65);
  expect(() => measureContent(tooDeep)).toThrow(/deep/);
  expect(() => measureContent(plain(tooDeep))).toThrow(/deep/);
});
it("keeps resource identities exact through independent parse and COW reparents rather than trusting object equality", () => {
  const source = {
      branch: [
        { src: "data:image/png;base64,AQ==" },
        { src: "data:image/png;base64,Ag==" },
      ],
      extra: { saved: true },
    },
    first = parseOwnedJSON(JSON.stringify(source)) as typeof source;
  const updated = parseOwnedJSON(
    JSON.stringify({ ...source, extra: { saved: false } }),
    first,
  ) as typeof source;
  expect(updated.branch).toBe(first.branch);
  expect(capturedContentSummary(updated.branch)).toBe(
    capturedContentSummary(first.branch),
  );
  compare({
    incoming: updated,
    old: first,
    repeated: [updated.branch, first.branch],
  });
});
it("retains summaries for a real long editable C++ capture and accounts their graph bookkeeping", () => {
  const ink = longCubicInputFixture(20001),
    held = compare({ ink, metadata: { revision: 1 } }),
    summary = capturedContentSummary(held.ink.capture!.raw)!;
  expect(held.ink.capture!.raw).toHaveLength(20001);
  expect(summary.resources).toBeNull();
  const next = captureOwnedJSON({ ...held, metadata: { revision: 2 } });
  expect(next.ink).toBe(held.ink);
  expect(capturedContentSummary(next.ink.capture!.raw)).toBe(summary);
  expect(measureContent(next)).toEqual(measureContent(plain(next)));
  const generic = freezeOwnedJSON({ x: 1 }),
    captured = captureOwnedJSON({ x: 1 });
  expect(ownedJSONMetrics(captured)!.bytes).toBeGreaterThan(
    ownedJSONMetrics(generic)!.bytes,
  );
});
it("does not turn content measurements into model or normalized-source authority", () => {
  const page = createResource(blankDocument(), "board");
  page.content.content = [
    {
      type: "drawing",
      attrs: {
        id: "invalid",
        tool: "pen",
        color: "#111111",
        strokeWidth: 4,
        extent: [40, 30],
        points: [{ x: 1, y: 2 }],
        ink: { ...longCubicInputFixture(3), geometryVersion: 2 },
      },
    },
  ];
  const captured = captureOwnedJSON({
    format: "showai",
    version: 3,
    document: page,
  });
  expect(measureContent(captured).jsonBytes).toBeGreaterThan(0);
  expect(() => parseArtifactConsumingForSourceSnapshot(captured)).toThrow(
    /ink|version|Unsupported/,
  );
});
it("shares actual immutable node leaves across reordering while preserving all target fields", () => {
  const first = captureOwnedJSON({
    nodes: [
      {
        attrs: { id: "a" },
        raw: [
          [1, 2],
          [3, 4],
        ],
        unknown: { é: 1, é: 2 },
      },
      { attrs: { id: "b" }, value: 7 },
    ],
    futureRoot: { keep: true },
  });
  const target = plain({
    nodes: [{ ...first.nodes[1], value: 8 }, first.nodes[0]],
    futureRoot: { keep: true },
    added: { all: [false, null] },
  });
  const shared = shareCapturedJSON(first, target);
  expect(shared).toEqual(target);
  expect(shared.nodes[1]).toBe(first.nodes[0]);
  expect(shared.futureRoot).toBe(first.futureRoot);
  target.nodes[1].raw[0][0] = 90;
  expect(shared.nodes[1].raw[0][0]).toBe(1);
  expect(measureContent(shared)).toEqual(measureContent(plain(shared)));
});
it("captures accessor baselines before exact sharing and cannot lend proof to later caller mutations", () => {
  const canonical = captureOwnedJSON({
    data: { values: [1, 2, 3] },
    metadata: { valid: true },
  });
  let value = { values: [1, 2, 3] };
  const outside = {
    get data() {
      return value;
    },
    metadata: { valid: true },
  };
  freezeOwnedJSON(outside);
  const result = shareCapturedJSON(outside, canonical);
  value = { values: [9, 9, 9] };
  expect(result).toEqual(canonical);
  expect(result.data.values).toEqual([1, 2, 3]);
  expect(capturedContentSummary(result)).toBeDefined();
  expect(measureContent(result)).toEqual(measureContent(plain(canonical)));
});
it("cannot borrow an inherited prototype branch into an actual captured target", () => {
  const before = captureOwnedJSON({}),
    target = captureOwnedJSON(
      JSON.parse('{"__proto__":{"__sourceSummaryProtoRead":1}}'),
    );
  let reads = 0,
    result: unknown;
  try {
    Object.defineProperty(Object.prototype, "__sourceSummaryProtoRead", {
      configurable: true,
      enumerable: true,
      get() {
        return ++reads <= 2 ? 1 : "x".repeat(1024);
      },
    });
    result = shareCapturedJSON(before, target);
  } finally {
    delete (Object.prototype as any).__sourceSummaryProtoRead;
  }
  expect(reads).toBe(0);
  expect(result).toBe(target);
  expect(result).toEqual(target);
  expect(measureContent(result)).toEqual(measureContent(plain(target)));
});
it("does not use inherited attrs or id getters as array source identities", () => {
  const before = captureOwnedJSON({ nodes: [{ value: 1 }] }),
    target = captureOwnedJSON({ nodes: [{ value: 2 }, { value: 1 }] }),
    calls: string[] = [];
  let result: unknown;
  try {
    Object.defineProperty(Object.prototype, "attrs", {
      configurable: true,
      get() {
        calls.push("attrs");
        return { id: "borrowed" };
      },
    });
    Object.defineProperty(Object.prototype, "id", {
      configurable: true,
      get() {
        calls.push("id");
        return "borrowed";
      },
    });
    result = shareCapturedJSON(before, target);
  } finally {
    delete (Object.prototype as any).attrs;
    delete (Object.prototype as any).id;
  }
  expect(calls).toEqual([]);
  expect(result).toEqual(target);
  expect(measureContent(result)).toEqual(measureContent(plain(target)));
});
it("charges newly retained resource leaves and indices without charging a borrowed child index again", () => {
  const uri = "data:image/png;base64,AQ==",
    held = captureOwnedJSON({ resources: Array(10000).fill(uri) }),
    index = capturedContentSummary(held.resources)!;
  expect(index.bookkeepingBytes).toBeGreaterThan(10000 * 40);
  const parent = captureOwnedJSON({ a: held.resources, b: held.resources }),
    summary = capturedContentSummary(parent)!;
  expect(summary.bookkeepingBytes).toBeLessThan(1024);
  expect(ownedJSONMetrics(parent)!.bytes).toBeLessThan(
    ownedJSONMetrics(held.resources)!.bytes,
  );
  expect(measureContent(parent).resourceCount).toBe(1);
  expect(measureContent(parent)).toEqual(measureContent(plain(parent)));
});
