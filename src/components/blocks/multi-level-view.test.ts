import { describe, expect, it } from "vitest";
import catalog from "../../../resources/catalog/components.json";
import documentation from "../../../resources/catalog/component-documentation.json";
import {
  componentParameterReference,
  type ParameterDocumentation,
} from "../../contract/component-parameters.mjs";
import {
  validateMultiLevelViewData,
  multiLevelPath,
  multiLevelWidgets,
  type MultiLevelViewData,
} from "./multi-level-view-contract.mjs";
import { getBlockDefinition } from "./registry";
import { validateDocument } from "../../portable/validation.mjs";
import { blankDocument } from "../../core/catalog";
import { createResource } from "../../document/containers.mjs";
const fixture = () =>
  structuredClone(
    validateMultiLevelViewData(
      catalog.find((item) => item.kind === "multi-level-view")!.defaultData,
    ),
  );
const native = (data: unknown) =>
  validateMultiLevelViewData(data, (kind, props) => {
    const definition = getBlockDefinition(kind);
    if (!definition) throw new Error(`Unknown component kind: ${kind}`);
    definition.validate?.(props);
  });
const widget = (data: MultiLevelViewData, index: number) =>
  multiLevelWidgets(data.levels[index])[0];
describe("native multilevel view", () => {
  it("publishes a complete queryable parameter contract", () => {
    const component = catalog.find((item) => item.kind === "multi-level-view")!;
    const report = componentParameterReference(
      component.propsSchema,
      documentation["multi-level-view"] as ParameterDocumentation,
      component.defaultData,
      component.examples,
    );
    expect(report.diagnostics).toEqual([]);
    expect(report.verifiedContract).toBe(true);
  });
  it("validates the architecture and mixed-content examples with native child contracts", () => {
    const data = fixture();
    expect(data.levels).toHaveLength(8);
    const index = new Map(data.levels.map((level) => [level.id, level]));
    expect(
      multiLevelPath(index, "validation").map(
        (level) => multiLevelWidgets(level)[0]?.attrs.kind,
      ),
    ).toEqual(["flowchart", "layer-diagram", "flowchart", "layer-diagram"]);
    for (const example of catalog.find(
      (item) => item.kind === "multi-level-view",
    )!.examples)
      expect(() => native(example.data)).not.toThrow();
  });
  const invalid: [(data: MultiLevelViewData) => void, RegExp][] = [
    [
      (d) => {
        d.root = "missing";
      },
      /root/,
    ],
    [
      (d) => {
        d.levels[1].id = d.root;
      },
      /duplicates/,
    ],
    [
      (d) => {
        d.levels[1].parentId = null;
      },
      /parentId/,
    ],
    [
      (d) => {
        d.levels.find((l) => l.id === "services")!.parentId = "order";
      },
      /cycle/,
    ],
    [
      (d) => {
        d.levels[0].bindings.pop();
      },
      /entry binding/,
    ],
    [
      (d) => {
        d.levels[0].bindings[0].to = "order";
      },
      /direct child/,
    ],
    [
      (d) => {
        d.levels[0].bindings[0].source.id = "missing";
      },
      /existing component target/,
    ],
    [
      (d) => {
        d.levels[0].bindings[0].source.scope = "another-flow";
      },
      /existing component target/,
    ],
    [
      (d) => {
        d.levels[0].bindings.push(structuredClone(d.levels[0].bindings[0]));
      },
      /duplicates a binding/,
    ],
    [
      (d) => {
        widget(d, 0).attrs.data = { flows: "invalid" };
      },
      /component.props/,
    ],
    [
      (d) => {
        widget(d, 1).attrs.data = { layers: [] };
      },
      /component.props/,
    ],
    [
      (d) => {
        widget(d, 0).attrs.kind = "unknown";
      },
      /Unknown component kind/,
    ],
    [
      (d) => {
        widget(d, 0).attrs.data.flows = [
          {
            id: "x",
            label: "x",
            nodes: [{ id: "a", label: "A" }],
            edges: [{ id: "e", source: "a", target: "missing" }],
          },
        ];
      },
      /component.props/,
    ],
    [
      (d) => {
        d.levels[0].bindings[0].blockId = "missing";
      },
      /blockId/,
    ],
  ];
  it.each(invalid)(
    "rejects invalid hierarchy, object identity or child data (%#)",
    (change, error) => {
      const data = fixture();
      change(data);
      expect(() => native(data)).toThrow(error);
    },
  );
  it("requires a component identity for ambiguous multi-component content", () => {
    const data = fixture();
    const node = structuredClone(data.levels[0].content!.content[0]);
    node.attrs!.id = "second-diagram";
    data.levels[0].content!.content.push(node);
    delete data.levels[0].bindings[0].blockId;
    expect(() => native(data)).toThrow(/need blockId/);
  });
  it("accepts native prose without inventing a widget", () => {
    const data = {
      title: "文字层",
      root: "root",
      levels: [
        {
          id: "root",
          parentId: null,
          label: "正文",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "纯文字也可以成为一层。" }],
              },
            ],
          },
          bindings: [],
        },
      ],
    };
    expect(() => native(data)).not.toThrow();
  });
  it("rejects unsupported fields and bounded-list overflows", () => {
    expect(() => native({ ...fixture(), extra: true })).toThrow(/extra/);
    const data = fixture();
    data.levels = Array.from({ length: 81 }, () => data.levels[0]);
    expect(() => native(data)).toThrow(/80/);
  });
  it("uses the same native validation during page saves", () => {
    const doc = createResource(blankDocument()),
      data = fixture();
    doc.content.content = [
      {
        type: "widget",
        attrs: { id: "multilevel", kind: "multi-level-view", data },
      },
    ];
    doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["multilevel"];
    expect(() => validateDocument(doc)).not.toThrow();
    data.levels[0].bindings[0].source.id = "missing";
    expect(() => validateDocument(doc)).toThrow(/existing component target/);
  });
});
