import { describe, it, expect } from "vitest";
import type { ShowDocument } from "../types";
import {
  inkScenePatch,
  portableNodeSamples,
  isEditableDrawing,
  inkModelPoses,
  createPortableInk,
  validatePortableInk,
  portableInkGeometry,
  portableInkHit,
  portableInkBounds,
} from "./portable-ink.mjs";
import { finishBoardDrawing } from "./board-drawing.mjs";
import { applyInkUpdate } from "./inline-ink";
import { transformObjects, duplicateObjects } from "./board-commands";
import { parseArtifact } from "../portable/validation.mjs";
import { reconcileSurface } from "./document.mjs";
import { mergePageContent } from "../core/page-merge-model";

const ink = () =>
  createPortableInk(
    [
      { x: 10, y: 20, pressure: 0.2 },
      { x: 90, y: 80, pressure: 1 },
    ],
    8,
    [100, 100],
  );
function node(id = "stroke") {
  return {
    type: "drawing",
    attrs: {
      id,
      tool: "pen",
      name: "Ink",
      color: "#234567",
      strokeWidth: 8,
      extent: [100, 100],
      points: [
        { x: 10, y: 20 },
        { x: 90, y: 80 },
      ],
      ink: ink(),
    },
  };
}
function document(): ShowDocument {
  return reconcileSurface({
    id: "page",
    title: "Ink",
    icon: "",
    cover: "",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: "2026-10-21T00:00:00Z",
    updatedAt: "2026-10-21T00:00:00Z",
    comments: [],
    content: {
      type: "surface",
      attrs: { id: "board", kind: "board" },
      content: [node()],
    },
    layout: { stroke: { x: 0, y: 0, width: 100, height: 100 } },
    surfaceViews: {},
  });
}
describe("portable ink kernel and collaboration", () => {
  it("keeps one authoritative trajectory rather than duplicating every sample in node attributes", () => {
    const points=Array.from({length:256},(_,i)=>({x:i,y:Math.sin(i/8)*20,pressure:i/255}));
    const result=finishBoardDrawing("pen",{color:"#234567",fillColor:"none",strokeWidth:8},{origin:points[0],points,release:points.at(-1)!,moved:true,scale:1});
    expect(result.node.attrs!.points).toHaveLength(2);
    expect(result.node.attrs!.ink.samples.length).toBeGreaterThanOrEqual(256);
    expect(result.node.attrs!.ink.samples[128][6]).toBe(points[128].pressure);
    expect(portableInkGeometry(result.node.attrs!.ink).path).toContain("L");
  });
  it("sends a versionable ink hierarchy without retransmitting unchanged samples", () => {
    const base=document(), next=structuredClone(base);
    next.content.content!.push(node("remote"));
    next.layout!.remote={x:200,y:0,width:100,height:100};
    const first=inkScenePatch(base,"board"), patch=inkScenePatch(next,"board",base);
    expect(first.nodes).toHaveLength(1);
    expect(patch.nodes.map(n=>n.attrs.id)).toEqual(["remote"]);
    expect(JSON.stringify(patch.document)).not.toContain("samples");
    expect(patch.document.content.content.map((n:{attrs:{id:string}})=>n.attrs.id)).toEqual(["stroke","remote"]);
    next.content.content=[];next.layout={};
    expect(inkScenePatch(next,"board",base).document.content.content).toEqual([]);
  });
  it("edits pressure and width through the same sample rules on every adapter", () => {
    const stroke=node(), original=structuredClone(stroke.attrs.ink.samples);
    expect(isEditableDrawing(stroke)).toBe(true);
    const varied=portableNodeSamples(stroke);
    expect(varied[0][3]).toBeLessThan(varied[1][3]);
    const uniform=portableNodeSamples({...stroke,attrs:{...stroke.attrs,pressure:false,strokeWidth:12}});
    expect(uniform.map(p=>p[3])).toEqual([12,12]);
    expect(stroke.attrs.ink.samples).toEqual(original);
    expect(isEditableDrawing({type:"drawing",attrs:{ink:{format:"showai-pencilkit-v1"}}})).toBe(false);
  });
  it("derives fractional root poses from the authoritative model without layout rounding", () => {
    const d = document();
    d.layout!.stroke = {
      x: 1.123456789,
      y: 2.345678901,
      width: 143.432167,
      height: 87.432165,
    };
    d.content.content![0].attrs!.extent = [143.432167, 87.432165];
    const result = inkModelPoses(d, "board");
    expect(result.complete).toBe(true);
    expect(result.nested).toBe(false);
    expect(result.poses.stroke[0]).toBe(1);
    expect(result.poses.stroke[3]).toBe(1);
    expect(result.poses.stroke[4]).toBeCloseTo(d.layout!.stroke.x, 10);
    expect(result.poses.stroke[5]).toBeCloseTo(d.layout!.stroke.y, 10);
  });
  it("stores a real drawing with editable geometry and no PNG/archive requirement", () => {
    const d = document();
    expect(() =>
      parseArtifact({ format: "showai", version: 3, document: d }),
    ).not.toThrow();
    const path = portableInkGeometry(ink()).path;
    expect(path).toContain("L");
    expect(path).not.toContain("image");
    const moved = transformObjects(d, {
      stroke: { x: 50, y: 20, width: 200, height: 150, rotation: 30 },
    });
    expect(moved.content.content![0].attrs!.ink).toEqual(
      d.content.content![0].attrs!.ink,
    );
    expect(
      duplicateObjects(moved, ["stroke"]).document.content.content,
    ).toHaveLength(2);
  });
  it("creates browser strokes through the same portable protocol", () => {
    const next = finishBoardDrawing(
      "highlighter",
      { color: "#345678", fillColor: "none", strokeWidth: 5, pressure: true },
      {
        origin: { x: 10, y: 20, pressure: 0.4 },
        release: { x: 50, y: 70, pressure: 0.8 },
        points: [{ x: 10, y: 20, pressure: 0.4 }],
        moved: true,
        scale: 1,
      },
    );
    expect(next.node.attrs!.ink.format).toBe("showai-ink-v1");
    expect(next.node.attrs!.ink.opacity).toBe(0.35);
    expect(() => validatePortableInk(next.node.attrs!.ink)).not.toThrow();
  });
  it("hits painted geometry, clips partial eraser masks and preserves scaled widths", () => {
    const i = ink();
    expect(portableInkHit(i, { x: 50, y: 50 }).inside).toBe(true);
    expect(portableInkHit(i, { x: 10, y: 85 }).inside).toBe(false);
    const narrow = portableInkBounds(i, 2),
      wide = portableInkBounds(i, 20);
    expect(wide.width).toBeGreaterThan(narrow.width);
    i.mask = [["M", 0, 0], ["L", 40, 0], ["L", 40, 100], ["L", 0, 100], ["Z"]];
    expect(portableInkHit(i, { x: 90, y: 80 }).inside).toBe(false);
    expect(portableInkHit(i, { x: 10, y: 20 }).inside).toBe(true);
  });
  it("rejects malformed versions, excessive samples and unsafe coordinates", () => {
    for (const patch of [
      { brushVersion: 2 },
      { transform: [0, 0, 0, 0, 0, 0] },
      { samples: [[0, 0, -1, 2, 2, 1, 1, 0, 1]] },
      { samples: [] },
      { width: Infinity },
      { unexpected: true },
    ])
      expect(() => validatePortableInk({ ...ink(), ...patch })).toThrow();
  });
  it("merges independent clients adding strokes and changing styles without replacing the board", () => {
    const base = document(),
      remote = structuredClone(base);
    remote.content.content![0].attrs!.color = "#abcdef";
    const next = applyInkUpdate(remote, {
      pageId: "page",
      boardId: "board",
      nodes: [node("other")],
      layout: { other: { x: 20, y: 50, width: 100, height: 100 } },
      removedIds: [],
      baseNodes: [],
      baseLayout: {},
    });
    expect(next.content.content).toHaveLength(2);
    expect(next.content.content![0].attrs!.color).toBe("#abcdef");
    const local = structuredClone(base);
    local.content.content!.push(node("local"));
    local.layout!.local = { x: 0, y: 100, width: 100, height: 100 };
    const merged = mergePageContent(base, local, next);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.document.content.content).toHaveLength(3);
  });
  it("preserves remote styles on a stale geometry delta, is replay safe and never resurrects deletions", () => {
    const base = document(),
      remote = structuredClone(base),
      edited = structuredClone(node());
    remote.content.content![0].attrs!.color = "#abcdef";
    edited.attrs.ink.samples[1][0] = 95;
    const delta = {
      pageId: "page",
      boardId: "board",
      nodes: [edited],
      layout: { stroke: base.layout!.stroke },
      removedIds: [],
      baseNodes: [node()],
      baseLayout: base.layout!,
    };
    const first = applyInkUpdate(remote, delta),
      second = applyInkUpdate(first, delta);
    expect(first.content.content![0].attrs!.color).toBe("#abcdef");
    expect(second).toEqual(first);
    const removed = structuredClone(remote);
    removed.content.content = [];
    delete removed.layout!.stroke;
    expect(applyInkUpdate(removed, delta).content.content).toHaveLength(0);
  });
  it("retains remotely modified strokes when a stale eraser attempts deletion", () => {
    const base=document(), remote=structuredClone(base);
    remote.content.content![0].attrs!.color="#abcdef";
    expect(()=>applyInkUpdate(remote,{pageId:"page",boardId:"board",nodes:[],layout:{},removedIds:["stroke"],baseNodes:[node()],baseLayout:base.layout!})).toThrow(/Concurrent ink deletion/);
    expect(remote.content.content).toHaveLength(1);
    expect(applyInkUpdate(base,{pageId:"page",boardId:"board",nodes:[],layout:{},removedIds:["stroke"],baseNodes:[node()],baseLayout:base.layout!}).content.content).toHaveLength(0);
  });
  it("exposes conflicting changes to the same property instead of silently losing them", () => {
    const base = document(),
      remote = structuredClone(base),
      edited = structuredClone(node());
    remote.content.content![0].attrs!.color = "#abcdef";
    edited.attrs.color = "#123456";
    expect(() =>
      applyInkUpdate(remote, {
        pageId: "page",
        boardId: "board",
        nodes: [edited],
        layout: {},
        removedIds: [],
        baseNodes: [node()],
        baseLayout: base.layout!,
      }),
    ).toThrow(/Concurrent ink edit/);
  });
});
