import { CAPACITY, assertBytes, utf8Bytes } from "./capacity.mjs";
// One actual recursive ownership registry shared by source factories and their
// private validation adapters. Object.isFrozen(root) alone is never proof.
const owned = new WeakSet(),
  metrics = new WeakMap(),
  plainOwned = new WeakSet(),
  plainBytes = new WeakMap();
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

// This proof is separate from generic recursive freezing: only an exclusive
// JSON.parse graph or an independent data capture can enter this registry.
function scalarBytes(value) {
  return utf8Bytes(JSON.stringify(value));
}
function capturePlain(
  value,
  exclusive,
  active,
  captured,
  depth,
  budget,
  candidate,
) {
  const charge = (bytes) => {
    if (!exclusive) {
      budget.bytes += bytes;
      assertBytes(
        "Source JSON capture",
        budget.bytes,
        CAPACITY.publicationTransferBytes,
      );
    }
  };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    if (!exclusive) charge(scalarBytes(value));
    return value;
  }
  if (!value || typeof value !== "object")
    throw new TypeError(
      "Invalid native source delta: non-JSON value (expected finite plain data)",
    );
  if (plainOwned.has(value)) {
    charge(plainBytes.get(value));
    return value;
  }
  if (depth > 64 || (!exclusive && active.has(value)))
    throw new TypeError("Expected acyclic JSON data within depth 64");
  if (!exclusive && captured.has(value)) {
    const result = captured.get(value);
    charge(plainBytes.get(result));
    return result;
  }
  const array = Array.isArray(value),
    prototype = exclusive ? Object.prototype : Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw new TypeError("Expected plain JSON objects");
  const keys = Object.keys(value);
  if (
    !exclusive &&
    array &&
    (keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)))
  )
    throw new TypeError("Expected dense JSON arrays");
  const usable =
    !!candidate &&
    plainOwned.has(candidate) &&
    Array.isArray(candidate) === array;
  let equal = usable && keys.length === Object.keys(candidate).length;
  const result = exclusive ? value : array ? [] : {};
  charge(2 + Math.max(0, keys.length - 1));
  if (!exclusive) active.add(value);
  for (const key of keys) {
    if (!array && !exclusive) charge(scalarBytes(key) + 1);
    const prior =
      usable && Object.hasOwn(candidate, key) ? candidate[key] : undefined;
    const child = capturePlain(
      value[key],
      exclusive,
      active,
      captured,
      depth + 1,
      budget,
      prior,
    );
    equal = equal && Object.hasOwn(candidate, key) && child === prior;
    if (!exclusive || child !== value[key])
      Object.defineProperty(result, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  }
  if (!exclusive) active.delete(value);
  if (equal) {
    if (!exclusive) captured.set(value, candidate);
    return candidate;
  }
  // The source is now actual plain data; this sealing walk visits only new
  // immediate children. Previously proved branches are never re-frozen.
  freezeOwnedJSON(result);
  let bytes = 2 + Math.max(0, keys.length - 1);
  for (const key of keys) {
    if (!array) bytes += scalarBytes(key) + 1;
    const child = result[key];
    bytes +=
      child && typeof child === "object"
        ? plainBytes.get(child)
        : scalarBytes(child);
  }
  plainOwned.add(result);
  plainBytes.set(result, bytes);
  if (!exclusive) captured.set(value, result);
  return result;
}
export function captureOwnedJSON(value) {
  return capturePlain(value, false, new WeakSet(), new WeakMap(), 0, {
    bytes: 0,
  });
}
/** Parse, compare against actual sealed data, and seal before anything escapes.
 * The base may suggest reuse but every field is compared; no identity shortcut
 * grants ownership to mutable caller objects or accessor graphs. */
export function parseOwnedJSON(raw, base) {
  assertBytes(
    "Source JSON capture",
    utf8Bytes(raw),
    CAPACITY.publicationTransferBytes,
  );
  const candidate = base === undefined ? undefined : captureOwnedJSON(base);
  return capturePlain(
    JSON.parse(raw),
    true,
    new WeakSet(),
    new WeakMap(),
    0,
    { bytes: 0 },
    candidate,
  );
}
