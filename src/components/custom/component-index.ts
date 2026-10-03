import type { CompiledComponent, CustomComponentRef } from "./types";

const exactKey = (id: string, version: string, integrity: string) =>
  `${id}@${version}#${integrity}`;

export function indexComponents(
  components: CompiledComponent[],
): ReadonlyMap<string, CompiledComponent> {
  const result = new Map<string, CompiledComponent>();
  for (const component of components) {
    const key = exactKey(component.id, component.version, component.integrity);
    const previous = result.get(key);
    if (
      previous &&
      (previous.html !== component.html ||
        JSON.stringify(previous.schema) !== JSON.stringify(component.schema) ||
        JSON.stringify(previous.inline) !== JSON.stringify(component.inline))
    )
      throw new Error(
        `Conflicting component payloads claim the same fingerprint: ${key}.`,
      );
    if (!previous) result.set(key, component);
  }
  return result;
}

export function findComponent(
  index: ReadonlyMap<string, CompiledComponent>,
  ref: CustomComponentRef,
): CompiledComponent | undefined {
  if (ref.integrity)
    return index.get(exactKey(ref.componentId, ref.version, ref.integrity));
  const candidates = [...index.values()].filter(
    (component) =>
      component.id === ref.componentId &&
      component.version === ref.version &&
      (!ref.scope || component.scope === ref.scope),
  );
  if (candidates.length > 1)
    throw new Error(
      `组件 ${ref.componentId}@${ref.version} 有多个不同内容版本，请指定完整性指纹。`,
    );
  return candidates[0];
}
