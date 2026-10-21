/** Exact JSON transport edits. This carries existing source packets; it is not
 * an editing/causal protocol. The caller owns publication identity and receipt
 * validation. Neither inserted values nor mutable UI objects become baselines. */
const own = (value, key) => Object.hasOwn(value, key);
const object = (value) => value !== null && typeof value === "object";
const define = (value, key, child) => Object.defineProperty(value, key, {
  value: child, enumerable: true, writable: true, configurable: true,
});
const fail = (message) => { throw new TypeError(`Invalid native source delta: ${message}`); };
function cloneJSON(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!object(value)) return fail("non-JSON value");
  if (ancestors.has(value)) return fail("cyclic JSON value");
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = [];
    if (Object.keys(value).length !== value.length) fail("sparse or decorated array");
    for (let index = 0; index < value.length; index++) {
      if (!own(value, index)) fail("sparse array");
      result.push(cloneJSON(value[index], ancestors));
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("non-JSON object");
    result = {};
    for (const key of Object.keys(value)) define(result, key, cloneJSON(value[key], ancestors));
  }
  ancestors.delete(value);
  return result;
}

/** Literal string keys are distinct (including NFC/NFD), object order is not.
 * No reference identity shortcut: callers may have edited an object in place. */
export function diffNativeSource(base, next) {
  const edits = [];
  const visit = (before, after, path) => {
    if (!object(before) || !object(after) || Array.isArray(before) !== Array.isArray(after)) {
      if (before !== after) edits.push({ op: "set", path, value: cloneJSON(after) });
      return;
    }
    if (Array.isArray(after)) {
      for (let index = 0; index < after.length; index++) {
        if (!own(after, index)) fail("sparse array");
        if (index < before.length) visit(before[index], after[index], [...path, index]);
        else edits.push({ op: "set", path: [...path, index], value: cloneJSON(after[index]) });
      }
      if (after.length < before.length) edits.push({ op: "resize", path, length: after.length });
    } else {
      for (const key of Object.keys(before).sort()) if (!own(after, key)) edits.push({ op: "remove", path: [...path, key] });
      for (const key of Object.keys(after).sort()) {
        if (own(before, key)) visit(before[key], after[key], [...path, key]);
        else edits.push({ op: "set", path: [...path, key], value: cloneJSON(after[key]) });
      }
    }
  };
  visit(base, next, []);
  return edits;
}

/** Apply all edits before returning any result. Each touched ancestor is cloned
 * once, untouched private subtrees remain private, and base/edits are unchanged
 * even when a later edit is malformed. Never expose this result to mutable UI. */
export function applyNativeSourceDelta(base, edits) {
  if (!Array.isArray(edits)) fail("edits must be an array");
  let result = base;
  const owned = new WeakSet();
  const writable = (value) => {
    if (!object(value)) fail("path traverses a primitive");
    if (owned.has(value)) return value;
    const copy = Array.isArray(value) ? value.slice() : Object.fromEntries(Object.entries(value));
    owned.add(copy);
    return copy;
  };
  const keyFor = (parent, key, append = false) => {
    if (Array.isArray(parent)) {
      if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0 || key > parent.length || (!append && key === parent.length))
        fail("invalid array index");
    } else if (typeof key !== "string") fail("object path requires a literal string key");
    return key;
  };
  const parentAt = (path) => {
    result = writable(result);
    let parent = result;
    for (const key of path) {
      keyFor(parent, key);
      if (!own(parent, key)) fail("missing path ancestor");
      const child = writable(parent[key]);
      define(parent, key, child);
      parent = child;
    }
    return parent;
  };
  for (const edit of edits) {
    if (!object(edit) || !Array.isArray(edit.path) || !["set", "remove", "resize"].includes(edit.op)) fail("unknown edit");
    const expected = edit.op === "set" ? ["op", "path", "value"] : edit.op === "resize" ? ["op", "path", "length"] : ["op", "path"];
    if (Object.keys(edit).length !== expected.length || expected.some(key => !own(edit, key))) fail("unexpected edit fields");
    const path = edit.path;
    if (edit.op === "set" && !path.length) { result = cloneJSON(edit.value); if (object(result)) owned.add(result); continue; }
    if (edit.op === "resize") {
      const parent = path.length ? parentAt(path.slice(0, -1)) : null;
      const key = path.at(-1);
      if (parent) { keyFor(parent, key); if (!own(parent, key)) fail("missing resize target"); }
      const value = parent ? parent[key] : result;
      if (!Array.isArray(value) || !Number.isSafeInteger(edit.length) || edit.length < 0 || edit.length > value.length) fail("resize must truncate an existing array");
      const copy = writable(value); copy.length = edit.length;
      if (parent) define(parent, key, copy); else result = copy;
      continue;
    }
    if (!path.length) fail("cannot remove the root");
    const parent = parentAt(path.slice(0, -1)), key = path.at(-1);
    keyFor(parent, key, edit.op === "set");
    if (edit.op === "remove") {
      if (Array.isArray(parent) || !own(parent, key)) fail("remove requires an existing object field");
      delete parent[key];
    } else define(parent, key, cloneJSON(edit.value));
  }
  return result;
}

/** After complete model normalization, retain only exactly equal old UI
 * subtrees. The next graph must already be independent of private transport
 * caches; changed leaves come exclusively from next, never a native baseline.
 * Optional undefined UI properties are compared as present, not missing. */
export function shareNativeSource(previous, next) {
  if (!object(previous) || !object(next) || Array.isArray(previous) !== Array.isArray(next)) return previous === next ? previous : next;
  const before = Object.keys(previous), after = Object.keys(next);
  let equal = before.length === after.length && (!Array.isArray(next) || previous.length === next.length);
  let result = next;
  for (const key of after) {
    const present = own(previous, key), value = present ? shareNativeSource(previous[key], next[key]) : next[key];
    if (!present || value !== previous[key]) equal = false;
    if (value !== next[key]) {
      if (result === next) result = Array.isArray(next) ? next.slice() : Object.fromEntries(Object.entries(next));
      define(result, key, value);
    }
  }
  return equal ? previous : result;
}
