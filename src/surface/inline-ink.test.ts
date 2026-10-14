import { expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { createResource, createSurface } from "./containers.mjs";
import { addNode } from "./editing";
import { applyInkUpdate, inkNodes } from "./inline-ink";
import { polygonContains } from "./lasso";

it("merges a completed native stroke into the latest Board while retaining shapes and nested ink", () => {
  let document = createResource(blankDocument(), "board");
  const id = document.content.attrs!.id;
  const shape = {
    type: "drawing",
    attrs: {
      id: "shape",
      tool: "rectangle",
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 20 },
      ],
      extent: [30, 20],
      color: "#252629",
      strokeWidth: 2,
    },
  };
  const ink = (id: string) => ({
    type: "widget",
    attrs: {
      id,
      kind: "image",
      data: { nativeInk: { format: "showai-pencilkit-v1" } },
    },
  });
  document = addNode(
    document,
    ink("old"),
    { x: 1, y: 2, width: 10, height: 10 },
    id,
  ) as typeof document;
  document = addNode(
    document,
    shape,
    { x: 50, y: 60, width: 30, height: 20 },
    id,
  ) as typeof document;
  const nested = createSurface("board", "Nested", "nested");
  nested.content = [ink("nested-ink")];
  document = addNode(
    document,
    nested,
    { x: 100, y: 100, width: 400, height: 300 },
    id,
  ) as typeof document;
  const updated = applyInkUpdate(document, {
    pageId: document.id,
    boardId: id,
    nodes: [ink("new")],
    layout: { new: { x: 5, y: 6, width: 40, height: 20 } },
  });
  expect(updated.content.content!.find((n) => n.attrs?.id === "shape")).toEqual(
    shape,
  );
  expect(
    updated.content.content!.find((n) => n.attrs?.id === "nested"),
  ).toEqual(nested);
  expect(inkNodes(updated.content).map((n) => n.attrs!.id)).toEqual(["new"]);
  expect(updated.layout?.old).toBeUndefined();
  expect(updated.layout?.shape).toEqual(document.layout.shape);
  expect(updated.layout?.new.x).toBe(5);
  expect(
    applyInkUpdate(document, {
      pageId: "another",
      boardId: id,
      nodes: [],
      layout: {},
    }),
  ).toBe(document);
});
it("erasing ink leaves the current Board's other objects and their positions intact", () => {
  const document = createResource(blankDocument(), "board"),
    id = document.content.attrs!.id;
  const ink = {
    type: "widget",
    attrs: { id: "ink", kind: "image", data: { nativeInk: {} } },
  };
  const source = addNode(
    document,
    ink,
    { x: -50, y: 200, width: 120, height: 40 },
    id,
  );
  const result = applyInkUpdate(source, {
    pageId: source.id,
    boardId: id,
    nodes: [],
    layout: {},
  });
  expect(inkNodes(result.content)).toEqual([]);
  expect(result.layout?.ink).toBeUndefined();
});
it("a concave lasso selects the enclosed area without turning it into a rectangular marquee", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 30 },
    { x: 30, y: 30 },
    { x: 30, y: 100 },
    { x: 0, y: 100 },
  ];
  expect(polygonContains(polygon, { x: 15, y: 80 })).toBe(true);
  expect(polygonContains(polygon, { x: 80, y: 15 })).toBe(true);
  expect(polygonContains(polygon, { x: 80, y: 80 })).toBe(false);
});
