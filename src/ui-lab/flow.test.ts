import { expect, test } from "vitest";
import { uiFlow, flowNode } from "./flow";
import { uiScene } from "./registry";

test("flow branches, conditions and action destinations resolve within their feature", () => {
  for (const locale of ["zh-CN", "en"] as const)
    for (const feature of ["remote-connection", "workbench"]) {
      const flow = uiFlow(feature, locale),
        ids = new Set(flow.nodes.map((node) => node.id));
      expect(ids.size).toBe(flow.nodes.length);
      expect(ids.has(flow.entry)).toBe(true);
      for (const node of flow.nodes) {
        expect(uiScene(feature, node.scene, locale)).toBeDefined();
        expect(node.matches.length).toBeGreaterThan(0);
        expect(new Set(node.actions.map((action) => action.id)).size).toBe(
          node.actions.length,
        );
        for (const id of [
          node.parent,
          ...(node.variants ?? []),
          ...node.actions.map((action) => action.to),
        ].filter(Boolean))
          expect(ids.has(id!)).toBe(true);
        const path = new Set([node.id]);
        let parent = node.parent;
        while (parent) {
          expect(path.has(parent)).toBe(false);
          path.add(parent);
          parent = flow.nodes.find((node) => node.id === parent)?.parent;
        }
      }
      if (feature === "remote-connection")
        expect(ids.has("created")).toBe(false);
    }
});
test("direct state selection rejects unknown nodes and exposes service outcomes beside a pending connection", () => {
  expect(() => flowNode("remote-connection", "missing")).toThrow(
    "Unknown UI state",
  );
  const node = flowNode("remote-connection", "lan.starting");
  expect(node.variants).toContain("lan.error");
  expect(node.variants).toContain("lan.ready");
  expect(node.actions.some((action) => action.id === "cancel")).toBe(true);
});
