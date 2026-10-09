import { SurfaceGeometryStore } from "./geometry-store";
import { describe, expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { applyOperations } from "../core/diff";
import { createResource, createSurface } from "./containers.mjs";
import { addNode, moveNode, removeNode } from "./editing";
import {
  canCommitBoardGesture,
  transformObjects,
  duplicateObjects,
  removeObjects,
} from "./board-commands";
import {
  arrowEndpoints,
  indexSurfaceTree,
  reconcileConnections,
} from "./connections.mjs";
import { findSurfaceNode, remapSurfaceIds } from "./document.mjs";
import {
  validateDocument,
  serializeArtifact,
  parseArtifact,
} from "../portable/validation.mjs";
import {
  resizeFrame,
  selectionMinimum,
  frameAnchor,
  frameBounds,
  normalizedAnchor,
  hitFrame,
  intersectsFrame,
  screenToSurface,
  surfaceToScreen,
  createSnapIndex,
  snapFrame,
  snapResizeFrame,
} from "./geometry.mjs";

const fixture = () => {
  let doc = createResource(blankDocument(), "board");
  const root = doc.content.attrs!.id;
  doc = addNode(
    doc,
    createSurface("page", "Page", "page"),
    { x: 100, y: 100, width: 300, height: 200 },
    root,
  ) as typeof doc;
  doc = addNode(
    doc,
    {
      type: "image",
      attrs: {
        id: "image",
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0XcAAAAASUVORK5CYII=",
        alt: "Image",
      },
    },
    { x: 600, y: 100, width: 200, height: 200 },
    root,
  ) as typeof doc;
  doc = addNode(
    doc,
    {
      type: "drawing",
      attrs: {
        id: "arrow",
        tool: "arrow",
        name: "Connection",
        color: "#252629",
        strokeWidth: 2,
        extent: [200, 20],
        points: [
          { x: 0, y: 10 },
          { x: 200, y: 10 },
        ],
        bindings: {
          start: { targetId: "page", anchor: { x: 1, y: 0.5 } },
          end: { targetId: "image", anchor: { x: 0, y: 0.5 } },
        },
      },
    },
    { x: 400, y: 190, width: 200, height: 20 },
    root,
  ) as typeof doc;
  return doc;
};
const arrow = (doc: ReturnType<typeof fixture>) =>
  findSurfaceNode(doc, "arrow")!.node;
const ends = (doc: ReturnType<typeof fixture>) =>
  arrowEndpoints(arrow(doc), doc.layout.arrow);

describe("native Board geometry", () => {
  it("limits a mixed group before a member's minimum would break relative geometry", () => {
    const bounds = { x: 0, y: 0, width: 660, height: 200 };
    const minimum = selectionMinimum(bounds, [
      {
        frame: { x: 0, y: 0, width: 360, height: 200 },
        minWidth: 120,
        minHeight: 180,
        resizeHeight: true,
      },
      {
        frame: { x: 500, y: 0, width: 160, height: 100 },
        minWidth: 1,
        minHeight: 1,
        resizeHeight: true,
      },
    ]);
    expect(minimum).toEqual({ width: 220, height: 180 });
    const next = resizeFrame(bounds, { x: -650, y: 0 }, "e", minimum);
    expect(next.width).toBe(220);
    const ratio = next.width / bounds.width;
    expect(360 * ratio).toBe(120);
    expect(500 * ratio).toBeGreaterThan(360 * ratio);
  });

  it("snaps each moving resize edge while retaining its opposite edge", () => {
    const index = createSnapIndex([
      { id: "target", frame: { x: 100, y: 100, width: 100, height: 100 } },
    ]);
    const minimum = { width: 1, height: 1 };
    const west = snapResizeFrame(
      { x: 103, y: 300, width: 297, height: 100 },
      index,
      1,
      "w",
      minimum,
    ).frame;
    expect(west.x).toBe(100);
    expect(west.x + west.width).toBe(400);
    const north = snapResizeFrame(
      { x: 300, y: 103, width: 100, height: 297 },
      index,
      1,
      "n",
      minimum,
    ).frame;
    expect(north.y).toBe(100);
    expect(north.y + north.height!).toBe(400);
    expect(
      snapResizeFrame(
        { x: 0, y: 300, width: 197, height: 100 },
        index,
        1,
        "e",
        minimum,
      ).frame.width,
    ).toBe(200);
    expect(
      snapResizeFrame(
        { x: 300, y: 0, width: 100, height: 197 },
        index,
        1,
        "s",
        minimum,
      ).frame.height,
    ).toBe(200);
  });
  it("snaps a rotated edge only along its permitted resize axis", () => {
    const frame = { x: 0, y: 0, width: 100, height: 80, rotation: 90 };
    const index = createSnapIndex([
      { id: "target", frame: { x: 300, y: 92, width: 100, height: 100 } },
    ]);
    const fixed = frameAnchor(frame, { x: 0, y: 0.5 });
    const result = snapResizeFrame(frame, index, 1, "e", {
      width: 1,
      height: 1,
    });
    expect(frameAnchor(result.frame, { x: 1, y: 0.5 }).y).toBeCloseTo(92);
    expect(frameAnchor(result.frame, { x: 0, y: 0.5 }).y).toBeCloseTo(fixed.y);
    expect(result.guides.map((g) => g.axis)).toEqual(["y"]);
  });
  it("resizes rotated local axes while preserving the opposite anchor", () => {
    const frame = { x: 10, y: 20, width: 200, height: 100, rotation: 90 };
    const fixed = frameAnchor(frame, { x: 0, y: 0.5 });
    const resized = resizeFrame(frame, { x: 0, y: 100 }, "e");
    expect(resized.width).toBeCloseTo(300);
    const after = frameAnchor(resized, { x: 0, y: 0.5 });
    expect(after.x).toBeCloseTo(fixed.x);
    expect(after.y).toBeCloseTo(fixed.y);
    const northwest = resizeFrame(
      { x: 10, y: 20, width: 200, height: 100 },
      { x: 50, y: 20 },
      "nw",
    );
    expect(northwest).toEqual({ x: 60, y: 40, width: 150, height: 80 });
  });
  it("roundtrips screen coordinates after translation and zoom", () => {
    const point = { x: -850, y: 922 },
      origin = { x: 81, y: 52 },
      camera = { x: 200, y: -199, scale: 0.37 };
    const restored = screenToSurface(
      surfaceToScreen(point, origin, camera),
      origin,
      camera,
    );
    expect(restored.x).toBeCloseTo(point.x);
    expect(restored.y).toBeCloseTo(point.y);
  });
  it("shares center-rotated anchors, exact hit testing and bounds", () => {
    const frame = { x: 10, y: 20, width: 200, height: 100, rotation: 90 };
    const point = frameAnchor(frame, { x: 1, y: 0.5 });
    expect(point.x).toBeCloseTo(110);
    expect(point.y).toBeCloseTo(170);
    expect(normalizedAnchor(frame, point)).toEqual({ x: 1, y: 0.5 });
    const bounds = frameBounds(frame);
    expect(bounds.x).toBeCloseTo(60);
    expect(bounds.width).toBeCloseTo(100);
    expect(hitFrame(frame, point)).toBe(true);
    expect(hitFrame(frame, { x: 15, y: 25 })).toBe(false);
    expect(
      intersectsFrame(frame, { x: 10, y: 20, width: 10, height: 10 }),
    ).toBe(false);
    expect(
      intersectsFrame(frame, { x: 100, y: 100, width: 20, height: 20 }),
    ).toBe(true);
  });
  it("snaps edges with screen-space tolerance", () => {
    const index = createSnapIndex([
      { id: "a", frame: { x: 100, y: 100, width: 200, height: 200 } },
    ]);
    const frame = { x: 107, y: 405, width: 50, height: 50 };
    expect(snapFrame(frame, index, 1).frame.x).toBe(107);
    expect(snapFrame(frame, index, 0.5).frame.x).toBe(100);
    expect(snapFrame({ ...frame, x: 103 }, index, 1).guides[0].kind).toBe(
      "align",
    );
  });
  it("snaps centers and equal gaps without unrelated off-band objects", () => {
    const index = createSnapIndex([
      { id: "a", frame: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "b", frame: { x: 150, y: 0, width: 100, height: 100 } },
    ]);
    expect(
      snapFrame({ x: 302, y: 0, width: 100, height: 100 }, index).frame.x,
    ).toBe(300);
    expect(
      snapFrame({ x: 302, y: 500, width: 100, height: 100 }, index).frame.x,
    ).toBe(302);
    expect(
      snapFrame({ x: 43, y: 500, width: 20, height: 20 }, index).frame.x,
    ).toBe(40);
  });
});

describe("native connections and structural commands", () => {
  it("accepts equivalent file reloads while rejecting edits made during a gesture", () => {
    const original = fixture(),
      reloaded = structuredClone(original);
    reloaded.updatedAt = new Date().toISOString();
    expect(canCommitBoardGesture(original, reloaded, ["page"])).toBe(true);
    const changed = structuredClone(reloaded);
    changed.layout.page.x++;
    expect(canCommitBoardGesture(original, changed, ["page"])).toBe(false);
    const edited = structuredClone(reloaded);
    findSurfaceNode(edited, "page")!.node.attrs!.name = "Changed elsewhere";
    expect(canCommitBoardGesture(original, edited, ["page"])).toBe(false);
    expect(
      canCommitBoardGesture(original, removeObjects(reloaded, ["page"]), [
        "page",
      ]),
    ).toBe(false);
  });

  it("Agent transforms match UI arrow-only and grouped binding rules", () => {
    const before = fixture();
    const alone = applyOperations(before, [
      {
        type: "surface.layout.set",
        nodeId: "arrow",
        layout: { y: before.layout.arrow.y + 30 },
      },
    ]) as typeof before;
    expect(arrow(alone).attrs!.bindings).toBeUndefined();
    expect(ends(alone)).toEqual([
      { x: 400, y: 230 },
      { x: 600, y: 230 },
    ]);
    const group = applyOperations(
      before,
      ["page", "image", "arrow"].map((nodeId) => ({
        type: "surface.layout.set" as const,
        nodeId,
        layout: { y: before.layout[nodeId].y + 30 },
      })),
    ) as typeof before;
    expect(arrow(group).attrs!.bindings.start.targetId).toBe("page");
    expect(ends(group)).toEqual(ends(alone));
    expect(
      arrow(
        applyOperations(before, [
          {
            type: "surface.layout.set",
            nodeId: "arrow",
            layout: { y: before.layout.arrow.y },
          },
        ]) as typeof before,
      ).attrs!.bindings,
    ).toBeTruthy();
  });

  it("resolves anchors and updates a target move/resize in one transform", () => {
    const before = fixture();
    expect(ends(before)).toEqual([
      { x: 400, y: 200 },
      { x: 600, y: 200 },
    ]);
    const after = transformObjects(before, {
      page: { ...before.layout.page, x: 150, width: 400 },
    });
    expect(ends(after)).toEqual([
      { x: 550, y: 200 },
      { x: 600, y: 200 },
    ]);
    expect(before.layout.page.x).toBe(100);
    expect(findSurfaceNode(after, "image")!.node).toBe(
      findSurfaceNode(before, "image")!.node,
    );
    expect(after.layout.image).toBe(before.layout.image);
    expect(validateDocument(after)).toBeTruthy();
  });
  it("updates a rotated image target", () => {
    const before = fixture(),
      after = transformObjects(before, {
        image: { ...before.layout.image, rotation: 90 },
      });
    expect(ends(after)[1].x).toBeCloseTo(700);
    expect(ends(after)[1].y).toBeCloseTo(100);
    expect(validateDocument(after)).toBeTruthy();
  });
  it("freezes a deleted target endpoint and keeps remaining bindings", () => {
    const before = fixture(),
      after = removeNode(before, "page");
    expect(ends(after)).toEqual(ends(before));
    expect(arrow(after).attrs!.bindings.start).toBeUndefined();
    expect(arrow(after).attrs!.bindings.end.targetId).toBe("image");
    expect(validateDocument(after)).toBeTruthy();
    const both = removeObjects(before, ["page", "image"]);
    expect(ends(both)).toEqual(ends(before));
    expect(arrow(both).attrs!.bindings).toBeUndefined();
  });
  it("detaches cross-parent relationships and retains subtree identity on reparent", () => {
    let before = fixture();
    before = addNode(
      before,
      createSurface("board", "Nested", "nested"),
      { x: 0, y: 600, width: 800, height: 500 },
      before.content.attrs!.id,
    ) as typeof before;
    const moved = moveNode(before, "page", "nested", {
      ...before.layout.page,
      x: 0,
      y: 0,
    });
    expect(arrow(moved).attrs!.bindings.start).toBeUndefined();
    expect(ends(moved)).toEqual(ends(before));
    expect(findSurfaceNode(moved, "page")!.parent!.attrs!.id).toBe("nested");
    expect(validateDocument(moved)).toBeTruthy();
  });
  it("detaches arrow-only movement but retains group internal bindings", () => {
    const before = fixture();
    const moved = transformObjects(before, {
      arrow: { ...before.layout.arrow, y: before.layout.arrow.y + 50 },
    });
    expect(arrow(moved).attrs!.bindings).toBeUndefined();
    expect(ends(moved)).toEqual([
      { x: 400, y: 250 },
      { x: 600, y: 250 },
    ]);
    const grouped = transformObjects(
      before,
      Object.fromEntries(
        ["page", "image", "arrow"].map((id) => [
          id,
          { ...before.layout[id], y: before.layout[id].y + 50 },
        ]),
      ),
    );
    expect(arrow(grouped).attrs!.bindings.start.targetId).toBe("page");
    expect(ends(grouped)).toEqual(ends(moved));
  });
  it("copies native subtrees and remaps connections only to copied targets", () => {
    const before = fixture(),
      result = duplicateObjects(before, ["page", "image", "arrow"]);
    const copiedArrow = findSurfaceNode(result.document, result.ids[2])!.node;
    expect(copiedArrow.attrs!.bindings.start.targetId).toBe(result.ids[0]);
    expect(copiedArrow.attrs!.bindings.end.targetId).toBe(result.ids[1]);
    expect(findSurfaceNode(result.document, result.ids[0])!.node.type).toBe(
      "surface",
    );
    expect(validateDocument(result.document)).toBeTruthy();
    const one = duplicateObjects(before, ["arrow"]);
    expect(
      findSurfaceNode(one.document, one.ids[0])!.node.attrs!.bindings,
    ).toBeUndefined();
    const template = remapSurfaceIds(before);
    expect(validateDocument(template)).toBeTruthy();
    expect(
      [...indexSurfaceTree(template.content).values()].find(
        (e) => e.node.type === "drawing",
      )!.node.attrs!.bindings.start.targetId,
    ).not.toBe("page");
  });
  it("roundtrips artifact bytes with binding and rotation fields", () => {
    const doc = transformObjects(fixture(), {
      image: { x: 600, y: 100, width: 200, height: 200, rotation: 45 },
    });
    const parsed = parseArtifact(serializeArtifact(doc));
    expect(parsed.document.layout!.image.rotation).toBe(45);
    expect(
      findSurfaceNode(parsed.document, "arrow")!.node.attrs!.bindings,
    ).toEqual(arrow(doc).attrs!.bindings);
  });
  it("runs existing Agent layout commands through connection resolution", () => {
    const before = fixture();
    const after = applyOperations(before, [
      { type: "surface.layout.set", nodeId: "page", layout: { x: 140 } },
    ]);
    expect(ends(after as typeof before)[0]).toEqual({ x: 440, y: 200 });
  });
  it("rejects dangling bindings, non-arrow bindings and unsupported rotation", () => {
    let doc = fixture();
    arrow(doc).attrs!.bindings.start.targetId = "missing";
    expect(() => validateDocument(doc)).toThrow(/sibling/);
    doc = fixture();
    doc.layout.page.rotation = 30;
    expect(() => validateDocument(doc)).toThrow(/Rotation/);
    doc = fixture();
    arrow(doc).attrs!.bindings.start.anchor.x = 2;
    expect(() => validateDocument(doc)).toThrow(/anchor/);
  });
  it("resolving stable bindings is idempotent and preserves node identity", () => {
    const doc = fixture(),
      node = arrow(doc),
      content = doc.content;
    reconcileConnections(doc);
    expect(doc.content).toBe(content);
    expect(arrow(doc)).toBe(node);
  });
});

describe("content-sized object geometry", () => {
  it("notifies only the measured target's connections and batches gesture changes", () => {
    const store = new SurfaceGeometryStore();
    let a = 0,
      b = 0;
    const off = store.subscribe(["a"], () => a++);
    store.subscribe(["b"], () => b++);
    store.measure("a", 300, 200);
    expect([a, b]).toEqual([1, 0]);
    store.measure("a", 300, 200);
    expect(a).toBe(1);
    store.beginGesture();
    store.measure("a", 300, 300);
    store.measure("a", 300, 400);
    expect(a).toBe(1);
    store.endGesture();
    expect(a).toBe(2);
    off();
    store.measure("a", 300, 500);
    expect(a).toBe(2);
  });
  it("renders live height without mutating the source and materializes on a command", () => {
    const doc = fixture();
    doc.layout.page.heightMode = "auto";
    const bytes = JSON.stringify(doc),
      store = new SurfaceGeometryStore();
    store.measure("page", 300, 540);
    const resolved = store.resolveArrow(arrow(doc), doc.layout.arrow, doc);
    expect(arrowEndpoints(resolved.node, resolved.frame)[0]).toEqual({
      x: 400,
      y: 370,
    });
    expect(JSON.stringify(doc)).toBe(bytes);
    const saved = store.materialize(doc);
    expect(saved.layout.page.height).toBe(200);
    expect(saved.layout.page.contentSize).toEqual({ width: 300, height: 540 });
    expect(ends(saved)[0]).toEqual({ x: 400, y: 370 });
    expect(validateDocument(saved)).toBeTruthy();
    expect(ends(removeObjects(saved, ["page"]))[0]).toEqual({ x: 400, y: 370 });
  });
  it("does not reuse dimensions measured for a different width", () => {
    const doc = fixture();
    doc.layout.page.heightMode = "auto";
    const store = new SurfaceGeometryStore();
    store.measure("page", 200, 540);
    expect(store.materialize(doc).layout.page.contentSize).toBeUndefined();
    const next = {
      ...doc,
      layout: { ...doc.layout, page: { ...doc.layout.page, width: 200 } },
    };
    expect(store.materialize(next).layout.page.contentSize?.height).toBe(540);
  });
});
