import { expect, test } from "vitest";
import {
  catalogEntry,
  compareCatalogVersions,
  summarizeCatalog,
} from "./disclosure";
import { listBuiltinComponents } from "../core/catalog";
import { componentSignature } from "../portable/component-signature.mjs";

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

test("component summaries carry a one-line signature; templates do not", () => {
  const chart = listBuiltinComponents().find((item) => item.kind === "chart")!;
  const summary = summarizeCatalog("component", chart);
  expect(summary.signature).toBe(
    componentSignature("chart", chart.propsSchema),
  );
  expect(summary.signature!.startsWith("chart { labels: string[], series: ")).toBe(
    true,
  );
  expect(catalogEntry(summary).signature).toBe(summary.signature);
  const projected = summarizeCatalog("component", {
    id: "projected",
    name: "Projected",
    version: "1.0.0",
    integrity: "sha256-x",
    scope: "project",
    scenarios: ["listing"],
    signature: "projected { value: number }",
  });
  expect(projected.signature).toBe("projected { value: number }");
  const template = summarizeCatalog("template", {
    id: "report",
    name: "Report",
    scenarios: ["reports"],
    schema: { type: "object", properties: { title: { type: "string" } } },
  });
  expect(template.signature).toBeUndefined();
  expect("signature" in catalogEntry(template)).toBe(false);
});
