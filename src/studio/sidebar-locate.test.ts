import { describe, expect, it } from "vitest";
import { centeredScrollTop } from "./sidebar-locate";

const container = {
  scrollTop: 300,
  clientHeight: 400,
  scrollHeight: 2000,
  top: 100,
};

describe("centeredScrollTop", () => {
  it("places a row in the middle of the container", () => {
    // The row sits 50px below the visible top, so 350px into the content.
    const top = centeredScrollTop(container, { top: 150, height: 36 });
    expect(top).toBe(350 - (400 - 36) / 2);
  });

  it("settles at the top for rows near the start", () => {
    expect(
      centeredScrollTop(
        { ...container, scrollTop: 0 },
        { top: 140, height: 36 },
      ),
    ).toBe(0);
  });

  it("settles at the end for rows near the bottom", () => {
    expect(
      centeredScrollTop(
        { ...container, scrollTop: 1500 },
        { top: 450, height: 36 },
      ),
    ).toBe(1600);
  });

  it("stays at zero when the content fits without scrolling", () => {
    expect(
      centeredScrollTop(
        { scrollTop: 0, clientHeight: 400, scrollHeight: 300, top: 0 },
        { top: 250, height: 36 },
      ),
    ).toBe(0);
  });

  it("rounds to whole pixels", () => {
    expect(
      Number.isInteger(
        centeredScrollTop(container, { top: 151.5, height: 35 }),
      ),
    ).toBe(true);
  });
});
