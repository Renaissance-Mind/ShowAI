import { expect, test } from "vitest";
import sliderManifest from "../../../resources/catalog/value-slider/manifest.json";
import ganttManifest from "../../../resources/catalog/task-gantt/manifest.json";
import { builtinComponentCatalog } from "../catalog";
import { validateComponentDocumentation } from "./documentation";

test("every shipped component has a usable versioned contract, including retained legacy renderers", () => {
  const components = builtinComponentCatalog({ includeLegacy: true });
  expect(components.length).toBeGreaterThan(61);
  for (const item of components) {
    const docs = validateComponentDocumentation(
      item.documentation,
      item.examples.length,
    );
    expect(docs.usage.inputs.length, item.kind).toBeGreaterThan(0);
    for (const example of item.examples) expect(example.data).toBeDefined();
  }
  const markdown = components.find(
    (item) => item.kind === "text",
  )!.documentation!;
  expect(
    markdown.usage.recipes.flatMap((recipe) => recipe.steps).join("\n"),
  ).toContain("引用每行以 >");
  expect(markdown.usage.constraints.join("\n")).toContain("任务复选框");
  const bar = components.find((item) => item.kind === "g2-bar")!.documentation!;
  const sankey = components.find(
    (item) => item.kind === "g2-sankey",
  )!.documentation!;
  expect(
    bar.usage.inputs.find((input) => input.path === "datasets")!.meaning,
  ).toContain("genre");
  expect(
    sankey.usage.inputs.find((input) => input.path === "datasets")!.meaning,
  ).toContain("source");
  expect(
    bar.usage.inputs.find((input) => input.path === "fields")!.meaning,
  ).toContain('"genre":"label"');
});

test("invalid contracts cannot claim completeness or refer to nonexistent examples", () => {
  const docs = structuredClone(builtinComponentCatalog()[0].documentation!);
  expect(() =>
    validateComponentDocumentation({ ...docs, version: 2 }),
  ).toThrow();
  expect(() =>
    validateComponentDocumentation({
      ...docs,
      reuse: { kind: "content-specific", boundaries: ["One work"] },
    }),
  ).toThrow("owning work");
  docs.usage.recipes[0].exampleIndex = 100;
  expect(() => validateComponentDocumentation(docs, 1)).toThrow(
    "missing example",
  );
});

test("shipped reusable source packages provide validated guides", () => {
  for (const manifest of [sliderManifest, ganttManifest]) {
    expect(
      validateComponentDocumentation(
        manifest.documentation,
        manifest.examples.length,
      ).reuse.kind,
    ).toBe("general");
    expect(manifest.examples.length).toBeGreaterThanOrEqual(2);
  }
});
