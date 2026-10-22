import { describe, expect, it } from "vitest";
import { closeAllowed } from "./desktop/bridge";
import { isChunkLoadError } from "./AppErrorBoundary";

describe("app shell errors", () => {
  it("recognizes failed interface file loads", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: http://127.0.0.1/assets/Studio-x.js",
        ),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError(new TypeError("Importing a module script failed.")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of null"))).toBe(
      false,
    );
  });

  it("treats a close explanation as a refusal", () => {
    expect(closeAllowed(true)).toBe(true);
    expect(closeAllowed(false)).toBe(false);
    expect(closeAllowed({ allow: false, pages: [] })).toBe(false);
    expect(closeAllowed({ allow: true })).toBe(true);
  });
});
