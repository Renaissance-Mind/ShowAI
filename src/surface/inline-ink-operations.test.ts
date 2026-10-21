import { expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { createResource } from "./containers.mjs";
import { addNode } from "./editing";
import { createPortableInk } from "./portable-ink.mjs";
import { bootstrapInkOperation, createInkOperation, materializeInkOperations } from "./ink-operations.mjs";
import { applyInkMaterialization, inkUpdateToOperation } from "./inline-ink-operations";
const frame = { x: 1, y: 2, width: 40, height: 20 };
const stroke = (id: string) => ({ type: "drawing", attrs: { id, tool: "pen", color: "#111111", strokeWidth: 2, extent: [40, 20], ink: createPortableInk([{ x: 2, y: 3 }], 2, [40, 20]) } });

it("converts the existing incremental bridge contract to editable operation deltas", () => {
  const seed = bootstrapInkOperation({ actor: "seed", pageId: "page", boardId: "board", nodes: [stroke("a"), stroke("b")], layout: { a: frame, b: frame } })!;
  const baseline = materializeInkOperations([seed]);
  const recolored = stroke("a"); recolored.attrs.color = "#0000ff";
  const { operation } = inkUpdateToOperation({ pageId: "page", boardId: "board", nodes: [recolored, stroke("c")], removedIds: ["b"], layout: { c: frame } }, baseline, { actor: "ipad", sequence: 1 });
  expect(operation!.changes.map(change => change.kind)).toEqual(["delete", "edit", "create"]);
  const result = materializeInkOperations([seed, operation!]);
  expect(result.strokes.filter(stroke => !stroke.deleted).map(stroke => stroke.id)).toEqual(["a", "c"]);
  expect(result.strokes.find(stroke => stroke.id === "a")!.node.attrs!.color).toBe("#0000ff");
});
it("does not turn an old native snapshot into resurrection of a tombstone", () => {
  const seed = bootstrapInkOperation({ actor: "seed", pageId: "page", boardId: "board", nodes: [stroke("a")], layout: { a: frame } })!;
  const erase = createInkOperation({ actor: "ipad", sequence: 1, pageId: "page", boardId: "board", parents: [seed.id], changes: [{ kind: "delete", strokeId: "a" }] });
  const result = inkUpdateToOperation({ pageId: "page", boardId: "board", nodes: [stroke("a")], layout: { a: frame } }, materializeInkOperations([seed, erase]), { actor: "web", sequence: 1 });
  expect(result.operation).toBeNull();
  expect(result.skippedDeletedIds).toEqual(["a"]);
});
it("applies a conflict-free result through existing Board hierarchy/layout semantics", () => {
  let document = createResource(blankDocument(), "board");
  const boardId = document.content.attrs!.id as string;
  document = addNode(document, stroke("a"), frame, boardId) as typeof document;
  const seed = bootstrapInkOperation({ actor: "seed", pageId: document.id, boardId, nodes: [stroke("a")], layout: { a: frame } })!;
  const move = createInkOperation({ actor: "ipad", sequence: 1, pageId: document.id, boardId, parents: [seed.id], changes: [{ kind: "edit", strokeId: "a", patch: { layout: { ...frame, x: 200 } } }] });
  expect(applyInkMaterialization(document, materializeInkOperations([seed, move])).layout!.a.x).toBe(200);
  const other = createInkOperation({ actor: "web", sequence: 1, pageId: document.id, boardId, parents: [seed.id], changes: [{ kind: "edit", strokeId: "a", patch: { layout: { ...frame, x: 500 } } }] });
  expect(() => applyInkMaterialization(document, materializeInkOperations([seed, move, other]))).toThrow("Unresolved ink operation conflicts");
});
