import { describe, expect, it } from "vitest";
import { mobileNavigationLayout, sidebarSwipe } from "./mobile-navigation.mjs";
import { boardFingerNavigates } from "../surface/board-input.mjs";

describe("mobile navigation and writing ownership", () => {
  it("keeps the phone and portrait tablet page full size, and docks only a wide landscape tablet", () => {
    expect(mobileNavigationLayout("phone", 844, 390).docked).toBe(false);
    expect(mobileNavigationLayout("pad", 834, 1194).docked).toBe(false);
    expect(mobileNavigationLayout("pad", 1194, 834)).toEqual({
      docked: true,
      width: 240,
    });
    expect(mobileNavigationLayout("pad", 600, 400).docked).toBe(false);
    expect(mobileNavigationLayout("pad", 834, 600, "portrait").docked).toBe(
      false,
    );
  });
  it("reveals the sidebar from an edge swipe without consuming ordinary canvas pans or vertical scrolling", () => {
    expect(sidebarSwipe({ x: 10, y: 200 }, { x: 90, y: 215 })).toBe(true);
    expect(sidebarSwipe({ x: 100, y: 200 }, { x: 190, y: 200 })).toBe(false);
    expect(sidebarSwipe({ x: 10, y: 200 }, { x: 15, y: 300 })).toBe(false);
  });
  it("opens Boards full screen even on a landscape tablet while retaining project navigation", () => {
    expect(mobileNavigationLayout("pad", 1194, 834, "landscape", true)).toEqual(
      { docked: false, width: 280 },
    );
    expect(
      mobileNavigationLayout("pad", 1194, 834, "landscape", false).docked,
    ).toBe(true);
  });
  it("reserves tablet finger contacts for navigation unless writing is explicitly enabled", () => {
    const tablet = { native: true, device: "pad", fingerDrawing: false };
    expect(boardFingerNavigates("touch", tablet)).toBe(true);
    expect(boardFingerNavigates("pen", tablet)).toBe(false);
    expect(
      boardFingerNavigates("touch", { ...tablet, fingerDrawing: true }),
    ).toBe(false);
    expect(boardFingerNavigates("touch", { ...tablet, device: "phone" })).toBe(
      false,
    );
    expect(boardFingerNavigates("mouse", tablet)).toBe(false);
  });
});
