import { describe, expect, it } from "vitest";
import {
  pageHoverPreviewPosition,
  searchResultPagePreview,
} from "./page-hover-preview";

describe("page hover preview", () => {
  it("recognizes page results and carries the revision used to reload them", () => {
    expect(
      searchResultPagePreview({
        path: "projects/project-1/pages/page-1.json",
        revision: "revision-1",
      }),
    ).toEqual({
      projectId: "project-1",
      pageId: "page-1",
      updatedAt: "revision-1",
    });
    expect(
      searchResultPagePreview({
        path: "packages/components/card/1.0.0/manifest.json",
        revision: "revision-1",
      }),
    ).toBeUndefined();
  });

  it("opens to the right of the pointer", () => {
    const position = pageHoverPreviewPosition(
      { x: 400, y: 300 },
      { width: 1200, height: 800 },
    );
    expect(position.left).toBe(414);
    expect(position.width).toBe(380);
    expect(position.top).toBeGreaterThan(0);
  });

  it("flips to the left near the right edge and stays vertically on screen", () => {
    const position = pageHoverPreviewPosition(
      { x: 1160, y: 790 },
      { width: 1200, height: 800 },
    );
    expect(position.left).toBe(766);
    expect(position.top + position.height).toBe(788);
  });

  it("keeps the preview on screen near the top", () => {
    const position = pageHoverPreviewPosition(
      { x: 400, y: 0 },
      { width: 1200, height: 800 },
    );
    expect(position.top).toBe(12);
  });

  it("shrinks to fit narrow and short viewports", () => {
    const narrow = pageHoverPreviewPosition(
      { x: 160, y: 300 },
      { width: 320, height: 600 },
    );
    expect(narrow.width).toBe(296);
    expect(narrow.left).toBe(12);
    expect(narrow.left + narrow.width).toBe(308);
    const short = pageHoverPreviewPosition(
      { x: 100, y: 100 },
      { width: 600, height: 200 },
    );
    expect(short.height).toBe(176);
    expect(short.top).toBe(12);
  });
});
