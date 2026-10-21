import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { blankDocument } from "../core/catalog";
import { FileStore } from "../core/store";
import { addNode } from "../surface/editing";
import { longCubicInputFixture } from "../surface/cubic-ink-chunks.fixture.mjs";
import { cubicInkGeometry } from "../surface/cubic-ink.mjs";
import { createPortableInk } from "../surface/portable-ink.mjs";
import {
  parseArtifact,
  parseArtifactForSourceSnapshot,
  validateDocument,
} from "./validation.mjs";
import { CAPACITY } from "./capacity.mjs";
import type { JSONContent } from "@tiptap/core";

it("persists and reopens actual 20k cubic source/actual capture beside legacy 20k samples without derived geometry", async () => {
  const root = await mkdtemp(join(tmpdir(), "actual-long-ink-document-"));
  try {
    const store = new FileStore(root),
      project = await store.createProject({
        name: "Actual long editable source",
      }),
      page = await store.createPage(project.id, { kind: "board" });
    const ink = longCubicInputFixture();
    expect(ink.segments).toHaveLength(20000);
    expect(ink.capture!.raw).toHaveLength(20001);
    const legacy = createPortableInk(
      Array.from({ length: 20000 }, (_, index) => ({
        x: index,
        y: 20,
        pressure: 1,
      })),
      4,
      [40020, 160],
      "monoline",
      false,
    );
    let document = page.document;
    for (const [id, source] of [
      ["actual-cubic", ink],
      ["legacy-samples", legacy],
    ] as const) {
      document = addNode(
        document,
        {
          type: "drawing",
          attrs: {
            id,
            tool: "pen",
            color: "#111111",
            strokeWidth: 4,
            extent: source.extent,
            points: [
              { x: 0, y: 20 },
              { x: 10, y: 20 },
            ],
            ink: source,
          },
        } as JSONContent,
        { x: 0, y: 0, width: source.extent[0], height: source.extent[1] },
        document.content.attrs!.id,
      ) as typeof document;
    }
    const artifact = { format: "showai", version: 3, document };
    expect(parseArtifact(artifact).document.content).toEqual(document.content);
    expect(parseArtifactForSourceSnapshot(artifact).document.content).toEqual(
      document.content,
    );
    const saved = await store.savePage(
      project.id,
      document.id,
      document,
      page.hash,
      page.revision,
    );
    const reopened = await new FileStore(root).readPage(
      project.id,
      document.id,
    );
    expect(reopened.document).toEqual(saved.document);
    const nodes = reopened.document.content.content!,
      restored = nodes.find((n) => n.attrs?.id === "actual-cubic")!.attrs!.ink;
    expect(restored).toEqual(ink);
    expect(
      nodes.find((n) => n.attrs?.id === "legacy-samples")!.attrs!.ink,
    ).toEqual(legacy);
    const geometry = cubicInkGeometry(restored);
    expect(geometry.commands.length).toBeGreaterThan(100000);
    expect(geometry.chunks).toHaveLength(157);
    expect(Object.keys(restored)).not.toContain("chunks");
    expect(Object.keys(restored)).not.toContain("outline");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("bounds arbitrary JSON data arrays by bytes/depth while keeping the actual model node count", () => {
  const input = {
    ...blankDocument(),
    future: { numbers: Array.from({ length: 20001 }, (_, index) => index) },
  };
  expect(validateDocument(input)).toEqual(input);
  const tooManyNodes = {
    ...blankDocument(),
    content: {
      type: "doc",
      content: Array.from({ length: 12000 }, () => ({
        type: "paragraph",
        content: [],
      })),
    },
  };
  expect(() => validateDocument(tooManyNodes)).toThrow(/12000 nodes/);
  const oversized = {
    ...blankDocument(),
    future: Array(12001).fill("x".repeat(1400)),
  };
  expect(() => validateDocument(oversized)).toThrow(/limit|large|exceed/i);
  let deep: any = 0;
  for (let i = 0; i < 49; i++) deep = { value: deep };
  expect(() => validateDocument({ ...blankDocument(), future: deep })).toThrow(
    /deep/,
  );
  expect(() =>
    validateDocument({
      ...input,
      future: { numbers: [...input.future.numbers, Infinity] },
    }),
  ).toThrow(/finite/);
  expect(() =>
    validateDocument({ ...input, future: { numbers: [, 1] } }),
  ).toThrow(/dense JSON arrays/);
  expect(CAPACITY.pageStructureBytes).toBe(16 * 1024 * 1024);
});
