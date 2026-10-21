import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortableInkPaths } from "./PortableInkPaths";
import { CompiledInkInput } from "./ink-kernel/compiled-ink-input.mjs";
import { CompiledInkStroke } from "./ink-kernel/ink-stroke-kernel.mjs";
import {
  validatePortableInk,
  portableInkGeometry,
  portableInkBounds,
  portableInkHit,
  portableNodeFragments,
  cubicInkFromInput,
  createPortableInk,
} from "./portable-ink.mjs";
import { validatePortableInk as legacyValidate } from "./ink-kernel/reference-ink-v1.mjs";
import {
  validateInkInput,
  validateInkFragments,
} from "./ink-input-contract.mjs";
import { shapeHit, shapeIntersectsPolygon } from "./drawing-geometry.mjs";
import { validateCubicInk } from "./portable-ink-v2.mjs";
import type { PortableInkV2 } from "./portable-ink.mjs";
import { validateDocument } from "../portable/validation.mjs";
import type { ShowDocument } from "../types";
import { blankDocument } from "../core/catalog";
import { createResource } from "./containers.mjs";
import { addNode } from "./editing";
export function curve(): PortableInkV2 {
  return {
    format: "showai-ink-v2",
    geometryVersion: 1,
    brushVersion: 1,
    brush: "pen",
    strokeCount: 1,
    width: 4,
    opacity: 0.35,
    extent: [100, 100],
    transform: [1, 0, 0, 1, 0, 0],
    outlineTolerance: 0.0025,
    segments: [
      {
        points: [
          [10, 20],
          [30, 0],
          [60, 70],
          [80, 20],
        ],
        radius: [2, 3],
      },
    ],
  };
}
const drawing = (ink = curve()) => ({
  type: "drawing",
  attrs: {
    id: "curve",
    tool: "pen",
    color: "#111111",
    strokeWidth: 4,
    extent: [100, 100],
    points: [
      { x: 10, y: 20 },
      { x: 80, y: 20 },
    ],
    ink,
  },
});
it("has one closed editable center/radius authority; unsupported brushes, predictions and derived geometry reject", () => {
  const ink = curve();
  expect(validatePortableInk(ink)).toBe(ink);
});
it("validates optional actual capture, excludes predictions and preserves every actual pressure knot", () => {
  const input = new CompiledInkInput({
    width: 4,
    mode: 1,
    positionWindow: 0,
    jitterWindow: 0,
  });
  input.push(
    [
      { id: 1, x: 10, y: 20, time: 0, force: 0.1 },
      { id: 2, x: 30, y: 30, time: 0.01, force: 1 },
      { id: 3, x: 50, y: 20, time: 0.02, force: 0.3 },
    ],
    [{ id: 4, x: 200, y: 200, time: 0.03, force: 1 }],
  );
  expect(() =>
    cubicInkFromInput(input, { sourceID: "capture", extent: [100, 100] }),
  ).toThrow(/Finish/);
  input.finish();
  const ink = cubicInkFromInput(input, {
    sourceID: "source:é",
    extent: [100, 100],
    origin: { x: 5, y: 10 },
  });
  expect(ink.capture!.raw.map((p) => p[6])).toEqual([1, 2, 3]);
  expect(ink.segments).toHaveLength(2);
  expect(ink.segments[0].radius).toEqual(input.strokeSegments()[0].radius);
  expect(ink.segments[0].points[0]).toEqual([5, 10]);
  expect(ink.outlineTolerance).toBe(0.0025);
  expect(validateCubicInk(ink)).toBe(ink);
  const bad = structuredClone(ink);
  bad.capture!.raw[1][6] = 1;
  expect(() => validateCubicInk(bad)).toThrow(/identity/);
  const without = cubicInkFromInput(input, {
    sourceID: "ignored",
    extent: [100, 100],
    capture: false,
  });
  expect(without.capture).toBeUndefined();
});
it("rejects unknown fields at every geometry/capture boundary and forbids legacy companion sources at node level", () => {
  for (const change of [
    (i: any) => (i.samples = []),
    (i: any) => (i.mask = []),
    (i: any) => (i.brush = "pencil"),
    (i: any) => (i.segments[0].predicted = true),
    (i: any) => (i.segments[0].radius = [-1, 1]),
    (i: any) => (i.segments[0].points[0] = [NaN, 0]),
    (i: any) => {
      i.segments[0].points = [[0, 0]];
      i.segments[0].radius = [1, 2];
    },
    (i: any) => (i.transform = [1, 0, 0, 0, 0, 0]),
  ]) {
    const ink = curve();
    change(ink);
    expect(() => validateCubicInk(ink)).toThrow();
  }
  expect(() => legacyValidate(curve())).toThrow();
  expect(() => validateInkInput({}, curve())).toThrow();
  expect(() => validateInkFragments(curve(), [])).toThrow();
  expect(() =>
    portableNodeFragments({
      ...drawing(),
      attrs: { ...drawing().attrs, inkFragments: [] },
    }),
  ).toThrow();
  let doc = createResource(blankDocument(), "board") as ShowDocument;
  doc = addNode(
    doc,
    drawing(),
    { x: 0, y: 0, width: 100, height: 100 },
    doc.content.attrs!.id,
  ) as ShowDocument;
  expect(() => validateDocument(doc)).not.toThrow();
  for (const field of ["inkFragments", "inkInput"]) {
    const bad = structuredClone(doc);
    bad.content.content![0].attrs![field] = field === "inkFragments" ? [] : {};
    expect(() => validateDocument(bad)).toThrow();
  }
});
it("renders shared cubic vector coverage once per theme and keeps v1 interpretation unchanged", () => {
  const ink = curve(),
    markup = renderToStaticMarkup(
      createElement(
        "svg",
        null,
        createElement(PortableInkPaths, { ink, color: "#112233" }),
      ),
    );
  expect(markup).toContain('data-portable-ink="2"');
  expect(markup).toContain("C ");
  expect(markup).not.toContain("<image");
  expect(markup.match(/opacity="0.35"/g)).toHaveLength(2);
  const v1 = createPortableInk(
    [
      { x: 1, y: 2 },
      { x: 10, y: 12 },
    ],
    2,
    [30, 30],
  );
  expect(v1.format).toBe("showai-ink-v1");
  expect(legacyValidate(v1)).toBe(v1);
  expect(portableInkGeometry(v1)).toEqual(
    portableInkGeometry(structuredClone(v1)),
  );
});
it("uses same C++ style resolution for width and pressure without altering source knots", () => {
  const ink = curve(),
    kernel = new CompiledInkStroke(),
    original = structuredClone(ink);
  expect(
    kernel.resolve(ink.segments, {
      sourceWidth: 4,
      width: 8,
      pressure: true,
    })[0].radius,
  ).toEqual([4, 6]);
  expect(
    kernel.resolve(ink.segments, {
      sourceWidth: 4,
      width: 8,
      pressure: false,
    })[0].radius,
  ).toEqual([4, 4]);
  expect(ink).toEqual(original);
  expect(() =>
    kernel.resolve(ink.segments, { sourceWidth: 0, width: 8, pressure: false }),
  ).toThrow();
});
it("queries actual filled cubic bounds, transforms and lasso rather than the endpoint chord", () => {
  const ink = curve(),
    bounds = portableInkBounds(ink);
  expect(bounds.height).toBeGreaterThan(20);
  expect(portableInkHit(ink, { x: 10, y: 20 }).inside).toBe(true);
  const node = drawing(ink),
    frame = { x: 0, y: 0, width: 100, height: 100 };
  expect(shapeHit(node, frame, { x: 10, y: 20 })).toBeTruthy();
  expect(
    shapeIntersectsPolygon(node, frame, [
      { x: 8, y: 18 },
      { x: 12, y: 18 },
      { x: 12, y: 22 },
      { x: 8, y: 22 },
    ]),
  ).toBe(true);
  const old = portableInkGeometry(ink).path;
  ink.segments[0].points[0][0] = 30;
  expect(portableInkGeometry(ink).path).not.toBe(old);
  ink.transform = [2, 0, 0, 3, 5, 7];
  expect(portableInkHit(ink, { x: 65, y: 67 }).inside).toBe(true);
});

import { build } from "esbuild";
import { runInNewContext } from "node:vm";
it("validates mixed document sources in an actual isolated JS runtime with WebAssembly unavailable", async () => {
  const bundle = await build({
      entryPoints: ["src/surface/portable-ink.mjs"],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "Portable",
      platform: "neutral",
    }),
    context = runInNewContext(bundle.outputFiles[0].text + ";Portable", {
      WebAssembly: undefined,
    });
  expect(context.validatePortableInk(curve()).segments).toEqual(
    curve().segments,
  );
  expect(() =>
    context.validatePortableInk({ ...curve(), samples: [] }),
  ).toThrow();
});
it("keeps closed disjoint curve coverage and frozen caches exact without turning the space between elements into paint", () => {
  const ink = curve();
  ink.segments = [
    { points: [[10, 20]], radius: [2, 2] },
    { points: [[80, 20]], radius: [2, 2] },
  ];
  const freeze = (v: any): any => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  };
  freeze(ink);
  expect(portableInkHit(ink, { x: 45, y: 20 }).inside).toBe(false);
  const first = portableInkGeometry(ink),
    second = portableInkGeometry(ink);
  expect(second.path).toBe(first.path);
  expect(
    shapeIntersectsPolygon(
      drawing(ink),
      { x: 0, y: 0, width: 100, height: 100 },
      [
        { x: 40, y: 18 },
        { x: 50, y: 18 },
        { x: 50, y: 22 },
        { x: 40, y: 22 },
      ],
    ),
  ).toBe(false);
});
it("does not treat a shallow frozen source as immutable geometry proof", () => {
  const ink = curve();
  Object.freeze(ink);
  const before = portableInkGeometry(ink).path;
  ink.segments[0].points[1][1] = 60;
  expect(portableInkGeometry(ink).path).not.toBe(before);
});
