import { expect, it } from "vitest";
import { createPortableInk } from "./portable-ink.mjs";
import { normalizeDocument } from "../core/diff";
import { blankDocument } from "../core/catalog";
import { createResource } from "./containers.mjs";
import { addNode } from "./editing";
import { validateInkFragments, validateInkInput } from "./ink-input-contract.mjs";
import type { ShowDocument } from "../types";
const primary = createPortableInk([{ x: 1, y: 2 }, { x: 20, y: 10 }], 2, [40, 30]);
const configuration = { version: 1, mode: 0, width: 2, creationZoom: 1, fitTolerance: 0.2, flattenTolerance: 0.1, positionWindow: 0.01, jitterWindow: 0.01, forceBackward: 0, forceForward: 0, forceTime: 0, minimumFraction: 0.1, maximumFraction: 1, curveBlend: 0.5, estimateTimeout: 0.01 };
const input = () => ({ format: "showai-input-v1", sourceID: "source", configuration, raw: [[1, 2, 0, 0.5, 0, 1.5, 0, 0, 0, 0], [20, 10, 0.01, 0.7, 0, 1.5, 0, 0, 0, 0]], curves: [{ points: [1, 2, 5, 3, 15, 8, 20, 10], firstRaw: 0, lastRaw: 1, steps: 10 }], fragmentCount: 2, compositeOpacity: 1, composite: "single-opacity-coverage" });
it("validates and normalizes raw editable logical fragments without dropping source or provenance", () => {
  const source = input(); expect(() => validateInkInput(source, primary, [primary])).not.toThrow();
  let document = createResource(blankDocument(), "board") as ShowDocument;
  document = addNode(document, { type: "drawing", attrs: { id: "long", tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30], points: [{ x: 1, y: 2 }, { x: 20, y: 10 }], ink: primary, inkFragments: [primary], inkInput: source } }, { x: 10, y: 20, width: 40, height: 30 }, document.content.attrs!.id) as ShowDocument;
  const normalized = normalizeDocument(document), attrs = normalized.content.content![0].attrs!;
  expect(attrs.inkFragments).toEqual([primary]); expect(attrs.inkInput).toEqual(source);
});
it("rejects geometry/opacity seams, missing fragments and invalid raw provenance", () => {
  for (const patch of [{ opacity: 0.5 }, { width: 3 }, { extent: [30, 40] as [number, number] }, { transform: [2, 0, 0, 2, 0, 0] }]) expect(() => validateInkFragments(primary, [{ ...primary, ...patch }])).toThrow();
  expect(() => validateInkInput(input(), primary, [])).toThrow("fragment");
  const source = input(); source.raw[1][2] = -1; expect(() => validateInkInput(source, primary, [primary])).toThrow("actual");
});
