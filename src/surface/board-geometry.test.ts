import { describe, expect, it } from "vitest";
import { blankDocument } from "../core/catalog";
import { applyOperations } from "../core/diff";
import { createResource, createSurface } from "./containers.mjs";
import { addNode, moveNode, removeNode } from "./editing";
import {
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
  frameAnchor,
  frameBounds,
  normalizedAnchor,
  hitFrame,
  intersectsFrame,
  screenToSurface,
  surfaceToScreen,
  createSnapIndex,
  snapFrame,
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
