import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { selectDocumentBlocks } from "./selection.mjs";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "./validation.mjs";
import { SurfaceReader } from "./SurfaceReader";

const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const legacy = () =>
  validateDocument({
    id: "monitor",
    title: "Complete report",
    cover: "",
    comments: [],
    content: {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { id: "panel", tone: "blue" },
          content: [
            paragraph("progress", "62%"),
            paragraph("notes", "UNRELATED NOTES"),
          ],
        },
        paragraph("footer", "UNRELATED FOOTER"),
      ],
    },
  });

describe("partial page projection", () => {
  it("retains required ancestors, source order and selected subtrees without mutating the page", () => {
    const source = legacy();
    const snapshot = structuredClone(source);
    const selected = selectDocumentBlocks(source, ["footer", "progress"]);
    expect(selected.content.content?.map((node) => node.attrs?.id)).toEqual([
      "panel",
      "footer",
    ]);
    expect(
      selected.content.content?.[0].content?.map((node) => node.attrs?.id),
    ).toEqual(["progress"]);
    expect(source).toEqual(snapshot);
    const overlap = selectDocumentBlocks(source, ["panel", "progress"]);
    expect(overlap.content.content).toHaveLength(1);
    expect(overlap.content.content?.[0].content).toHaveLength(2);
  });

  it("cleans whiteboard layout, saved targets and reading order to retained nodes", () => {
    const source = validateDocument({
      ...legacy(),
      content: {
        type: "surface",
        content: [
          {
            type: "region",
            attrs: { id: "panel", name: "Status" },
            content: [
              paragraph("progress", "62%"),
              paragraph("notes", "UNRELATED NOTES"),
            ],
          },
          paragraph("footer", "UNRELATED FOOTER"),
        ],
      },
      layout: {
        panel: { x: 2300, y: 500, width: 600, mode: "free" },
        progress: { x: 180, y: 200, width: 300 },
        notes: { x: 0, y: 900, width: 300 },
        footer: { x: 4000, y: 1000, width: 500 },
      },
      views: {
        initial: "all",
        saved: [
          { id: "all", name: "All", targets: ["progress", "footer"] },
          { id: "footer-view", name: "Footer", targets: ["footer"] },
        ],
        readingOrder: ["footer", "panel"],
      },
    });
    const selected = selectDocumentBlocks(source, ["progress"]);
    expect(Object.keys(selected.layout!)).toEqual(["panel", "progress"]);
    expect(selected.layout!.progress).toEqual(source.layout!.progress);
    expect(selected.views).toEqual({
      initial: null,
      saved: [{ id: "all", name: "All", targets: ["progress"] }],
      readingOrder: ["panel"],
    });
  });

  it("round-trips partial metadata and renders a legacy selection without the full-page title", () => {
    const document = selectDocumentBlocks(legacy(), ["progress"]);
    const artifact = parseArtifact(
      serializeArtifact(document, [], [], "reading", {
        blockIds: ["progress"],
      }),
    );
    expect(artifact.selection).toEqual({ blockIds: ["progress"] });
    const html = renderToStaticMarkup(
      createElement(SurfaceReader, {
        document: artifact.document,
        heading: null,
        presentation: "reading",
        partial: true,
      }),
    );
    expect(html).toContain("62%");
    expect(html).not.toContain("Complete report");
    expect(html).not.toContain("UNRELATED");
    expect(() =>
      parseArtifact({ ...artifact, selection: { blockIds: ["missing"] } }),
    ).toThrow("existing block");
  });

  it("rejects missing, empty and duplicate selections instead of displaying the full page", () => {
    for (const ids of [[], [""], [" "], ["progress", "progress"]])
      expect(() => selectDocumentBlocks(legacy(), ids)).toThrow(
        "unique block ids",
      );
    expect(() =>
      selectDocumentBlocks(legacy(), ["progress", "missing"]),
    ).toThrow("missing");
  });

  it("opens an enclosing toggle when its selected child would otherwise be hidden", () => {
    const source = validateDocument({
      ...legacy(),
      content: {
        type: "doc",
        content: [
          {
            type: "toggle",
            attrs: { id: "details", title: "Details", open: false },
            content: [
              paragraph("progress", "62%"),
              paragraph("notes", "UNRELATED"),
            ],
          },
        ],
      },
    });
    expect(
      selectDocumentBlocks(source, ["progress"]).content.content?.[0].attrs
        ?.open,
    ).toBe(true);
    expect(
      selectDocumentBlocks(source, ["details"]).content.content?.[0].attrs
        ?.open,
    ).toBe(false);
    expect(source.content.content?.[0].attrs?.open).toBe(false);
  });
});
