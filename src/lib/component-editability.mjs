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
