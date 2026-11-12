import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import type { ShowDocument } from "../types";
import { SKIP, walk } from "./walk.mjs";
import { assignSurfaceIds } from "./document.mjs";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (id: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [text(id)],
});
const doc = (...content: JSONContent[]) => ({ type: "doc", content });
const widget = (id: string, kind: string, data: unknown) => ({
  type: "widget",
  attrs: { id, kind, data },
});

const root: JSONContent = doc(
  paragraph("top"),
  widget("note", "text", {
    content: doc(
      paragraph("in-note"),
      widget("callout", "callout", { content: doc(paragraph("deep")) }),
    ),
  }),
  widget("steps", "stepper", {
    steps: [{ title: "One", content: doc(paragraph("in-step")) }],
  }),
);

const ids = (scope: "tree" | "content") => {
  const found: string[] = [];
  walk(root, (node) => {
    if (typeof node.attrs?.id === "string") found.push(node.attrs.id);
  }, { scope });
  return found;
};

describe("walk", () => {
  test("requires a scope", () => {
    expect(() =>
      walk(root, () => {}, undefined as unknown as { scope: "tree" }),
    ).toThrow(/scope/);
    expect(() =>
      walk(root, () => {}, { scope: "all" } as unknown as { scope: "tree" }),
    ).toThrow(/scope/);
  });

  test("tree follows content; content also enters documents held in component data", () => {
    expect(ids("tree")).toEqual(["top", "note", "steps"]);
    expect(ids("content")).toEqual([
      "top",
      "note",
      "in-note",
      "callout",
      "deep",
      "steps",
      "in-step",
    ]);
  });

  test("reports parent, nearest host, outermost owner and index", () => {
    const seen: Record<string, unknown> = {};
    walk(root, (node, { parent, host, owner, index }) => {
      const id = node.attrs?.id;
      if (typeof id === "string")
        seen[id] = {
          parent: parent?.attrs?.id ?? parent?.type ?? null,
          host: host?.attrs?.id ?? null,
          owner: owner?.attrs?.id ?? null,
          index,
        };
    }, { scope: "content" });
    expect(seen).toEqual({
      top: { parent: "doc", host: null, owner: null, index: 0 },
      note: { parent: "doc", host: null, owner: null, index: 1 },
      "in-note": { parent: "doc", host: "note", owner: "note", index: 0 },
      callout: { parent: "doc", host: "note", owner: "note", index: 1 },
      deep: { parent: "doc", host: "callout", owner: "note", index: 0 },
      steps: { parent: "doc", host: null, owner: null, index: 2 },
      "in-step": { parent: "doc", host: "steps", owner: "steps", index: 0 },
    });
  });

  test("SKIP leaves children and held documents unvisited", () => {
    const found: string[] = [];
    walk(root, (node) => {
      if (typeof node.attrs?.id === "string") found.push(node.attrs.id);
      if (node.attrs?.id === "note") return SKIP;
    }, { scope: "content" });
    expect(found).toEqual(["top", "note", "steps", "in-step"]);
  });
});

describe("generated ids", () => {
  test("never repeat an id held in component data", () => {
    const page = (nested: string[]) =>
      ({
        id: "page",
        title: "Ids",
        content: doc(
          { type: "paragraph", content: [text("needs an id")] },
          widget("note", "text", { content: doc(...nested.map(paragraph)) }),
        ),
      }) as unknown as ShowDocument;
    const generated = assignSurfaceIds(page([])).content.content![0].attrs!.id;
    const next = assignSurfaceIds(page([generated]));
    expect(next.content.content![0].attrs!.id).toBe(`${generated}-copy`);
  });
});
