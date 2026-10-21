import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankDocument } from "./catalog";
import { createResource } from "../surface/containers.mjs";
import { FileStore } from "./store";
import { InkOperationJournal } from "./ink-operation-journal";
import { mergePageContent } from "./page-merge-model";
import { addNode } from "../surface/editing";
import {
  createPortableInk,
  type PortableInkV2,
} from "../surface/portable-ink.mjs";
import { inkWireConflicts, stampInkDocument } from "../surface/ink-wire.mjs";
import {
  bootstrapInkOperation,
  createInkOperation,
  compensateInkOperation,
  materializeInkOperations,
  InkOperationReplica,
} from "../surface/ink-operations.mjs";
import type { ShowDocument } from "../types";
const roots: string[] = [],
  journals: InkOperationJournal[] = [];
async function root() {
  const r = await mkdtemp(
    join(process.env.SHOWAI_TEST_HOME ?? tmpdir(), "ink-v2-"),
  );
  roots.push(r);
  return r;
}
afterEach(async () => {
  for (const j of journals.splice(0)) j.close();
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
const ink = (): PortableInkV2 => ({
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
});
const node = (id = "cubic") => ({
    type: "drawing",
    attrs: {
      id,
      tool: "pen",
      color: "#111111",
      strokeWidth: 4,
      extent: [100, 100],
      points: [
        { x: 10, y: 20 },
        { x: 80, y: 20 },
      ],
      ink: ink(),
    },
  }),
  frame = { x: 10, y: 20, width: 100, height: 100 };
it("saves and reopens mixed v1/v2 editable sources and converges independent real device CAS edits", async () => {
  const a = await root(),
    b = await root(),
    store = new FileStore(a),
    project = await store.createProject({ name: "Mixed versions" }),
    page = await store.createPage(project.id, { kind: "board" });
  let doc = addNode(
    page.document,
    node(),
    frame,
    page.document.content.attrs!.id,
  ) as ShowDocument;
  doc = addNode(
    doc,
    {
      ...node("legacy"),
      attrs: {
        ...node("legacy").attrs,
        ink: createPortableInk(
          [
            { x: 1, y: 2 },
            { x: 20, y: 12 },
          ],
          4,
          [100, 100],
        ),
      },
    },
    { ...frame, x: 200 },
    doc.content.attrs!.id,
  ) as ShowDocument;
  const base = await store.savePage(
    project.id,
    page.document.id,
    doc,
    page.hash,
  );
  await cp(store.projectPath(project.id), join(b, "projects", project.id), {
    recursive: true,
  });
  const other = new FileStore(b),
    copy = await other.readPage(project.id, page.document.id);
  const left = structuredClone(base.document),
    right = structuredClone(copy.document);
  left.content.content![0].attrs!.color = "#ff0000";
  right.content.content![0].attrs!.strokeWidth = 8;
  right.layout!.cubic.x = 500;
  const local = await store.savePage(
      project.id,
      page.document.id,
      left,
      base.hash,
    ),
    remote = await other.savePage(
      project.id,
      page.document.id,
      right,
      copy.hash,
    ),
    merged = mergePageContent(base.document, local.document, remote.document);
  expect(merged.conflicts).toEqual([]);
  expect(merged.document.content.content![0].attrs).toMatchObject({
    color: "#ff0000",
    strokeWidth: 8,
    ink: ink(),
  });
  expect(merged.document.layout!.cubic.x).toBe(500);
  const saved = await store.savePage(
    project.id,
    page.document.id,
    merged.document,
    local.hash,
  );
  const reopened = await new FileStore(a).readPage(
    project.id,
    page.document.id,
  );
  expect(reopened.hash).toBe(saved.hash);
  expect(
    reopened.document.content.content!.map((n) => n.attrs!.ink.format),
  ).toEqual(["showai-ink-v2", "showai-ink-v1"]);
  expect(
    JSON.parse(await readFile(reopened.path, "utf8")).document.content
      .content[0].attrs.ink,
  ).toEqual(ink());
  await expect(
    store.savePage(project.id, page.document.id, left, base.hash),
  ).rejects.toThrow();
});
it("retains actual concurrent v2 geometry variants without manufacturing v1 samples", () => {
  const make = (actor: string, y: number) => {
    const d = structuredClone(base);
    d.content.content![0].attrs!.ink.segments[0].points[1][1] = y;
    return stampInkDocument(d, base, { actor, sequence: 1 });
  };
  const resource = createResource(blankDocument(), "board"),
    source = addNode(
      resource,
      node(),
      frame,
      resource.content.attrs!.id,
    ) as ShowDocument;
  const base = stampInkDocument(source, undefined, {
      actor: "seed",
      sequence: 1,
    }),
    merged = mergePageContent(base, make("ipad", 10), make("windows", 30));
  expect(merged.conflicts.some((c) => c.domain === "ink" && c.retained)).toBe(
    true,
  );
  expect(inkWireConflicts(merged.document)).toHaveLength(1);
  const variants =
    merged.document.content.attrs!.inkState.strokes.cubic.variants.ink;
  expect(
    Object.values(variants).every(
      (v: any) => v.format === "showai-ink-v2" && !Object.hasOwn(v, "samples"),
    ),
  ).toBe(true);
});
it("durably replays v2 operations and selective undo/redo preserves a concurrent remote style", async () => {
  const location = await root(),
    journal = await InkOperationJournal.open(location, { checkpointEvery: 2 });
  journals.push(journal);
  const scope = { pageId: "p", boardId: "board" },
    seed = bootstrapInkOperation({
      ...scope,
      actor: "seed",
      nodes: [node()],
      layout: { cubic: frame },
    })!;
  journal.append([seed]);
  const changed = ink();
  changed.segments[0].points[1][1] = 30;
  const own = journal.appendLocal({
      ...scope,
      parents: [seed.id],
      changes: [{ kind: "edit", strokeId: "cubic", patch: { ink: changed } }],
    }),
    foreign = createInkOperation({
      ...scope,
      actor: "desktop",
      sequence: 1,
      parents: [seed.id],
      changes: [
        { kind: "edit", strokeId: "cubic", patch: { color: "#0000ff" } },
      ],
    });
  journal.append([foreign]);
  const before = journal.operations(scope),
    undo = compensateInkOperation(before, own.id, {
      actor: journal.actor,
      sequence: 2,
    }).operation!;
  journal.append([undo]);
  let actual = journal.read(scope).materialization!;
  expect(actual.strokes[0].node.attrs!.ink).toEqual(ink());
  expect(actual.strokes[0].node.attrs!.color).toBe("#0000ff");
  const redo = compensateInkOperation(journal.operations(scope), undo.id, {
    actor: journal.actor,
    sequence: 3,
  }).operation!;
  journal.append([redo]);
  journal.close();
  journals.splice(journals.indexOf(journal), 1);
  const reopened = await InkOperationJournal.open(location);
  journals.push(reopened);
  actual = reopened.read(scope).materialization!;
  expect(actual.strokes[0].node.attrs!.ink).toEqual(changed);
  expect(actual.strokes[0].node.attrs!.color).toBe("#0000ff");
  expect(actual.conflicts).toEqual([]);
  expect(actual).toEqual(materializeInkOperations([...before, undo, redo]));
});
it("rejects v2 mixed-source edits atomically before retained replica publication", () => {
  const scope = { pageId: "p", boardId: "board" },
    seed = bootstrapInkOperation({
      ...scope,
      actor: "seed",
      nodes: [node()],
      layout: { cubic: frame },
    })!,
    replica = new InkOperationReplica(scope);
  replica.append([seed]);
  const before = replica.checkpoint();
  for (const patch of [
    {
      inkFragments: [
        createPortableInk(
          [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          4,
          [100, 100],
        ),
      ],
    },
    {
      node: {
        type: "drawing",
        attrs: { id: "cubic", inkInput: { format: "showai-input-v1" } },
      },
    },
  ]) {
    const op = createInkOperation({
      ...scope,
      actor: "bad",
      sequence: 1,
      parents: [seed.id],
      changes: [{ kind: "edit", strokeId: "cubic", patch }],
    });
    expect(() => replica.append([op])).toThrow();
    expect(replica.checkpoint()).toEqual(before);
  }
});

import { prepareSavedInkResolution } from "./ink-wire-writer";
import { inkWireResolutionCandidates } from "../surface/ink-wire.mjs";
it("resolves and reopens actual conflicting center curves using a real persisted writer", async () => {
  const store = new FileStore(await root()),
    project = await store.createProject({ name: "Curve conflict" }),
    page = await store.createPage(project.id, { kind: "board" }),
    doc = addNode(
      page.document,
      node(),
      frame,
      page.document.content.attrs!.id,
    ) as ShowDocument,
    base = await store.savePage(project.id, page.document.id, doc, page.hash);
  const branch = (actor: string, y: number) => {
    const source = structuredClone(base.document);
    source.content.content![0].attrs!.ink.segments[0].points[1][1] = y;
    return stampInkDocument(source, base.document, { actor, sequence: 1 });
  };
  const merged = mergePageContent(
    base.document,
    branch("ipad", 11),
    branch("browser", 33),
  );
  expect(merged.conflicts.every((c) => c.domain === "ink" && c.retained)).toBe(
    true,
  );
  const conflicted = await store.savePage(
      project.id,
      page.document.id,
      merged.document,
      base.hash,
    ),
    candidate = inkWireResolutionCandidates(conflicted.document).find(
      (c) => c.field === "ink",
    )!,
    chosen = candidate.candidates.find(
      (c: any) => c.value.segments[0].points[1][1] === 33,
    )!;
  const resolved = await prepareSavedInkResolution(
    store.root,
    conflicted.document,
    [
      {
        boardId: candidate.boardId,
        strokeId: candidate.strokeId,
        field: candidate.field,
        hash: chosen.hash,
      },
    ],
  );
  await store.savePage(project.id, page.document.id, resolved, conflicted.hash);
  const reopened = await store.readPage(project.id, page.document.id);
  expect(inkWireConflicts(reopened.document)).toEqual([]);
  expect(
    reopened.document.content.content![0].attrs!.ink.segments[0].points[1][1],
  ).toBe(33);
});

import {
  inkCheckpointFromDocument,
  inkWireDocumentFromCheckpoint,
} from "../surface/ink-wire.mjs";
it("preserves mixed-version nested placement, order, source transforms and tombstones through causal checkpoint projection", () => {
  const resource = createResource(blankDocument(), "board"),
    legacy = {
      ...node("legacy"),
      attrs: {
        ...node("legacy").attrs,
        ink: createPortableInk(
          [
            { x: 1, y: 2 },
            { x: 20, y: 12 },
          ],
          4,
          [100, 100],
        ),
      },
    },
    cubic = node(),
    group = {
      type: "region",
      attrs: { id: "group", name: "Editable strokes" },
      content: [legacy, cubic],
    };
  let source = addNode(
    resource,
    group,
    { ...frame, mode: "free", rotation: 25 },
    resource.content.attrs!.id,
  ) as ShowDocument;
  source.layout!.legacy = { x: 0, y: 0, width: 100, height: 100 };
  source.layout!.cubic = { x: 0, y: 0, width: 100, height: 100 };
  source = stampInkDocument(source, undefined, { actor: "seed", sequence: 1 });
  const board = source.content.attrs!.id,
    checkpoint = inkCheckpointFromDocument(source, board),
    projected = inkWireDocumentFromCheckpoint(source, board, checkpoint);
  expect(
    projected.content.content![0].content!.map((n) => n.attrs!.id),
  ).toEqual(["legacy", "cubic"]);
  expect(projected.content.content![0].content![1].attrs!.ink).toEqual(ink());
  const replica = new InkOperationReplica({ checkpoint }),
    del = createInkOperation({
      pageId: source.id,
      boardId: board,
      actor: "eraser",
      sequence: 1,
      parents: [...replica.frontier],
      changes: [{ kind: "delete", strokeId: "cubic" }],
    });
  replica.append([del]);
  const erased = inkWireDocumentFromCheckpoint(
    source,
    board,
    replica.checkpoint(),
  );
  expect(erased.content.content![0].content!.map((n) => n.attrs!.id)).toEqual([
    "legacy",
  ]);
  const restore = createInkOperation({
    pageId: source.id,
    boardId: board,
    actor: "eraser",
    sequence: 2,
    parents: [...replica.frontier],
    changes: [{ kind: "restore", strokeId: "cubic" }],
  });
  replica.append([restore]);
  const restored = inkWireDocumentFromCheckpoint(
    erased,
    board,
    replica.checkpoint(),
  );
  expect(restored.content.content![0].content!.map((n) => n.attrs!.id)).toEqual(
    ["legacy", "cubic"],
  );
  expect(restored.content.content![0].content![1].attrs!.ink).toEqual(ink());
});
