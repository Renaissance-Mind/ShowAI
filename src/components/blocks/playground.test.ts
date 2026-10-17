import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import catalog from "../../../resources/catalog/components.json";
import { calculate, PlaygroundBlock } from "./Playground";
import {
  breakdownParts,
  evaluateExpression,
  evaluatePlayground,
  formatNumber,
  isLegacyPlayground,
  parseExpression,
  rankItems,
  validatePlaygroundData,
} from "./playground-contract.mjs";

// Until the 1.1.0 entry lands in the catalog, read it from the integration fragment.
const FRAGMENT =
  "/Users/chunqiu/ShowAI-Development/development/builtin-candidates-20261018/fragments/playground.json";
const entry: any = catalog.find((component) => component.kind === "playground");
const component: any =
  entry.version === "1.0.0" && existsSync(FRAGMENT)
    ? JSON.parse(readFileSync(FRAGMENT, "utf8")).component
    : entry;
const example = (name: string): any =>
  structuredClone(
    component.examples.find((item: { name: string }) => item.name === name)
      .data,
  );
const evaluate = (source: string, scope: Record<string, number> = {}) =>
  evaluateExpression(parseExpression(source), scope);
const render = (data: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(PlaygroundBlock, { data, readOnly: true }),
  );

describe("playground expressions", () => {
  it("follows arithmetic precedence, power associativity and unary minus", () => {
    expect(evaluate("1 + 2 * 3")).toBe(7);
    expect(evaluate("(1 + 2) * 3")).toBe(9);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("-2 ^ 2")).toBe(-4);
    expect(evaluate("2 ^ -1")).toBe(0.5);
    expect(evaluate("10 / 4 - .5e1")).toBe(-2.5);
  });
  it("evaluates functions, comparisons and references", () => {
    const scope = { people: 3, nights: 4 };
    expect(evaluate("ceil(people / 2)", scope)).toBe(2);
    expect(evaluate("min(people, nights, 1)", scope)).toBe(1);
    expect(evaluate("max(people, nights)", scope)).toBe(4);
    expect(evaluate("round(2.345, 2) + floor(1.9) + abs(-1)")).toBe(4.35);
    expect(evaluate("clamp(people * 10, 0, 25)", scope)).toBe(25);
    expect(evaluate("if(people >= 3, 100, 1 / 0)", scope)).toBe(100);
    expect(
      evaluate("(people == 3) + (people != 3) + (nights < 4)", scope),
    ).toBe(1);
    expect(evaluate("sqrt(16) <= 4", scope)).toBe(1);
  });
  it("rejects malformed input with a position instead of executing it", () => {
    expect(() => parseExpression("1 +")).toThrow(/ended unexpectedly/);
    expect(() => parseExpression("2 * (3")).toThrow(/Expected "\)"/);
    expect(() => parseExpression("alert(1)")).toThrow(
      /Unknown function "alert"/,
    );
    expect(() => parseExpression("a; b")).toThrow(
      /character ";" at position 2/,
    );
    expect(() => parseExpression("this.constructor")).toThrow(/character "\."/);
    expect(() => parseExpression("round()")).toThrow(/1 to 2 argument/);
    expect(() => parseExpression("1 2")).toThrow(/Unexpected "2"/);
    expect(() => parseExpression("-".repeat(80) + "1")).toThrow(
      /nested too deeply/,
    );
    expect(() => evaluate("ghost + 1")).toThrow(/Unknown id "ghost"/);
  });
});

describe("playground contract", () => {
  it("keeps legacy data valid and computing as before", () => {
    const area = example("矩形面积");
    expect(validatePlaygroundData(area)).toBe(area);
    expect(isLegacyPlayground(area)).toBe(true);
    expect(validatePlaygroundData(component.defaultData)).toBeTruthy();
    expect(calculate([3, 4], "product")).toBe(12);
    expect(calculate([3, 4], "average")).toBe(3.5);
    expect(calculate([], "sum")).toBe(0);
    expect(() =>
      validatePlaygroundData({ ...area, operation: "median" }),
    ).toThrow(/operation/);
    expect(() =>
      validatePlaygroundData({
        inputs: [{ id: "a", label: "A", min: 5, max: 1, step: 1, value: 2 }],
      }),
    ).toThrow(/inputs\[0\]\.max/);
    expect(() => validatePlaygroundData({ inputs: [null] })).toThrow(
      /inputs\[0\]/,
    );
  });
  it("accepts every catalog example", () => {
    for (const item of component.examples)
      expect(() => validatePlaygroundData(item.data), item.name).not.toThrow();
  });
  it("reports unknown ids, cycles, duplicates and bad cross references", () => {
    const base = {
      inputs: [{ id: "x", label: "X", min: 0, max: 10, step: 1, value: 2 }],
    };
    expect(() =>
      validatePlaygroundData({
        ...base,
        formulas: [{ id: "y", expr: "x + z" }],
      }),
    ).toThrow(/formulas\[0\]\.expr references unknown id "z"/);
    expect(() =>
      validatePlaygroundData({
        ...base,
        formulas: [
          { id: "a", expr: "b + 1" },
          { id: "b", expr: "c * 2" },
          { id: "c", expr: "a - x" },
        ],
      }),
    ).toThrow(/cycle: a -> b -> c -> a/);
    expect(() =>
      validatePlaygroundData({ ...base, formulas: [{ id: "x", expr: "1" }] }),
    ).toThrow(/duplicates/);
    expect(() =>
      validatePlaygroundData({ ...base, formulas: [{ id: "max", expr: "1" }] }),
    ).toThrow(/reserved/);
    expect(() =>
      validatePlaygroundData({ ...base, formulas: [{ id: "y", expr: "x +" }] }),
    ).toThrow(/formulas\[0\]\.expr: Expression ended/);
    expect(() =>
      validatePlaygroundData({ ...base, outputs: [{ formula: "nope" }] }),
    ).toThrow(/outputs\[0\]\.formula/);
    expect(() =>
      validatePlaygroundData({
        ...base,
        presets: [{ label: "Too far", values: { x: 99 } }],
      }),
    ).toThrow(/presets\[0\]\.values\.x must be within 0 to 10/);
    expect(() =>
      validatePlaygroundData({
        inputs: [
          {
            id: "tier",
            label: "Tier",
            type: "choice",
            value: 3,
            options: [
              { label: "A", value: 1 },
              { label: "B", value: 2 },
            ],
          },
        ],
      }),
    ).toThrow(/inputs\[0\]\.value must equal one of the option values/);
    const ranking = example("折叠屏手机加权排名");
    ranking.ranking.items[0].scores.unknown = 3;
    expect(() => validatePlaygroundData(ranking)).toThrow(
      /does not match a criterion id/,
    );
  });
  it("computes the trip budget the way the homepage demo did", () => {
    const data = example("京都五日预算");
    const scope = evaluatePlayground(data);
    // 2 people, 4 nights, business hotel: one room × 15000 × 4 / 2 + food + transit + trips.
    expect(scope.rooms).toBe(1);
    expect(scope.lodging).toBe(30000);
    expect(scope.perPerson).toBe(30000 + 7000 * 5 + 1200 * 5 + 1600 + 5000);
    const three = evaluatePlayground(data, { people: 3 });
    expect(three.rooms).toBe(2);
    const parts = breakdownParts(data, scope);
    expect(parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1);
    expect(parts[0].value).toBe(30000);
  });
  it("clamps reading values and applies presets as plain input values", () => {
    const data = example("季度推演");
    const base = evaluatePlayground(data);
    expect(base.endArr).toBeCloseTo(
      14100 + 44 * 30 + 14100 * 0.0694 - 14100 * 0.039,
    );
    const plan = data.presets.find(
      (preset: { label: string }) => preset.label === "董事会计划",
    );
    const planned = evaluatePlayground(data, plan.values);
    expect(planned.endArr).toBeGreaterThan(base.endArr);
    expect(evaluatePlayground(data, { growth: 999 }).growth).toBe(60);
  });
  it("ranks by input-driven weights and keeps authored order on ties", () => {
    const data = example("折叠屏手机加权排名");
    const scope = evaluatePlayground(data);
    const ranked = rankItems(data.ranking, scope);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    const perfect = rankItems(
      {
        criteria: [{ id: "a", label: "A", weight: 1 }],
        items: [
          { id: "one", label: "One", scores: { a: 10 } },
          { id: "two", label: "Two", scores: { a: 10 } },
        ],
      },
      {},
    );
    expect(perfect.map((entry) => entry.item.id)).toEqual(["one", "two"]);
    expect(perfect[0].score).toBe(100);
    const camera = rankItems(
      data.ranking,
      evaluatePlayground(data, {
        wPortable: 0,
        wBattery: 0,
        wScreen: 0,
        wPrice: 0,
        wCamera: 5,
      }),
    );
    const best = Math.max(
      ...data.ranking.items.map(
        (item: { scores: { camera: number } }) => item.scores.camera,
      ),
    );
    expect(camera[0].item.scores.camera).toBe(best);
    expect(camera[0].score).toBeCloseTo(best * 10);
  });
  it("formats with prefix, suffix, divisor, fixed decimals and sign", () => {
    expect(
      formatNumber(
        14100,
        { prefix: "$", suffix: "M", divisor: 1000, decimals: 2 },
        "en",
      ),
    ).toBe("$14.10M");
    expect(formatNumber(-3.21, { decimals: 1 }, "en")).toBe("−3.2");
    expect(formatNumber(2, { signed: true, suffix: "%" }, "en")).toBe("+2%");
    expect(formatNumber(0.001, { signed: true, decimals: 1 }, "en")).toBe(
      "±0.0",
    );
    expect(formatNumber(Number.NaN)).toBe("");
  });
});

describe("playground rendering", () => {
  it("renders legacy data with the original result and formula line", () => {
    const html = render(example("矩形面积"));
    expect(html).toContain("sb-calculation-result");
    expect(html).toContain("12");
    expect(html).toContain("长 × 宽");
    expect(html).not.toContain("pg-results");
  });
  it("renders formula outputs, a target verdict, presets and a breakdown table", () => {
    const html = render(example("季度推演"));
    expect(html).toContain("pg-results");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("pg-target");
    expect(html).toContain("低于季度计划");
    const trip = render(example("京都五日预算"));
    expect(trip).toContain('role="radiogroup"');
    expect(trip).toContain("pg-stepper");
    expect(trip).toContain("<table");
    expect(trip).toContain("77,600");
  });
  it("renders a sorted ranking with stacked contributions", () => {
    const html = render(example("折叠屏手机加权排名"));
    expect(html).toContain("pg-rank-list");
    expect(html).toContain("pg-rank-bar");
    expect(html).not.toContain("sb-calculation-result");
  });
});
