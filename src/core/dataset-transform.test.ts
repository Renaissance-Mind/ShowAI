import { describe, expect, test } from "vitest";
import { TRANSFORM_LIMITS, runTransform } from "./dataset-transform";

const book = {
  sheets: [
    {
      name: "说明",
      rows: [["本表按月统计"]],
    },
    {
      name: "预算",
      rows: [
        ["部门预算", null, null],
        [null, null, null],
        [null, "月份", "金额"],
        [null, "1月", 1200],
        [null, "2月", 800.5],
        [null, null, null],
        [null, "备注", "含税"],
      ],
    },
  ],
};

async function value(script: string, inputs: Record<string, unknown> = {}) {
  const result = await runTransform(script, inputs);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return (result as { value: unknown }).value;
}

describe("helpers", () => {
  test("sheet, cell and range read a workbook", async () => {
    expect(
      await value(
        `function transform({ book }, h) {
          const sheet = h.sheet(book, "预算");
          return {
            first: h.sheet(book).name,
            byIndex: h.sheet(book, 1).name,
            title: h.cell(sheet, "A1"),
            amount: h.cell(sheet, "$C$4"),
            outside: h.cell(sheet, "Z99"),
            box: h.range(sheet, "B3:C5"),
            reversed: h.range(sheet, "C4:B3"),
          };
        }`,
        { book },
      ),
    ).toEqual({
      first: "说明",
      byIndex: "预算",
      title: "部门预算",
      amount: 1200,
      outside: null,
      box: [
        ["月份", "金额"],
        ["1月", 1200],
        ["2月", 800.5],
      ],
      reversed: [
        ["月份", "金额"],
        ["1月", 1200],
      ],
    });
  });

  test("find locates a header and table reads the rows below it", async () => {
    expect(
      await value(
        `function transform({ book }, h) {
          const sheet = h.sheet(book, "预算");
          const header = h.find(sheet, "月份");
          const byFunction = h.find(sheet, (value) => typeof value === "number" && value < 1000);
          const rows = h.table(sheet, { header: header.row });
          return { header, byFunction, rows, missing: h.find(sheet, "无"), letters: h.columnName(27) };
        }`,
        { book },
      ),
    ).toEqual({
      header: { row: 2, column: 1, ref: "B3", value: "月份" },
      byFunction: { row: 4, column: 2, ref: "C5", value: 800.5 },
      rows: [
        { A: null, 月份: "1月", 金额: 1200 },
        { A: null, 月份: "2月", 金额: 800.5 },
      ],
      missing: null,
      letters: "AB",
    });
  });

  test("helper misuse fails with a message naming the problem", async () => {
    const missing = await runTransform(
      `function transform({ book }, h) { return h.sheet(book, "利润"); }`,
      { book },
    );
    expect(missing).toMatchObject({ ok: false, code: "TRANSFORM_FAILED" });
    expect((missing as { message: string }).message).toContain(
      'Sheet "利润" not found',
    );
    const reference = await runTransform(
      `function transform({ book }, h) {\n  return h.cell(h.sheet(book), "3B");\n}`,
      { book },
    );
    expect((reference as { message: string }).message).toContain(
      '"3B" is not a cell reference',
    );
  });
});

describe("sandbox", () => {
  test("multiple inputs arrive as deep copies of JSON", async () => {
    const inputs = { a: { list: [1, 2] }, b: [{ x: 3 }] };
    expect(
      await value(
        `function transform(inputs) {
          inputs.a.list.push(99);
          return { sum: inputs.a.list.reduce((s, n) => s + n, 0) + inputs.b[0].x, names: Object.keys(inputs) };
        }`,
        inputs,
      ),
    ).toEqual({ sum: 105, names: ["a", "b"] });
    expect(inputs.a.list).toEqual([1, 2]);
  });

  test("host objects are absent", async () => {
    expect(
      await value(`function transform() {
        return [typeof process, typeof require, typeof fetch, typeof setTimeout,
          typeof XMLHttpRequest, typeof console, typeof globalThis.os, typeof globalThis.std];
      }`),
    ).toEqual(Array(8).fill("undefined"));
    const imported = await runTransform(
      `function transform() { return import("fs"); }`,
      {},
    );
    expect(imported.ok).toBe(false);
  });

  test("an endless loop is stopped at the deadline", async () => {
    const started = Date.now();
    const result = await runTransform(
      `function transform() { while (true) {} }`,
      {},
    );
    expect(result).toMatchObject({ ok: false, code: "TRANSFORM_FAILED" });
    expect((result as { message: string }).message).toContain(
      "ran longer than 2 s",
    );
    expect(Date.now() - started).toBeLessThan(
      TRANSFORM_LIMITS.timeoutMs + 3000,
    );
    // The engine keeps working after an interrupted run.
    expect(await value(`function transform() { return 1; }`)).toBe(1);
  });

  test("memory and stack are bounded", async () => {
    for (const script of [
      "return new Array(5e7).fill(1).length;",
      'const list = []; for (let i = 0; ; i++) list.push({ i, text: "row " + i });',
    ]) {
      const memory = await runTransform(
        `function transform() { ${script} }`,
        {},
      );
      expect(memory, script).toMatchObject({
        ok: false,
        code: "TRANSFORM_FAILED",
        message: "The script used more than 64 MiB of memory and was stopped.",
      });
    }
    const recursion = await runTransform(
      `function transform() { const deep = (n) => deep(n + 1) + 1; return deep(0); }`,
      {},
    );
    expect(recursion).toMatchObject({ ok: false, code: "TRANSFORM_FAILED" });
    expect(
      await value(`function transform() { return "still running"; }`),
    ).toBe("still running");
  });

  test("errors name the script line", async () => {
    const thrown = await runTransform(
      `function transform(inputs) {\n  const rows = inputs.missing;\n  return rows.length;\n}`,
      {},
    );
    expect(thrown).toMatchObject({
      ok: false,
      code: "TRANSFORM_FAILED",
      line: 3,
    });
    expect((thrown as { message: string }).message).toMatch(
      /^TypeError: .*\(line 3\)$/,
    );
    const syntax = await runTransform(`function transform( {`, {});
    expect(syntax).toMatchObject({ ok: false, code: "TRANSFORM_FAILED" });
    expect((syntax as { message: string }).message).toMatch(/^SyntaxError/);
    const none = await runTransform(`const x = 1;`, {});
    expect((none as { message: string }).message).toContain(
      "defines no function transform",
    );
  });

  test("output must be JSON data", async () => {
    for (const [script, text] of [
      ["return undefined;", "returned nothing"],
      ["return { when: new Date(0) };", "the output.when is a Date"],
      ["return { list: [1, undefined] };", "the output.list[1] is undefined"],
      ["return { n: NaN };", "numbers must be finite"],
      ["return { f() {} };", "is a function"],
      ["return Promise.resolve(1);", "is a Promise"],
    ]) {
      const result = await runTransform(
        `function transform() { ${script} }`,
        {},
      );
      expect(result, script).toMatchObject({
        ok: false,
        code: "OUTPUT_INVALID",
      });
      expect((result as { message: string }).message, script).toContain(text);
    }
    // Properties set to undefined are left out, as JSON does.
    expect(
      await value(`function transform() { return { a: 1, b: undefined }; }`),
    ).toEqual({ a: 1 });
  });

  test("output larger than a dataset is refused", async () => {
    const result = await runTransform(
      `function transform() { return "x".repeat(${TRANSFORM_LIMITS.outputBytes + 10}); }`,
      {},
    );
    expect(result).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });
});
