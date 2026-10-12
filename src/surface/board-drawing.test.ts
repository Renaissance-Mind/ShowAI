import { describe, expect, it } from "vitest";
import { finishBoardDrawing } from "./board-drawing.mjs";
import { createResource } from "./containers.mjs";
import { blankDocument } from "../core/catalog";
import { addNode } from "./editing";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { findSurfaceNode } from "./document.mjs";

const style = { color: "#123456", fillColor: "#ffccaa", strokeWidth: 7 };
const gesture = {
  origin: { x: 300, y: 200 },
  release: { x: 120, y: 80 },
  points: [{ x: 300, y: 200 }],
  moved: false,
  scale: 1,
};

describe("Board drawing transactions", () => {
  it.each(["rectangle", "ellipse", "arrow", "region"] as const)(
    "commits %s from release without any move frame",
    (tool) => {
      const result = finishBoardDrawing(tool, style, gesture);
      expect(result.frame).toMatchObject({
        x: 120,
        y: 80,
        width: 180,
        height: 120,
      });
      if (tool === "region") expect(result.frame.mode).toBe("free");
      else
        expect(result.node.attrs).toMatchObject({
          ...style,
          points: [
            { x: 180, y: 120 },
            { x: 0, y: 0 },
          ],
        });
    },
  );
  it("uses a click-sized default only below the screen distance threshold", () => {
    const click = finishBoardDrawing("rectangle", style, {
      ...gesture,
      release: { x: 301, y: 201 },
    });
    expect(click.frame.width).toBe(200);
    const zoomed = finishBoardDrawing("rectangle", style, {
      ...gesture,
      scale: 2,
      release: { x: 302, y: 202 },
    });
    expect(zoomed.frame.width).toBe(2);
  });
  it("retains the final freehand sample and an isolated dot", () => {
    const result = finishBoardDrawing("highlighter", style, gesture);
    expect(result.node.attrs!.points).toHaveLength(2);
    expect(result.node.attrs!.points.at(-1)).toEqual({ x: 0, y: 0 });
    const dot = finishBoardDrawing("pen", style, {
      ...gesture,
      release: gesture.origin,
    });
    expect(dot.node.attrs!.points).toHaveLength(2);
  });
  it("roundtrips highlighter, fill and stroke settings through the real artifact format", () => {
    let doc = createResource(blankDocument(), "board");
    for (const tool of ["highlighter", "rectangle", "region"] as const) {
      const drawing = finishBoardDrawing(tool, style, gesture);
      doc = addNode(
        doc,
        drawing.node,
        drawing.frame,
        doc.content.attrs!.id,
      ) as typeof doc;
    }
    const result = parseArtifact(
      serializeArtifact(validateDocument(doc)),
    ).document;
    expect(result.content.content).toHaveLength(3);
    expect(result.content.content![0].attrs).toMatchObject({
      tool: "highlighter",
      ...style,
    });
    expect(result.content.content![1].attrs).toMatchObject({
      tool: "rectangle",
      ...style,
    });
    const shape = result.content.content![1].attrs!.id;
    findSurfaceNode(result, shape)!.node.attrs!.fillColor = "url(remote)";
    expect(() => validateDocument(result)).toThrow(/Drawing fill/);
  });
});
