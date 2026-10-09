import { describe, expect, it } from "vitest";
import {
  addMindmapNode,
  layoutMindmap,
  promoteMindmapNode,
  removeMindmapNode,
  validateMindmapData,
  type MindmapData,
} from "./mindmap-contract.mjs";
import { builtinComponent } from "../catalog";
import { insertComponent } from "../../surface/component-insertion";
import { createSurface } from "../../surface/containers.mjs";
import { validateDocument } from "../../portable/validation.mjs";
const map = (): MindmapData => ({
  nodes: [
    { id: "r", parentId: null, label: "中心" },
    { id: "a", parentId: "r", label: "分支 A", collapsed: true },
    { id: "a1", parentId: "a", label: "子主题" },
    { id: "b", parentId: "r", label: "分支 B" },
  ],
});
describe("mind map document contract", () => {
  it("inserts from the shared catalog into Page and Board and survives serialization", () => {
    const metadata = builtinComponent("mindmap")!;
    for (const kind of ["page", "board"] as const) {
      const source = validateDocument({
        id: crypto.randomUUID(),
        title: "Mind map",
        content: createSurface(kind),
      });
      const inserted = insertComponent(
        source,
        null,
        "mindmap",
        metadata.defaultData,
      );
      const saved = validateDocument(
        JSON.parse(JSON.stringify(inserted.document)),
      );
      const widget = saved.content.content!.find(
        (item) => item.attrs?.id === inserted.nodeId,
      )!;
      expect(widget.attrs!.kind).toBe("mindmap");
      expect(widget.attrs!.data).toEqual(metadata.defaultData);
      widget.attrs!.data.nodes[1].parentId = "missing";
      expect(() => validateDocument(saved)).toThrow(/missing parent/);
    }
  });
  it("rejects cycles, orphan parents, multiple roots and duplicate IDs", () => {
    const cycle = map();
    cycle.nodes[1].parentId = "a1";
    expect(() => validateMindmapData(cycle)).toThrow(/cycles/);
    const orphan = map();
    orphan.nodes[1].parentId = "missing";
    expect(() => validateMindmapData(orphan)).toThrow(/missing parent/);
    const roots = map();
    roots.nodes[1].parentId = null;
    expect(() => validateMindmapData(roots)).toThrow(/one root/);
    const duplicate = map();
    duplicate.nodes[1].id = "r";
    expect(() => validateMindmapData(duplicate)).toThrow(/unique/);
  });
  it("adds children to collapsed parents and inserts ordered siblings before or after", () => {
    const original = map();
    const child = addMindmapNode(original, "a", "new");
    expect(child.nodes.find((item) => item.id === "new")?.parentId).toBe("a");
    expect(child.nodes.find((item) => item.id === "a")?.collapsed).toBe(false);
    expect(original.nodes[1].collapsed).toBe(true);
    const sibling = addMindmapNode(original, "a", "peer", "sibling", true);
    expect(
      sibling.nodes
        .filter((item) => item.parentId === "r")
        .map((item) => item.id),
    ).toEqual(["peer", "a", "b"]);
    expect(
      addMindmapNode(original, "r", "branch", "sibling").nodes.find(
        (item) => item.id === "branch",
      )?.parentId,
    ).toBe("r");
  });
  it("deletes entire branches, protects root and promotes subtrees without losing children", () => {
    const original = addMindmapNode(map(), "a1", "a2");
    expect(
      removeMindmapNode(original, "a").nodes.map((item) => item.id),
    ).toEqual(["r", "b"]);
    expect(removeMindmapNode(original, "r")).toBe(original);
    const promoted = promoteMindmapNode(original, "a1");
    expect(promoted.nodes.find((item) => item.id === "a1")?.parentId).toBe("r");
    expect(promoted.nodes.find((item) => item.id === "a2")?.parentId).toBe(
      "a1",
    );
    expect(promoteMindmapNode(original, "a")).toBe(original);
  });
  it("lays out both branch banks without overlapping nodes and hides folded descendants", () => {
    let data = map();
    for (let i = 0; i < 30; i++)
      data = addMindmapNode(data, i % 3 === 0 ? "a1" : "b", `n${i}`);
    const graph = layoutMindmap(data);
    expect(new Set(graph.nodes.map((item) => item.side))).toEqual(
      new Set([0, 1, -1]),
    );
    for (const a of graph.nodes)
      for (const b of graph.nodes) {
        if (a === b) continue;
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
    expect(
      layoutMindmap(data, new Set(["a"])).nodes.some(
        (item) => item.id === "a1",
      ),
    ).toBe(false);
    expect(layoutMindmap(data, new Set(["r"])).nodes).toHaveLength(1);
  });
});
