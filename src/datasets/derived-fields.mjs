// Derived fields of typed records: relations between datasets and the values
// computed from them (reverse relations, rollups) and from a record's own
// fields (formulas). Relations are facts between datasets, and formulas run
// in the harness's QuickJS transform runtime with FORMULA_SCRIPT, so this
// module belongs to the harness. Pure and dependency-free.

import { isErrorValue } from "./value-types.mjs";

export const ROLLUP_AGGREGATES = [
  "count",
  "sum",
  "average",
  "min",
  "max",
  "unique",
  "percentChecked",
];

const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const ids = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/** The record table of a dataset value shaped like a database: {columns, rows}. */
export function recordTable(value) {
  if (!isObject(value) || !Array.isArray(value.rows)) return null;
  return {
    columns: Array.isArray(value.columns)
      ? value.columns.filter(
          (column) => isObject(column) && typeof column.id === "string",
        )
      : [],
    rows: value.rows.filter(
      (row) => isObject(row) && typeof row.id === "string",
    ),
  };
}

/** A record's name: its first text field, else title or name, else its id. */
export function recordTitle(record, columns = []) {
  const text = columns.find((column) => column.type === "text");
  const value = text ? record[text.id] : (record.title ?? record.name);
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number"
      ? String(value)
      : record.id;
}

export const reverseColumnId = (datasetId, columnId) =>
  `rev-${datasetId}-${columnId}`.slice(0, 200);

/**
 * Derived reverse columns of a dataset: every relation column of another
 * dataset that points at it with `reverse` set shows up here, listing the
 * records that link to each record.
 * `incoming`: [{datasetId, name, value}] for the other datasets of the project.
 */
export function reverseColumns(selfDataset, incoming) {
  const columns = [];
  for (const source of incoming) {
    if (source.datasetId === selfDataset) continue;
    const table = recordTable(source.value);
    for (const column of table?.columns ?? [])
      if (
        column.type === "relation" &&
        column.relation?.dataset === selfDataset &&
        isObject(column.relation.reverse) &&
        !column.relation.reverseOf
      )
        columns.push({
          id: reverseColumnId(source.datasetId, column.id),
          name:
            (typeof column.relation.reverse.name === "string" &&
              column.relation.reverse.name.trim()) ||
            source.name ||
            source.datasetId,
          type: "relation",
          relation: { dataset: source.datasetId, reverseOf: column.id },
        });
  }
  return columns;
}

const aggregate = (kind, values) => {
  if (kind === "count") return values.length;
  if (kind === "unique")
    return new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter(
          (value) => value !== "" && value !== undefined && value !== null,
        )
        .map((value) => JSON.stringify(value)),
    ).size;
  if (kind === "percentChecked")
    return values.length
      ? Math.round(
          (values.filter((value) => value === true).length / values.length) *
            1000,
        ) / 10
      : "";
  const numbers = values
    .map((value) => (typeof value === "number" ? value : Number.NaN))
    .filter(Number.isFinite);
  if (!numbers.length) return kind === "sum" ? 0 : "";
  if (kind === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (kind === "average")
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (kind === "min") return Math.min(...numbers);
  return Math.max(...numbers);
};

/**
 * Values of derived columns per record id: reverse relations, rollups and the
 * formula results already evaluated (`formulas`: {rowId: {columnId: value}}).
 * `related(datasetId)` returns a record table or undefined while unknown.
 */
export function deriveValues(columns, rows, { related, formulas } = {}) {
  const values = new Map(rows.map((row) => [row.id, {}]));
  const read = (row, column) =>
    values.get(row.id)?.[column.id] ?? row[column.id];
  for (const column of columns) {
    const reverseOf =
      column.type === "relation" ? column.relation?.reverseOf : undefined;
    if (!reverseOf) continue;
    const source = related?.(column.relation.dataset);
    for (const row of rows)
      values.get(row.id)[column.id] = source
        ? source.rows
            .filter((item) => ids(item[reverseOf]).includes(row.id))
            .map((item) => item.id)
        : [];
  }
  for (const column of columns) {
    if (column.type !== "rollup") continue;
    const relation = columns.find(
      (item) => item.id === column.rollup?.relation && item.type === "relation",
    );
    const target = relation ? related?.(relation.relation?.dataset) : undefined;
    const kind = ROLLUP_AGGREGATES.includes(column.rollup?.aggregate)
      ? column.rollup.aggregate
      : "count";
    for (const row of rows) {
      if (!relation) {
        values.get(row.id)[column.id] = "";
        continue;
      }
      const linked = ids(read(row, relation));
      if (!target) {
        values.get(row.id)[column.id] = kind === "count" ? linked.length : "";
        continue;
      }
      const records = linked
        .map((id) => target.rows.find((item) => item.id === id))
        .filter(Boolean);
      values.get(row.id)[column.id] = aggregate(
        kind,
        kind === "count"
          ? records
          : records.map((item) => item[column.rollup.column]),
      );
    }
  }
  if (formulas)
    for (const row of rows) {
      const computed = formulas[row.id];
      if (computed) Object.assign(values.get(row.id), computed);
    }
  return values;
}

const PROP = /\bprop\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*\)/g;

/** Property names a formula reads with prop("…"); throws for any other prop() use. */
export function formulaReferences(expression) {
  const names = [];
  const literal = expression.replace(PROP, (_match, quoted) => {
    names.push(
      quoted.startsWith('"')
        ? JSON.parse(quoted)
        : quoted.slice(1, -1).replace(/\\(.)/g, "$1"),
    );
    return "";
  });
  if (/\bprop\s*\(/.test(literal))
    throw new Error('prop() takes a quoted property name, like prop("Price").');
  return names;
}

/**
 * The evaluation plan of a database's formulas: their order, the column each
 * prop() name reads, and the formulas that cannot run (unknown names, cycles).
 */
export function formulaPlan(columns) {
  const formulas = columns.filter((column) => column.type === "formula");
  const references = {};
  const errors = {};
  const resolve = (name) =>
    columns.find((column) => column.id === name) ??
    columns.find((column) => column.name === name);
  for (const column of formulas) {
    const expression = column.formula?.expression ?? "";
    if (!expression.trim()) {
      errors[column.id] = "The formula is empty.";
      continue;
    }
    try {
      references[column.id] = {};
      for (const name of formulaReferences(expression)) {
        const target = resolve(name);
        if (!target)
          throw new Error(`Unknown property ${JSON.stringify(name)}.`);
        references[column.id][name] = target.id;
      }
    } catch (error) {
      errors[column.id] = error.message;
    }
  }
  const order = [];
  const state = new Map();
  const nameOf = (id) => columns.find((column) => column.id === id)?.name || id;
  const visit = (id, trail) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "active") {
      const cycle = [...trail.slice(trail.indexOf(id)), id]
        .map(nameOf)
        .join(" → ");
      for (const member of trail.slice(trail.indexOf(id)))
        errors[member] = `Circular reference: ${cycle}.`;
      return;
    }
    state.set(id, "active");
    for (const target of Object.values(references[id] ?? {}))
      if (formulas.some((column) => column.id === target))
        visit(target, [...trail, id]);
    state.set(id, "done");
    order.push(id);
  };
  for (const column of formulas) visit(column.id, []);
  return { order, references, errors };
}

/** Inputs of FORMULA_SCRIPT for these records; `values(row)` adds derived values. */
export function formulaInputs(columns, rows, values) {
  const plan = formulaPlan(columns);
  const formulas = columns
    .filter(
      (column) => column.type === "formula" && plan.order.includes(column.id),
    )
    .map((column) => ({
      id: column.id,
      expression: column.formula?.expression ?? "",
      references: plan.references[column.id] ?? {},
      ...(plan.errors[column.id] ? { error: plan.errors[column.id] } : {}),
    }));
  if (!formulas.length) return null;
  const used = new Set(
    formulas.flatMap((formula) => Object.values(formula.references)),
  );
  return {
    order: plan.order,
    formulas,
    rows: rows.map((row) => {
      const derived = values?.(row) ?? {};
      return {
        id: row.id,
        values: Object.fromEntries(
          [...used]
            .filter((id) => !formulas.some((formula) => formula.id === id))
            .map((id) => [id, derived[id] ?? row[id] ?? null]),
        ),
      };
    }),
  };
}

/**
 * Evaluates formulas in the transform sandbox: transform(inputs, helpers)
 * returns {rowId: {columnId: value | {error}}}. Each expression is compiled
 * on its own, so a syntax error stays in its column.
 */
export const FORMULA_SCRIPT = String.raw`function transform(inputs, helpers) {
  "use strict";
  const compiled = {};
  for (const formula of inputs.formulas) {
    if (formula.error) { compiled[formula.id] = { error: formula.error }; continue; }
    try {
      compiled[formula.id] = new Function("prop", "helpers", '"use strict"; return (' + formula.expression + "\n);");
    } catch (error) {
      compiled[formula.id] = {
        error: (error && error.name ? error.name + ": " : "") + String((error && error.message) || error),
      };
    }
  }
  const byId = {};
  for (const formula of inputs.formulas) byId[formula.id] = formula;
  const failed = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.error === "string";
  const clean = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    if (Array.isArray(value)) return value.map((item) => (item === null || item === undefined ? "" : String(item)));
    throw new TypeError("A formula returns text, a number, a boolean, a date or a list, not an object.");
  };
  const out = {};
  for (const row of inputs.rows) {
    const values = row.values;
    const result = {};
    for (const id of inputs.order) {
      const fn = compiled[id];
      if (!fn) continue;
      if (typeof fn !== "function") {
        result[id] = { error: fn.error };
        values[id] = result[id];
        continue;
      }
      const references = byId[id].references;
      const prop = (name) => {
        if (!Object.prototype.hasOwnProperty.call(references, name))
          throw new Error("Unknown property " + JSON.stringify(name) + ".");
        const value = values[references[name]];
        if (failed(value)) throw new Error(name + " has an error.");
        return value === undefined ? null : value;
      };
      try {
        result[id] = clean(fn(prop, helpers));
      } catch (error) {
        const kind = error && error.name && error.name !== "Error" ? error.name + ": " : "";
        result[id] = { error: (kind + String((error && error.message) || error)).slice(0, 300) };
      }
      values[id] = result[id];
    }
    out[row.id] = result;
  }
  return out;
}`;

/** Whether a computed value is a formula error ({error}). */
export { isErrorValue };
