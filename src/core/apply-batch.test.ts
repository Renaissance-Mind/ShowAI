import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { applyOperations } from "./diff";
import { blankDocument } from "./catalog";
import { CoreError, type PageOperation, type ShowDocument } from "./model";
import { createResource } from "../document/containers.mjs";
import { walk } from "../document/walk.mjs";

/**
 * applyOperations(document, operations) gives what applying the operations
 * one at a time gives, each on the previous result: the same document, or a
 * failure at the same operation index.
 */

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const integrity = (digit: string) => `sha256-${digit.repeat(64)}`;
const text = (value: string) => [{ type: "text", text: value }];
const paragraph = (id: string | undefined, value: string): JSONContent => ({
  type: "paragraph",
  ...(id ? { attrs: { id } } : {}),
  content: text(value),
});

function fixture(): ShowDocument {
  const page = createResource(blankDocument()) as unknown as ShowDocument;
  page.title = "Batch";
  return applyOperations(page, [
    { type: "block.insert", node: paragraph("p1", "First paragraph") },
    {
      type: "block.insert",
      node: {
        type: "widget",
        attrs: {
          id: "note",
          kind: "text",
          data: {
            content: {
              type: "doc",
              content: [
                paragraph("in-note", "Nested text"),
                {
                  type: "widget",
                  attrs: {
                    id: "deep",
                    kind: "custom",
                    data: {
                      componentId: "value-slider",
                      version: "1.0.0",
                      integrity: integrity("a"),
                      props: { label: "Deep" },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    { type: "surface.create", kind: "board", name: "Board", nodeId: "board" },
    {
      type: "diagram.insert",
      parentId: "board",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C", shape: "ellipse" },
      ],
      edges: [
        { id: "a-b", from: "a", to: "b" },
        { id: "b-c", from: "b", to: "c" },
      ],
    },
    {
      type: "block.insert",
      parentId: "board",
      node: { type: "drawing", attrs: { id: "free", tool: "rectangle" } },
    },
    {
      type: "block.insert",
      node: { type: "region", attrs: { id: "region", name: "Region" }, content: [paragraph("in-region", "Region text")] },
    },
    { type: "surface.create", kind: "page", name: "Sub page", nodeId: "sub" },
    // Enough blocks that a check of the touched block differs from a whole-page one.
    ...Array.from({ length: 120 }, (_, index) => ({
      type: "block.insert",
      node: paragraph(`bulk-${index}`, `Bulk paragraph ${index} `.repeat(4)),
    })),
    { type: "comment", text: "On a quote", quote: "Bulk paragraph 3" },
  ] as PageOperation[]);
}

/** Ids present now, by role, so generated operations mostly address real nodes. */
function pools(document: ShowDocument) {
  const all: string[] = [],
    paragraphs: string[] = [],
    boardChildren: string[] = [],
    shapes: string[] = [],
    roots: string[] = [],
    regionChildren: string[] = [];
  walk(document.content, (node, { parent, host }) => {
    const id = node.attrs?.id;
    if (typeof id !== "string" || node === document.content) return;
    all.push(id);
    if (node.type === "paragraph" || node.type === "heading") paragraphs.push(id);
    if (!host && parent === document.content) roots.push(id);
    if (!host && parent?.attrs?.id === "region") regionChildren.push(id);
    if (!host && parent?.attrs?.id === "board") {
      boardChildren.push(id);
      if (node.type === "drawing" && node.attrs?.tool !== "arrow") shapes.push(id);
    }
  }, { scope: "content" });
  return { all, paragraphs, boardChildren, shapes, roots, regionChildren };
}

function generate(next: () => number, document: ShowDocument, step: number): PageOperation {
  const pick = <T,>(items: T[], fallback: T): T =>
    items.length ? items[Math.floor(next() * items.length)] : fallback;
  const ids = pools(document);
  const id = () => pick(ids.all, "missing");
  const root = document.content.attrs!.id as string;
  const fresh = `n${step}-${Math.floor(next() * 1000)}`;
  const block = () =>
    pick(
      [
        paragraph(next() < 0.5 ? fresh : undefined, `Inserted ${step}`),
        { type: "heading", attrs: { level: 3 }, content: text(`Heading ${step}`) },
        { type: "bulletList", content: [{ type: "listItem", content: [paragraph(undefined, "Item")] }] },
        // Invalid in themselves: an unsupported attribute, an empty list, empty text.
        { type: "paragraph", attrs: { color: "#123456" }, content: text("Coloured") },
        { type: "bulletList", content: [] },
        { type: "paragraph", content: [{ type: "text", text: "" }] },
        // An id that already exists.
        paragraph(pick(ids.all, "p1"), "Repeated id"),
        { type: "widget", attrs: { kind: "custom", data: { componentId: "value-slider", version: "1.0.0", integrity: integrity("d"), props: { label: "New" } } } },
      ] as JSONContent[],
      paragraph(undefined, "x"),
    );
  const kinds = [
    () => ({ type: "block.text.set", blockId: pick(ids.paragraphs, "p1"), text: `Text ${step}` }),
    () => ({ type: "block.text.set", blockId: pick(ids.paragraphs, "p1"), text: next() < 0.3 ? "" : `Bulk paragraph 3 then ${step}` }),
    () => ({ type: "block.insert", node: block(), ...(next() < 0.5 ? { afterId: pick(ids.roots, null) } : {}) }),
    () => ({ type: "block.insert", parentId: "region", node: block(), ...(next() < 0.5 ? { afterId: pick(ids.regionChildren, null) } : {}) }),
    () => ({ type: "block.insert", parentId: "sub", node: block() }),
    () => ({
      type: "component.insert",
      kind: pick(["text", "callout", "divider", "custom", "chart-missing"], "text"),
      data: pick(
        [
          { format: "plain", content: `Component ${step}` },
          { content: `Callout ${step}` },
          {},
          { componentId: "value-slider", version: "1.0.0", integrity: integrity("e"), props: { label: "C" } },
        ],
        {},
      ),
      ...(next() < 0.2 ? { parentId: pick(["region", "sub", "board"], "region") } : {}),
      ...(next() < 0.3 ? { afterId: pick(ids.roots, null) } : {}),
    }),
    () => ({ type: "block.attrs.set", blockId: id(), attrs: { color: "#336699" } }),
    () => ({
      type: "block.insert",
      node: paragraph(next() < 0.5 ? fresh : undefined, `Inserted ${step}`),
      ...(next() < 0.5 ? { afterId: pick(ids.roots, null) } : {}),
    }),
    () => ({
      type: "block.insert",
      parentId: "board",
      node: { type: "drawing", attrs: { id: fresh, tool: next() < 0.5 ? "rectangle" : "ellipse" } },
    }),
    () => ({
      type: "block.insert",
      parentId: "board",
      node: {
        type: "drawing",
        attrs: {
          id: fresh,
          tool: "arrow",
          bindings: {
            start: { targetId: pick(ids.shapes, "a") },
            end: { targetId: pick(ids.shapes, "b") },
          },
        },
      },
    }),
    () => ({ type: "block.remove", blockId: id() }),
    () => ({
      type: "block.replace",
      blockId: pick(ids.paragraphs, "p1"),
      node: { type: "heading", attrs: { level: 2 }, content: text(`Heading ${step}`) },
    }),
    () => ({
      type: "block.move",
      blockId: pick(ids.roots, "p1"),
      ...(next() < 0.5 ? { afterId: pick(ids.roots, null) } : { afterId: null }),
    }),
    () => ({
      type: "surface.layout.set",
      nodeId: pick(ids.boardChildren, "a"),
      layout: { x: Math.round(next() * 400), y: Math.round(next() * 300), width: 80 + Math.round(next() * 120) },
    }),
    () => ({ type: "component.insert", kind: next() < 0.5 ? "callout" : "text", ...(next() < 0.3 ? { parentId: "board" } : {}) }),
    () => ({ type: "component.props.set", blockId: next() < 0.7 ? "deep" : id(), props: { label: `Label ${step}` } }),
    () => ({ type: "component.ref.set", blockId: next() < 0.8 ? "deep" : id(), version: `1.0.${step}`, integrity: integrity(next() < 0.5 ? "b" : "c") }),
    () => ({
      type: "diagram.insert",
      parentId: "board",
      nodes: [{ id: `${fresh}-x`, label: "X" }, { id: `${fresh}-y`, label: "Y" }],
      edges: [{ from: `${fresh}-x`, to: `${fresh}-y` }, { from: `${fresh}-y`, to: pick(ids.shapes, "a") }],
    }),
    () => ({ type: "diagram.arrange", nodeIds: ids.boardChildren.filter(() => next() < 0.7), direction: next() < 0.5 ? "right" : "down" }),
    () => ({ type: "surface.reading-order.set", surfaceId: root, nodeIds: [...ids.roots].sort(() => next() - 0.5) }),
    () => ({
      type: "surface.view.save",
      surfaceId: "board",
      view: { id: `view-${step}`, name: "View", targets: ids.boardChildren.filter(() => next() < 0.5).slice(0, 3) },
    }),
    () => ({ type: "page.set", fields: { title: `Title ${step}` } }),
    () => ({ type: "comment", text: `Note ${step}`, blockId: pick(ids.paragraphs, "p1") }),
  ];
  return kinds[Math.floor(next() * kinds.length)]() as PageOperation;
}

type Outcome = { document: ShowDocument } | { index: number; code: string; message: string };

function batch(document: ShowDocument, operations: PageOperation[]): Outcome {
  try {
    return { document: applyOperations(document, operations) };
  } catch (error) {
    return failure(error);
  }
}
function sequential(document: ShowDocument, operations: PageOperation[]): Outcome {
  let current = document;
  for (const [index, operation] of operations.entries()) {
    try {
      current = applyOperations(current, [operation], index);
    } catch (error) {
      return failure(error);
    }
  }
  return { document: current };
}
function failure(error: unknown): Outcome {
  if (!(error instanceof CoreError)) throw error;
  const index = /^operations\[(\d+)\]/.exec(error.message)?.[1];
  return { index: index === undefined ? -1 : Number(index), code: error.code, message: error.message };
}

/** Random ids and clock times differ between runs; their order of appearance does not. */
function comparable(outcome: Outcome) {
  if (!("document" in outcome)) return outcome;
  const { createdAt: _c, updatedAt: _u, ...rest } = outcome.document;
  const tokens = new Map<string, string>();
  return JSON.parse(
    JSON.stringify(rest).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g,
      (value) => {
        if (!tokens.has(value)) tokens.set(value, `<${tokens.size}>`);
        return tokens.get(value)!;
      },
    ),
  );
}

describe("batch equals sequential", () => {
  const base = fixture();
  for (let seed = 1; seed <= 400; seed++)
    test(`seed ${seed}`, () => {
      const next = random(seed);
      const length = 1 + Math.floor(next() * 14);
      const operations: PageOperation[] = [];
      let preview = base;
      for (let step = 0; step < length; step++) {
        const operation = generate(next, preview, step);
        operations.push(operation);
        const applied = sequential(preview, [operation]);
        if ("document" in applied) preview = applied.document;
      }
      expect(comparable(batch(base, operations))).toEqual(
        comparable(sequential(base, operations)),
      );
    });
});
