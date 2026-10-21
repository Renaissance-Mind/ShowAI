import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankDocument } from "./catalog";
import { InkOperationJournal } from "./ink-operation-journal";
import { inkCheckpointFromDocument, inkWireDocumentFromCheckpoint, inkWireEditPlans, inkWireImportCheckpoints, stampInkDocument, inkWireResolutionCandidates, inkWireConflicts } from "../surface/ink-wire.mjs";
import { createResource } from "../surface/containers.mjs";
import { addNode } from "../surface/editing";
import { createPortableInk } from "../surface/portable-ink.mjs";
import { mergePageContent } from "./page-merge-model";
import type { ShowDocument } from "../types";
const roots: string[] = [], journals: InkOperationJournal[] = [];
async function open() { const parent = process.env.SHOWAI_TEST_HOME ?? tmpdir(); await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, "ink-wire-edit-")); roots.push(root); const journal = await InkOperationJournal.open(root); journals.push(journal); return journal; }
afterEach(async () => { journals.splice(0).forEach(journal => journal.close()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
function source() {
  let document = createResource(blankDocument(), "board") as ShowDocument;
  document = addNode(document, { type: "drawing", attrs: { id: "stroke", tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30], points: [{ x: 1, y: 2 }, { x: 20, y: 12 }], ink: createPortableInk([{ x: 1, y: 2 }, { x: 20, y: 12 }], 2, [40, 30]) } }, { x: 10, y: 20, width: 40, height: 30 }, document.content.attrs!.id) as ShowDocument;
  return stampInkDocument(document, undefined, { actor: "seed", sequence: 1 });
}
const scopeOf = (document: ShowDocument) => ({ pageId: document.id, boardId: document.content.attrs!.id as string });
it("ordinary field intent uses only the real author baseline while retaining unseen remote fields and pending local writes", async () => {
  const base = source(), scope = scopeOf(base), journal = await open(); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  journal.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 12 } }] });
  const remoteRaw = structuredClone(base); remoteRaw.content.content![0].attrs!.color = "#ff0000";
  const remote = stampInkDocument(remoteRaw, base, { actor: "browser", sequence: 1 }); journal.importCheckpoint(scope, inkCheckpointFromDocument(remote, scope.boardId));
  const draft = structuredClone(base); draft.content.content![0].attrs!.strokeWidth = 20;
  const plans = inkWireEditPlans(base, draft);
  expect(plans).toEqual([{ boardId: scope.boardId, parents: ["seed:1"], changes: [{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 20 } }] }]);
  for (const plan of plans) journal.appendLocal({ pageId: base.id, ...plan });
  const projected = inkWireDocumentFromCheckpoint(draft, scope.boardId, journal.read(scope).checkpoint!);
  expect(projected.content.content![0].attrs).toMatchObject({ color: "#ff0000", strokeWidth: 20 });
  expect(inkWireConflicts(projected)).toEqual([]);
});
it("creates real editable source and deletes it with actual journal identities", async () => {
  const base = source(), scope = scopeOf(base), journal = await open(); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  const draft = structuredClone(base), copy = structuredClone(draft.content.content![0]); copy.attrs!.id = "copy"; draft.content.content!.push(copy); draft.layout!.copy = { ...draft.layout!.stroke, x: 200 };
  const create = inkWireEditPlans(base, draft); expect(create[0].changes[0]).toMatchObject({ kind: "create", strokeId: "copy", placement: { parentId: scope.boardId } });
  for (const plan of create) journal.appendLocal({ pageId: base.id, ...plan });
  const saved = inkWireDocumentFromCheckpoint(draft, scope.boardId, journal.read(scope).checkpoint!);
  const erased = structuredClone(saved); erased.content.content = []; erased.layout = {};
  for (const plan of inkWireEditPlans(saved, erased)) journal.appendLocal({ pageId: base.id, ...plan });
  expect(journal.read(scope).materialization!.strokes.every(stroke => stroke.deleted)).toBe(true);
});
it("restores a compact tombstone by hydrating source then explicitly changing liveness", async () => {
  const base = source(), scope = scopeOf(base), erased = structuredClone(base); erased.content.content = []; erased.layout = {};
  const removed = stampInkDocument(erased, base, { actor: "browser", sequence: 1 }), journal = await open();
  journal.importCheckpoint(scope, inkCheckpointFromDocument(removed, scope.boardId));
  const draft = structuredClone(removed); draft.content.content = structuredClone(base.content.content); draft.layout = structuredClone(base.layout);
  const plans = inkWireEditPlans(removed, draft); expect(plans).toHaveLength(2); expect(plans[0].changes[0].kind).toBe("edit"); expect(plans[1].changes).toEqual([{ kind: "restore", strokeId: "stroke" }]);
  for (const plan of plans) journal.appendLocal({ pageId: base.id, ...plan });
  const restored = inkWireDocumentFromCheckpoint(draft, scope.boardId, journal.read(scope).checkpoint!);
  expect(restored.content.content![0].attrs!.ink.samples).toEqual(base.content.content![0].attrs!.ink.samples); expect(inkWireConflicts(restored)).toEqual([]);
});
it("treats a chosen existing conflict value as a fresh authored field, and passes properly stamped imports through", () => {
  const base = source(), left = structuredClone(base), right = structuredClone(base);
  left.content.content![0].attrs!.color = "#ff0000"; right.content.content![0].attrs!.color = "#0000ff";
  const one = stampInkDocument(left, base, { actor: "ipad", sequence: 1 }), two = stampInkDocument(right, base, { actor: "browser", sequence: 1 });
  expect(inkWireEditPlans(base, one)).toEqual([]);
  const merged = mergePageContent(base, one, two).document, draft = structuredClone(merged);
  const value = inkWireResolutionCandidates(merged)[0].candidates.find(candidate => candidate.value !== merged.content.content![0].attrs!.color)!.value;
  draft.content.content![0].attrs!.color = value;
  expect(inkWireEditPlans(merged, draft)[0].changes).toEqual([{ kind: "edit", strokeId: "stroke", patch: { color: value } }]);
});
it("pairs primary geometry and fragments but leaves unrelated ordinary document edits alone", () => {
  const base = source(), draft = structuredClone(base); draft.content.content![0].attrs!.inkFragments = [draft.content.content![0].attrs!.ink];
  const patch = inkWireEditPlans(base, draft)[0].changes[0]; expect(patch).toMatchObject({ kind: "edit", patch: { ink: base.content.content![0].attrs!.ink, inkFragments: [base.content.content![0].attrs!.ink] } });
  const title = structuredClone(base); title.title = "Changed"; expect(inkWireEditPlans(base, title)).toEqual([]);
});

it("imports genuine foreign heads from mixed drafts without inventing author operations", async () => {
  const base = source(), scope = scopeOf(base), raw = structuredClone(base); raw.content.content![0].attrs!.color = "#ff0000";
  const remote = stampInkDocument(raw, base, { actor: "browser", sequence: 1 }), mixed = structuredClone(remote);
  mixed.content.content![0].attrs!.strokeWidth = 20;
  expect(() => inkCheckpointFromDocument(mixed, scope.boardId)).toThrow("unstamped");
  const journal = await open(); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  const plans = inkWireEditPlans(base, mixed);
  expect(plans[0].changes).toEqual([{ kind: "edit", strokeId: "stroke", patch: { strokeWidth: 20 } }]);
  for (const incoming of inkWireImportCheckpoints(base, mixed)) journal.importCheckpoint({ pageId: base.id, boardId: incoming.boardId }, incoming.checkpoint);
  for (const plan of plans) journal.appendLocal({ pageId: base.id, ...plan });
  const projected = inkWireDocumentFromCheckpoint(mixed, scope.boardId, journal.read(scope).checkpoint!);
  expect(projected.content.content![0].attrs).toMatchObject({ color: "#ff0000", strokeWidth: 20 });
  expect(projected.content.attrs!.inkState.strokes.stroke.fields.color[0][0]).toBe("browser:1");
  expect(journal.operations(scope)).toHaveLength(1);
});
it("imports source anchors independently of draft deletion and rejects missing hashed source instead of guessing", () => {
  const base = source(), erased = structuredClone(base); erased.content.content = []; erased.layout = {};
  const checkpoint = inkWireImportCheckpoints(base, erased)[0].checkpoint;
  expect(checkpoint.strokes[0].registers.alive[0].value).toBe(true);
  expect(checkpoint.strokes[0].registers.ink[0].value).toEqual(base.content.content![0].attrs!.ink);
  const raw = structuredClone(base); raw.content.content![0].attrs!.color = "#ff0000";
  const remote = stampInkDocument(raw, base, { actor: "browser", sequence: 1 }); remote.content.content = []; remote.layout = {};
  expect(() => inkWireImportCheckpoints(base, remote)).toThrow("source is unavailable");
});
it("does not silently order an ordinary draft after an unseen same-field remote write", async () => {
  const base = source(), scope = scopeOf(base), journal = await open(); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  const raw = structuredClone(base); raw.content.content![0].attrs!.strokeWidth = 30;
  const remote = stampInkDocument(raw, base, { actor: "browser", sequence: 1 }); journal.importCheckpoint(scope, inkCheckpointFromDocument(remote, scope.boardId));
  const draft = structuredClone(base); draft.content.content![0].attrs!.strokeWidth = 20;
  for (const plan of inkWireEditPlans(base, draft)) journal.appendLocal({ pageId: base.id, ...plan });
  const current = journal.read(scope).materialization!;
  expect(current.conflicts).toMatchObject([{ field: "strokeWidth", candidates: expect.arrayContaining([{ operationId: "browser:1", value: 30 }, expect.objectContaining({ value: 20 })]) }]);
});

it("authors generic history restoration of a superseded field instead of treating its old dot as a new import", async () => {
  const base = source(), changed = structuredClone(base); changed.content.content![0].attrs!.color = "#ff0000";
  const current = stampInkDocument(changed, base, { actor: "ipad", sequence: 1 });
  const plans = inkWireEditPlans(current, base);
  expect(plans[0].changes).toEqual([{ kind: "edit", strokeId: "stroke", patch: { color: "#111111" } }]);
  const journal = await open(), scope = scopeOf(base); journal.importCheckpoint(scope, inkCheckpointFromDocument(current, scope.boardId));
  for (const incoming of inkWireImportCheckpoints(current, base)) journal.importCheckpoint({ pageId: base.id, boardId: incoming.boardId }, incoming.checkpoint);
  for (const plan of plans) journal.appendLocal({ pageId: base.id, ...plan });
  expect(journal.read(scope).materialization!.strokes[0].node.attrs!.color).toBe("#111111");
});
it("restores historical source after a compact tombstone but imports a genuinely newer restoration without fabricating edits", async () => {
  const base = source(), erased = structuredClone(base); erased.content.content = []; erased.layout = {};
  const removed = stampInkDocument(erased, base, { actor: "ipad", sequence: 1 });
  const plans = inkWireEditPlans(removed, base);
  expect(plans).toHaveLength(2); expect(plans[0].changes[0].kind).toBe("edit"); expect(plans[1].changes).toEqual([{ kind: "restore", strokeId: "stroke" }]);
  const journal = await open(), scope = scopeOf(base); journal.importCheckpoint(scope, inkCheckpointFromDocument(base, scope.boardId));
  journal.appendLocal({ ...scope, parents: ["seed:1"], changes: [{ kind: "delete", strokeId: "stroke" }] });
  const deleted = inkWireDocumentFromCheckpoint(erased, scope.boardId, journal.read(scope).checkpoint!);
  journal.appendLocal({ ...scope, parents: journal.read(scope).checkpoint!.frontier, changes: [{ kind: "restore", strokeId: "stroke" }] });
  const restored = inkWireDocumentFromCheckpoint(base, scope.boardId, journal.read(scope).checkpoint!);
  expect(inkWireEditPlans(deleted, restored)).toEqual([]);
});
