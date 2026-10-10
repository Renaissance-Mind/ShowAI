import { describe, it, expect } from "vitest";
import { blankDocument, listBuiltinComponents } from "../core/catalog";
import { createResource } from "./containers.mjs";
import { insertComponent } from "./component-insertion";
import { applyOperations } from "../core/diff";
import { findSurfaceNode, visitNodes } from "./document.mjs";
import {
  validateDocument,
  serializeArtifact,
  parseArtifact,
} from "../portable/validation.mjs";

describe("unified component insertion", () => {
  it("discovers Page and Board alongside all normal components", () => {
    const all = listBuiltinComponents();
    for (const kind of ["page", "board"])
      expect(all.find((item) => item.kind === kind)?.insertion).toEqual({
        nodeType: "surface",
        surfaceKind: kind,
      });
    expect(all.some((item) => item.kind === "metrics")).toBe(true);
  });
  it("uses one path for nested Page, Board and normal widget content", () => {
    const initial = createResource(blankDocument());
    const board = insertComponent(initial, null, "board", { title: "Board" });
    const page = insertComponent(board.document, board.nodeId, "page", {
      title: "Page",
    });
    const text = insertComponent(page.document, page.nodeId, "text", {
      content: "Actual text",
      format: "markdown",
    });
    expect(findSurfaceNode(text.document, board.nodeId)!.node.attrs!.kind).toBe(
      "board",
    );
    expect(findSurfaceNode(text.document, page.nodeId)!.parent!.attrs!.id).toBe(
      board.nodeId,
    );
    expect(findSurfaceNode(text.document, text.nodeId)!.parent!.attrs!.id).toBe(
      page.nodeId,
    );
    expect(findSurfaceNode(text.document, text.nodeId)!.node.type).toBe(
      "richText",
    );
    expect(text.document.layout[page.nodeId].heightMode).toBe("fixed");
    expect(() => validateDocument(text.document)).not.toThrow();
    expect(parseArtifact(serializeArtifact(text.document)).version).toBe(3);
    expect(initial.content.content).toHaveLength(1);
  });
  it("remaps repeated container examples together with their layout and saved views", () => {
    const data = {
      content: [
        {
          type: "surface",
          attrs: { id: "nested", kind: "board", name: "Nested" },
          content: [
            {
              type: "paragraph",
              attrs: { id: "note" },
              content: [{ type: "text", text: "Note" }],
            },
          ],
        },
      ],
      layout: { note: { x: -40, y: 30, width: 320 } },
      surfaceViews: {
        nested: {
          initial: "focus",
          saved: [{ id: "focus", name: "Note", targets: ["note"] }],
          readingOrder: ["note"],
        },
      },
    };
    const first = insertComponent(
      createResource(blankDocument()),
      null,
      "page",
      data,
    );
    const second = insertComponent(first.document, null, "page", data);
    const ids: string[] = [];
    visitNodes(second.document.content, (node) => {
      if (node.attrs?.id) ids.push(node.attrs.id);
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => validateDocument(second.document)).not.toThrow();
    expect(
      Object.values(second.document.layout).filter((frame) => frame.x === -40),
    ).toHaveLength(2);
  });
  it("inserts through Agent operations and preserves Page auto sizing", () => {
    const source = createResource(blankDocument());
    const next = applyOperations(source, [
      {
        type: "component.insert",
        kind: "page",
        data: { title: "Child" },
        parentId: source.content.attrs!.id,
      },
    ]);
    const child = next.content.content![1];
    expect(child.type).toBe("surface");
    expect(next.layout![child.attrs!.id].heightMode).toBe("auto");
    expect(() =>
      applyOperations(source, [
        {
          type: "component.insert",
          kind: "board",
          data: { content: [{ type: "surface", attrs: { kind: "invalid" } }] },
        },
      ]),
    ).toThrow();
  });
});
