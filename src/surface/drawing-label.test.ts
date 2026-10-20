import { describe, expect, it } from "vitest";
import { applyOperations } from "../core/diff";
import { blankDocument } from "../core/catalog";
import type { PageOperation, ShowDocument } from "../core/model";
import { createResource } from "./containers.mjs";
import { findSurfaceNode } from "./document.mjs";
import { tidyFrames } from "./diagram.mjs";
import { labelBox, labelledShapeSize } from "./drawing-label.mjs";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { toMarkdown } from "../lib/document";

const board = () =>
  createResource(blankDocument(), "board") as unknown as ShowDocument;
const rootId = (document: ShowDocument) =>
  document.content.attrs!.id as string;
const attrs = (document: ShowDocument, id: string) =>
  findSurfaceNode(document, id)!.node.attrs!;
const apply = (document: ShowDocument, operations: unknown[]) =>
  applyOperations(document, operations as PageOperation[]);

describe("Shape labels", () => {
  it("stores, validates and round-trips a label on shapes and arrows", () => {
    const document = apply(board(), [
      {
        type: "block.insert",
        node: {
          type: "drawing",
          attrs: { id: "box", tool: "rectangle", label: "API 服务\n鉴权", labelSize: 22 },
        },
      },
      { type: "surface.layout.set", nodeId: "box", layout: { x: 0, y: 0, width: 200, height: 90 } },
    ]);
    expect(attrs(document, "box")).toMatchObject({
      label: "API 服务\n鉴权",
      labelSize: 22,
      color: "#252629",
      strokeWidth: 2,
      extent: [200, 90],
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 90 },
      ],
    });
    const parsed = parseArtifact(serializeArtifact(document)) as {
      document: ShowDocument;
    };
    expect(attrs(parsed.document, "box").label).toBe("API 服务\n鉴权");
    expect(toMarkdown(document.content)).toContain("API 服务\n鉴权");
  });

  it("rejects labels on freehand strokes and empty or oversized labels", () => {
    const pen = {
      type: "drawing",
      attrs: {
        id: "pen",
        tool: "pen",
        color: "#252629",
        strokeWidth: 2.5,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    };
    expect(() =>
      apply(board(), [
        { type: "block.insert", node: { ...pen, attrs: { ...pen.attrs, label: "x" } } },
      ]),
    ).toThrow(/Only rectangle, ellipse and arrow/);
    for (const label of ["  ", "x".repeat(2001)])
      expect(() =>
        apply(board(), [
          { type: "block.insert", node: { type: "drawing", attrs: { id: "r", tool: "rectangle", label } } },
        ]),
      ).toThrow(/drawing.label/);
    expect(() =>
      apply(board(), [
        { type: "block.insert", node: { type: "drawing", attrs: { id: "r", tool: "ellipse", labelSize: 4 } } },
      ]),
    ).toThrow(/labelSize/);
  });

  it("keeps ellipse text inside the inscribed rectangle", () => {
    const box = labelBox("ellipse", 200, 100, 2);
    expect(box.x).toBeGreaterThan(29);
    expect(box.x + box.width).toBeLessThan(171);
    expect(box.y + box.height).toBeLessThan(86);
  });
});

describe("Drawing defaults for authors", () => {
  it("sizes an unframed shape from its label and fills style defaults", () => {
    const document = apply(board(), [
      {
        type: "block.insert",
        node: { type: "drawing", attrs: { id: "note", tool: "ellipse", label: "一段较长的说明文字，需要换行显示" } },
      },
    ]);
    const frame = document.layout!.note;
    const expected = labelledShapeSize("ellipse", "一段较长的说明文字，需要换行显示");
    expect(frame).toMatchObject(expected);
    expect(attrs(document, "note").extent).toEqual([frame.width, frame.height]);
    expect(frame.height).toBeGreaterThan(72);
  });

  it("resolves an arrow from bindings alone, facing the other object", () => {
    const document = apply(board(), [
      { type: "block.insert", node: { type: "drawing", attrs: { id: "a", tool: "rectangle" } } },
      { type: "surface.layout.set", nodeId: "a", layout: { x: 0, y: 0, width: 100, height: 60 } },
      { type: "block.insert", node: { type: "drawing", attrs: { id: "b", tool: "rectangle" } } },
      { type: "surface.layout.set", nodeId: "b", layout: { x: 300, y: 100, width: 100, height: 60 } },
      {
        type: "block.insert",
        node: {
          type: "drawing",
          attrs: {
            id: "link",
            tool: "arrow",
            label: "请求",
            bindings: { start: { targetId: "a" }, end: { targetId: "b" } },
          },
        },
      },
    ]);
    const link = attrs(document, "link");
    expect(link.bindings).toEqual({
      start: { targetId: "a", anchor: { x: 1, y: 0.5 } },
      end: { targetId: "b", anchor: { x: 0, y: 0.5 } },
    });
    const frame = document.layout!.link;
    const start = link.points[0],
      end = link.points.at(-1);
    expect(frame.x + start.x).toBeCloseTo(100);
    expect(frame.y + start.y).toBeCloseTo(30);
    expect(frame.x + end.x).toBeCloseTo(300);
    expect(frame.y + end.y).toBeCloseTo(130);
  });

  it("reports an unbound arrow without points", () => {
    expect(() =>
      apply(board(), [
        { type: "block.insert", node: { type: "drawing", attrs: { id: "lost", tool: "arrow" } } },
      ]),
    ).toThrow(/needs points, or bindings/);
  });

  it("leaves complete drawings from earlier writes untouched", () => {
    const first = apply(board(), [
      { type: "block.insert", node: { type: "drawing", attrs: { id: "a", tool: "rectangle", strokeWidth: 5 } } },
      { type: "surface.layout.set", nodeId: "a", layout: { x: 10, y: 20, width: 120, height: 80 } },
    ]);
    const second = apply(first, [
      { type: "block.insert", node: { type: "drawing", attrs: { id: "b", tool: "ellipse" } } },
    ]);
    expect(attrs(second, "a")).toEqual(attrs(first, "a"));
    expect(second.layout!.a).toEqual(first.layout!.a);
  });
});

describe("diagram.insert", () => {
  const nodes = [
    { id: "client", label: "客户端" },
    { id: "api", label: "API 服务", fillColor: "#ede9fe" },
    { id: "cache", label: "缓存" },
    { id: "db", label: "数据库", shape: "ellipse" },
  ];
  const edges = [
    { from: "client", to: "api", label: "请求" },
    { from: "api", to: "cache", label: "① 查缓存" },
    { from: "api", to: "db", label: "② 未命中再查库" },
  ];

  it("lays out labelled shapes and bound arrows in one operation", () => {
    const document = apply(board(), [{ type: "diagram.insert", nodes, edges }]);
    validateDocument(document);
    const layout = document.layout!;
    expect(layout.client.x).toBeLessThan(layout.api.x);
    expect(layout.api.x).toBeLessThan(layout.cache.x);
    expect(layout.cache.x).toBe(layout.db.x);
    expect(attrs(document, "db")).toMatchObject({ tool: "ellipse", label: "数据库" });
    expect(attrs(document, "api").fillColor).toBe("#ede9fe");
    const arrow = attrs(document, "api-to-db");
    expect(arrow).toMatchObject({ tool: "arrow", label: "② 未命中再查库" });
    expect(arrow.bindings.start.targetId).toBe("api");
    expect(arrow.bindings.end.targetId).toBe("db");
    // Arrows paint above the shapes they connect.
    const order = (document.content.content ?? []).map((n) => n.attrs!.id);
    expect(order.indexOf("client-to-api")).toBeGreaterThan(order.indexOf("db"));
  });

  it("flows downward and places a new diagram beside existing content", () => {
    const first = apply(board(), [{ type: "diagram.insert", nodes, edges }]);
    const right = Math.max(
      ...["client", "api", "cache", "db"].map(
        (id) => first.layout![id].x + first.layout![id].width,
      ),
    );
    const second = apply(first, [
      {
        type: "diagram.insert",
        direction: "down",
        nodes: [
          { id: "start", label: "开始" },
          { id: "end", label: "结束" },
        ],
        edges: [{ from: "start", to: "end" }, { from: "end", to: "db" }],
      },
    ]);
    expect(second.layout!.start.x).toBeGreaterThanOrEqual(right + 120);
    expect(second.layout!.end.y).toBeGreaterThan(second.layout!.start.y);
    expect(attrs(second, "end-to-db").bindings.end.targetId).toBe("db");
  });

  it("uses explicit positions relative to origin", () => {
    const document = apply(board(), [
      {
        type: "diagram.insert",
        origin: { x: 100, y: 50 },
        nodes: [
          { id: "a", x: 0, y: 0, width: 120, height: 60 },
          { id: "b", x: 300, y: 0 },
        ],
        edges: [{ id: "ab", from: "a", to: "b" }],
      },
    ]);
    expect(document.layout!.a).toEqual({ x: 100, y: 50, width: 120, height: 60 });
    expect(document.layout!.b).toMatchObject({ x: 400, y: 50 });
  });

  it("rejects ambiguous or dangling input", () => {
    const base = board();
    expect(() =>
      apply(base, [
        { type: "diagram.insert", nodes: [{ id: "a", x: 0, y: 0 }, { id: "b" }] },
      ]),
    ).toThrow(/every diagram node both x and y/);
    expect(() =>
      apply(base, [
        { type: "diagram.insert", nodes: [{ id: "a" }], edges: [{ from: "a", to: "ghost" }] },
      ]),
    ).toThrow(/ghost/);
    expect(() =>
      apply(base, [{ type: "diagram.insert", nodes: [{ id: rootId(base) }] }]),
    ).toThrow(/already in use/);
    const page = createResource(blankDocument()) as unknown as ShowDocument;
    expect(() =>
      apply(page, [{ type: "diagram.insert", nodes: [{ id: "a" }] }]),
    ).toThrow(/Board or a free-layout region/);
  });
});

describe("Tidy layout", () => {
  it("arranges connected objects along their arrows from the selection corner", () => {
    const document = apply(board(), [
      {
        type: "diagram.insert",
        nodes: [
          { id: "c", x: 400, y: 300 },
          { id: "a", x: 0, y: 200 },
          { id: "b", x: 50, y: 0 },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
        ],
      },
    ]);
    const { frames, anchors } = tidyFrames(document, ["a", "b", "c"], "right")!;
    expect(anchors["a-to-b"]).toEqual({
      start: { x: 1, y: 0.5 },
      end: { x: 0, y: 0.5 },
    });
    expect(frames.a.x).toBe(0);
    expect(frames.a.x).toBeLessThan(frames.b.x);
    expect(frames.b.x).toBeLessThan(frames.c.x);
    expect(Math.min(frames.a.y, frames.b.y, frames.c.y)).toBe(0);
    expect(tidyFrames(document, ["a"], "right")).toBeNull();
  });
});

describe("diagram.arrange", () => {
  it("arranges existing objects along their arrows and re-anchors the arrows", () => {
    const document = apply(board(), [
      {
        type: "diagram.insert",
        nodes: [
          { id: "a", x: 0, y: 300, label: "A" },
          { id: "b", x: 400, y: 0, label: "B" },
          { id: "loose", x: 900, y: 900 },
        ],
        edges: [{ from: "a", to: "b" }],
      },
    ]);
    const arranged = apply(document, [
      { type: "diagram.arrange", nodeIds: ["a", "b"], direction: "down" },
    ]);
    const layout = arranged.layout!;
    expect(layout.b.y).toBeGreaterThan(layout.a.y + layout.a.height!);
    expect(layout.loose).toEqual(document.layout!.loose);
    expect(attrs(arranged, "a-to-b").bindings).toEqual({
      start: { targetId: "a", anchor: { x: 0.5, y: 1 } },
      end: { targetId: "b", anchor: { x: 0.5, y: 0 } },
    });
    const arrow = attrs(arranged, "a-to-b"),
      frame = layout["a-to-b"];
    expect(frame.y + arrow.points[0].y).toBeCloseTo(layout.a.y + layout.a.height!);
    expect(() =>
      apply(document, [{ type: "diagram.arrange", nodeIds: ["a", "loose"] }]),
    ).toThrow(/arrow between two of them/);
  });

  it("removes a label when block.attrs.set sends null", () => {
    const document = apply(board(), [
      { type: "diagram.insert", nodes: [{ id: "a", label: "A", labelSize: 22 }] },
    ]);
    const cleared = apply(document, [
      { type: "block.attrs.set", blockId: "a", attrs: { label: null, labelSize: null } },
    ]);
    expect(attrs(cleared, "a")).not.toHaveProperty("label");
    expect(attrs(cleared, "a")).not.toHaveProperty("labelSize");
  });
});

describe("Page placeholders", () => {
  it("replaces a new Page's empty paragraph with inserted content", () => {
    const document = apply(board(), [
      { type: "surface.create", kind: "page", nodeId: "note", name: "Note" },
      {
        type: "component.insert",
        kind: "text",
        parentId: "note",
        data: { format: "markdown", content: "Hello" },
      },
    ]);
    const note = findSurfaceNode(document, "note")!.node;
    expect(note.content).toHaveLength(1);
    expect(JSON.stringify(note.content)).toContain("Hello");
    validateDocument(document);
  });

  it("keeps the paragraph when the Page already has text", () => {
    const created = apply(board(), [
      { type: "surface.create", kind: "page", nodeId: "note", name: "Note" },
    ]);
    const paragraph = findSurfaceNode(created, "note")!.node.content![0];
    const typed = apply(created, [
      { type: "block.text.set", blockId: paragraph.attrs!.id, text: "Draft" },
      {
        type: "component.insert",
        kind: "text",
        parentId: "note",
        data: { format: "markdown", content: "More" },
      },
    ]);
    expect(findSurfaceNode(typed, "note")!.node.content).toHaveLength(2);
  });
});
