import primitives from "../../resources/catalog/primitives.json";
import components from "../../resources/catalog/components.json";
import surfaces from "../../resources/catalog/surfaces.json";
import g2 from "../../resources/catalog/g2.json";
import diagrams from "../../resources/catalog/diagrams.json";
import diagramDocumentation from "../../resources/catalog/diagram-documentation.json";
import documentation from "../../resources/catalog/component-documentation.json";
import type { ComponentDocumentation } from "./custom/documentation";
import type { BuiltinComponentMetadata } from "./custom/types";
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value))
      deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
let shared:
  | {
      current: readonly BuiltinComponentMetadata[];
      byKind: ReadonlyMap<string, BuiltinComponentMetadata>;
    }
  | undefined;
function sharedCatalog() {
  if (!shared) {
    // One frozen copy for readers in the workbench; documentation is cloned
    // too, so freezing never reaches the imported JSON other callers receive.
    const items = deepFreeze(
      structuredClone(builtinComponentCatalog({ includeLegacy: true })),
    );
    const byKind = new Map<string, BuiltinComponentMetadata>();
    for (const item of items) if (!byKind.has(item.kind)) byKind.set(item.kind, item);
    shared = {
      current: Object.freeze(items.filter((item) => !item.replacedBy)),
      byKind,
    };
  }
  return shared;
}
/**
 * The current built-in catalog as one shared, deeply frozen list. Callers that
 * change an item, such as inserting its default data, copy that part first.
 */
export function readBuiltinComponentCatalog(): readonly BuiltinComponentMetadata[] {
  return sharedCatalog().current;
}
/** A built-in component's shared, deeply frozen metadata, including legacy kinds. */
export function builtinComponent(
  kind: string,
): Readonly<BuiltinComponentMetadata> | undefined {
  return sharedCatalog().byKind.get(kind);
}
