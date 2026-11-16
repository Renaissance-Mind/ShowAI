export function bindingEditable(resolved) {
  const { compiled, projected, writable } = resolved;
  const intoKeys = [
    ...new Set(compiled.collections.map((collection) => collection.into)),
  ];
  const shared = (key) => !!compiled.props && !compiled.props.local.has(key);
  const paths = [];
  if (writable || !compiled.props) paths.push("*");
  else
    for (const key of compiled.props.local)
      if (!intoKeys.includes(key)) paths.push(key);
  const exceptions = [];
  for (const into of intoKeys) {
    if (!writable && shared(into)) continue;
    paths.push(`${into}[*]`);
    for (const collection of compiled.collections) {
      if (collection.into !== into) continue;
      const fixed = [
        ...collection.derived.map((derivation) => derivation.target),
        ...(writable ? [] : collection.fields.map((field) => field.target)),
      ];
      for (const field of fixed)
        exceptions.push(`!${into}[id=${collection.key}:*].${field}`);
    }
    if (writable)
      for (const item of projected.values())
        if (item.into === into && !item.source)
          for (const field of item.collection.fields)
            exceptions.push(`!${into}[id=${item.id}].${field.target}`);
  }
  if (writable && !exceptions.length) return true;
  if (!paths.length) return false;
  return { paths: [...paths, ...exceptions] };
}

export { canEdit, componentDataState } from "../lib/component-editability.mjs";
