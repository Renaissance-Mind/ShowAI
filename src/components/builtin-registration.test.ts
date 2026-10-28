import { describe, expect, it } from "vitest";
import primitives from "../../resources/catalog/primitives.json";
import components from "../../resources/catalog/components.json";
import g2 from "../../resources/catalog/g2.json";
import diagrams from "../../resources/catalog/diagrams.json";
import surfaces from "../../resources/catalog/surfaces.json";
import documentation from "../../resources/catalog/component-documentation.json";
import diagramDocumentation from "../../resources/catalog/diagram-documentation.json";
import inlineReadiness from "../../resources/catalog/inline-readiness.json";
import { blockDefinitions, getBlockDefinition } from "./blocks/registry";
import { builtinEnglish } from "./builtin-display-text";
import { builtinCategories } from "../core/component-categories";
import { builtinExports } from "../core/builtin-sources";

// One place that names every registration point of a built-in component, so a
// contributor who adds a kind to one list learns which other lists need it.
// docs/contributing-components.md walks through the same points.
const blockKinds = [...primitives, ...components, ...g2, ...diagrams].map(
  (item) => item.kind,
);
const surfaceKinds = surfaces.map((item) => item.kind);
const allKinds = [...blockKinds, ...surfaceKinds];
const missing = (kinds: string[], present: (kind: string) => boolean) =>
  kinds.filter((kind) => !present(kind));

describe("built-in component registration", () => {
  it("gives every kind one catalog entry", () => {
    const duplicates = allKinds.filter(
      (kind, index) => allKinds.indexOf(kind) !== index,
    );
    expect(duplicates).toEqual([]);
  });

  it("registers a renderer for every catalog entry in blocks/registry.ts", () => {
    expect(missing(blockKinds, (kind) => !!getBlockDefinition(kind))).toEqual(
      [],
    );
  });

  it("lists every registered block in resources/catalog", () => {
    expect(
      blockDefinitions
        .map((definition) => definition.kind)
        .filter((kind) => kind !== "custom" && !blockKinds.includes(kind)),
    ).toEqual([]);
  });

  it("documents every kind in component- or diagram-documentation.json", () => {
    const documented = { ...documentation, ...diagramDocumentation };
    expect(
      missing(allKinds, (kind) => Object.hasOwn(documented, kind)),
    ).toEqual([]);
  });

  it("records inline readiness for every block kind", () => {
    expect(
      missing(blockKinds, (kind) => Object.hasOwn(inlineReadiness, kind)),
    ).toEqual([]);
  });

  it("gives every kind an English name and description", () => {
    expect(
      missing(
        allKinds,
        (kind) =>
          !!builtinEnglish[kind]?.name.trim() &&
          !!builtinEnglish[kind]?.description.trim(),
      ),
    ).toEqual([]);
  });

  it("assigns every non-G2 kind a catalog category", () => {
    expect(
      missing(
        allKinds.filter((kind) => !kind.startsWith("g2-")),
        (kind) => Object.hasOwn(builtinCategories, kind),
      ),
    ).toEqual([]);
  });

  it("exports every block kind from the editable component SDK", () => {
    expect(
      missing(blockKinds, (kind) => Object.hasOwn(builtinExports, kind)),
    ).toEqual([]);
  });
});
