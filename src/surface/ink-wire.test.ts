import { expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { mergePageContent } from "../core/page-merge-model";
import { normalizeDocument } from "../core/diff";
import { createResource, createSurface } from "./containers.mjs";
import { addNode } from "./editing";
import { createPortableInk } from "./portable-ink.mjs";
import { canonicalInkJSON } from "./ink-operations.mjs";
import { resolveInkWireFields, stampInkDocument, validateInkWireState } from "./ink-wire.mjs";
import type { ShowDocument } from "../types";

const frame = { x: 10, y: 20, width: 40, height: 30 };
const stroke = (id: string) => ({ type: "drawing", attrs: { id, tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30], points: [{ x: 1, y: 2 }, { x: 20, y: 12 }], ink: createPortableInk([{ x: 1, y: 2, pressure: 0.5 }, { x: 20, y: 12, pressure: 0.8 }], 2, [40, 30]) } });
function source() {
  let page = createResource(blankDocument(), "board") as ShowDocument;
  page = addNode(page, stroke("stroke"), frame, page.content.attrs!.id) as ShowDocument;
  return stampInkDocument(page, undefined, { actor: "seed", sequence: 1 });
}
function ink(page: ShowDocument, id = "stroke") {
  const find = (node: ShowDocument["content"]): ShowDocument["content"] | undefined => node.attrs?.id === id ? node : node.content?.map(find).find(Boolean);
  return find(page.content)!;
}
function edit(base: ShowDocument, actor: string, change: (page: ShowDocument) => void, sequence = 1) { const next = structuredClone(base); change(next); return stampInkDocument(next, base, { actor, sequence }); }
const state = (page: ShowDocument) => page.content.attrs!.inkState;

it("stores causal references without duplicating unconflicted sample arrays and survives actual normalization", () => {
  const page = source(), normalized = normalizeDocument(page);
  expect(normalized.content.attrs!.inkState).toEqual(state(page));
  expect(canonicalInkJSON(page).match(/"samples"/g)).toHaveLength(1);
  expect(validateInkWireState(state(page)).clock).toEqual({ seed: 1 });
  const invalid = structuredClone(page); invalid.content.attrs!.kind = "page";
  expect(() => normalizeDocument(invalid)).toThrow("Board");
});
it("merges disjoint native/browser fields commutatively without losing raw control points", () => {
  const base = source(), left = edit(base, "ipad", page => { ink(page).attrs!.color = "#ff0000"; });
  const right = edit(base, "browser", page => { page.layout!.stroke.x = 400; });
  const merged = mergePageContent(base, left, right), reversed = mergePageContent(base, right, left);
  expect(merged.conflicts).toEqual([]); expect(reversed.conflicts).toEqual([]);
  expect(merged.document).toEqual(reversed.document);
  expect(ink(merged.document).attrs!.color).toBe("#ff0000");
  expect(merged.document.layout!.stroke.x).toBe(400);
  expect(ink(merged.document).attrs!.ink.samples).toEqual(ink(base).attrs!.ink.samples);
  expect(canonicalInkJSON(merged.document).match(/"samples"/g)).toHaveLength(1);
});
it("keeps concurrent same-field values as explicit variants and idempotently merges them again", () => {
  const base = source(), left = edit(base, "ipad", page => { ink(page).attrs!.color = "#ff0000"; });
  const right = edit(base, "browser", page => { ink(page).attrs!.color = "#0000ff"; });
  const merged = mergePageContent(base, left, right);
  expect(merged.conflicts.some(conflict => conflict.path.endsWith("/color"))).toBe(true);
  expect(Object.values(state(merged.document).strokes.stroke.variants.color)).toContain("#ff0000");
  expect(mergePageContent(base, merged.document, right).document).toEqual(merged.document);
  const resolved = edit(merged.document, "ipad", page => { ink(page).attrs!.color = "#00ff00"; }, 2);
  expect(mergePageContent(merged.document, resolved, right).conflicts).toEqual([]);
});
it("a causally newer write wins even when its old branch arrives after newer snapshots", () => {
  const base = source(), first = edit(base, "ipad", page => { ink(page).attrs!.color = "#ff0000"; });
  const newer = edit(first, "ipad", page => { ink(page).attrs!.color = "#00ff00"; }, 2);
  const merged = mergePageContent(base, newer, first);
  expect(merged.conflicts).toEqual([]);
  expect(ink(merged.document).attrs!.color).toBe("#00ff00");
});
it("unmodified old snapshots cannot resurrect tombstones, including after metadata stripping", () => {
  const base = source(), removed = edit(base, "ipad", page => { page.content.content = []; page.layout = {}; });
  const old = structuredClone(base); delete old.content.attrs!.inkState;
  const merged = mergePageContent(base, removed, old);
  expect(merged.conflicts).toEqual([]);
  expect(merged.document.content.content ?? []).toEqual([]);
  expect(Object.keys(state(merged.document).strokes.stroke.fields)).toEqual(["alive"]);
  expect(canonicalInkJSON(state(merged.document))).not.toContain('"samples"');
});
it("deletion versus an offline transform retains exact geometry only as a real conflict variant", () => {
  const base = source(), removed = edit(base, "ipad", page => { page.content.content = []; page.layout = {}; });
  const moved = edit(base, "browser", page => { page.layout!.stroke.y = 900; });
  const merged = mergePageContent(base, removed, moved);
  expect(merged.conflicts.some(conflict => conflict.path.endsWith("/delete/layout"))).toBe(true);
  expect(merged.document.content.content ?? []).toEqual([]);
  const variants = state(merged.document).strokes.stroke.variants.ink;
  expect(Object.values(variants)).toContainEqual(ink(base).attrs!.ink);
});
it("detects unstamped legacy edits through baseline hashes without assigning device IDs", () => {
  const base = source(), legacy = structuredClone(base); ink(legacy).attrs!.color = "#ff0000";
  delete legacy.content.attrs!.inkState;
  const remote = edit(base, "ipad", page => { page.layout!.stroke.x = 500; });
  const merged = mergePageContent(base, legacy, remote);
  expect(merged.conflicts).toEqual([]);
  expect(ink(merged.document).attrs!.color).toBe("#ff0000");
  expect(Object.keys(state(merged.document).clock).some(actor => actor.startsWith("legacy-"))).toBe(true);
  expect(mergePageContent(base, remote, legacy).document).toEqual(merged.document);
});
it("CAS-authorized local undo restores the source while delayed stale snapshots stay deleted", () => {
  const base = source(), removed = edit(base, "ipad", page => { page.content.content = []; page.layout = {}; });
  const restored = stampInkDocument(base, removed, { actor: "ipad", sequence: 2 });
  const merged = mergePageContent(removed, restored, removed);
  expect(merged.conflicts).toEqual([]);
  expect(ink(merged.document).attrs!.ink.samples).toEqual(ink(base).attrs!.ink.samples);
});
it("preserves stroke z-order anchors around non-ink shapes", () => {
  const base = source(), rootId = base.content.attrs!.id;
  const shape = { type: "drawing", attrs: { id: "shape", tool: "rectangle", points: [{ x: 0, y: 0 }, { x: 30, y: 20 }], extent: [30, 20], color: "#111111", strokeWidth: 2 } };
  let withShape = addNode(base, shape, { x: 100, y: 100, width: 30, height: 20 }, rootId) as ShowDocument;
  withShape = stampInkDocument(withShape, base, { actor: "seed", sequence: 2 });
  const left = edit(withShape, "ipad", page => { ink(page).attrs!.color = "#ff0000"; });
  const right = edit(withShape, "browser", page => { page.layout!.shape.x = 700; });
  const merged = mergePageContent(withShape, left, right);
  expect(merged.conflicts).toEqual([]);
  expect(merged.document.content.content!.map(node => node.attrs!.id)).toEqual(["stroke", "shape"]);
  expect(merged.document.layout!.shape.x).toBe(700);
});
it("keeps nested container placement while merging independent Board objects", () => {
  const base = source(), rootId = base.content.attrs!.id;
  const nested = createSurface("board", "Nested", "nested"); nested.content = [stroke("nested-stroke")];
  let withNested = addNode(base, nested, { x: 100, y: 100, width: 400, height: 300 }, rootId) as ShowDocument;
  withNested.layout!["nested-stroke"] = frame;
  withNested = stampInkDocument(withNested, base, { actor: "seed", sequence: 2 });
  const left = edit(withNested, "ipad", page => { ink(page, "nested-stroke").attrs!.color = "#ff0000"; });
  const right = edit(withNested, "browser", page => { page.layout!.stroke.x = 800; });
  const merged = mergePageContent(withNested, left, right);
  expect(merged.conflicts).toEqual([]);
  expect(ink(merged.document, "nested").content!.map(node => node.attrs!.id)).toEqual(["nested-stroke"]);
  expect(ink(merged.document, "nested-stroke").attrs!.color).toBe("#ff0000");
});
it("explicit resolution stamps the chosen displayed value with a real supplied writer identity", () => {
  const base = source(), left = edit(base, "ipad", page => { ink(page).attrs!.color = "#ff0000"; });
  const right = edit(base, "browser", page => { ink(page).attrs!.color = "#0000ff"; });
  const unresolved = mergePageContent(base, left, right).document;
  const chosen = state(unresolved).strokes.stroke.fields.color[0][1];
  const resolved = resolveInkWireFields(unresolved, [{ boardId: base.content.attrs!.id, strokeId: "stroke", field: "color", hash: chosen }], { actor: "ipad", sequence: 2 });
  expect(state(resolved).strokes.stroke.fields.color).toHaveLength(1);
  expect(state(resolved).strokes.stroke.fields.color[0][0]).toBe("ipad:2");
  expect(mergePageContent(unresolved, resolved, right).conflicts).toEqual([]);
});
it("explicitly keeping a concurrent deletion acknowledges the edited source and compacts the tombstone", () => {
  const base = source(), removed = edit(base, "ipad", page => { page.content.content = []; page.layout = {}; });
  const moved = edit(base, "browser", page => { page.layout!.stroke.y = 900; });
  const unresolved = mergePageContent(base, removed, moved).document;
  const deletion = state(unresolved).strokes.stroke.fields.alive.find(([dot]: string[]) => dot === "ipad:1")[1];
  const resolved = resolveInkWireFields(unresolved, [{ boardId: base.content.attrs!.id, strokeId: "stroke", field: "alive", hash: deletion }], { actor: "ipad", sequence: 2 });
  expect(Object.keys(state(resolved).strokes.stroke.fields)).toEqual(["alive"]);
  expect(mergePageContent(unresolved, resolved, moved).conflicts).toEqual([]);
});
it("placement cycles stay explicit and do not invent a stream of legacy edits on repeated merge", () => {
  let base = source();
  for (const id of ["a", "b", "c"]) base = addNode(base, { type: "drawing", attrs: { id, tool: "rectangle", points: [{ x: 0, y: 0 }, { x: 30, y: 20 }], extent: [30, 20], color: "#111111", strokeWidth: 2 } }, { x: 100, y: 100, width: 30, height: 20 }, base.content.attrs!.id) as ShowDocument;
  const arrange = (page: ShowDocument, ids: string[]) => { const nodes = new Map(page.content.content!.map(node => [node.attrs!.id, node])); page.content.content = ids.map(id => nodes.get(id)!); };
  arrange(base, ["a", "stroke", "b", "c"]); base = stampInkDocument(base, undefined, { actor: "ordered", sequence: 1 });
  const left = edit(base, "aaa", page => arrange(page, ["a", "b", "stroke", "c"]));
  const right = edit(base, "zzz", page => arrange(page, ["a", "stroke", "c", "b"]));
  const merged = mergePageContent(base, left, right);
  expect(merged.conflicts.some(conflict => conflict.reason?.includes("cycle"))).toBe(true);
  expect(ink(merged.document).attrs!.ink.samples).toEqual(ink(base).attrs!.ink.samples);
  const again = mergePageContent(base, merged.document, right);
  expect(Object.keys(state(again.document).clock).filter(actor => actor.startsWith("legacy-"))).toEqual([]);
});
