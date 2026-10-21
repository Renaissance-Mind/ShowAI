import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPortableInk } from "./portable-ink.mjs";
import {
  bootstrapInkOperation, canonicalInkJSON, checkpointInkOperations,
  compensateInkOperation, createInkOperation, inkOperationDigest,
  materializeInkOperations, validateInkCheckpoint, validateInkOperation,
  InkOperationReplica,
  type InkOperation, type InkOperationChange,
} from "./ink-operations.mjs";

const frame = { x: 10, y: 20, width: 40, height: 30 };
const node = (id: string) => ({ type: "drawing", attrs: {
  id, tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30],
  ink: createPortableInk([{ x: 1, y: 2, pressure: 0.5 }, { x: 25, y: 12, pressure: 0.8 }], 2, [40, 30]),
} });
const initial = () => bootstrapInkOperation({ actor: "seed", pageId: "page", boardId: "board", nodes: [node("stroke")], layout: { stroke: frame } })!;
const operation = (actor: string, changes: InkOperationChange[], parents = ["seed:1"], sequence = 1) => createInkOperation({ actor, sequence, pageId: "page", boardId: "board", parents, changes });
const edit = (actor: string, patch: Extract<InkOperationChange, { kind: "edit" }>["patch"], parents?: string[], sequence?: number) => operation(actor, [{ kind: "edit", strokeId: "stroke", patch }], parents, sequence);
function permutations<T>(items: T[]): T[][] { return items.length <= 1 ? [items] : items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest])); }

describe("portable causal ink operations", () => {
  it("prepares only touched registers, publishes after commit, and aborts without changing state", () => {
    const replica = new InkOperationReplica({ pageId: "page", boardId: "board" }); replica.append([initial()]);
    const before = replica.checkpoint(), prepared = replica.prepare([edit("ipad", { color: "#ff0000" })]);
    expect(replica.checkpoint()).toEqual(before);
    expect(prepared.records.map(record => [record.kind, record.field])).toEqual([["known", ""], ["register", "color"]]);
    expect(canonicalInkJSON(prepared)).not.toContain('"samples"');
    replica.abort(prepared.token); expect(replica.checkpoint()).toEqual(before);
    const next = replica.prepare([edit("ipad", { color: "#0000ff" })]); replica.commit(next.token);
    expect(replica.materialize(["stroke"]).strokes[0].node.attrs!.color).toBe("#0000ff");
    expect(() => replica.commit(next.token)).toThrow("unknown prepared");
  });
  it("uses SHA-256 and canonical JSON matching host bytes, including Unicode and numeric boundaries", () => {
    for (const value of ["", "abc", "中文🤔", "\ud800", "x".repeat(100000), { z: 1e-8, a: [1.002e-7, 0, -0, "e\u0301", "é"] }]) {
      const text = typeof value === "string" ? value : canonicalInkJSON(value);
      expect(inkOperationDigest(value)).toBe(createHash("sha256").update(text).digest("hex"));
    }
    expect(() => canonicalInkJSON({ x: undefined })).toThrow("finite JSON");
    expect(() => canonicalInkJSON([NaN])).toThrow("finite JSON");
  });
  it("bootstraps exact editable samples and preserves the original paint order", () => {
    const nodes = [node("z"), node("a")];
    const seed = bootstrapInkOperation({ actor: "seed", pageId: "page", boardId: "board", nodes, layout: { z: frame, a: frame } })!;
    const result = materializeInkOperations([seed]);
    expect(result.strokes.map(stroke => stroke.node)).toEqual(nodes);
    expect(result.strokes[0].node.attrs!.ink.samples).toEqual(nodes[0].attrs.ink.samples);
    expect(result.conflicts).toEqual([]);
    const input = { pageId: "page", boardId: "board", nodes, layout: { z: frame, a: frame } };
    expect(bootstrapInkOperation(input)).toEqual(bootstrapInkOperation(structuredClone(input)));
    expect(bootstrapInkOperation(input)!.actor).toMatch(/^snapshot-/);
    expect(bootstrapInkOperation({ ...input, layout: { ...input.layout, unrelated: frame } })).toEqual(bootstrapInkOperation(input));
  });
  it("merges independent field edits identically in every delivery order", () => {
    const ops = [initial(), edit("ipad", { color: "#ff0000" }), edit("windows", { layout: { ...frame, x: 400 } }), edit("web", { strokeWidth: 12 })];
    const expected = materializeInkOperations(ops);
    for (const shuffled of permutations(ops)) expect(materializeInkOperations(shuffled)).toEqual(expected);
    expect(expected.strokes[0].node.attrs).toMatchObject({ color: "#ff0000", strokeWidth: 12 });
    expect(expected.strokes[0].layout.x).toBe(400);
    expect(expected.conflicts).toEqual([]);
  });
  it("retains divergent same-field candidates and resolves only after observing them", () => {
    const ops = [initial(), edit("ipad", { color: "#ff0000" }), edit("web", { color: "#0000ff" })];
    const conflict = materializeInkOperations(ops);
    expect(conflict.conflicts).toEqual([{ strokeId: "stroke", field: "color", candidates: [
      { operationId: "ipad:1", value: "#ff0000" }, { operationId: "web:1", value: "#0000ff" },
    ] }]);
    const resolved = edit("ipad", { color: "#00ff00" }, conflict.frontier, 2);
    const result = materializeInkOperations([...ops, resolved]);
    expect(result.conflicts).toEqual([]);
    expect(result.strokes[0].node.attrs!.color).toBe("#00ff00");
  });
  it("does not create a conflict when concurrent peers independently choose the same value", () => {
    const result = materializeInkOperations([initial(), edit("ipad", { color: "#ff0000" }), edit("web", { color: "#ff0000" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.strokes[0].heads.color).toEqual(["ipad:1", "web:1"]);
  });
  it("tombstones concurrent/stale edits and only explicit observed restores make strokes visible", () => {
    const remove = operation("ipad", [{ kind: "delete", strokeId: "stroke" }]);
    const move = edit("web", { layout: { ...frame, y: 800 } });
    const deleted = materializeInkOperations([initial(), remove, move]);
    expect(deleted.strokes[0].deleted).toBe(true);
    expect(deleted.strokes[0].layout.y).toBe(800);
    expect(deleted.conflicts.map(conflict => conflict.field)).toEqual(["delete/layout"]);
    const restore = operation("ipad", [{ kind: "restore", strokeId: "stroke" }], deleted.frontier, 2);
    const result = materializeInkOperations([initial(), remove, move, restore]);
    expect(result.strokes[0].deleted).toBe(false);
    expect(result.strokes[0].layout.y).toBe(800);
    expect(result.conflicts).toEqual([]);
    expect(() => materializeInkOperations([initial(), operation("bad", [{ kind: "restore", strokeId: "stroke" }])])).toThrow("observe a deletion");
    expect(() => materializeInkOperations([initial(), remove, operation("bad", [{ kind: "create", strokeId: "stroke", node: node("stroke"), layout: frame }], [remove.id])])).toThrow("already created");
  });
  it("a restore concurrent with another deletion stays deleted and exposes its liveness conflict", () => {
    const first = operation("ipad", [{ kind: "delete", strokeId: "stroke" }]);
    const restore = operation("ipad", [{ kind: "restore", strokeId: "stroke" }], [first.id], 2);
    const remote = operation("web", [{ kind: "delete", strokeId: "stroke" }]);
    for (const shuffled of permutations([initial(), first, restore, remote])) {
      const result = materializeInkOperations(shuffled);
      expect(result.strokes[0].deleted).toBe(true);
      expect(result.conflicts[0].field).toBe("alive");
    }
  });
  it("exact duplicates are idempotent while identity reuse and incomplete dependencies fail", () => {
    const seed = initial();
    expect(materializeInkOperations([seed, seed])).toEqual(materializeInkOperations([seed]));
    const fork = structuredClone(seed); fork.changes[0] = { kind: "delete", strokeId: "stroke" };
    expect(() => materializeInkOperations([seed, fork])).toThrow("collision");
    expect(() => materializeInkOperations([edit("ipad", { color: "#ff0000" })])).toThrow("missing causal");
    expect(() => createInkOperation({ actor: "ipad", sequence: 2, pageId: "page", boardId: "board", changes: [{ kind: "delete", strokeId: "stroke" }] })).toThrow("predecessor");
    expect(() => materializeInkOperations([seed, operation("ipad", [{ kind: "delete", strokeId: "stroke" }], [])])).toThrow("does not observe stroke creation");
  });
  it("checkpoint replay remains identical when an old offline fork arrives later", () => {
    const seed = initial(), local = edit("ipad", { color: "#ff0000" });
    const checkpoint = checkpointInkOperations([seed, local]);
    const offline = edit("web", { color: "#0000ff" });
    expect(materializeInkOperations([offline], checkpoint)).toEqual(materializeInkOperations([seed, local, offline]));
    expect(materializeInkOperations([offline], checkpoint).conflicts).toHaveLength(1);
    expect(materializeInkOperations([seed, local], checkpoint)).toEqual(materializeInkOperations([seed, local]));
    const changed = structuredClone(local); (changed.changes[0] as Extract<InkOperationChange, { kind: "edit" }>).patch.color = "#ffffff";
    expect(() => materializeInkOperations([changed], checkpoint)).toThrow("collision");
  });
  it("checkpoints omit historical sample payloads while retaining deletion and causality", () => {
    const seed = initial(), updates: InkOperation[] = [seed];
    for (let sequence = 1; sequence <= 25; ++sequence) updates.push(edit("ipad", { color: sequence % 2 ? "#ff0000" : "#0000ff" }, [sequence > 1 ? `ipad:${sequence - 1}` : seed.id], sequence));
    const remove = operation("ipad", [{ kind: "delete", strokeId: "stroke" }], ["ipad:25"], 26);
    updates.push(remove);
    const checkpoint = checkpointInkOperations(updates);
    expect(Object.keys(checkpoint.known)).toHaveLength(27);
    expect(canonicalInkJSON(checkpoint).match(/"samples"/g)).toHaveLength(1);
    expect(materializeInkOperations([], checkpoint).strokes[0].deleted).toBe(true);
    const corrupt = structuredClone(checkpoint); corrupt.frontier = ["absent:1"];
    expect(() => validateInkCheckpoint(corrupt)).toThrow("frontier");
  });
  it("selective undo compensates only local fields that remain active", () => {
    const seed = initial(), local = edit("ipad", { color: "#ff0000", layout: { ...frame, x: 300 } });
    const remote = edit("web", { color: "#0000ff" }, [local.id]);
    const ops = [seed, local, remote];
    const undo = compensateInkOperation(ops, local.id, { actor: "ipad", sequence: 2 });
    expect(undo.skipped).toEqual([{ strokeId: "stroke", field: "color" }]);
    const result = materializeInkOperations([...ops, undo.operation!]);
    expect(result.strokes[0].node.attrs!.color).toBe("#0000ff");
    expect(result.strokes[0].layout).toEqual(frame);
    expect(result.conflicts).toEqual([]);
    expect(compensateInkOperation([...ops, undo.operation!], local.id, { actor: "ipad", sequence: 3 }).operation).toBeNull();
  });
  it("undo does not remove a locally created stroke that another peer edited", () => {
    const seed = initial(), remote = edit("web", { color: "#0000ff" });
    const undo = compensateInkOperation([seed, remote], seed.id, { actor: "ipad", sequence: 1 });
    expect(undo.operation).toBeNull();
    expect(undo.skipped).toEqual([{ strokeId: "stroke", field: "create" }]);
  });
  it("undo-delete restores current remote geometry rather than a stale snapshot", () => {
    const seed = initial(), remove = operation("ipad", [{ kind: "delete", strokeId: "stroke" }]);
    const remote = edit("web", { layout: { ...frame, y: 900 } });
    const ops = [seed, remove, remote], undo = compensateInkOperation(ops, remove.id, { actor: "ipad", sequence: 2 });
    const result = materializeInkOperations([...ops, undo.operation!]);
    expect(result.strokes[0].deleted).toBe(false);
    expect(result.strokes[0].layout.y).toBe(900);
  });
  it("rejects cross-Board operations and malformed portable samples before replay", () => {
    const other = { ...initial(), boardId: "another" };
    expect(() => materializeInkOperations([initial(), other])).toThrow("cross-Board");
    const bad = initial();
    if (bad.changes[0].kind === "create") bad.changes[0].node.attrs!.ink.samples[0][0] = Infinity;
    expect(() => validateInkOperation(bad)).toThrow("finite JSON");
  });
});

it("keeps a long logical stroke's fragments in one atomic editable register pair", () => {
  const primary = createPortableInk(Array.from({ length: 20000 }, (_, index) => ({ x: index / 1000, y: 2 })), 2, [40, 30]);
  const rest = createPortableInk([{ x: 20, y: 2 }, { x: 25, y: 8 }], 2, [40, 30]);
  const logical = { ...node("long"), attrs: { ...node("long").attrs, ink: primary, inkFragments: [rest] } };
  const seed = bootstrapInkOperation({ actor: "seed", pageId: "page", boardId: "board", nodes: [logical], layout: { long: frame } })!;
  const replica = new InkOperationReplica({ pageId: "page", boardId: "board" }); replica.append([seed]);
  const changed = structuredClone(rest); changed.samples[1][1] = 10;
  const update = operation("ipad", [{ kind: "edit", strokeId: "long", patch: { inkFragments: [changed] } }]);
  const staged = replica.prepare([update]);
  expect(staged.records.filter(record => record.kind === "register").map(record => record.field)).toEqual(["inkFragments", "ink"]);
  replica.commit(staged.token);
  expect(replica.materialize().strokes).toHaveLength(1);
  expect(replica.materialize().strokes[0].node.attrs!.inkFragments[0].samples[1][1]).toBe(10);
  const mismatch = structuredClone(rest); mismatch.opacity = 0.5;
  expect(() => replica.prepare([operation("bad", [{ kind: "edit", strokeId: "long", patch: { inkFragments: [mismatch] } }], [update.id])])).toThrow("opacity");
});
