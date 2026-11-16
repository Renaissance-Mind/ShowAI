import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankDocument } from "../core/catalog";
import { FileStore } from "../core/store";
import { createResource, createSurface } from "../document/containers.mjs";
import { findSurfaceNode, reconcileSurface } from "../document/document.mjs";
import { addNode, editNode, moveNode } from "./editing";
import { canCommitBoardGesture, transformObjects } from "./board-commands";
import type { PageRecord } from "../core/model";
import type { ShowDocument } from "../types";

const stroke = (id: string) => ({
  type: "drawing",
  attrs: {
    id,
    tool: "pen",
    color: "#111111",
    strokeWidth: 2,
    extent: [100, 50],
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
  },
});
function source() {
  let document: ShowDocument = createResource(blankDocument(), "board");
  const root = document.content.attrs!.id;
  document = addNode(
    document,
    { type: "region", attrs: { id: "group", name: "Group" }, content: [] },
    { x: 100, y: 100, width: 800, height: 600, mode: "free", gap: 24 },
    root,
  );
  document = addNode(
    document,
    stroke("stroke"),
    { x: 20, y: 40, width: 100, height: 50 },
    "group",
  );
  document = addNode(
    document,
    stroke("sibling"),
    { x: 240, y: 40, width: 100, height: 50 },
    "group",
  );
  document = addNode(
    document,
    createSurface("board", "Nested Board", "nested"),
    { x: 10, y: 300, width: 600, height: 250 },
    "group",
  );
  document = addNode(
    document,
    stroke("nested-stroke"),
    { x: 10, y: 20, width: 100, height: 50 },
    "nested",
  );
  return reconcileSurface(document);
}

let directory: string;
let store: FileStore;
let projectId: string;
let record: PageRecord;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-board-gesture-"));
  store = new FileStore(join(directory, "library"));
  projectId = (await store.createProject({ name: "Board gesture regression" }))
    .id;
  record = await store.createPage(projectId, { document: source() });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function save(document: ShowDocument, writer = store) {
  record = await writer.savePage(
    projectId,
    record.document.id,
    document,
    record.hash,
    record.revision,
  );
  return record.document;
}
const node = (document: ShowDocument, id: string) =>
  findSurfaceNode(document, id)!.node;
const state = (document: ShowDocument, id = document.content.attrs!.id) =>
  node(document, id).attrs!.inkState;

it("keeps consecutive gestures across actual saved ink metadata receipts", async () => {
  for (const sign of [1, -1, 1, -1, 1, -1]) {
    const before = record.document;
    const draft = transformObjects(before, {
      stroke: {
        ...before.layout!.stroke,
        x: before.layout!.stroke.x + sign * 90,
        y: before.layout!.stroke.y + sign * 45,
      },
    });
    const saved = await save(draft);
    expect(saved.layout!.stroke).toEqual(draft.layout!.stroke);
    expect(node(saved, "stroke")).toEqual(node(draft, "stroke"));
    expect(state(saved)).not.toEqual(state(draft));
    expect(canCommitBoardGesture(draft, saved, ["stroke"])).toBe(true);
    const disk = JSON.parse(await readFile(record.path, "utf8")).document;
    expect(disk.layout.stroke).toEqual(draft.layout!.stroke);
    expect(disk.content.attrs.inkState).toEqual(state(saved));
  }
});

it("compares nested Board and Region subtrees by editable state", async () => {
  const before = record.document;
  const draft = transformObjects(before, {
    "nested-stroke": { ...before.layout!["nested-stroke"], x: 60 },
  });
  const saved = await save(draft);
  expect(state(saved, "nested")).not.toEqual(state(draft, "nested"));
  for (const ids of [
    ["nested"],
    ["group"],
    ["stroke", "sibling"],
    ["group", "nested"],
  ])
    expect(canCommitBoardGesture(draft, saved, ids), ids.join(",")).toBe(true);
  const changed = editNode(saved, "nested-stroke", (value) => {
    value.attrs = { ...value.attrs, color: "#ff0000" };
  });
  const external = await save(changed, new FileStore(store.root));
  expect(canCommitBoardGesture(saved, external, ["group"])).toBe(false);
});

it("rejects real external object, ancestry, placement and lock changes", async () => {
  const acknowledged = await save(record.document);
  const changes = [
    (value: ShowDocument) =>
      transformObjects(value, {
        stroke: { ...value.layout!.stroke, x: value.layout!.stroke.x + 10 },
      }),
    (value: ShowDocument) =>
      editNode(value, "stroke", (child) => {
        child.attrs = { ...child.attrs, color: "#ff0000" };
      }),
    (value: ShowDocument) =>
      transformObjects(value, {
        group: { ...value.layout!.group, x: value.layout!.group.x + 10 },
      }),
    (value: ShowDocument) =>
      editNode(value, "group", (child) => {
        child.attrs = { ...child.attrs, name: "Renamed elsewhere" };
      }),
    (value: ShowDocument) =>
      moveNode(value, "stroke", value.content.attrs!.id, value.layout!.stroke),
    (value: ShowDocument) =>
      transformObjects(value, {
        stroke: { ...value.layout!.stroke, locked: true },
      }),
  ];
  for (const change of changes) {
    const baseline = record.document;
    const external = await save(change(baseline), new FileStore(store.root));
    expect(canCommitBoardGesture(baseline, external, ["stroke"])).toBe(false);
    await save(acknowledged);
  }
});

it("commits against the latest source and retains sibling edits and full causal state", async () => {
  const baseline = await save(record.document);
  const external = await save(
    editNode(baseline, "sibling", (value) => {
      value.attrs = { ...value.attrs, color: "#ff0000" };
    }),
    new FileStore(store.root),
  );
  expect(canCommitBoardGesture(baseline, external, ["stroke"])).toBe(true);
  const causalState = state(external);
  const transformed = transformObjects(external, {
    stroke: { ...baseline.layout!.stroke, x: baseline.layout!.stroke.x + 90 },
  });
  expect(state(transformed)).toEqual(causalState);
  expect(state(external)).toEqual(causalState);
  expect(node(transformed, "sibling").attrs!.color).toBe("#ff0000");
  const committed = await save(transformed);
  const reopened = await new FileStore(store.root).readPage(
    projectId,
    committed.id,
  );
  expect(reopened.document.layout!.stroke.x).toBe(transformed.layout!.stroke.x);
  expect(node(reopened.document, "sibling").attrs!.color).toBe("#ff0000");
});
