import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContainerRuntime } from "./ContainerRuntime";
import { createResource } from "./containers.mjs";
import { blankDocument } from "../core/catalog";
import { finishBoardDrawing } from "./board-drawing.mjs";
import { addNode } from "./editing";

describe("drawing preview handoff", () => {
  it.each(["pen", "highlighter", "rectangle", "ellipse", "arrow"] as const)(
    "renders an unselected %s immediately, before visibility observers run",
    (tool) => {
      let document = createResource(blankDocument(), "board");
      const drawing = finishBoardDrawing(
        tool,
        {
          color: "#123456",
          fillColor: "none",
          strokeWidth: 2.5,
        },
        {
          origin: { x: -120, y: -80 },
          release: { x: 160, y: 80 },
          points: [{ x: -120, y: -80 }],
          moved: true,
          scale: 1,
        },
      );
      document = addNode(
        document,
        drawing.node,
        drawing.frame,
        document.content.attrs!.id,
      ) as typeof document;
      const html = renderToStaticMarkup(
        createElement(ContainerRuntime, {
          document,
          renderContent: () => null,
        }),
      );
      expect(html).toContain('class="board-drawing"');
      expect(html).toContain('stroke="#123456"');
      expect(html).not.toContain("is-selected");
    },
  );
});
