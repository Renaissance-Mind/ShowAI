import { expect, test } from "vitest";
import { compareCatalogVersions } from "./disclosure";

test("recommended component versions follow release and numeric prerelease precedence", () => {
  expect(compareCatalogVersions("2.10.0", "2.9.0")).toBeGreaterThan(0);
  expect(compareCatalogVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
  expect(
    compareCatalogVersions("1.0.0-beta.10", "1.0.0-beta.2"),
  ).toBeGreaterThan(0);
  expect(compareCatalogVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(
    0,
  );
});
