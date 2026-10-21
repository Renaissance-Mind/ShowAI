// One actual recursive ownership registry shared by source factories and their
// private validation adapters. Object.isFrozen(root) alone is never proof.
const owned = new WeakSet(),
  metrics = new WeakMap();
export function freezeOwnedJSON(value) {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new TypeError("Invalid native source delta: non-JSON value");
  if (value && typeof value === "object" && !owned.has(value)) {
    for (const key of Object.keys(value)) freezeOwnedJSON(value[key]);
    const children = [],
      keys = Object.keys(value);
    let bytes = 48 + keys.length * 8;
    for (const key of keys) {
      const child = value[key];
      if (!Array.isArray(value)) bytes += key.length * 2;
      if (child && typeof child === "object") children.push(child);
      else bytes += typeof child === "string" ? child.length * 2 : 8;
    }
    metrics.set(
      value,
      Object.freeze({ bytes, children: Object.freeze(children) }),
    );
    Object.freeze(value);
    owned.add(value);
  }
  return value;
}
export const isOwnedJSON = (value) =>
  !!value && typeof value === "object" && owned.has(value);
export const ownedJSONMetrics = (value) => metrics.get(value);
