import { describe, expect, it } from "vitest";
import { marqueeIds } from "./directory-marquee";

const entries = [
  { id: "folder", left: 20, right: 220, top: 30, bottom: 230 },
  { id: "page", left: 240, right: 440, top: 30, bottom: 230 },
  { id: "below", left: 20, right: 220, top: 900, bottom: 1100 },
];

describe("directory marquee content coordinates", () => {
  it("selects folders and pages intersected by a partial drag", () => {
    expect(
      marqueeIds(entries, { left: 180, right: 260, top: 100, bottom: 150 }, []),
    ).toEqual(["folder", "page"]);
  });

  it("keeps entries above the viewport selected during downward autoscroll", () => {
    expect(
      marqueeIds(entries, { left: 0, right: 230, top: 0, bottom: 1050 }, []),
    ).toEqual(["folder", "below"]);
  });

  it("selects from a scrolled origin without moving cached entry bounds", () => {
    expect(
      marqueeIds(entries, { left: 10, right: 230, top: 800, bottom: 1200 }, []),
    ).toEqual(["below"]);
    expect(
      marqueeIds(entries, { left: 10, right: 230, top: 100, bottom: 1000 }, []),
    ).toEqual(["folder", "below"]);
  });

  it("preserves modifier selection without duplicates or order changes", () => {
    expect(
      marqueeIds(entries, { left: 0, right: 500, top: 0, bottom: 250 }, [
        "below",
        "page",
      ]),
    ).toEqual(["below", "page", "folder"]);
  });

  it("does not select cards when only their edges touch the rectangle", () => {
    expect(
      marqueeIds(entries, { left: 220, right: 240, top: 30, bottom: 230 }, []),
    ).toEqual([]);
  });
});
