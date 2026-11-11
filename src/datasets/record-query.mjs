// Filter groups and sort lists over typed records. One pure module for the
// workbench, the portable reader, the CLI and custom components (through the
// SDK), so a query means the same everywhere.
//
// Filter group: {join: "and"|"or", conditions: [condition | group]}, nested one
// level; condition: {column, operator, value?}. Sorts: [{column, direction}].
// Older views saved one {column, value} filter and one {column, direction}
// sort; they read as a one-condition group and a one-item list.

import {
  OPERATORS,
  compareProjections,
  kindOf,
  localDay,
  operandIssue,
  operatorsOf,
  testOperator,
  valueTypeOf,
} from "./value-types.mjs";

export const MAX_FILTER_CONDITIONS = 50;
export const MAX_SORTS = 10;

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isLegacyFilter = (filter) =>
  isObject(filter) && !("conditions" in filter) && "column" in filter;
const isGroup = (item) => isObject(item) && Array.isArray(item.conditions);

/**
 * The filter group of a saved view filter, or null. A legacy {column, value}
 * filter (equality on the text readers saw) becomes one condition.
 */
export function readFilter(filter, columns = []) {
  if (filter === undefined || filter === null) return null;
  if (isLegacyFilter(filter)) {
    if (!filter.column) return null;
    const column = columns.find((item) => item.id === filter.column);
    const value = String(filter.value ?? "");
    const condition =
      column?.type === "checkbox" && (value === "true" || value === "false")
        ? {
            column: filter.column,
            operator: value === "true" ? "checked" : "unchecked",
          }
        : value === ""
          ? { column: filter.column, operator: "isEmpty" }
          : column?.type === "number" && Number.isFinite(Number(value))
            ? { column: filter.column, operator: "is", value: Number(value) }
            : { column: filter.column, operator: "is", value };
    return { join: "and", conditions: [condition] };
  }
  return isGroup(filter) ? filter : null;
}

/** The sort list of a view: `sorts`, or the older single `sort`. */
export function readSorts(view) {
  if (Array.isArray(view?.sorts)) return view.sorts;
  return isObject(view?.sort) && view.sort.column ? [view.sort] : [];
}

/** Every condition of a group, nested ones included. */
export function filterConditions(group) {
  if (!group) return [];
  return group.conditions.flatMap((item) =>
    isGroup(item) ? item.conditions : [item],
  );
}

/**
 * Check a filter group's structure (and operands against column kinds when
 * columns are given). Throws with a path-qualified message.
 */
export function validateFilter(filter, path, columns, context) {
  const fail = (message) => {
    throw new Error(`${path}${message}`);
  };
  if (isLegacyFilter(filter)) {
    if (
      Object.keys(filter).some((key) => key !== "column" && key !== "value") ||
      typeof filter.column !== "string" ||
      filter.column.length > 200 ||
      typeof filter.value !== "string" ||
      filter.value.length > 10000
    )
      fail(" must be {column, value} with text values or a filter group.");
    return;
  }
  let count = 0;
  const group = (value, at, depth) => {
    if (!isObject(value)) fail(`${at} must be a filter group.`);
    for (const key of Object.keys(value))
      if (!["join", "conditions"].includes(key))
        fail(`${at}.${key} is not a supported setting.`);
    if (value.join !== "and" && value.join !== "or")
      fail(`${at}.join must be and or or.`);
    if (!Array.isArray(value.conditions))
      fail(`${at}.conditions must be an array.`);
    value.conditions.forEach((item, index) => {
      const where = `${at}.conditions[${index}]`;
      if (isGroup(item)) {
        if (depth > 0) fail(`${where} nests deeper than one level.`);
        group(item, where, depth + 1);
        return;
      }
      count += 1;
      if (count > MAX_FILTER_CONDITIONS)
        fail(` has more than ${MAX_FILTER_CONDITIONS} conditions.`);
      if (!isObject(item)) fail(`${where} must be a condition or group.`);
      for (const key of Object.keys(item))
        if (!["column", "operator", "value"].includes(key))
          fail(`${where}.${key} is not a supported setting.`);
      if (
        typeof item.column !== "string" ||
        !item.column ||
        item.column.length > 200
      )
        fail(`${where}.column must be a column id.`);
      if (!Object.hasOwn(OPERATORS, item.operator))
        fail(
          `${where}.operator must be one of ${Object.keys(OPERATORS).join(", ")}.`,
        );
      const column = columns?.find((entry) => entry.id === item.column);
      const kind = column ? kindOf(column, context) : undefined;
      if (OPERATORS[item.operator] === "none") {
        if (item.value !== undefined)
          fail(`${where}.value is not used by ${item.operator}.`);
        if (kind && !operatorsOf(column, context).includes(item.operator))
          fail(
            `${where}.operator ${item.operator} does not apply to ${column.type} columns.`,
          );
        return;
      }
      if (column && !operatorsOf(column, context).includes(item.operator))
        fail(
          `${where}.operator ${item.operator} does not apply to ${column.type} columns.`,
        );
      const issue = operandIssue(item.operator, item.value, kind);
      if (issue) fail(`${where}.${issue}`);
    });
  };
  group(filter, "", 0);
}

export function validateSorts(sorts, path) {
  if (!Array.isArray(sorts) || sorts.length > MAX_SORTS)
    throw new Error(`${path} must be an array of at most ${MAX_SORTS} sorts.`);
  sorts.forEach((sort, index) => {
    if (
      !isObject(sort) ||
      Object.keys(sort).some(
        (key) => key !== "column" && key !== "direction",
      ) ||
      typeof sort.column !== "string" ||
      !sort.column ||
      sort.column.length > 200 ||
      !["asc", "desc"].includes(sort.direction)
    )
      throw new Error(
        `${path}[${index}] must be {column, direction: asc|desc}.`,
      );
  });
}

/**
 * Prepared accessors for a set of columns: each column's type, kind and a
 * projection per record, cached so a query projects each cell once.
 */
function prepare(columns, context) {
  const byId = new Map();
  const read = context.value ?? ((row, column) => row[column.id]);
  for (const column of columns) {
    const type = valueTypeOf(column, context);
    const kind = kindOf(column, context);
    const cache = new WeakMap();
    byId.set(column.id, {
      column,
      type,
      kind,
      operators: operatorsOf(column, context),
      project(row) {
        if (cache.has(row)) return cache.get(row);
        const projected = type.project(read(row, column), column, context);
        cache.set(row, projected);
        return projected;
      },
      text: (row) => type.text(read(row, column), column, context),
    });
  }
  return byId;
}

function matches(row, group, fields, today) {
  const results = [];
  for (const item of group.conditions) {
    let result;
    if (isGroup(item)) {
      if (!filterConditions(item).some((entry) => fields.has(entry.column)))
        continue;
      result = matches(row, item, fields, today);
    } else {
      const field = fields.get(item.column);
      // A condition on a deleted column, or one this type no longer offers, is ignored.
      if (
        !field ||
        !(OPERATORS[item.operator] === "none" || item.value !== undefined)
      )
        continue;
      if (!field.operators.includes(item.operator)) continue;
      result = testOperator(
        field.kind,
        field.project(row),
        item.operator,
        item.value,
        today,
      );
    }
    results.push(result);
    if (group.join === "and" && !result) return false;
    if (group.join === "or" && result) return true;
  }
  return group.join === "and" || !results.length;
}

/**
 * Records that pass the search text and filter group, in sort order. Pass a
 * context with `today` (day number), `locale`, `value(row, column)` for
 * derived values, `pageTitle`, `recordTitles` and `contributed`.
 */
export function queryRecords(rows, columns, query = {}, context = {}) {
  const fields = prepare(columns, context);
  const today = context.today ?? localDay();
  const group = readFilter(query.filter, columns);
  const needle = String(query.search ?? "")
    .trim()
    .toLocaleLowerCase();
  const shown = rows.filter(
    (row) =>
      (!needle ||
        [...fields.values()].some((field) =>
          field.text(row).toLocaleLowerCase().includes(needle),
        )) &&
      (!group || matches(row, group, fields, today)),
  );
  const sorts = (query.sorts ?? []).filter((sort) => fields.has(sort.column));
  if (!sorts.length) return shown;
  const keys = sorts.map((sort) => fields.get(sort.column));
  return shown
    .map((row, index) => ({
      row,
      index,
      values: keys.map((field) => field.project(row)),
    }))
    .sort((a, b) => {
      for (const [position, sort] of sorts.entries()) {
        const result = compareProjections(
          keys[position].kind,
          a.values[position],
          b.values[position],
          sort.direction,
          context.locale,
        );
        if (result) return result;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Group keys of a record for a column whose type groups (select, multiSelect, checkbox). */
export function groupKeys(row, column, context = {}) {
  const type = valueTypeOf(column, context);
  const read = context.value ?? ((item, field) => item[field.id]);
  return type.groups ? type.groups(read(row, column), column, context) : [];
}
