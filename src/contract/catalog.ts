import primitives from "../../resources/catalog/primitives.json";
import components from "../../resources/catalog/components.json";
import surfaces from "../../resources/catalog/surfaces.json";
import g2 from "../../resources/catalog/g2.json";
import diagrams from "../../resources/catalog/diagrams.json";
import diagramDocumentation from "../../resources/catalog/diagram-documentation.json";
import documentation from "../../resources/catalog/component-documentation.json";
import type { ComponentDocumentation } from "./documentation";
import type { BuiltinComponentMetadata } from "./types";
/** Shared discovery data for the workspace, standalone editor and Agent. */
export function builtinComponentCatalog({
  includeLegacy = false,
}: { includeLegacy?: boolean } = {}) {
  const items = structuredClone([
    ...primitives,
    ...components,
    ...g2,
    ...diagrams,
    ...surfaces,
  ]).map((item) => ({
    ...item,
    documentation: (
      { ...documentation, ...diagramDocumentation } as unknown as Record<
        string,
        ComponentDocumentation
      >
    )[item.kind],
  })) as BuiltinComponentMetadata[];
  return includeLegacy ? items : items.filter((item) => !item.replacedBy);
}

// One shared copy for workbench readers, by kind. Its users only read it;
// insertion copies default data before changing it.
let byKind: Map<string, BuiltinComponentMetadata> | undefined;
let current: readonly BuiltinComponentMetadata[] | undefined;
const shared = () =>
  (byKind ??= new Map(
    builtinComponentCatalog({ includeLegacy: true }).map((item) => [
      item.kind,
      item,
    ]),
  ));
/**
 * The current built-in catalog as one shared list. Callers that change an
 * item, such as inserting its default data, copy that part first.
 */
export function readBuiltinComponentCatalog(): readonly BuiltinComponentMetadata[] {
  return (current ??= [...shared().values()].filter(
    (item) => !item.replacedBy,
  ));
}
/** A built-in component's shared metadata, including legacy kinds. */
export function builtinComponent(
  kind: string,
): Readonly<BuiltinComponentMetadata> | undefined {
  return shared().get(kind);
}
