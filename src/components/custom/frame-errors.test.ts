import { afterEach, describe, expect, it } from "vitest";
import Ajv from "ajv";
import { setLocale, translator } from "../../i18n";
import messages from "../../i18n/messages/customComponents";
import {
  isValidationMessage,
  parseValidationMessage,
  readFrameRuntimeError,
  readableValidation,
  repeatsRuntimeError,
} from "./frame-errors";

const t = translator(messages) as never;

/** The component runtime joins ajv errors exactly like this (catalog.ts runtimeSource). */
function runtimeMessage(schema: object, data: unknown) {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  expect(validate(data)).toBe(false);
  return (validate.errors ?? [])
    .map(
      (error) =>
        (error.instancePath ||
          (error.params as { missingProperty?: string })?.missingProperty ||
          "data") +
        " " +
        error.message,
    )
    .join("; ");
}

const rowsSchema = {
  type: "object",
  required: ["title", "rows"],
  properties: {
    title: { type: "string" },
    rows: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["label"],
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          value: { type: "number", minimum: 0 },
          tone: { enum: ["good", "bad"] },
        },
      },
    },
  },
};

afterEach(() => setLocale("zh-CN"));

describe("readableValidation", () => {
  it("says which item misses which field", () => {
    setLocale("zh-CN");
    const message = runtimeMessage(rowsSchema, {
      title: "季度",
      rows: [{ value: 3 }],
    });
    expect(message).toBe("/rows/0 must have required property 'label'");
    expect(readableValidation(message, t)).toEqual(["rows 第 1 项缺少 label"]);
    setLocale("en");
    expect(readableValidation(message, t)).toEqual([
      "rows › item 1 is missing “label”",
    ]);
  });

  it("names missing root properties, types, enums, limits and extra fields", () => {
    setLocale("zh-CN");
    const message = runtimeMessage(rowsSchema, {
      rows: [
        { label: 1, value: -1, tone: "meh", extra: true },
      ],
    });
    expect(readableValidation(message, t)).toEqual([
      "缺少 title",
      "rows 第 1 项包含组件不支持的字段",
      "rows 第 1 项的 label应为文本",
      "rows 第 1 项的 value不能小于 0",
      "rows 第 1 项的 tone不是允许的取值",
    ]);
  });

  it("counts list items and keeps unknown messages readable", () => {
    setLocale("en");
    const message = runtimeMessage(rowsSchema, { title: "x", rows: [] });
    expect(readableValidation(message, t)).toEqual([
      "rows needs at least 1 item",
    ]);
    // Parameter relation rules are written by the component author.
    expect(readableValidation("/rows Use rows or series, not both", t)).toEqual([
      "rows: Use rows or series, not both",
    ]);
    expect(readableValidation("Something else broke", t)).toEqual([
      "Something else broke",
    ]);
  });

  it("decodes JSON pointer escapes and tells validation from runtime text", () => {
    expect(parseValidationMessage("/a~1b/2 must be string")[0].path).toEqual([
      "a/b",
      2,
    ]);
    expect(isValidationMessage("/rows/0 must have required property 'label'")).toBe(true);
    expect(isValidationMessage("Cannot read properties of undefined (reading 'map')")).toBe(
      false,
    );
  });
});

describe("readFrameRuntimeError", () => {
  const frame = {};
  const data = {
    channel: "c-1",
    type: "showai:runtime-error",
    kind: "error",
    message: "Cannot read properties of undefined (reading 'map')",
    stack: "TypeError: Cannot read…\n    at Broken",
  };

  it("accepts a report from its own frame on its channel", () => {
    expect(readFrameRuntimeError({ source: frame, data }, frame, "c-1")).toEqual({
      kind: "error",
      message: data.message,
      stack: data.stack,
    });
  });

  it("ignores other frames, channels and malformed reports", () => {
    expect(readFrameRuntimeError({ source: {}, data }, frame, "c-1")).toBeNull();
    expect(readFrameRuntimeError({ source: frame, data }, null, "c-1")).toBeNull();
    expect(readFrameRuntimeError({ source: frame, data }, frame, "c-2")).toBeNull();
    for (const bad of [
      null,
      "text",
      { ...data, type: "showai:error" },
      { ...data, kind: "warning" },
      { ...data, message: 42 },
      { ...data, message: "   " },
    ])
      expect(readFrameRuntimeError({ source: frame, data: bad }, frame, "c-1")).toBeNull();
  });

  it("bounds the message and stack it keeps", () => {
    const long = readFrameRuntimeError(
      {
        source: frame,
        data: { ...data, message: "x".repeat(5000), stack: "y".repeat(9000) },
      },
      frame,
      "c-1",
    )!;
    expect(long.message).toHaveLength(2000);
    expect(long.stack).toHaveLength(4000);
  });

  it("recognises the legacy runtime repeating the same failure", () => {
    const error = readFrameRuntimeError({ source: frame, data }, frame, "c-1");
    expect(repeatsRuntimeError(`Uncaught TypeError: ${data.message}`, error)).toBe(true);
    expect(repeatsRuntimeError("/rows must be array", error)).toBe(false);
    expect(repeatsRuntimeError(data.message, null)).toBe(false);
  });
});
