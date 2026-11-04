import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import components from "../../../resources/catalog/components.json";
import { validateSvgData } from "./svg-contract.mjs";
import { validateMechanismData } from "./mechanism-contract.mjs";
import { MechanismDiagramBlock } from "./MechanismDiagram";

const entry = (kind: string) =>
  (components as { kind: string; defaultData: any; examples: any[] }[]).find(
    (item) => item.kind === kind,
  )!;
const figure = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${body}</svg>`;

describe("svg contract", () => {
  it("accepts the catalog defaults and examples", () => {
    const svg = entry("svg");
    expect(() => validateSvgData(svg.defaultData)).not.toThrow();
    for (const example of svg.examples)
      expect(() => validateSvgData(example.data)).not.toThrow();
  });
  it.each([
    [figure("<script>alert(1)</script>"), "<script>"],
    [figure("<style>rect{}</style>"), "<style>"],
    [figure('<rect onclick="x()"/>'), "event attributes"],
    [figure('<a href="https://example.com"><rect/></a>'), "<a>"],
    [figure('<image href="https://example.com/a.png"/>'), "href"],
    [figure('<rect style="fill:url(https://x)"/>'), "url(...)"],
    [figure("<foreignObject/>"), "<foreignObject>"],
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', "viewBox"],
  ])("rejects unsafe or unscalable source %#", (source, message) => {
    expect(() => validateSvgData({ source, alt: "figure" })).toThrow(message);
  });
  it("requires a description for readers who cannot see the figure", () => {
    expect(() => validateSvgData({ source: figure("<rect/>") })).toThrow("alt");
  });
});

describe("mechanism-diagram contract", () => {
  it("accepts the catalog defaults and examples", () => {
    const mechanism = entry("mechanism-diagram");
    expect(() => validateMechanismData(mechanism.defaultData)).not.toThrow();
    for (const example of mechanism.examples)
      expect(() => validateMechanismData(example.data)).not.toThrow();
  });
  const base = (): any => ({
    nodes: [
      { id: "a", label: "A", col: 0, row: 0 },
      {
        id: "t",
        col: 1,
        row: 0,
        table: { columns: ["key", "value"], rows: [["k", "v"]] },
      },
    ],
    links: [{ id: "l", from: "a", to: "t", in: ["s1"] }],
    steps: [{ id: "s1", title: "One" }],
  });
  it.each([
    [
      (d: any) => (d.links[0].to = "ghost"),
      "links[0].to references a missing node",
    ],
    [
      (d: any) => (d.links[0].in = ["s9"]),
      "links[0].in[0] references a missing step",
    ],
    [
      (d: any) => (d.nodes[1].table.rows = [["only one"]]),
      "nodes[1].table.rows[0] must be a row of 2 cells",
    ],
    [
      (d: any) => (d.steps[0].tables = { a: { highlight: 0 } }),
      "steps[0].tables.a references a node without a table",
    ],
    [
      (d: any) => (d.steps[0].focus = ["nope"]),
      "steps[0].focus[0] references a missing element",
    ],
    [
      (d: any) => (d.nodes[0].label = undefined),
      "nodes[0].label must be non-empty text",
    ],
    [(d: any) => (d.nodes[1].id = "a"), "nodes[1].id duplicates id a"],
    [(d: any) => ((d.steps = undefined), d), "links[0].in needs steps"],
  ])("names the field path of a broken reference %#", (change, message) => {
    const data = base();
    change(data);
    expect(() => validateMechanismData(data)).toThrow(message);
  });
});

describe("mechanism-diagram rendering", () => {
  it("draws the current step only and prints every step", () => {
    const nat = entry("mechanism-diagram").examples[0].data;
    const html = renderToStaticMarkup(
      createElement(MechanismDiagramBlock, { data: nat }),
    );
    // Live frame shows the first step's label; the print copy draws all three.
    expect(html).toContain("从 192.168.0.5:41641");
    expect(html.match(/class="md-print-step"/g)).toHaveLength(3);
    expect(html).toContain("发往 203.0.113.7:22");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/<input|<textarea/);
  });
});
