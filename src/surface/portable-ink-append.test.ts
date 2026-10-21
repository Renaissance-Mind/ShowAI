import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { createPortableInk } from "./portable-ink.mjs";
import { longCubicInputFixture } from "./cubic-ink-chunks.fixture.mjs";
import {
  appendNewPortableInk,
  appendPortableInkFromSource,
} from "./portable-ink-append.mjs";

const frame = () => ({
  x: 2.25,
  y: -4.5,
  width: 120,
  height: 80,
  rotation: -12,
});
const widget = (id: string): JSONContent => ({
  type: "widget",
  attrs: { id, kind: "text", data: { text: id } },
});
const stroke = (
  id = "A",
  ink = createPortableInk(
    [
      { x: 1, y: 2, pressure: 0.4 },
      { x: 20, y: 30, pressure: 1 },
    ],
    4,
    [120, 80],
  ),
): JSONContent => ({
  type: "drawing",
  attrs: { id, tool: "pen", color: "#123456", ink },
});
function document(children: JSONContent[] = []): ShowDocument {
  return {
    id: "page",
    title: "Append",
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
      content: children,
    },
    layout: Object.fromEntries(
      children.map((node) => [node.attrs!.id, frame()]),
    ),
    surfaceViews: {
      board: {
        initial: null,
        saved: [],
        readingOrder: children.map((node) => node.attrs!.id),
      },
    },
  };
}
const ids = (d: ShowDocument) =>
  d.content.content!.map((node) => node.attrs!.id);
const order = (d: ShowDocument) => d.surfaceViews!.board.readingOrder;
const frozen = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
};

describe("pure portable ink append", () => {
  it("copies only the edited tree/layout/view paths and retains literal unknown fields", () => {
    const old = widget("O"),
      input = document([old]),
      a = stroke(),
      placement = frame();
    const unknown = { nested: ["keep"] };
    const target = {
      ...input,
      futureRoot: unknown,
      é: { value: 1 },
      "e\u0301": { value: 2 },
    };
    target.content = {
      ...target.content,
      futureContent: unknown,
    } as JSONContent;
    target.content.attrs!.future = unknown;
    target.surfaceViews!.board = Object.assign({}, target.surfaceViews!.board, {
      futureView: unknown,
    });
    frozen(target);
    frozen(a);
    frozen(placement);
    const next = appendNewPortableInk(target, "board", a, placement);
    expect(next).not.toBe(target);
    expect(next.content).not.toBe(target.content);
    expect(next.content.attrs).toBe(target.content.attrs);
    expect(next.content.content![0]).toBe(old);
    expect(next.content.content![1]).toBe(a);
    expect(next.layout!.O).toBe(target.layout!.O);
    expect(next.layout!.A).toBe(placement);
    expect(next.futureRoot).toBe(unknown);
    expect(next["é"]).toBe(target["é"]);
    expect(next["e\u0301"]).toBe(target["e\u0301"]);
    expect((next.content as Record<string, unknown>).futureContent).toBe(
      unknown,
    );
    expect(
      (next.surfaceViews!.board as unknown as Record<string, unknown>)
        .futureView,
    ).toBe(unknown);
    expect(next.surfaceViews!.board.saved).toBe(
      target.surfaceViews!.board.saved,
    );
    expect(order(next)).toEqual(["O", "A"]);
    expect(ids(target)).toEqual(["O"]);
  });
  it("appends to the actual nested Board with ancestor COW and untouched sibling identity", () => {
    const a = stroke(),
      board = document([widget("O")]).content;
    const other = {
      type: "surface",
      attrs: { id: "other", kind: "board" },
      content: [],
    };
    const region = {
      type: "region",
      attrs: { id: "region", future: [1] },
      content: [board, other],
    };
    const sibling = widget("sibling"),
      target = document();
    target.content = {
      type: "surface",
      attrs: { id: "page-root", kind: "page" },
      content: [region, sibling],
    };
    const next = appendNewPortableInk(
      frozen(target),
      "board",
      frozen(a),
      frame(),
    );
    const nextRegion = next.content.content![0];
    expect(next.content.content![1]).toBe(sibling);
    expect(nextRegion.attrs).toBe(region.attrs);
    expect(nextRegion.content![1]).toBe(other);
    expect(nextRegion.content![0].content!.at(-1)).toBe(a);
    expect(region.content[0].content).toHaveLength(1);
  });
  it("retains a real 20,000-segment v2 source and raw capture without cloning it", () => {
    const ink = longCubicInputFixture(),
      a: JSONContent = { type: "drawing", attrs: { id: "A", ink } };
    const target = frozen(document()),
      source = document([a]);
    frozen(ink);
    expect(ink.segments).toHaveLength(20000);
    expect(ink.capture!.raw).toHaveLength(20001);
    const created = appendNewPortableInk(target, "board", a, source.layout!.A);
    const recovered = appendPortableInkFromSource(target, source, "board", "A");
    for (const result of [created, recovered]) {
      const actual = result.content.content![0];
      expect(actual).toBe(a);
      expect(actual.attrs!.ink).toBe(ink);
      expect(actual.attrs!.ink.segments).toBe(ink.segments);
      expect(actual.attrs!.ink.capture.raw).toBe(ink.capture!.raw);
      expect(actual.attrs!.ink.segments[19999]).toBe(ink.segments[19999]);
    }
  });
  it("permits an absent draft tool without granting proof and rejects explicit shape/unsupported portable kinds", () => {
    const a = stroke();
    delete a.attrs!.tool;
    expect(ids(appendNewPortableInk(document(), "board", a, frame()))).toEqual([
      "A",
    ]);
    for (const node of [
      widget("A"),
      { ...a, attrs: { ...a.attrs, tool: "rectangle" } },
      { ...a, attrs: { ...a.attrs, ink: { format: "showai-pencilkit-v1" } } },
    ]) {
      expect(() =>
        appendNewPortableInk(document(), "board", node, frame()),
      ).toThrow(/portable/);
    }
  });
  it("does not upgrade a legacy doc or append to a Page pretending to be a Board", () => {
    const target = document();
    target.content = { type: "doc", content: [] };
    expect(() =>
      appendNewPortableInk(target, "board", stroke(), frame()),
    ).toThrow(/resource/);
    const page = document();
    page.content.attrs!.kind = "page";
    expect(appendNewPortableInk(page, "board", stroke(), frame())).toBe(page);
  });
  it("returns the original target for a removed Board without creating layout/views", () => {
    const source = document([stroke()]),
      target = document([widget("B")]);
    target.content.attrs!.id = "different";
    const beforeLayout = target.layout,
      beforeViews = target.surfaceViews;
    expect(appendNewPortableInk(target, "board", stroke(), frame())).toBe(
      target,
    );
    expect(appendPortableInkFromSource(target, source, "board", "A")).toBe(
      target,
    );
    expect(target.layout).toBe(beforeLayout);
    expect(target.surfaceViews).toBe(beforeViews);
  });
  it("reports global new-ID conflicts including an existing stroke in the same Board", () => {
    const target = document([stroke()]);
    expect(() =>
      appendNewPortableInk(target, "board", stroke(), frame()),
    ).toThrow(/already exists/);
    const nested = document([
      {
        type: "surface",
        attrs: { id: "other", kind: "board" },
        content: [stroke()],
      },
    ]);
    expect(() =>
      appendNewPortableInk(nested, "board", stroke(), frame()),
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(() =>
      appendPortableInkFromSource(nested, document([stroke()]), "board", "A"),
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
  });
  it("rejects a same-Board widget reusing the accepted drawing ID", () => {
    expect(() =>
      appendPortableInkFromSource(
        document([widget("A")]),
        document([stroke()]),
        "board",
        "A",
      ),
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
  });
  it("validates the actual source before existing-target and missing-target early returns", () => {
    const existing = document([stroke()]),
      removed = document();
    removed.content.attrs!.id = "removed";
    const bad = [
      document(),
      document([widget("A")]),
      { ...document([stroke()]), layout: {} },
      { ...document([stroke()]), layout: { A: { ...frame(), x: NaN } } },
    ];
    for (const source of bad)
      for (const target of [existing, removed])
        expect(() =>
          appendPortableInkFromSource(target, source, "board", "A"),
        ).toThrow();
    const other = document([stroke()]);
    other.content.attrs!.id = "other";
    expect(() =>
      appendPortableInkFromSource(existing, other, "board", "A"),
    ).toThrow(/source Board/);
  });
  it("preserves a current stroke's foreign style and pose exactly when it already exists", () => {
    const source = document([stroke()]),
      target = document([stroke()]);
    target.content.content![0].attrs!.color = "#abcdef";
    target.layout!.A = { ...frame(), x: 900, rotation: 80 };
    expect(
      appendPortableInkFromSource(frozen(target), source, "board", "A"),
    ).toBe(target);
    expect(target.content.content![0].attrs!.color).toBe("#abcdef");
    expect(target.layout!.A.x).toBe(900);
  });
  it("keeps an existing stroke grouped in the same Board instead of moving it", () => {
    const a = stroke(),
      target = document([
        { type: "region", attrs: { id: "group" }, content: [a] },
      ]);
    target.layout!.A = frame();
    expect(
      appendPortableInkFromSource(target, document([stroke()]), "board", "A"),
    ).toBe(target);
    const source = document([
      { type: "region", attrs: { id: "group" }, content: [stroke()] },
    ]);
    source.layout!.A = frame();
    expect(() =>
      appendPortableInkFromSource(document(), source, "board", "A"),
    ).toThrow(/direct Board/);
  });
  it("inserts accepted A between surviving O and the later widget B", () => {
    const source = document([widget("O"), stroke()]),
      target = document([widget("O"), widget("B")]);
    const next = appendPortableInkFromSource(
      frozen(target),
      source,
      "board",
      "A",
    );
    expect(ids(next)).toEqual(["O", "A", "B"]);
    expect(order(next)).toEqual(["O", "A", "B"]);
    expect(next.content.content![0]).toBe(target.content.content![0]);
    expect(next.content.content![2]).toBe(target.content.content![1]);
    expect(next.layout!.A).toBe(source.layout!.A);
  });
  it("prepends a source-first A even when the target contains a later widget B", () => {
    const next = appendPortableInkFromSource(
      document([widget("B"), widget("C")]),
      document([stroke(), widget("C")]),
      "board",
      "A",
    );
    expect(ids(next)).toEqual(["A", "B", "C"]);
    expect(order(next)).toEqual(["A", "B", "C"]);
  });
  it("uses the nearest surviving predecessor, then successor, and otherwise appends", () => {
    const source = document([widget("O"), widget("P"), stroke(), widget("C")]);
    const predecessor = appendPortableInkFromSource(
      document([widget("O"), widget("B")]),
      source,
      "board",
      "A",
    );
    expect(ids(predecessor)).toEqual(["O", "A", "B"]);
    const successor = appendPortableInkFromSource(
      document([widget("B"), widget("C")]),
      source,
      "board",
      "A",
    );
    expect(ids(successor)).toEqual(["B", "A", "C"]);
    const noAnchor = appendPortableInkFromSource(
      document([widget("B")]),
      source,
      "board",
      "A",
    );
    expect(ids(noAnchor)).toEqual(["B", "A"]);
  });
  it("COW-updates only the existing legacy view branch and preserves modern sibling views", () => {
    const target = document([widget("O")]),
      legacy = {
        initial: null,
        saved: [],
        readingOrder: ["O"],
        future: { x: 1 },
      };
    target.surfaceViews = {
      other: { initial: null, saved: [], readingOrder: [] },
    };
    target.views = legacy;
    const next = appendNewPortableInk(
      frozen(target),
      "board",
      stroke(),
      frame(),
    );
    expect(next.surfaceViews).toBe(target.surfaceViews);
    expect(next.views).not.toBe(legacy);
    expect(next.views!.readingOrder).toEqual(["O", "A"]);
    expect((next.views as typeof legacy).future).toBe(legacy.future);
    const modern = document([widget("O")]);
    modern.views = legacy;
    const updated = appendNewPortableInk(modern, "board", stroke(), frame());
    expect(updated.views).toBe(legacy);
    expect(order(updated)).toEqual(["O", "A"]);
  });
  it("creates default per-Board views only when neither modern nor legacy branch exists", () => {
    const target = document([widget("O")]);
    delete target.surfaceViews;
    const next = appendNewPortableInk(target, "board", stroke(), frame());
    expect(order(next)).toEqual(["O", "A"]);
    expect(next.views).toBeUndefined();
  });
});
