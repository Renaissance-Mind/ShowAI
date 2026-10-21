import { serializeArtifact } from "../portable/validation.mjs";
import { documentHash } from "./diff";
import { prepareSavedInkResolution } from "./ink-wire-writer";
import { inkWireResolutionCandidates, inkWireConflicts, stampInkDocument } from "../surface/ink-wire.mjs";
import { afterEach, expect, it } from "vitest";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileStore } from "./store";
import { mergePageContent } from "./page-merge-model";
import { addNode } from "../surface/editing";
import { createPortableInk } from "../surface/portable-ink.mjs";
import type { ShowDocument } from "../types";
const roots: string[] = [];
async function temporary() { const parent = process.env.SHOWAI_TEST_HOME ?? tmpdir(); await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, "ink-wire-writer-")); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("stamps actual canonical FileStore saves using stable persisted actors and safely merges two device copies", async () => {
  const root = await temporary(), secondRoot = await temporary(), store = new FileStore(root);
  const project = await store.createProject({ name: "Causal ink roundtrip" });
  const page = await store.createPage(project.id, { kind: "board", title: "Ink" });
  const node = { type: "drawing", attrs: { id: "stroke", name: "笔迹 e\u0301 / é", tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30], points: [{ x: 1, y: 2 }, { x: 20, y: 12 }], ink: createPortableInk([{ x: 1.002e-7, y: 2 }, { x: 20, y: 12 }], 2, [40, 30]) } };
  const document = addNode(page.document, node, { x: 10, y: 20, width: 40, height: 30 }, page.document.content.attrs!.id) as ShowDocument;
  const baseline = await store.savePage(project.id, page.document.id, document, page.hash);
  await cp(store.projectPath(project.id), join(secondRoot, "projects", project.id), { recursive: true });
  const other = new FileStore(secondRoot), copied = await other.readPage(project.id, baseline.document.id);
  const localDoc = structuredClone(baseline.document); localDoc.content.content![0].attrs!.color = "#ff0000";
  const local = await new FileStore(root).savePage(project.id, baseline.document.id, localDoc, baseline.hash);
  const remoteDoc = structuredClone(copied.document); remoteDoc.layout!.stroke.x = 700;
  const remote = await other.savePage(project.id, baseline.document.id, remoteDoc, copied.hash);
  const localClock = local.document.content.attrs!.inkState.clock, remoteClock = remote.document.content.attrs!.inkState.clock;
  const sharedActor = Object.keys(baseline.document.content.attrs!.inkState.clock).find(actor => actor.startsWith("wire-device-"))!;
  expect(localClock[sharedActor]).toBeGreaterThan(baseline.document.content.attrs!.inkState.clock[sharedActor]);
  expect(Object.keys(remoteClock).filter(actor => actor.startsWith("wire-device-"))).toHaveLength(2);
  const merged = mergePageContent(baseline.document, local.document, remote.document); expect(merged.conflicts).toEqual([]);
  const savedLocal = await store.savePage(project.id, baseline.document.id, merged.document, local.hash);
  const savedRemote = await other.savePage(project.id, baseline.document.id, merged.document, remote.hash);
  expect(savedLocal.hash).toBe(savedRemote.hash);
  expect(savedLocal.document.content.content![0].attrs!.color).toBe("#ff0000"); expect(savedLocal.document.layout!.stroke.x).toBe(700);
  const reopened = await new FileStore(root).readPage(project.id, baseline.document.id);
  expect(reopened.hash).toBe(savedLocal.hash);
  expect(JSON.parse(await readFile(reopened.path, "utf8")).document.content.attrs.inkState).toEqual(reopened.document.content.attrs!.inkState);
  if (process.env.SHOWAI_INK_WIRE_FIXTURE) {
    const path = process.env.SHOWAI_INK_WIRE_FIXTURE; await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ projectId: project.id, baseline: baseline.document, browser: remote.document, expected: merged.document }, null, 2));
  }
});

it("prepares conflict resolution with a real persistent writer and saves it through actual CAS", async () => {
  const root = await temporary(), store = new FileStore(root), project = await store.createProject({ name: "Resolve ink" });
  const page = await store.createPage(project.id, { kind: "board" });
  const node = { type: "drawing", attrs: { id: "stroke", tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 30], points: [{ x: 1, y: 2 }, { x: 20, y: 12 }], ink: createPortableInk([{ x: 1, y: 2 }, { x: 20, y: 12 }], 2, [40, 30]) } };
  const base = await store.savePage(project.id, page.document.id, addNode(page.document, node, { x: 10, y: 20, width: 40, height: 30 }, page.document.content.attrs!.id) as ShowDocument, page.hash);
  const left = structuredClone(base.document), right = structuredClone(base.document);
  left.content.content![0].attrs!.color = "#ff0000"; right.content.content![0].attrs!.color = "#0000ff";
  const conflict = mergePageContent(base.document, stampInkDocument(left, base.document, { actor: "ipad", sequence: 1 }), stampInkDocument(right, base.document, { actor: "browser", sequence: 1 }));
  const current = await store.savePage(project.id, page.document.id, conflict.document, base.hash);
  const group = inkWireResolutionCandidates(current.document)[0], chosen = group.candidates.find(candidate => candidate.value === "#0000ff")!;
  const resolved = await prepareSavedInkResolution(root, current.document, [{ boardId: group.boardId, strokeId: group.strokeId, field: group.field, hash: chosen.hash }]);
  const actual = resolved.content.attrs!.inkState.strokes.stroke.fields.color;
  expect(actual).toHaveLength(1); expect(actual[0][0]).toMatch(/^wire-device-/);
  const saved = await store.savePage(project.id, page.document.id, resolved, current.hash);
  expect(inkWireConflicts(saved.document)).toEqual([]); expect(saved.document.content.content![0].attrs!.color).toBe("#0000ff");
  const stale = await prepareSavedInkResolution(root, current.document, [{ boardId: group.boardId, strokeId: group.strokeId, field: group.field, hash: chosen.hash }]);
  await expect(store.savePage(project.id, page.document.id, stale, current.hash)).rejects.toThrow();
});

it.skipIf(!process.env.SHOWAI_NATIVE_INK_ROUNDTRIP)("accepts the actual Swift journal projection through the canonical browser/server FileStore", async () => {
  const fixture = JSON.parse(await readFile(process.env.SHOWAI_NATIVE_INK_SOURCE!, "utf8"));
  const native = JSON.parse(await readFile(process.env.SHOWAI_NATIVE_INK_ROUNDTRIP!, "utf8"));
  const root = await temporary(), store = new FileStore(root), project = await store.createProject({ name: "Native/browser roundtrip" });
  // The sync import seam installs the canonical source artifact. Subsequent edits
  // use the production read/normalization/CAS save path without test doubles.
  const path = store.pagePath(project.id, fixture.browser.id); await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(serializeArtifact(fixture.browser)));
  const baseline = await store.readPage(project.id, fixture.browser.id);
  expect(documentHash(native.document)).toBe(native.hash);
  const saved = await store.savePage(project.id, native.document.id, native.document, baseline.hash);
  expect(saved.hash).toBe(native.hash);
  expect(saved.document.content.attrs!.inkState).toEqual(native.document.content.attrs.inkState);
  expect(saved.document.content.content![0].attrs!.name).toBe("笔迹 e\u0301 / é");
  expect(saved.document.layout!.stroke.x).toBe(700);
  expect(saved.document.content.content![0].attrs!.strokeWidth).toBe(2);
  expect(inkWireConflicts(saved.document)).toEqual([]);
});
