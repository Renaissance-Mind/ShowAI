import { expect, test } from "vitest";
import {
  componentParameterReference,
  parameterRuleIssues,
  parameterPath,
  schemaParameters,
} from "../../portable/component-parameters.mjs";
import { assertProps, assertParameterDefinition } from "./schema";
import { validateComponentDocumentation } from "./documentation";
import { parameterComponent } from "../../test/parameter-component";
import { builtinComponentCatalog } from "../catalog";

test("generated reference preserves schema constraints, semantics and distinguishes initialization from fallback", () => {
  const source = parameterComponent(),
    docs = validateComponentDocumentation(source.manifest.documentation, 1);
  if (docs.version !== 2) throw new Error("Expected authored v2");
  assertParameterDefinition(source.schema, docs, [source.manifest.defaultData]);
  const report = componentParameterReference(
    source.schema,
    docs,
    source.manifest.defaultData,
    source.manifest.examples,
  );
  expect(report.verifiedContract).toBe(true);
  const selected = report.entries.find((x) => x.path === "/selected")!;
  expect(selected.required).toBe("optional");
  expect(selected.omission.from.path).toBe("slides[].id");
  const x = report.entries.find((e) => e.path === "/slides/*/regions/*/box/x")!;
  expect(x.constraints.maximum).toBe(100);
  expect(x.units).toBe("%");
  expect(x.coordinateSystem).toContain("100×100");
  expect(x.context.path).toBe("/slides/*/regions/*/box");
  expect(x.samples[0].value).toBe(5);
  const data = structuredClone(source.manifest.defaultData);
  delete data.selected;
  assertProps(source.schema, data, docs);
  expect(data.selected).toBeUndefined();
});
test("missing meanings, fake paths, omitted optional behavior and invalid fallback values cannot claim v2", () => {
  const source = parameterComponent(),
    docs = validateComponentDocumentation(source.manifest.documentation, 1);
  if (docs.version !== 2) throw new Error("Expected authored v2");
  const missing = structuredClone(docs);
  missing.usage.inputs = missing.usage.inputs.filter(
    (x) => x.path !== "slides[].regions[].box.x",
  );
  expect(() => assertParameterDefinition(source.schema, missing)).toThrow(
    "missing-meaning",
  );
  const typo = structuredClone(docs);
  typo.usage.inputs.push({ path: "slides[].phantom", meaning: "not real" });
  expect(() => assertParameterDefinition(source.schema, typo)).toThrow(
    "unknown-path",
  );
  const omit = structuredClone(docs);
  delete omit.usage.inputs.find((x) => x.path === "selected")!.omission;
  expect(() => assertParameterDefinition(source.schema, omit)).toThrow(
    "missing-omission",
  );
  const fallback = structuredClone(docs);
  fallback.usage.inputs.find((x) => x.path === "selected")!.omission = {
    behavior: "fallback",
    description: "wrong type",
    value: 7,
  };
  expect(() => assertParameterDefinition(source.schema, fallback)).toThrow(
    "Fallback",
  );
});
test("ID scope, references, zero-based indexes and coordinate extents reject real invalid input", () => {
  const source = parameterComponent(),
    docs = validateComponentDocumentation(source.manifest.documentation, 1);
  if (docs.version !== 2) throw new Error("Expected authored v2");
  const mutate = (f: (data: any) => void) => {
    const data = structuredClone(source.manifest.defaultData);
    f(data);
    return data;
  };
  for (const data of [
    mutate((d) => (d.slides[1].id = d.slides[0].id)),
    mutate((d) => (d.selected = "absent")),
    mutate((d) => (d.slides[0].target.regionId = "r2")),
    mutate((d) => (d.slides[0].target.index = 1)),
    mutate((d) => (d.slides[0].regions[0].box.w = 99)),
  ])
    expect(() => assertProps(source.schema, data, docs)).toThrow("relations");
  const repeatedAcrossParents = mutate((d) => {
    d.slides[1].regions[0].id = "r1";
    d.slides[1].target.regionId = "r1";
  });
  expect(() =>
    assertProps(source.schema, repeatedAcrossParents, docs),
  ).not.toThrow();
});
test("index via an ID selects the corresponding nested array, rather than another sibling", () => {
  const data = {
    slides: [
      {
        visuals: [
          { id: "a", regions: ["x"] },
          { id: "b", regions: ["x", "y"] },
        ],
        blocks: [{ target: { visualId: "b", region: 1 } }],
      },
    ],
  };
  const rules = [
    {
      kind: "index" as const,
      path: "slides[].blocks[].target.region",
      target: "slides[].visuals[].regions",
      via: {
        source: "slides[].blocks[].target.visualId",
        target: "slides[].visuals[].id",
      },
    },
  ];
  expect(parameterRuleIssues(data, rules)).toEqual([]);
  data.slides[0].blocks[0].target.visualId = "a";
  expect(parameterRuleIssues(data, rules)).toHaveLength(1);
});
test("local references, conditional schema fields and escaped pointers remain inspectable", () => {
  const schema = {
    type: "object",
    definitions: {
      point: {
        type: "object",
        properties: { "a/b": { type: "number", description: "coordinate" } },
        required: ["a/b"],
      },
    },
    properties: { point: { $ref: "#/definitions/point" } },
    oneOf: [
      {
        properties: { mode: { const: "a" }, alpha: { type: "number" } },
        required: ["alpha"],
      },
      { properties: { mode: { const: "b" }, beta: { type: "string" } } },
    ],
  };
  expect(schemaParameters(schema).some((x) => x.path === "/point/a~1b")).toBe(
    true,
  );
  expect(
    schemaParameters(schema).find((x) => x.path === "/alpha")?.required,
  ).toBe("conditional");
  expect(parameterPath("slides[].id")).toBe("/slides/*/id");
  expect(() => parameterPath("/__proto__")).toThrow();
});
test("legacy component references expose missing contract information without becoming authoring v2", () => {
  for (const item of builtinComponentCatalog({ includeLegacy: true })) {
    const reference = componentParameterReference(
      item.propsSchema,
      item.documentation,
      item.defaultData,
      item.examples,
    );
    expect(reference.documentationVersion).toBe(item.documentation?.version);
    if (item.documentation?.version === 1)
      expect(reference.verifiedContract).toBe(false);
  }
});

test("a closed zero-parameter component is valid, while undocumented free input is not", () => {
  const source = parameterComponent(),
    docs = validateComponentDocumentation(source.manifest.documentation, 1);
  if (docs.version !== 2) throw new Error("v2");
  docs.usage.inputs = [];
  docs.usage.rules = [];
  expect(() =>
    assertParameterDefinition(
      { type: "object", properties: {}, additionalProperties: false },
      docs,
    ),
  ).not.toThrow();
  expect(() => assertParameterDefinition({ type: "object" }, docs)).toThrow(
    "unbounded-root",
  );
  expect(
    parameterRuleIssues({ selected: "a", items: [{ id: "a" }, { id: "a" }] }, [
      { kind: "reference", path: "selected", target: "items[].id" },
    ]),
  ).toHaveLength(1);
});

test("escaped array scopes are distinct when references cross different containers", () => {
  const data = {
    "a/b": [{ ref: "y" }, { ref: "x" }],
    a: { b: [{ id: "x" }, { id: "y" }] },
  };
  expect(
    parameterRuleIssues(data, [
      { kind: "reference", path: "/a~1b/*/ref", target: "/a/b/*/id" },
    ]),
  ).toEqual([]);
});

test("root-local recursive schemas stop at the reusable definition without treating it as a remote reference", () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string" },
      children: { type: "array", items: { $ref: "#" } },
    },
  };
  expect(schemaParameters(schema).map((x) => x.path)).toEqual([
    "/id",
    "/children",
    "/children/*",
  ]);
});

test("derived renderer fallbacks retain their source paths without pretending to evaluate prose", () => {
  const source = parameterComponent(),
    docs = validateComponentDocumentation(source.manifest.documentation, 1);
  if (docs.version !== 2) throw new Error("v2");
  docs.usage.inputs.find((x) => x.path === "selected")!.omission = {
    behavior: "fallback",
    description: "Renderer chooses the first slide matching its view rule.",
    computedFrom: ["slides[].id"],
  };
  expect(() => assertParameterDefinition(source.schema, docs)).not.toThrow();
  docs.usage.inputs.find((x) => x.path === "selected")!.omission!.computedFrom =
    ["notReal"];
  expect(() => assertParameterDefinition(source.schema, docs)).toThrow(
    "unknown-fallback-source",
  );
});

test("explicit no-selection sentinels remain distinct from invalid indexes/references", () => {
  const data = { selected: null, index: -1, items: [] };
  expect(
    parameterRuleIssues(data, [
      {
        kind: "reference",
        path: "selected",
        target: "items[].id",
        sentinelValues: [null],
      },
      { kind: "index", path: "index", target: "items", sentinelValues: [-1] },
    ]),
  ).toEqual([]);
  expect(
    parameterRuleIssues({ ...data, index: -2 }, [
      { kind: "index", path: "index", target: "items", sentinelValues: [-1] },
    ]),
  ).toHaveLength(1);
});

test("no-selection declarations must be accepted by the actual field schema", () => {
  const source = parameterComponent(),
    docs = validateComponentDocumentation(source.manifest.documentation, 1);
  if (docs.version !== 2) throw new Error("v2");
  docs.usage.rules!.push({
    kind: "index",
    path: "slides[].target.index",
    target: "slides[].regions",
    sentinelValues: [-1],
  });
  const parsed = validateComponentDocumentation(docs, 1);
  expect(() => assertParameterDefinition(source.schema, parsed)).toThrow(
    "sentinel",
  );
});
