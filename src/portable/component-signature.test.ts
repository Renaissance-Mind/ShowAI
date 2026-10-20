import { describe, expect, test } from "vitest";
import {
  COMPONENT_SIGNATURE_LIMIT,
  componentSignature,
} from "./component-signature.mjs";
import { builtinComponentCatalog } from "../components/catalog";

const chart = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    type: { enum: ["line", "bar"] },
    labels: { type: "array", items: { type: "string" }, maxItems: 500 },
    series: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          values: { type: "array", items: { type: "number" } },
          color: { type: "string" },
        },
        required: ["name", "values"],
      },
    },
    unit: { type: "string" },
  },
  required: ["labels", "series"],
};

describe("componentSignature", () => {
  test("lists required fields first and nested shapes inline", () => {
    expect(componentSignature("chart", chart)).toBe(
      'chart { labels: string[], series: { name: string, values: number[], color?: string }[], title?: string, description?: string, type?: "line" | "bar", unit?: string }',
    );
  });

  test("is deterministic and independent of required order", () => {
    const reordered = { ...chart, required: ["series", "labels"] };
    expect(componentSignature("chart", reordered)).toBe(
      componentSignature("chart", chart),
    );
  });

  test("renders enums, literals, tuples, unions, records and refs", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { enum: ["a", "b", "c", "d", "e", "f", "g", "h"] },
        flag: { const: true },
        pair: { type: "array", items: [{ type: "string" }, { type: "number" }] },
        mixed: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        nullable: { type: ["string", "null"] },
        lookup: { type: "object", additionalProperties: { type: "number" } },
        node: { $ref: "#/definitions/Node" },
        nodes: { type: "array", items: { $ref: "#/$defs/Node~1Item" } },
        "odd key": { type: "integer" },
        anything: {},
        nothing: false,
      },
      required: ["mode"],
      definitions: { Node: { type: "object" } },
    };
    expect(componentSignature("demo", schema, 400)).toBe(
      'demo { mode: "a" | "b" | "c" | "d" | "e" | …, flag?: true, pair?: [string, number], mixed?: (string | number)[], nullable?: string | null, lookup?: Record<string, number>, node?: Node, nodes?: Node/Item[], "odd key"?: integer, anything?: any, nothing?: never }',
    );
  });

  test("follows a root ref, and summarizes closed or boolean roots", () => {
    expect(
      componentSignature("fixed", {
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
    ).toBe("fixed {}");
    expect(componentSignature("open", true)).toBe("open: any");
    expect(componentSignature("plain", { type: "object" })).toBe("plain: object");
    expect(
      componentSignature("linked", {
        $ref: "#/definitions/Root",
        definitions: {
          Root: {
            type: "object",
            properties: { value: { type: "number" } },
            required: ["value"],
          },
        },
      }),
    ).toBe("linked { value: number }");
  });

  test("collapses nested objects before dropping fields", () => {
    const field = (name: string) => [
      name,
      {
        type: "object",
        properties: {
          alpha: { type: "string" },
          beta: { type: "string" },
          gamma: { type: "string" },
        },
      },
    ];
    const deep = {
      type: "object",
      properties: Object.fromEntries(
        ["first", "second", "third", "fourth", "fifth"].map(field),
      ),
      required: ["first"],
    };
    expect(componentSignature("deep", deep).length).toBeGreaterThan(200);
    expect(componentSignature("deep", deep, 200)).toBe(
      "deep { first: {…}, second?: {…}, third?: {…}, fourth?: {…}, fifth?: {…} }",
    );
    const wide = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          `property${index}`,
          { type: "string" },
        ]),
      ),
      required: ["property39"],
    };
    const truncated = componentSignature("wide", wide);
    expect(truncated.startsWith("wide { property39: string, property0?: string")).toBe(true);
    expect(truncated.endsWith(", … }")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(COMPONENT_SIGNATURE_LIMIT);
    expect(componentSignature("wide", wide, 32)).toBe("wide { property39: string, … }");
    expect(componentSignature("wide", wide, 16)).toBe("wide { … }");
  });

  test("rejects an empty id or an unusable limit", () => {
    expect(() => componentSignature("", chart)).toThrow(/component id/);
    expect(() => componentSignature("chart", chart, 8)).toThrow(/at least 16/);
  });

  test("summarizes every built-in component on one bounded line", () => {
    const items = builtinComponentCatalog({ includeLegacy: true });
    expect(items.length).toBeGreaterThan(50);
    for (const item of items) {
      const text = componentSignature(item.kind, item.propsSchema);
      expect(text.startsWith(`${item.kind} `)).toBe(true);
      expect(text).not.toMatch(/[\r\n]/);
      expect(text.length).toBeLessThanOrEqual(COMPONENT_SIGNATURE_LIMIT);
      expect(componentSignature(item.kind, item.propsSchema)).toBe(text);
    }
    const builtinChart = items.find((item) => item.kind === "chart")!;
    expect(componentSignature("chart", builtinChart.propsSchema)).toBe(
      componentSignature("chart", chart),
    );
  });
});
