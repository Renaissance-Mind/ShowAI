import { describe, expect, test } from "vitest";
import tokens from "../design/tokens.css?raw";
import {
  exitKeyframes,
  parseDuration,
  planRowMotion,
  ROW_MOTION_LIMIT,
  type RowBox,
} from "./motion";

const row = (top: number, left = 0): RowBox => ({
  top,
  left,
  width: 200,
  height: 30,
});
const layout = (entries: [string, RowBox][]) => new Map(entries);
const view = { top: 0, bottom: 600 };

describe("motion values", () => {
  test("parses CSS times", () => {
    expect(parseDuration("140ms")).toBe(140);
    expect(parseDuration("0.2s")).toBe(200);
    expect(parseDuration(" 320ms ")).toBe(320);
    expect(parseDuration("")).toBe(0);
  });

  test("the token file defines the durations scripts read", () => {
    for (const token of [
      "--duration-fast",
      "--duration-base",
      "--duration-slow",
      "--ease-out",
      "--ease-in-out",
    ])
      expect(tokens).toContain(`${token}:`);
  });

  test("every exit ends transparent", () => {
    for (const style of ["fade", "pop", "drop", "rise"] as const) {
      const frames = exitKeyframes(style);
      expect(frames[0].opacity).toBe(1);
      expect(frames.at(-1)!.opacity).toBe(0);
    }
  });
});

describe("row motion plan", () => {
  test("rows below a removed row move up and the removed row leaves", () => {
    const before = layout([
      ["a", row(0)],
      ["b", row(30)],
      ["c", row(60)],
    ]);
    const after = layout([
      ["a", row(0)],
      ["c", row(30)],
    ]);
    expect(planRowMotion(before, after, view)).toEqual({
      moves: [{ key: "c", dx: 0, dy: 30 }],
      enters: [],
      exits: ["b"],
    });
  });

  test("an inserted row enters and pushes the rows below", () => {
    const before = layout([
      ["a", row(0)],
      ["b", row(30)],
    ]);
    const after = layout([
      ["new", row(0)],
      ["a", row(30)],
      ["b", row(60)],
    ]);
    expect(planRowMotion(before, after, view)).toEqual({
      moves: [
        { key: "a", dx: 0, dy: -30 },
        { key: "b", dx: 0, dy: -30 },
      ],
      enters: ["new"],
      exits: [],
    });
  });

  test("a reordered row slides from its old place", () => {
    const before = layout([
      ["a", row(0)],
      ["b", row(30)],
    ]);
    const after = layout([
      ["b", row(0)],
      ["a", row(30)],
    ]);
    expect(planRowMotion(before, after, view)?.moves).toEqual([
      { key: "b", dx: 0, dy: 30 },
      { key: "a", dx: 0, dy: -30 },
    ]);
  });

  test("grid cards move on both axes", () => {
    const before = layout([["a", row(0, 220)]]);
    const after = layout([["a", row(30, 0)]]);
    expect(planRowMotion(before, after, view)?.moves).toEqual([
      { key: "a", dx: 220, dy: -30 },
    ]);
  });

  test("only rows in the visible band animate", () => {
    const before = layout([
      ["near", row(100)],
      ["far", row(5000)],
      ["gone", row(9000)],
    ]);
    const after = layout([
      ["near", row(130)],
      ["far", row(5030)],
      ["fresh", row(8000)],
    ]);
    expect(planRowMotion(before, after, view)).toEqual({
      moves: [{ key: "near", dx: 0, dy: -30 }],
      enters: [],
      exits: [],
    });
  });

  test("an unchanged layout plans nothing", () => {
    const before = layout([["a", row(0)]]);
    expect(planRowMotion(before, new Map(before), view)).toBeNull();
  });

  test("a change larger than the limit is not animated", () => {
    const before = layout([["a", row(0)]]);
    const after = layout([
      ["a", row(0)],
      ...Array.from(
        { length: ROW_MOTION_LIMIT + 1 },
        (_, index) => [`n${index}`, row(30 + index * 30)] as [string, RowBox],
      ),
    ]);
    expect(planRowMotion(before, after, view)).toBeNull();
    expect(
      planRowMotion(before, after, view, ROW_MOTION_LIMIT + 1),
    ).not.toBeNull();
  });
});
