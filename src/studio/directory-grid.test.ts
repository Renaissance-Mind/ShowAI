import { expect, test } from "vitest";
import { directoryColumns } from "./directory-grid";

test("a full-width library shows four, three or two columns by thumbnail size", () => {
  expect(directoryColumns(1136, "small")).toBe(4);
  expect(directoryColumns(1136, "medium")).toBe(3);
  expect(directoryColumns(1136, "large")).toBe(2);
});

test("columns drop as the list narrows and never go below one or above four", () => {
  expect(directoryColumns(700, "small")).toBe(3);
  expect(directoryColumns(700, "medium")).toBe(2);
  expect(directoryColumns(700, "large")).toBe(1);
  expect(directoryColumns(300, "small")).toBe(1);
  expect(directoryColumns(0, "medium")).toBe(1);
  expect(directoryColumns(4000, "small")).toBe(4);
});

test("a card exactly at the preferred width keeps its column", () => {
  expect(directoryColumns(300 * 2 + 16, "medium")).toBe(2);
  expect(directoryColumns(300 * 2 + 15, "medium")).toBe(1);
});
