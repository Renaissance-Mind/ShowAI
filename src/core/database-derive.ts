import { CoreError } from "./model";
import type { FileStore } from "./store";
import type { ShowDocument } from "../types";
import { walk } from "../document/walk.mjs";
import { DatasetStore } from "./datasets";
import { runTransform } from "./dataset-transform";
import {
  FORMULA_SCRIPT,
  deriveValues,
  formulaInputs,
  recordTable,
  recordTitle,
  reverseColumns,
  type FormulaInputs,
  type FormulaResults,
  type RecordTable,
} from "../datasets/derived-fields.mjs";
import type { TypedField } from "../datasets/value-types.mjs";

// Derived database values outside the workbench: formulas run in the
// transform sandbox, relations read the project's datasets. Exports and
// Agent reads carry the result as `$derived`, so readers without a host
// show the same values, filters and sorts.

const DERIVED_KEY = "$derived";
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Checks formula inputs that arrive from a window before they reach the sandbox. */
function formulaRequest(value: unknown): FormulaInputs {
  if (
    !isObject(value) ||
    !Array.isArray(value.order) ||
    !Array.isArray(value.formulas) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 10000 ||
    value.formulas.length > 50 ||
    !value.formulas.every(
      (formula) =>
        isObject(formula) &&
        typeof formula.id === "string" &&
        typeof formula.expression === "string" &&
        formula.expression.length <= 4000 &&
        isObject(formula.references),
    ) ||
    !value.rows.every(
      (row) =>
        isObject(row) && typeof row.id === "string" && isObject(row.values),
    )
  )
    throw new CoreError("INVALID_DATA", "Formula inputs are malformed.");
  return value as unknown as FormulaInputs;
}

/** Formula results by record and column; a failed run fails every formula cell. */
export async function evaluateFormulas(
  inputs: unknown,
): Promise<FormulaResults> {
  const request = formulaRequest(inputs);
  const run = await runTransform(
    FORMULA_SCRIPT,
    request as unknown as Record<string, unknown>,
  );
  if (run.ok) return run.value as FormulaResults;
  const error = { error: run.message };
  return Object.fromEntries(
    request.rows.map((row) => [
      row.id,
      Object.fromEntries(
        request.formulas.map((formula) => [formula.id, error]),
      ),
    ]),
  );
}

/** Datasets of the project whose relations point at `datasetId` with a reverse side. */
export async function incomingRelations(
  store: FileStore,
  projectId: string,
  datasetId: string,
): Promise<{ datasetId: string; name: string; value: unknown }[]> {
  const datasets = new DatasetStore(store);
  const incoming = [];
  for (const summary of await datasets.list(projectId)) {
    if (summary.id === datasetId || summary.status === "empty") continue;
    const record = await datasets
      .read(projectId, summary.id)
      .catch(() => undefined);
    const table = recordTable(record?.dataset.value);
    if (
      table?.columns.some(
        (column) =>
          column.type === "relation" &&
          column.relation?.dataset === datasetId &&
          column.relation.reverse,
      )
    )
      incoming.push({
        datasetId: summary.id,
        name: summary.name,
        value: record!.dataset.value,
      });
  }
  return incoming;
}

const needsDerivation = (columns: TypedField[]) =>
  columns.some((column) =>
    ["relation", "formula", "rollup"].includes(column.type),
  );

/**
 * The `$derived` snapshot of one database's data: derived values, reverse
 * columns and the titles of related records. `selfDataset` is the dataset a
 * bound block shows.
 */
export async function deriveDatabase(
  store: FileStore,
  projectId: string,
  data: Record<string, unknown>,
  selfDataset?: string,
): Promise<Record<string, unknown> | undefined> {
  const columns = (Array.isArray(data.columns) ? data.columns : []).filter(
    (column): column is TypedField =>
      isObject(column) && typeof column.id === "string",
  );
  const rows = (Array.isArray(data.rows) ? data.rows : []).filter(
    (row): row is { id: string } & Record<string, unknown> =>
      isObject(row) && typeof row.id === "string",
  );
  const incoming = selfDataset
    ? await incomingRelations(store, projectId, selfDataset)
    : [];
  if (!needsDerivation(columns) && !incoming.length) return undefined;
  const all = [...columns, ...reverseColumns(selfDataset ?? "", incoming)];
  const datasets = new DatasetStore(store);
  const tables = new Map<string, RecordTable | undefined>();
  for (const source of incoming)
    tables.set(source.datasetId, recordTable(source.value) ?? undefined);
  for (const column of all)
    if (
      column.type === "relation" &&
      column.relation?.dataset &&
      !tables.has(column.relation.dataset)
    ) {
      const record = await datasets
        .read(projectId, column.relation.dataset)
        .catch(() => undefined);
      tables.set(
        column.relation.dataset,
        recordTable(record?.dataset.value) ?? undefined,
      );
    }
  const related = (id: string) => tables.get(id);
  const pure = deriveValues(all, rows, { related });
  const inputs = formulaInputs(all, rows, (row) => pure.get(row.id));
  const formulas = inputs ? await evaluateFormulas(inputs) : undefined;
  const values = deriveValues(all, rows, { related, formulas });
  const titles: Record<string, Record<string, string>> = {};
  for (const column of all) {
    const dataset =
      column.type === "relation" ? column.relation?.dataset : undefined;
    const table = dataset ? tables.get(dataset) : undefined;
    if (!dataset || !table) continue;
    const named = (titles[dataset] ??= {});
    for (const row of rows) {
      const linked = values.get(row.id)?.[column.id] ?? row[column.id];
      for (const id of Array.isArray(linked) ? linked : []) {
        const record = table.rows.find((item) => item.id === id);
        if (record) named[String(id)] = recordTitle(record, table.columns);
      }
    }
  }
  return {
    values: Object.fromEntries(
      [...values].filter(([, entry]) => Object.keys(entry).length),
    ),
    columns: all.slice(columns.length),
    titles,
  };
}

/**
 * A rendering snapshot whose database blocks carry `$derived`. `selfDatasets`
 * names the dataset each bound block (by id) shows.
 */
export async function withDerivedDatabases(
  store: FileStore,
  projectId: string,
  document: ShowDocument,
  selfDatasets: Map<string, string> = new Map(),
): Promise<ShowDocument> {
  const targets: Record<string, unknown>[] = [];
  // Databases nested in rich text show derived values too.
  walk(document.content, (node) => {
    if (
      node.type === "widget" &&
      node.attrs?.kind === "database" &&
      isObject(node.attrs.data)
    )
      targets.push(node.attrs as Record<string, unknown>);
  }, { scope: "content" });
  if (!targets.length) return document;
  let changed = false;
  const derived = new Map<Record<string, unknown>, Record<string, unknown>>();
  for (const attrs of targets) {
    const data = attrs.data as Record<string, unknown>;
    const snapshot = await deriveDatabase(
      store,
      projectId,
      data,
      selfDatasets.get(String(attrs.id ?? "")),
    );
    if (snapshot) {
      derived.set(attrs, snapshot);
      changed = true;
    }
  }
  if (!changed) return document;
  const copy = structuredClone(document);
  const order = [...targets];
  let index = 0;
  walk(copy.content, (node) => {
    if (
      node.type === "widget" &&
      node.attrs?.kind === "database" &&
      isObject(node.attrs.data)
    ) {
      const snapshot = derived.get(order[index++]);
      if (snapshot)
        node.attrs.data = { ...node.attrs.data, [DERIVED_KEY]: snapshot };
    }
  }, { scope: "content" });
  return copy;
}
