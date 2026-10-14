import { describe, expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { createResource, createSurface } from "./containers.mjs";
import { addNode } from "./editing";
import {
  adoptIntoRegion,
  alignOffsets,
  copyObjects,
  groupObjects,
  isBoardClip,
  pasteObjects,
  reorderObjects,
  rescaledDrawing,
  setObjectsLocked,
  transformObjects,
  ungroupRegion,
} from "./board-commands";
import { connectionAnchor } from "./connections.mjs";
import { findSurfaceNode } from "./document.mjs";
import { arrowPath, pickShape, smoothPath } from "./drawing-geometry.mjs";
import { validateDocument } from "../portable/validation.mjs";
import { gridSpacing } from "./useSurfaceViewport";
import { boardToolForKey, boardToolShortcut } from "./board-tools";

const rectangle = (id: string) => ({
  type: "drawing",
  attrs: {
    id,
    tool: "rectangle",
    name: "矩形",
    color: "#252629",
    fillColor: "none",
    strokeWidth: 2,
    extent: [100, 50],
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
  },
});
const fixture = () => {
  let doc = createResource(blankDocument(), "board");
  const root = doc.content.attrs!.id as string;
  doc = addNode(
    doc,
    createSurface("page", "Page", "page"),
    { x: 100, y: 100, width: 300, height: 200 },
    root,
  ) as typeof doc;
  for (const [id, x] of [
    ["a", 0],
    ["b", 200],
    ["c", 500],
  ] as const)
    doc = addNode(
      doc,
      rectangle(id),
      { x, y: 400, width: 100, height: 50 },
      root,
    ) as typeof doc;
  doc = addNode(
    doc,
    {
      type: "drawing",
      attrs: {
        id: "arrow",
        tool: "arrow",
        name: "连接",
        color: "#252629",
        strokeWidth: 2,
        extent: [100, 20],
        points: [
          { x: 0, y: 10 },
          { x: 100, y: 10 },
        ],
        bindings: {
          start: { targetId: "a", anchor: { x: 1, y: 0.5 } },
          end: { targetId: "b", anchor: { x: 0, y: 0.5 } },
        },
      },
    },
    { x: 100, y: 415, width: 100, height: 20 },
    root,
  ) as typeof doc;
  return { doc, root };
};
const order = (doc: ReturnType<typeof fixture>["doc"]) =>
  (doc.content.content ?? []).map((node) => node.attrs!.id);

describe("Board editing commands", () => {
  it("rescales a resized drawing instead of stretching its stroke", () => {
    const { doc } = fixture();
    const resized = transformObjects(doc, {
      a: { x: 0, y: 400, width: 300, height: 50 },
    });
    const node = findSurfaceNode(resized, "a")!.node;
    expect(node.attrs!.extent).toEqual([300, 50]);
    expect(node.attrs!.points[1]).toEqual({ x: 300, y: 50 });
    expect(node.attrs!.strokeWidth).toBe(2);
    expect(validateDocument(resized)).toBeTruthy();
    // A pure move keeps the drawing's identity.
    const moved = transformObjects(doc, {
      a: { x: 30, y: 420, width: 100, height: 50 },
    });
    expect(findSurfaceNode(moved, "a")!.node).toBe(
      findSurfaceNode(doc, "a")!.node,
    );
    expect(
      rescaledDrawing(findSurfaceNode(doc, "arrow")!.node, doc.layout.arrow, {
        ...doc.layout.arrow,
        width: 300,
      }),
    ).toBeNull();
  });
  it("copies and pastes with fresh ids and only internal connections", () => {
    const { doc, root } = fixture();
    const clip = JSON.parse(
      JSON.stringify(copyObjects(doc, ["a", "b", "arrow"])),
    );
    expect(isBoardClip(clip)).toBe(true);
    expect(isBoardClip({ nodes: [] })).toBe(false);
    const pasted = pasteObjects(doc, root, clip, { x: 10, y: 20 });
    expect(pasted.ids).toHaveLength(3);
    expect(pasted.ids.some((id) => ["a", "b", "arrow"].includes(id))).toBe(
      false,
    );
    const copiedArrow = findSurfaceNode(pasted.document, pasted.ids[2])!.node;
    expect(copiedArrow.attrs!.bindings.start.targetId).toBe(pasted.ids[0]);
    expect(pasted.document.layout[pasted.ids[0]]).toMatchObject({
      x: 10,
      y: 420,
    });
    expect(validateDocument(pasted.document)).toBeTruthy();
    const alone = pasteObjects(doc, root, copyObjects(doc, ["arrow"]));
    expect(
      findSurfaceNode(alone.document, alone.ids[0])!.node.attrs!.bindings,
    ).toBeUndefined();
  });
  it("reorders paint order while keeping the selection's relative order", () => {
    const { doc } = fixture();
    expect(order(reorderObjects(doc, ["a"], "front")).at(-1)).toBe("a");
    expect(order(reorderObjects(doc, ["c", "b"], "back")).slice(0, 2)).toEqual([
      "b",
      "c",
    ]);
    const forward = order(reorderObjects(doc, ["a"], "forward"));
    expect(forward.indexOf("a")).toBe(order(doc).indexOf("a") + 1);
    expect(reorderObjects(doc, [order(doc)[0]], "backward")).toBe(doc);
  });
  it("aligns and distributes visual bounds", () => {
    const boxes = {
      a: { x: 0, y: 0, width: 100, height: 50 },
      b: { x: 150, y: 30, width: 50, height: 50 },
      c: { x: 400, y: 10, width: 100, height: 20 },
    };
    expect(alignOffsets(boxes, "left").b).toEqual({ x: -150, y: 0 });
    expect(alignOffsets(boxes, "bottom").c).toEqual({ x: 0, y: 50 });
    expect(alignOffsets(boxes, "center").a.x).toBe(200);
    const spaced = alignOffsets(boxes, "distribute-x");
    // Gap = (500 - 250) / 2 = 125: b starts at 225.
    expect(spaced.b.x).toBe(75);
    expect(spaced.a.x).toBe(0);
    expect(alignOffsets({ a: boxes.a }, "left")).toEqual({});
  });
  it("groups into a free region and ungroups back to the same positions", () => {
    const { doc, root } = fixture();
    const offset = { x: 45, y: 27 };
    const grouped = groupObjects(
      doc,
      ["a", "b", "arrow"],
      { x: 0, y: 400, width: 300, height: 50 },
      offset,
    )!;
    const region = findSurfaceNode(grouped.document, grouped.id)!;
    expect(region.parent!.attrs!.id).toBe(root);
    expect(region.node.content!.map((node) => node.attrs!.id)).toEqual([
      "a",
      "b",
      "arrow",
    ]);
    expect(grouped.document.layout.a).toMatchObject({ x: 0, y: 0 });
    // Connections between grouped objects survive the move.
    expect(
      findSurfaceNode(grouped.document, "arrow")!.node.attrs!.bindings,
    ).toBeTruthy();
    expect(validateDocument(grouped.document)).toBeTruthy();
    const back = ungroupRegion(grouped.document, grouped.id, offset)!;
    expect(back.ids).toEqual(["a", "b", "arrow"]);
    expect(back.document.layout.b).toMatchObject({ x: 200, y: 400 });
    expect(findSurfaceNode(back.document, grouped.id)).toBeFalsy();
    expect(ungroupRegion(doc, "a", offset)).toBeNull();
  });
  it("adopts only siblings into a drawn region", () => {
    const { doc, root } = fixture();
    let next = addNode(
      doc,
      { type: "region", attrs: { id: "r", name: "区域" }, content: [] },
      { x: 450, y: 350, width: 300, height: 200, mode: "free", gap: 24 },
      root,
    );
    next = adoptIntoRegion(next, "r", ["c", "r"], { x: 45, y: 27 });
    expect(findSurfaceNode(next, "c")!.parent!.attrs!.id).toBe("r");
    expect(next.layout.c).toMatchObject({ x: 5, y: 23 });
  });
  it("stores and validates locked frames", () => {
    const { doc } = fixture();
    const locked = setObjectsLocked(doc, ["a", "b"], true);
    expect(locked.layout.a.locked).toBe(true);
    expect(validateDocument(locked)).toBeTruthy();
    const unlocked = setObjectsLocked(locked, ["a"], false);
    expect("locked" in unlocked.layout.a).toBe(false);
    expect(setObjectsLocked(unlocked, ["a"], false)).toBe(unlocked);
    const invalid = structuredClone(doc);
    (invalid.layout.a as unknown as Record<string, unknown>).locked = false;
    expect(() => validateDocument(invalid)).toThrow(/locked/);
  });
});

describe("Board geometry helpers", () => {
  it("attaches connections to edge midpoints when near or deep inside", () => {
    const frame = { x: 0, y: 0, width: 200, height: 100 };
    expect(connectionAnchor(frame, { x: 190, y: 45 })).toEqual({
      x: 1,
      y: 0.5,
    });
    expect(connectionAnchor(frame, { x: 100, y: 40 })).toEqual({
      x: 0.5,
      y: 0,
    });
    // On an edge away from its middle, the exact point is kept.
    expect(connectionAnchor(frame, { x: 20, y: 0 })).toEqual({ x: 0.1, y: 0 });
  });
  it("treats free regions as hollow so overlapped objects stay reachable", () => {
    const point = { x: 50, y: 50 };
    const behind = {
      id: "under",
      node: { type: "image", attrs: { id: "under" } },
      frame: { x: 0, y: 0, width: 100, height: 100 },
      point,
      tolerance: 4,
      scale: 1,
    };
    const region = {
      id: "region",
      node: { type: "region", attrs: { id: "region" } },
      frame: { x: 0, y: 0, width: 400, height: 400, mode: "free" as const },
      point,
      tolerance: 4,
      scale: 1,
    };
    expect(pickShape([behind, region])!.id).toBe("under");
    expect(pickShape([region])!.id).toBe("region");
  });
  it("draws smooth strokes and stroke-sized arrowheads", () => {
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe("M 0 0 L 10 0");
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toContain("Q 10 0 15 5");
    const thin = arrowPath({ x: 0, y: 0 }, { x: 400, y: 0 }, 2);
    const thick = arrowPath({ x: 0, y: 0 }, { x: 400, y: 0 }, 10);
    const headStart = (path: string) => Number(path.split(" ")[7]);
    expect(headStart(thick)).toBeLessThan(headStart(thin));
  });
  it("keeps dot grid spacing readable at every zoom", () => {
    for (const scale of [0.1, 0.25, 1, 2, 4])
      expect(gridSpacing(scale)).toBeGreaterThanOrEqual(12);
    for (const scale of [0.1, 1, 4])
      expect(gridSpacing(scale)).toBeLessThanOrEqual(96);
  });
  it("maps tool shortcuts, including hand and text", () => {
    expect(boardToolForKey("h")?.tool).toBe("highlighter");
    expect(boardToolForKey("T")?.tool).toBe("text");
    expect(boardToolForKey("t")?.tool).toBe("text");
    expect(boardToolForKey("m")?.tool).toBe("pan");
    expect(boardToolForKey("2")?.tool).toBe("pen");
    expect(boardToolShortcut("ellipse")).toBe("E / O / 5");
  });
});
