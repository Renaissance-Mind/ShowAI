import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankDocument } from "./catalog";
import { InkOperationJournal } from "./ink-operation-journal";
import { InkOperationReplica, materializeInkOperations, replayInkJournalEvents } from "../surface/ink-operations.mjs";
import { inkCheckpointFromDocument, inkWireConflicts, inkWireDocumentFromCheckpoint, stampInkDocument } from "../surface/ink-wire.mjs";
import { createResource } from "../surface/containers.mjs";
import { addNode } from "../surface/editing";
import { createPortableInk } from "../surface/portable-ink.mjs";
import type { ShowDocument } from "../types";
const roots: string[] = [], journals: InkOperationJournal[] = [];
async function open(root?: string) {
  if (!root) { const parent = process.env.SHOWAI_TEST_HOME ?? tmpdir(); await mkdir(parent, { recursive: true }); root = await mkdtemp(join(parent, "ink-wire-import-")); roots.push(root); }
  const journal = await InkOperationJournal.open(root); journals.push(journal); return journal;
}
afterEach(async () => { journals.splice(0).forEach(journal => journal.close()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function source() {
  let document = createResource(blankDocument(), "board") as ShowDocument;
  document = addNode(document, { type: "drawing", attrs: { id: "stroke", tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30], points: [{ x: 1, y: 2 }, { x: 20, y: 12 }], ink: createPortableInk([{ x: 1, y: 2 }, { x: 20, y: 12 }], 2, [40, 30]) } }, { x: 10, y: 20, width: 40, height: 30 }, document.content.attrs!.id) as ShowDocument;
  return stampInkDocument(document, undefined, { actor: "seed", sequence: 1 });
}
const scopeOf = (document: ShowDocument) => ({ pageId: document.id, boardId: document.content.attrs!.id as string });

it("imports foreign causal heads without overwriting pending local edits and selectively undoes only the local field", async () => {
  const base = source(), scope = scopeOf(base), journal = await open();
  journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  const local = journal.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 12 } }] });
  const authored = inkWireDocumentFromCheckpoint(base, scope.boardId, journal.read(scope).checkpoint!);
  expect(authored.content.attrs!.inkState.strokes.stroke.fields.strokeWidth[0][0]).toBe(local.id);
  const remoteRaw = structuredClone(base); remoteRaw.content.content![0].attrs!.color = "#0000ff";
  const remote = stampInkDocument(remoteRaw, base, { actor: "browser", sequence: 1 });
  journal.importCheckpoint(scope, inkCheckpointFromDocument(remote, scope.boardId));
  const current = journal.read(scope).checkpoint!, replica = new InkOperationReplica({ checkpoint: current });
  expect(replica.materialize().strokes[0].node.attrs).toMatchObject({ color: "#0000ff", strokeWidth: 12 });
  const undo = replica.compensationPlan(journal.operation(scope, local.id)!, journal.undoRecord(scope, local.id)!);
  expect(undo.changes).toEqual([{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 2 } }]);
  journal.appendLocal({ ...scope, parents: undo.parents, changes: undo.changes });
  const exported = inkWireDocumentFromCheckpoint(remote, scope.boardId, journal.read(scope).checkpoint!);
  expect(exported.content.content![0].attrs).toMatchObject({ color: "#0000ff", strokeWidth: 2 });
  expect(inkWireConflicts(exported)).toEqual([]);
  expect(exported.content.content![0].attrs!.ink.samples).toEqual(base.content.content![0].attrs!.ink.samples);
  expect(materializeInkOperations([], replayInkJournalEvents(scope, journal.events(scope)))).toEqual(journal.read(scope).materialization);
});
it("a remote same-field successor suppresses local inverse while preserving its other source data", async () => {
  const base = source(), scope = scopeOf(base), journal = await open(); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  const local = journal.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 12 } }] });
  const current = inkWireDocumentFromCheckpoint(base, scope.boardId, journal.read(scope).checkpoint!);
  const remoteRaw = structuredClone(current); remoteRaw.content.content![0].attrs!.strokeWidth = 20;
  const remote = stampInkDocument(remoteRaw, current, { actor: "browser", sequence: 1 });
  journal.importCheckpoint(scope, inkCheckpointFromDocument(remote, scope.boardId));
  const replica = new InkOperationReplica({ checkpoint: journal.read(scope).checkpoint! });
  const plan = replica.compensationPlan(local, journal.undoRecord(scope, local.id)!);
  expect(plan.changes).toEqual([]); expect(plan.skipped).toEqual([{ strokeId: "stroke", field: "strokeWidth" }]);
  expect(replica.materialize().strokes[0].node.attrs!.strokeWidth).toBe(20);
});
it("concurrent same-field imports retain both real heads and wire variants", async () => {
  const base = source(), scope = scopeOf(base), journal = await open(); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  journal.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 12 } }] });
  const remoteRaw = structuredClone(base); remoteRaw.content.content![0].attrs!.strokeWidth = 20;
  const remote = stampInkDocument(remoteRaw, base, { actor: "browser", sequence: 1 });
  journal.importCheckpoint(scope, inkCheckpointFromDocument(remote, scope.boardId));
  const exported = inkWireDocumentFromCheckpoint(remote, scope.boardId, journal.read(scope).checkpoint!);
  expect(inkWireConflicts(exported)).toMatchObject([{ field: "strokeWidth", retained: true }]);
  expect(Object.values(exported.content.attrs!.inkState.strokes.stroke.variants.strokeWidth)).toContain(12);
});
it("an unseen compact tombstone rejects stale recreation without inventing source geometry", async () => {
  const base = source(), scope = scopeOf(base), journal = await open(), removed = structuredClone(base);
  removed.content.content = []; removed.layout = {};
  const remote = stampInkDocument(removed, base, { actor: "browser", sequence: 1 });
  journal.importCheckpoint(scope, inkCheckpointFromDocument(remote, scope.boardId));
  const current = materializeInkOperations([], journal.read(scope).checkpoint!);
  expect(current.strokes).toEqual([]); expect(current.tombstones).toEqual(["stroke"]);
  expect(() => journal.appendLocal({ ...scope, parents: current.frontier, changes: [{ kind: "create", strokeId: "stroke", node: base.content.content![0], layout: base.layout!.stroke }] })).toThrow("already created");
});
it("another connection observes imports even when the raw local operation tail does not change", async () => {
  const base = source(), scope = scopeOf(base), first = await open(); first.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  const second = await open(first.path.replace(/\/local\/ink-operations\.sqlite$/, "")); second.warm(scope);
  const local = first.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 12 } }] });
  const remoteRaw = structuredClone(base); remoteRaw.content.content![0].attrs!.color = "#0000ff";
  first.importCheckpoint(scope, inkCheckpointFromDocument(stampInkDocument(remoteRaw, base, { actor: "browser", sequence: 1 }), scope.boardId));
  const next = second.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { pressure: false } }] });
  expect(next.parents).toEqual([local.id, "seed:1"].sort());
  expect(second.read(scope).materialization!.strokes[0].node.attrs).toMatchObject({ color: "#0000ff", strokeWidth: 12, pressure: false });
});
