import { expect, it } from "vitest";
import { mergeValues } from "./catalog-merge";

it("distinguishes choosing a deletion from choosing an explicit null", () => {
  const base = { field: "base", retained: 1 };
  const ours = { retained: 2 };
  const theirs = { field: null, retained: 1 };
  expect(
    mergeValues(base, ours, theirs, "/page", { "/page/field": "ours" }),
  ).toEqual({ value: { retained: 2 }, conflicts: [] });
  expect(
    mergeValues(base, ours, theirs, "/page", { "/page/field": "theirs" }),
  ).toEqual({ value: { field: null, retained: 2 }, conflicts: [] });
});
it("uses escaped conflict paths and preserves complete rich-text values", () => {
  const key = "source/with~escape";
  const before = [{ type: "text", text: "Base" }];
  const left = [{ type: "text", text: "Left", marks: [{ type: "bold" }] }];
  const right = [
    {
      type: "text",
      text: "Right",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    },
  ];
  const result = mergeValues(
    { [key]: before },
    { [key]: left },
    { [key]: right },
    "/page",
    { "/page/source~1with~0escape": "theirs" },
  );
  expect(result).toEqual({ value: { [key]: right }, conflicts: [] });
  expect((result.value as Record<string, unknown>)[key]).not.toBe(right);
});
