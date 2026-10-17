import { expect, it } from "vitest";
import { overlappingPageAnnotations } from "./page-annotations";
import { arrowEndpoints, bindingAtPoint, reconcileConnections } from "./connections.mjs";
import { transformObjects } from "./board-commands";
import type { ShowDocument } from "../types";

it("carries crossing and contained strokes and leaves locked/distant strokes", () => {
  const stroke = (id: string) => ({
    type: "drawing",
    attrs: {
      id,
      tool: "pen",
      extent: [100, 20],
      strokeWidth: 2,
      points: [
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ],
    },
  });
  const doc = {
    content: {
      type: "surface",
      attrs: { id: "board", kind: "board" },
      content: [
        { type: "surface", attrs: { id: "page", kind: "page" }, content: [] },
        stroke("crossing"),
        stroke("inside"),
        stroke("locked"),
        stroke("outside"),
      ],
    },
    layout: {
      page: { x: 100, y: 100, width: 200, height: 200 },
      crossing: { x: 50, y: 150, width: 100, height: 20 },
      inside: { x: 150, y: 150, width: 100, height: 20 },
      locked: { x: 150, y: 150, width: 100, height: 20, locked: true },
      outside: { x: 350, y: 150, width: 100, height: 20 },
    },
  } as unknown as ShowDocument;
  expect(overlappingPageAnnotations(doc, ["page"], doc.layout!)).toEqual([
    "crossing",
    "inside",
  ]);
});

it("binds to the point inside a Page and retains that point when the Page moves", () => {
  const doc = {
    content: {
      type: "surface",
      attrs: { id: "board", kind: "board" },
      content: [
        { type: "surface", attrs: { id: "page", kind: "page" }, content: [] },
        {
          type: "drawing",
          attrs: {
            id: "arrow",
            tool: "arrow",
            strokeWidth: 2,
            extent: [200, 150],
            points: [
              { x: 0, y: 0 },
              { x: 200, y: 150 },
            ],
          },
        },
      ],
    },
    layout: {
      page: { x: 100, y: 100, width: 400, height: 400 },
      arrow: { x: 0, y: 0, width: 200, height: 150 },
    },
  } as unknown as ShowDocument;
  const binding = bindingAtPoint(doc, "board", { x: 200, y: 150 });
  expect(binding).toEqual({ targetId: "page", anchor: { x: 0.25, y: 0.125 } });
  doc.content.content![1].attrs!.bindings = { end: binding };
  reconcileConnections(doc);
  const moved = transformObjects(doc, {
    page: { ...doc.layout!.page, x: 150 },
  });
  expect(moved.content.content![1].attrs!.bindings.end).toEqual(binding);
  expect(arrowEndpoints(moved.content.content![1], moved.layout!.arrow)[1]).toEqual({ x: 250, y: 150 });
});
