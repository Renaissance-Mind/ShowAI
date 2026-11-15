import { expect, test } from "vitest";
import { componentSdkSource } from "./component-sdk-source";

const sdk = `import "./base.css";
export { FlowchartBlock as Flowchart } from "./Flowchart";
export { LayerDiagramBlock as LayerDiagram } from "./LayerDiagram";
export { ComponentInteractions, type ComponentTarget } from "./interactions";
export { RichText } from "./RichText";
export * from "./g2";`;

test("named imports retain only their renderer and interaction exports", () => {
  const result = componentSdkSource(sdk, [
    'import { Flowchart as Diagram, ComponentInteractions, type ComponentTarget } from "showai:components";',
  ]);
  expect(result).toContain('import "./base.css"');
  expect(result).toContain("FlowchartBlock as Flowchart");
  expect(result).toContain("ComponentInteractions");
  expect(result).toContain("type ComponentTarget");
  expect(result).not.toContain("LayerDiagramBlock");
  expect(result).not.toContain("RichText");
  expect(result).not.toContain('from "./g2"');
});

test("collects exports used by every package module and named re-exports", () => {
  const result = componentSdkSource(sdk, [
    'import {Flowchart} from "showai:components"',
    "export {LayerDiagram as Layers} from 'showai:components'",
  ]);
  expect(result).toContain("FlowchartBlock as Flowchart");
  expect(result).toContain("LayerDiagramBlock as LayerDiagram");
  expect(result).not.toContain("RichText");
});

test.each([
  'import * as Components from "showai:components"',
  'const components = await import("showai:components")',
  'export * from "showai:components"',
  'import { G2Line } from "showai:components"',
  'import Default, { Flowchart } from "showai:components"',
])("retains the full SDK for conservative compatibility: %s", (source) => {
  expect(componentSdkSource(sdk, [source])).toBe(sdk);
});
