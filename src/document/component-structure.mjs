import {
  builtinComponentContract,
  legacyChildKindPaths,
} from "./builtin-component-contracts.mjs";
import {
  contractValues,
  componentSlotValues,
  contractPath,
} from "./component-definition.mjs";

export function nodeComponentContract(node) {
  return node.attrs?.kind === "custom"
    ? node.attrs.data?.contract
    : builtinComponentContract(node.attrs?.kind);
}
export function legacyEmbeddedKinds(kind, data) {
  return (legacyChildKindPaths[kind] ?? [])
    .flatMap((path) => contractValues(data, path).map((entry) => entry.value))
    .filter((value) => typeof value === "string");
}
export function componentContentDocuments(data, contract) {
  const props = data;
  if (contract)
    return [
      ...new Set(
        (contract.slots ?? [])
          .flatMap((slot) =>
            componentSlotValues(contract, props, slot).map(
              (entry) => entry.value,
            ),
          )
          .filter(
            (value) => value?.type === "doc" && Array.isArray(value.content),
          ),
      ),
    ];
  const found = [];
  const collect = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "doc" && Array.isArray(value.content)) found.push(value);
    else (Array.isArray(value) ? value : Object.values(value)).forEach(collect);
  };
  collect(data);
  return found;
}
export function mapComponentContent(data, contract, map, replacements) {
  const documents = new Set(componentContentDocuments(data, contract));
  const step = (value) => {
    if (!value || typeof value !== "object") return value;
    if (documents.has(value)) return map(value);
    if (Array.isArray(value)) {
      const next = value.map(step);
      return next.some((item, index) => item !== value[index]) ? next : value;
    }
    const next = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, step(item)]),
    );
    return Object.keys(value).some((key) => next[key] !== value[key])
      ? next
      : value;
  };
  let next = step(data);
  if (next === data || !contract?.references?.length || !replacements)
    return next;
  const before = data;
  let after = next;
  for (const ref of contract.references) {
    const slot = contract.slots.find((slot) => slot.name === ref.slot);
    for (const binding of contractValues(before, ref.path)) {
      const scope = contractPath(ref.scope ?? "");
      const location = binding.path.slice(0, scope.length);
      const ids = new Map();
      const counts = new Map();
      for (const doc of componentSlotValues(contract, before, slot).filter(
        (entry) => location.every((part, index) => entry.path[index] === part),
      )) {
        const visit = (node) => {
          const id = node.attrs?.id,
            mapped = replacements.get(node)?.attrs?.id;
          if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
          if (id && mapped && id !== mapped) ids.set(id, mapped);
          for (const child of node.content ?? []) visit(child);
        };
        visit(doc.value);
      }
      if ((counts.get(binding.value) ?? 0) > 1)
        throw new Error(
          "Ambiguous component reference; declare a narrower reference scope.",
        );
      if (!ids.has(binding.value)) continue;
      const replace = (value, depth) => {
        if (depth === binding.path.length) return ids.get(binding.value);
        const key = binding.path[depth];
        const copy = Array.isArray(value) ? [...value] : { ...value };
        copy[key] = replace(value[key], depth + 1);
        return copy;
      };
      after = replace(after, 0);
    }
  }
  return after;
}
