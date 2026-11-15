import primitives from "../../resources/catalog/primitives.json";
import components from "../../resources/catalog/components.json";
import surfaces from "../../resources/catalog/surfaces.json";
import g2 from "../../resources/catalog/g2.json";
import diagrams from "../../resources/catalog/diagrams.json";
import diagramDocumentation from "../../resources/catalog/diagram-documentation.json";
import documentation from "../../resources/catalog/component-documentation.json";
import type { ComponentDocumentation } from "./documentation";
import type { BuiltinComponentMetadata } from "./types";
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

let byKind: Map<string, BuiltinComponentMetadata> | undefined;
let current: readonly BuiltinComponentMetadata[] | undefined;
const shared = () =>
  (byKind ??= new Map(
    builtinComponentCatalog({ includeLegacy: true }).map((item) => [
      item.kind,
      item,
    ]),
  ));
export function readBuiltinComponentCatalog(): readonly BuiltinComponentMetadata[] {
  return (current ??= [...shared().values()].filter(
    (item) => !item.replacedBy,
  ));
}
export function builtinComponent(
  kind: string,
): Readonly<BuiltinComponentMetadata> | undefined {
  return shared().get(kind);
}
