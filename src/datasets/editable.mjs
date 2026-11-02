// Which parts of a bound block can be changed. A block reads `true` (all of
// it), `false` (nothing) or `{ paths }`: the writable paths of its props,
// with "!" marking read-only parts inside them. Path forms:
//
//   "*"                       every top-level prop that is not an item list
//   "title"                   one top-level prop
//   "rows[*]"                 the items of rows (add, change, remove)
//   "!rows[id=task:*].title"  not the title of items whose id starts with "task:"
//   "!rows[id=task:t1].title" not the title of the item with id "task:t1"
//
// Items mapped from a dataset collection have ids "<collection key>:<id>",
// so one "!" path per collection covers all of its records.

/**
 * The editable value of a resolved binding (see binding.mjs resolveBinding):
 * mapped fields follow the dataset (`resolved.writable`), derived fields are
 * never writable, the block's own items and fields always are.
 */
export function bindingEditable(resolved) {
  const { compiled, projected, writable } = resolved;
  const intoKeys = [
    ...new Set(compiled.collections.map((collection) => collection.into)),
  ];
  const shared = (key) => !!compiled.props && !compiled.props.local.has(key);
  const paths = [];
  // Without a props mapping every other prop is the block's own.
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
    // Records without a stable id cannot be written even when the dataset can.
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

/**
 * Whether a prop, an item of an item list, or one field of that item can be
 * changed under `editable`. Self-contained: component frames embed it.
 */
export function canEdit(editable, prop, itemId, field) {
  if (editable === true) return true;
  if (!editable || typeof editable !== "object") return false;
  const paths = Array.isArray(editable.paths) ? editable.paths : [];
  const list = `${prop}[`;
  const isList = paths.some((path) => path.replace(/^!/, "").startsWith(list));
  const whole = paths.includes(prop) || paths.includes("*");
  if (!isList) return whole;
  if (!paths.includes(`${prop}[*]`)) return false;
  const exceptions = paths.filter((path) => path.startsWith(`!${list}id=`));
  if (itemId === undefined) return !exceptions.length;
  const id = String(itemId);
  for (const path of exceptions) {
    const close = path.lastIndexOf("]");
    const pattern = path.slice(list.length + 4, close);
    const matches = pattern.endsWith("*")
      ? id.startsWith(pattern.slice(0, -1))
      : id === pattern;
    if (!matches) continue;
    const rest = path.slice(close + 1);
    if (!rest || (field !== undefined && rest === `.${field}`)) return false;
  }
  return true;
}

/**
 * The dataState prop of a component: `value` from the host message (absent
 * from older hosts), with canEdit bound to its editable value. A read-only
 * block can change nothing. Self-contained like canEdit, which component
 * frames pass in as `check`.
 */
export function componentDataState(value, readOnly, check = canEdit) {
  const known =
    value &&
    typeof value === "object" &&
    ["ok", "stale", "empty"].includes(value.status);
  const status = known ? value.status : "ok";
  const editable = readOnly ? false : known ? value.editable : true;
  return {
    status,
    editable,
    canEdit: (prop, itemId, field) => check(editable, prop, itemId, field),
  };
}
