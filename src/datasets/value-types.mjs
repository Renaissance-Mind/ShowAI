// Value types: how a typed field of a dataset record is checked, normalised,
// compared, written as text and filtered. They belong to the harness, not to
// one component: a database, a chart or a custom component bound to the same
// records types and filters them the same way (exported through the SDK).
// Dependency-free; runs in the workbench, the CLI and the portable reader.

const DAY_MS = 86400000;
const PAGE_LINK =
  /^showai:\/\/project\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/page\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})$/;

/** ISO calendar day (YYYY-MM-DD) to a whole day number, or null when invalid. */
export function parseDay(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return Math.round(time / DAY_MS);
}

export function formatDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The reader's local calendar day as a day number. */
export function localDay(date = new Date()) {
  return Math.round(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
}

/** Loose date text (2026/10/14, 2026-10-14T09:00) to ISO, or "" when unreadable. */
export function normalizeDate(value) {
  if (typeof value !== "string") return "";
  const match = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (!match) return "";
  const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return parseDay(iso) === null ? "" : iso;
}

/** The project and page a page cell links to, or null for empty or invalid values. */
export function parsePageCell(value) {
  const match = typeof value === "string" ? PAGE_LINK.exec(value) : null;
  return match ? { projectId: match[1], pageId: match[2] } : null;
}

/** What each operator compares its value with. */
export const OPERATORS = {
  contains: "text",
  notContains: "text",
  is: "value",
  isNot: "value",
  isEmpty: "none",
  isNotEmpty: "none",
  gt: "number",
  lt: "number",
  gte: "number",
  lte: "number",
  between: "range",
  before: "date",
  after: "date",
  onOrBefore: "date",
  onOrAfter: "date",
  within: "relative",
  includesAny: "list",
  includesAll: "list",
  includesNone: "list",
  checked: "none",
  unchecked: "none",
};

/**
 * Value kinds: the comparable form a value type projects its values to. The
 * kind decides the operators, the order and the empty value.
 */
export const KIND_OPERATORS = {
  text: ["contains", "notContains", "is", "isNot", "isEmpty", "isNotEmpty"],
  number: [
    "is",
    "isNot",
    "gt",
    "lt",
    "gte",
    "lte",
    "between",
    "isEmpty",
    "isNotEmpty",
  ],
  date: [
    "is",
    "before",
    "after",
    "onOrBefore",
    "onOrAfter",
    "between",
    "within",
    "isEmpty",
    "isNotEmpty",
  ],
  option: ["is", "isNot", "includesAny", "isEmpty", "isNotEmpty"],
  list: ["includesAny", "includesAll", "includesNone", "isEmpty", "isNotEmpty"],
  boolean: ["checked", "unchecked"],
};
export const VALUE_KINDS = Object.keys(KIND_OPERATORS);

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const primitiveText = (value) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "boolean"
        ? String(value)
        : "";
const textList = (value) =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];
const finiteNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() && Number.isFinite(+value))
    return Number(value);
  return null;
};
/** A derived value that failed, e.g. a formula error: {error}. */
export const isErrorValue = (value) =>
  isObject(value) && typeof value.error === "string";

/** The empty projection of a kind. */
export function emptyOf(kind) {
  return kind === "number" || kind === "date"
    ? null
    : kind === "list"
      ? []
      : kind === "boolean"
        ? false
        : "";
}
/** Whether a projection of the kind counts as empty. */
export function isEmptyProjection(kind, projected) {
  if (kind === "list") return !projected.length;
  if (kind === "boolean") return projected !== true;
  return projected === null || projected === "";
}

/** Check an operand for an operator; returns an error message or "". */
export function operandIssue(operator, operand, kind) {
  const expected = OPERATORS[operator];
  if (!expected) return `operator ${operator} is not supported.`;
  if (kind && !KIND_OPERATORS[kind]?.includes(operator))
    return `operator ${operator} does not apply to ${kind} values.`;
  const dateKind = kind === "date";
  const single = (value) =>
    dateKind
      ? parseDay(value) !== null
      : kind === "number"
        ? finiteNumber(value) !== null
        : ["string", "number", "boolean"].includes(typeof value) &&
          String(value).length <= 10000;
  if (expected === "none") return operand === undefined ? "" : "";
  if (expected === "text")
    return typeof operand === "string" && operand.length <= 10000
      ? ""
      : "value must be text.";
  if (expected === "value")
    return single(operand)
      ? ""
      : dateKind
        ? "value must be a YYYY-MM-DD date."
        : kind === "number"
          ? "value must be a number."
          : "value must be text, a number or a boolean.";
  if (expected === "number")
    return finiteNumber(operand) !== null ? "" : "value must be a number.";
  if (expected === "date")
    return parseDay(operand) !== null ? "" : "value must be a YYYY-MM-DD date.";
  if (expected === "range")
    return Array.isArray(operand) &&
      operand.length === 2 &&
      operand.every((item) =>
        dateKind ? parseDay(item) !== null : finiteNumber(item) !== null,
      )
      ? ""
      : dateKind
        ? "value must be [from, to] YYYY-MM-DD dates."
        : "value must be [min, max] numbers.";
  if (expected === "relative")
    return isObject(operand) &&
      ["past", "next"].includes(operand.direction) &&
      Number.isInteger(operand.days) &&
      operand.days >= 0 &&
      operand.days <= 3660 &&
      Object.keys(operand).every((key) => ["direction", "days"].includes(key))
      ? ""
      : "value must be {direction: past|next, days: 0–3660}.";
  if (expected === "list")
    return Array.isArray(operand) &&
      operand.length <= 1000 &&
      operand.every((item) => typeof item === "string" && item.length <= 1000)
      ? ""
      : "value must be a list of texts.";
  return "";
}

/** Whether a projected value passes an operator; `today` is a day number. */
export function testOperator(kind, projected, operator, operand, today) {
  if (operator === "isEmpty") return isEmptyProjection(kind, projected);
  if (operator === "isNotEmpty") return !isEmptyProjection(kind, projected);
  switch (kind) {
    case "boolean":
      return operator === "checked" ? projected === true : projected !== true;
    case "text": {
      const value = String(projected ?? "");
      if (operator === "contains" || operator === "notContains") {
        const found = value
          .toLocaleLowerCase()
          .includes(String(operand).toLocaleLowerCase());
        return operator === "contains" ? found : !found;
      }
      const equal = value === primitiveText(operand);
      return operator === "is" ? equal : !equal;
    }
    case "option": {
      const value = String(projected ?? "");
      if (operator === "includesAny") return textList(operand).includes(value);
      const equal = value === primitiveText(operand);
      return operator === "is" ? equal : !equal;
    }
    case "list": {
      const values = projected;
      const wanted = textList(operand);
      if (operator === "includesAny")
        return wanted.some((item) => values.includes(item));
      if (operator === "includesAll")
        return wanted.every((item) => values.includes(item));
      return !wanted.some((item) => values.includes(item));
    }
    case "number": {
      if (operator === "between") {
        const [low, high] = operand.map(finiteNumber).sort((a, b) => a - b);
        return projected !== null && projected >= low && projected <= high;
      }
      const target = finiteNumber(operand);
      if (operator === "is") return projected !== null && projected === target;
      if (operator === "isNot")
        return projected === null || projected !== target;
      if (projected === null) return false;
      if (operator === "gt") return projected > target;
      if (operator === "lt") return projected < target;
      if (operator === "gte") return projected >= target;
      return projected <= target;
    }
    case "date": {
      if (projected === null) return false;
      if (operator === "within") {
        const from =
          operand.direction === "past" ? today - operand.days : today;
        const to = operand.direction === "past" ? today : today + operand.days;
        return projected >= from && projected <= to;
      }
      if (operator === "between") {
        const [low, high] = operand.map(parseDay).sort((a, b) => a - b);
        return projected >= low && projected <= high;
      }
      const day = parseDay(operand);
      if (operator === "is") return projected === day;
      if (operator === "before") return projected < day;
      if (operator === "after") return projected > day;
      if (operator === "onOrBefore") return projected <= day;
      return projected >= day;
    }
  }
  return false;
}

/**
 * Order two projections of a kind; empty values sort after the others in
 * either direction, so the caller passes the direction.
 */
export function compareProjections(kind, a, b, direction = "asc", locale) {
  const emptyA = isEmptyProjection(kind, a) && kind !== "boolean";
  const emptyB = isEmptyProjection(kind, b) && kind !== "boolean";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  let result;
  if (kind === "number" || kind === "date") result = a - b;
  else if (kind === "boolean") result = Number(a) - Number(b);
  else
    result = (kind === "list" ? a.join(", ") : String(a)).localeCompare(
      kind === "list" ? b.join(", ") : String(b),
      locale,
      { numeric: true },
    );
  return direction === "desc" ? -result : result;
}

const listCheck = (value) =>
  value === undefined ||
  value === "" ||
  (Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((item) => typeof item === "string" && item.length <= 1000))
    ? ""
    : "must be a list of texts.";
const noConfig = () => {};

/** Built-in value types by type name. */
const builtins = new Map();
export function defineValueType(definition) {
  builtins.set(definition.type, Object.freeze({ ...definition }));
}

defineValueType({
  type: "text",
  kind: "text",
  check: () => "",
  normalize: (value) =>
    Array.isArray(value) ? textList(value).join(", ") : primitiveText(value),
  project: (value) => primitiveText(value),
  text: (value) => primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});
defineValueType({
  type: "url",
  kind: "text",
  check: () => "",
  normalize: (value) =>
    Array.isArray(value) ? (textList(value)[0] ?? "") : primitiveText(value),
  project: (value) => primitiveText(value),
  text: (value) => primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});
defineValueType({
  type: "number",
  kind: "number",
  check: () => "",
  normalize: (value) => finiteNumber(value) ?? "",
  project: (value) => finiteNumber(value),
  text: (value) => primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});
defineValueType({
  type: "checkbox",
  kind: "boolean",
  check: () => "",
  normalize: (value) => value === true || value === "true",
  project: (value) => value === true || value === "true",
  text: (value) => String(value === true || value === "true"),
  blank: () => false,
  regroup: (_value, _from, to) => to === "true",
  groups: (value) => [String(value === true || value === "true")],
  checkConfig: noConfig,
});
defineValueType({
  type: "date",
  kind: "date",
  check: (value) =>
    value === undefined || value === "" || parseDay(value) !== null
      ? ""
      : "must be a YYYY-MM-DD date or empty.",
  normalize: (value) => normalizeDate(primitiveText(value)),
  project: (value) => parseDay(value),
  text: (value) => primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});
defineValueType({
  type: "select",
  kind: "option",
  options: true,
  check: () => "",
  normalize: (value) =>
    Array.isArray(value) ? (value[0] ?? "") : primitiveText(value),
  project: (value) => primitiveText(value),
  text: (value) => primitiveText(value),
  blank: () => "",
  groups: (value) => [primitiveText(value)],
  regroup: (_value, _from, to) => to,
  checkConfig: noConfig,
});
defineValueType({
  type: "multiSelect",
  kind: "list",
  options: true,
  check: listCheck,
  normalize: (value) =>
    Array.isArray(value)
      ? [...new Set(textList(value))]
      : primitiveText(value)
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
  project: (value) => textList(value),
  text: (value) => textList(value).join(", "),
  blank: () => [],
  groups: (value) => {
    const list = textList(value);
    return list.length ? list : [""];
  },
  regroup: (value, from, to) => {
    const list = textList(value).filter((item) => item !== from && item !== to);
    return to ? [...list, to] : list;
  },
  checkConfig: noConfig,
});
defineValueType({
  type: "page",
  kind: "text",
  check: (value) =>
    value === undefined || value === "" || parsePageCell(value)
      ? ""
      : "must be a showai://project/PROJECT/page/PAGE link or empty.",
  normalize: (value) => (parsePageCell(value) ? String(value) : ""),
  // Search, filters and sorting read page cells by the titles readers see.
  project: (value, _column, context) =>
    value ? (context?.pageTitle?.(value) ?? String(value)) : "",
  text: (value, _column, context) =>
    value ? (context?.pageTitle?.(value) ?? String(value)) : "",
  blank: () => "",
  checkConfig: noConfig,
});
defineValueType({
  type: "relation",
  kind: "list",
  check: listCheck,
  normalize: (value) => [...new Set(textList(value))],
  project: (value) => textList(value),
  text: (value, column, context) => {
    const ids = textList(value);
    const titles = context?.recordTitles?.(column, ids);
    return (titles ?? ids).join(", ");
  },
  blank: () => [],
  checkConfig: noConfig,
});
// Derived types: their values are computed (see derived-fields.mjs) and never stored.
defineValueType({
  type: "formula",
  kind: "text",
  derived: true,
  kindOf: (column) =>
    VALUE_KINDS.includes(column?.formula?.kind) ? column.formula.kind : "text",
  check: () => "",
  normalize: () => "",
  project: (value, column) => projectAs(formulaKind(column), value),
  text: (value) =>
    isErrorValue(value)
      ? `#ERROR ${value.error}`
      : Array.isArray(value)
        ? textList(value).join(", ")
        : primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});
defineValueType({
  type: "rollup",
  kind: "number",
  derived: true,
  check: () => "",
  normalize: () => "",
  project: (value) => finiteNumber(value),
  text: (value) => primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});
const formulaKind = (column) =>
  VALUE_KINDS.includes(column?.formula?.kind) ? column.formula.kind : "text";

/** A raw value projected as a kind, for types whose kind is chosen per column. */
export function projectAs(kind, value) {
  if (isErrorValue(value)) return emptyOf(kind);
  if (kind === "number") return finiteNumber(value);
  if (kind === "date") return parseDay(value);
  if (kind === "boolean") return value === true;
  if (kind === "list") return textList(value);
  return Array.isArray(value)
    ? textList(value).join(", ")
    : primitiveText(value);
}

/**
 * A stored value nothing knows how to read (a field type whose component is
 * missing): shown as its text, read-only, never rewritten.
 */
const unknownType = Object.freeze({
  type: "unknown",
  kind: "text",
  unknown: true,
  check: () => "",
  normalize: (value) => value,
  project: (value) =>
    Array.isArray(value) ? textList(value).join(", ") : primitiveText(value),
  text: (value) =>
    Array.isArray(value)
      ? value.map(primitiveText).join(", ")
      : primitiveText(value),
  blank: () => "",
  checkConfig: noConfig,
});

export const BUILTIN_VALUE_TYPES = [...builtins.keys()];

/**
 * The value type of a column. `contributed(column)` supplies types that a
 * library component declares (column.type "custom"); without one the column
 * reads as an unknown type.
 */
export function valueTypeOf(column, context) {
  if (column?.type === "custom")
    return context?.contributed?.(column) ?? unknownType;
  return builtins.get(column?.type) ?? unknownType;
}
/** The value kind of a column (formula columns choose theirs). */
export function kindOf(column, context) {
  const type = valueTypeOf(column, context);
  return type.kindOf ? type.kindOf(column) : type.kind;
}
/** Operators the column's type supports. */
export function operatorsOf(column, context) {
  const type = valueTypeOf(column, context);
  const kind = kindOf(column, context);
  const all = KIND_OPERATORS[kind] ?? KIND_OPERATORS.text;
  return type.operators ? all.filter((op) => type.operators.includes(op)) : all;
}

/** A summary of the built-in value types for Agents and documentation. */
export function describeValueTypes() {
  return [...builtins.values()].map((type) => ({
    type: type.type,
    kind: type.kind,
    ...(type.derived ? { derived: true } : {}),
    operators: KIND_OPERATORS[type.kind],
  }));
}
