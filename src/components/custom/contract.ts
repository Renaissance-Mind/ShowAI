import type { ShowDocument } from "../../types";
import type {
  CompiledComponent,
  CustomBlockData,
  CustomComponentRef,
} from "./types";

export const COMPONENT_ID = /^[a-z][a-z0-9-]{0,79}$/;
export const COMPONENT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/;
export const COMPONENT_DATA_MARKER = "<!--SHOWAI_COMPONENT_DATA-->";

/** Browser-safe JSON validation; schema compilation stays in the component runtime. */
export function assertJsonValue(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("Component data is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonValue(item, depth + 1));
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("Component data contains a reserved property.");
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  throw new Error("Component data must contain only JSON values.");
}

export function componentWidgetData(
  component: Pick<
    CompiledComponent,
    "id" | "version" | "integrity" | "defaultData"
  >,
  props: Record<string, unknown> = component.defaultData,
): Record<string, unknown> {
  assertJsonValue(props);
  return {
    ...readCustomBlockData({
      componentId: component.id,
      version: component.version,
      integrity: component.integrity,
      props: structuredClone(props),
    }),
  };
}

export function componentKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export function readCustomBlockData(value: unknown): CustomBlockData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Custom block data must be an object.");
  const data = value as Record<string, unknown>;
  if (
    typeof data.componentId !== "string" ||
    !COMPONENT_ID.test(data.componentId)
  )
    throw new Error("A custom block needs a valid componentId.");
  if (typeof data.version !== "string" || !COMPONENT_VERSION.test(data.version))
    throw new Error("A custom block needs an exact component version.");
  if (
    data.integrity !== undefined &&
    (typeof data.integrity !== "string" ||
      !/^sha256-[a-f0-9]{64}$/.test(data.integrity))
  )
    throw new Error("Invalid component integrity hash.");
  if (
    !data.props ||
    typeof data.props !== "object" ||
    Array.isArray(data.props)
  )
    throw new Error("Custom block props must be an object.");
  return {
    componentId: data.componentId,
    version: data.version,
    props: data.props as Record<string, unknown>,
    ...(data.integrity ? { integrity: data.integrity as string } : {}),
  };
}

export function collectCustomComponentRefs(
  document: ShowDocument,
): CustomComponentRef[] {
  const refs = new Map<string, CustomComponentRef>();
  const visit = (node: typeof document.content) => {
    if (node.type === "widget" && node.attrs?.kind === "custom") {
      const { componentId, version, integrity } = readCustomBlockData(
        node.attrs.data,
      );
      const key = componentKey(componentId, version);
      const previous = refs.get(key);
      if (previous?.integrity && integrity && previous.integrity !== integrity)
        throw new Error(`Conflicting integrity hashes for ${key}.`);
      refs.set(key, {
        componentId,
        version,
        integrity: integrity ?? previous?.integrity,
      });
    }
    node.content?.forEach(visit);
  };
  visit(document.content);
  return [...refs.values()];
}
