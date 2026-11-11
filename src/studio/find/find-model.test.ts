import { describe, expect, it } from "vitest";
import {
  findInSegments,
  nearestMatch,
  replacementOrder,
  stepMatch,
} from "./find-model";
import { findShortcut } from "./useFind";

describe("find model", () => {
  const segments = ["Apple pie and apple tart", "No fruit here", "APPLE"];

  it("finds every occurrence without crossing segments, ignoring case by default", () => {
    expect(
      findInSegments(segments, "apple", { caseSensitive: false }),
    ).toEqual([
      { segment: 0, start: 0, end: 5 },
      { segment: 0, start: 14, end: 19 },
      { segment: 2, start: 0, end: 5 },
    ]);
    expect(findInSegments(["ab", "cd"], "bc", { caseSensitive: false })).toEqual(
      [],
    );
  });

  it("matches case when asked and treats the query as literal text", () => {
    expect(
      findInSegments(segments, "apple", { caseSensitive: true }),
    ).toEqual([{ segment: 0, start: 14, end: 19 }]);
    expect(
      findInSegments(["a.b a+b (x)"], "a+b", { caseSensitive: false }),
    ).toEqual([{ segment: 0, start: 4, end: 7 }]);
    expect(
      findInSegments(["(x) [y]"], "(x)", { caseSensitive: false }),
    ).toEqual([{ segment: 0, start: 0, end: 3 }]);
    expect(findInSegments(segments, "", { caseSensitive: false })).toEqual([]);
  });

  it("counts non-overlapping matches and handles text outside the BMP", () => {
    expect(
      findInSegments(["aaaa"], "aa", { caseSensitive: false }).length,
    ).toBe(2);
    expect(findInSegments(["😀x😀"], "😀", { caseSensitive: false })).toEqual([
      { segment: 0, start: 0, end: 2 },
      { segment: 0, start: 3, end: 5 },
    ]);
  });

  it("steps forward and back with wrapping", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });

  it("keeps the current match near its place when matches change", () => {
    const matches = findInSegments(segments, "apple", { caseSensitive: false });
    expect(nearestMatch(matches, null)).toBe(0);
    expect(nearestMatch(matches, { segment: 0, start: 10, end: 15 })).toBe(1);
    expect(nearestMatch(matches, { segment: 1, start: 0, end: 1 })).toBe(2);
    expect(nearestMatch(matches, { segment: 9, start: 0, end: 1 })).toBe(0);
    expect(nearestMatch([], null)).toBe(-1);
  });

  it("orders replacements last first and drops overlapping ranges", () => {
    expect(
      replacementOrder([
        { from: 1, to: 4 },
        { from: 10, to: 12 },
        { from: 3, to: 5 },
      ]),
    ).toEqual([
      { from: 10, to: 12 },
      { from: 3, to: 5 },
    ]);
  });
});

describe("find shortcuts", () => {
  const key = (
    init: Partial<Parameters<typeof findShortcut>[0]> & { key: string },
  ) => ({
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  });
  it("uses Command on macOS and Ctrl elsewhere", () => {
    expect(findShortcut(key({ key: "f", metaKey: true }), true)).toBe("open");
    expect(findShortcut(key({ key: "f", ctrlKey: true }), true)).toBeNull();
    expect(findShortcut(key({ key: "f", ctrlKey: true }), false)).toBe("open");
    expect(findShortcut(key({ key: "F", ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });
  it("maps replace, next and previous, reading Option chords by their physical key", () => {
    expect(
      findShortcut(key({ key: "ƒ", code: "KeyF", metaKey: true, altKey: true }), true),
    ).toBe("replace");
    expect(findShortcut(key({ key: "g", metaKey: true }), true)).toBe("next");
    expect(
      findShortcut(key({ key: "G", metaKey: true, shiftKey: true }), true),
    ).toBe("previous");
    expect(findShortcut(key({ key: "k", metaKey: true }), true)).toBeNull();
  });
});
