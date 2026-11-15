const own = (value, key) => Object.hasOwn(value, key);
const object = (value) => value !== null && typeof value === "object";
const define = (value, key, child) => Object.defineProperty(value, key, {
  value: child, enumerable: true, writable: true, configurable: true,
});
const stableID = value => object(value) && !Array.isArray(value)
  ? (typeof value.attrs?.id === "string" && value.attrs.id ? value.attrs.id : typeof value.id === "string" && value.id ? value.id : null) : null;
function uniqueArrayItems(values) {
  if (!values.length || !stableID(values[0])) return null;
  const byID = new Map();
  for (const value of values) {
    const id = stableID(value);
    if (!id || byID.has(id)) return null;
    byID.set(id, value);
  }
  return byID;
}

export function shareNativeSource(previous, next) {
  if (!object(previous) || !object(next) || Array.isArray(previous) !== Array.isArray(next)) return previous === next ? previous : next;
  const before = Object.keys(previous), after = Object.keys(next);
  let equal = before.length === after.length && (!Array.isArray(next) || previous.length === next.length);
  const candidates = Array.isArray(next) && uniqueArrayItems(next) ? uniqueArrayItems(previous) : null;
  let result = next;
  for (const key of after) {
    const present = own(previous, key), id = candidates ? stableID(next[key]) : null;
    const matched = candidates ? candidates.has(id) : present;
    const candidate = candidates ? candidates.get(id) : previous[key];
    const value = matched ? shareNativeSource(candidate, next[key]) : next[key];
    if (!present || value !== previous[key]) equal = false;
    if (value !== next[key]) {
      if (result === next) result = Array.isArray(next) ? next.slice() : Object.fromEntries(Object.entries(next));
      define(result, key, value);
    }
  }
  return equal ? previous : result;
}
