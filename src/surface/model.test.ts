import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { newDocument, toMarkdown } from "../lib/document";
import {
  applyOperations,
  diffDocuments,
  normalizeDocument,
} from "../core/diff";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { normalizedWheel, zoomAt } from "./model";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  attrs: { id: `p-${text}` },
  content: [{ type: "text", text }],
});
const position = { x: 1080, y: 120, width: 360 };
const sample = () => ({
  ...newDocument("Spatial page"),
  content: {
    type: "doc",
    content: [
      paragraph("body"),
      {
        type: "callout",
        attrs: {
          id: "legacy-floating",
          icon: "",
          tone: "neutral",
          canvas: { ...position },
        },
        content: [paragraph("side")],
      },
    ],
  },
});

describe("shared camera coordinates", () => {
  it("normalizes mouse line/page wheels and Shift-scroll", () => {
    expect(normalizedWheel(0, 3, 1, 800, true)).toEqual({ x: 48, y: 0 });
    expect(normalizedWheel(0, 1, 2, 800)).toEqual({ x: 0, y: 800 });
  });
  it("keeps the world point under the zoom anchor and clamps the scale", () => {
    const camera = { x: -270, y: -830, scale: 0.7 };
    const anchor = { x: 320, y: 200 };
    for (const scale of [0.01, 0.5, 1, 5]) {
      const next = zoomAt(camera, anchor, scale);
      expect((anchor.x - next.x) / next.scale).toBeCloseTo(
        (anchor.x - camera.x) / camera.scale,
      );
      expect((anchor.y - next.y) / next.scale).toBeCloseTo(
        (anchor.y - camera.y) / camera.scale,
      );
      expect(next.scale).toBeGreaterThanOrEqual(0.25);
      expect(next.scale).toBeLessThanOrEqual(2);
    }
  });
});

describe("legacy v1 spatial source compatibility", () => {
  it("round trips legacy JSON while preserving all content", () => {
    const document = sample();
    expect(parseArtifact(serializeArtifact(document)).document).toEqual(
      document,
    );
    expect(toMarkdown(document.content)).toContain("side");
  });
  it("exposes movement, editing and deletion through existing Agent operations and diffs", () => {
    const before = normalizeDocument(sample());
    const id = before.content.content![1].attrs!.id;
    const moved = applyOperations(before, [
      {
        type: "block.attrs.set",
        blockId: id,
        attrs: { canvas: { ...position, x: -500 } },
      },
    ]);
    expect(diffDocuments(before, moved)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "block.changed",
          blockId: id,
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "attrs.canvas.x", after: -500 }),
          ]),
        }),
      ]),
    );
    const edited = applyOperations(moved, [
      { type: "block.text.set", blockId: "p-side", text: "updated side" },
    ]);
    expect(toMarkdown(edited.content)).toContain("updated side");
    const deleted = applyOperations(edited, [
      { type: "block.remove", blockId: id },
    ]);
    expect(deleted.content.content).toHaveLength(1);
  });
  it.each([NaN, Infinity, "20", 1000001])(
    "rejects unsafe canvas coordinates %s",
    (x) => {
      const document = sample();
      document.content.content[1].attrs!.canvas.x = x;
      expect(() => validateDocument(document)).toThrow();
    },
  );
  it("rejects nested placement, incomplete dimensions and unknown placement fields", () => {
    const document = sample();
    const item = document.content.content[1];
    expect(() =>
      validateDocument({
        ...document,
        content: {
          type: "doc",
          content: [{ type: "blockquote", content: [item] }],
        },
      }),
    ).toThrow(/top-level/);
    for (const canvas of [
      { x: 0, y: 0 },
      { x: 0, y: 0, width: 100 },
      { ...position, height: 100 },
    ]) {
      expect(() =>
        validateDocument({
          ...document,
          content: {
            type: "doc",
            content: [{ ...item, attrs: { ...item.attrs, canvas } }],
          },
        }),
      ).toThrow();
    }
  });
  it("rejects canvas identities shared with another card or body block", () => {
    const document = sample();
    const item = document.content.content[1];
    document.content.content.push(structuredClone(item));
    expect(() => validateDocument(document)).toThrow(/Duplicate canvas id/);
    document.content.content.pop();
    document.content.content[0].attrs!.id = item.attrs!.id;
    expect(() => validateDocument(document)).toThrow(/Duplicate canvas id/);
  });
});
