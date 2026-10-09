import { describe, expect, it } from "vitest";
import {
  addMindmapNode,
  layoutMindmap,
  mindmapConnectionPath,
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
  it("balances natural branches without overlap and connects from the correct face", () => {
    let data = map();
    for (let i = 0; i < 6; i++) data = addMindmapNode(data, "r", `branch${i}`);
    for (let i = 0; i < 48; i++) {
      const parent = i % 2 === 0 ? `branch${i % 6}` : `detail${i - 1}`;
      data = addMindmapNode(data, parent, `detail${i}`);
    }
    data.nodes.find((node) => node.id === "branch2")!.label =
      "长主题名称".repeat(24);
    const graph = layoutMindmap({ ...data, layout: "radial" });
    const directions = new Set(
      graph.nodes
        .filter((node) => node.parentId === "r")
        .map((node) => `${node.axis}:${node.side}`),
    );
    expect(directions).toEqual(new Set(["horizontal:1", "horizontal:-1"]));
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
    const root = graph.nodes[0];
    for (const node of graph.nodes.filter((node) => node.parentId === "r")) {
      const path = mindmapConnectionPath(root, node);
      const endpoint = `${node.x + (node.side > 0 ? 0 : node.width)} ${node.y + node.height / 2}`;
      expect(path.endsWith(endpoint)).toBe(true);
      expect(node.depth).toBe(1);
    }
  });
  it("matches the original natural layout and balances by subtree size", () => {
    const graph = layoutMindmap(map());
    expect({ width: graph.width, height: graph.height }).toEqual({
      width: 980,
      height: 110,
    });
    expect(
      graph.nodes.map(({ id, x, y, side }) => ({ id, x, y, side })),
    ).toEqual([
      { id: "r", x: 276, y: 32, side: 0 },
      { id: "a", x: 520, y: 32, side: 1 },
      { id: "a1", x: 764, y: 32, side: 1 },
      { id: "b", x: 32, y: 32, side: -1 },
    ]);
    let data: MindmapData = {
      nodes: [
        { id: "r", parentId: null, label: "中心" },
        { id: "heavy", parentId: "r", label: "较大分支" },
      ],
    };
    for (let i = 0; i < 4; i++)
      data = addMindmapNode(data, "heavy", `detail${i}`);
    for (let i = 0; i < 3; i++) data = addMindmapNode(data, "r", `light${i}`);
    const branches = layoutMindmap({ ...data, layout: "radial" }).nodes.filter(
      (node) => node.parentId === "r",
    );
    expect(branches.map((node) => [node.id, node.side])).toEqual([
      ["heavy", 1],
      ["light0", -1],
      ["light1", -1],
      ["light2", -1],
    ]);
    expect(branches.every((node) => node.axis === "horizontal")).toBe(true);
  });
  it("lays out every descendant to the right or left while preserving content and branch colors", () => {
    const data = addMindmapNode(addMindmapNode(map(), "r", "c"), "c", "c1");
    const before = JSON.stringify(data);
    const radial = layoutMindmap({ ...data, layout: "radial" });
    for (const direction of ["right", "left"] as const) {
      const graph = layoutMindmap({ ...data, layout: "tree", direction });
      for (const node of graph.nodes.filter((node) => node.parentId)) {
        const parent = graph.nodes.find((item) => item.id === node.parentId)!;
        expect(node.axis).toBe("horizontal");
        expect(
          direction === "right"
            ? node.x > parent.x + parent.width
            : node.x + node.width < parent.x,
        ).toBe(true);
        expect(node.color).toBe(
          radial.nodes.find((item) => item.id === node.id)!.color,
        );
        expect(node.depth).toBe(parent.depth + 1);
      }
      expect(
        layoutMindmap(
          { ...data, layout: "tree", direction },
          new Set(["c"]),
        ).nodes.some((node) => node.id === "c1"),
      ).toBe(false);
    }
    expect(JSON.stringify(data)).toBe(before);
  });
  it("preserves layout settings on Page/Board round trips and rejects invalid settings", () => {
    for (const kind of ["page", "board"] as const) {
      const source = validateDocument({
        id: crypto.randomUUID(),
        title: "Layout",
        content: createSurface(kind),
      });
      const data = {
        ...map(),
        layout: "tree" as const,
        direction: "left" as const,
      };
      const inserted = insertComponent(source, null, "mindmap", data);
      const saved = validateDocument(
        JSON.parse(JSON.stringify(inserted.document)),
      );
      expect(
        saved.content.content!.find(
          (node) => node.attrs?.id === inserted.nodeId,
        )!.attrs!.data,
      ).toEqual(data);
    }
    expect(() => validateMindmapData({ ...map(), layout: "diagonal" })).toThrow(
      /layout/,
    );
    expect(() => validateMindmapData({ ...map(), direction: "up" })).toThrow(
      /direction/,
    );
  });
});
