import { describe, expect, it } from "vitest";
import { inSubmenuCorridor } from "./menu-aim";

const bounds = { left: 140, right: 300, top: 40, bottom: 220 };
const previous = { x: 100, y: 100 };

describe("submenu pointer corridor", () => {
  it("keeps a right-hand submenu open during diagonal movement", () => {
    expect(
      inSubmenuCorridor({ x: 120, y: 125 }, previous, bounds, "right"),
    ).toBe(true);
    expect(
      inSubmenuCorridor({ x: 139, y: 150 }, previous, bounds, "right"),
    ).toBe(true);
  });

  it("does not intercept movement outside the triangle", () => {
    expect(
      inSubmenuCorridor({ x: 120, y: 180 }, previous, bounds, "right"),
    ).toBe(false);
    expect(
      inSubmenuCorridor({ x: 90, y: 110 }, previous, bounds, "right"),
    ).toBe(false);
  });

  it("uses the near edge when the submenu opens to the left", () => {
    const leftBounds = { left: 0, right: 60, top: 40, bottom: 220 };
    expect(
      inSubmenuCorridor({ x: 80, y: 125 }, previous, leftBounds, "left"),
    ).toBe(true);
    expect(
      inSubmenuCorridor({ x: 120, y: 125 }, previous, leftBounds, "left"),
    ).toBe(false);
  });
});
