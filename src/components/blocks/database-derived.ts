// Derived values of a database: reverse relations, rollups and formulas,
// from the host's related records and its formula runtime, or from the
// snapshot an exported reader carries.
import { useEffect, useMemo, useState } from "react";
import {
  deriveValues,
  formulaInputs,
  recordTitle,
  reverseColumns,
  type FormulaResults,
} from "../../datasets/derived-fields.mjs";
import type { DatabaseHost } from "./database-host";
import type { DatabaseColumn, DatabaseRow } from "./types";

export interface DerivedDatabase {
  /** The database's columns followed by reverse relations pointing at its dataset. */
  columns: DatabaseColumn[];
  /** A cell's value: stored, or derived for derived columns. */
  value(row: DatabaseRow, column: DatabaseColumn): unknown;
  recordTitles(column: DatabaseColumn, ids: string[]): string[] | undefined;
  /** Formula evaluation failed as a whole (e.g. the runtime stopped it). */
  formulaError?: string;
}

const DERIVED = new Set(["formula", "rollup"]);
export const isDerivedColumn = (column: DatabaseColumn) =>
  DERIVED.has(column.type) ||
  (column.type === "relation" && !!column.relation?.reverseOf);

export function useDatabaseDerived(
  columns: DatabaseColumn[],
  rows: DatabaseRow[],
  host: DatabaseHost | null,
): DerivedDatabase {
  const precomputed = host?.precomputed;
  const self = host?.selfDataset;
  const incoming = self ? host?.incoming?.(self) : undefined;
  const all = useMemo(() => {
    const reverse = (precomputed?.columns ??
      (self && incoming
        ? reverseColumns(self, incoming)
        : [])) as unknown as DatabaseColumn[];
    const ids = new Set(columns.map((column) => column.id));
    return [...columns, ...reverse.filter((column) => !ids.has(column.id))];
  }, [columns, precomputed, self, incoming]);
  const related = host ? (id: string) => host.related(id) : undefined;
  // The host's version changes whenever related records change.
  const hostVersion = host?.version() ?? 0;
  const pure = useMemo(
    () =>
      precomputed
        ? undefined
        : deriveValues(all, rows, { related: (id) => related?.(id) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, rows, precomputed, hostVersion],
  );
  const inputs = useMemo(
    () => (pure ? formulaInputs(all, rows, (row) => pure.get(row.id)) : null),
    [all, rows, pure],
  );
  const key = inputs ? JSON.stringify(inputs) : "";
  const [results, setResults] = useState<{
    key: string;
    values?: FormulaResults;
    error?: string;
  }>({ key: "" });
  const evaluate = host?.formulas;
  useEffect(() => {
    if (!inputs || !evaluate || results.key === key) return;
    let current = true;
    const timer = setTimeout(() => {
      evaluate(inputs).then(
        (values) => current && setResults({ key, values }),
        (reason: unknown) =>
          current &&
          setResults({
            key,
            error: reason instanceof Error ? reason.message : String(reason),
          }),
      );
    }, 120);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // The key stands for the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, evaluate]);
  const values = useMemo(() => {
    if (precomputed) return new Map(Object.entries(precomputed.values));
    if (!inputs || !results.values) return pure!;
    return deriveValues(all, rows, {
      related: (id) => related?.(id),
      formulas: results.values,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precomputed, pure, results, all, rows]);
  return {
    columns: all,
    value: (row, column) =>
      isDerivedColumn(column)
        ? (values.get(row.id)?.[column.id] ??
          (results.error && column.type === "formula"
            ? { error: results.error }
            : undefined))
        : row[column.id],
    recordTitles: (column, ids) => {
      const dataset = column.relation?.dataset;
      if (!dataset) return undefined;
      if (precomputed)
        return ids.map((id) => precomputed.titles[dataset]?.[id] ?? id);
      const table = related?.(dataset);
      if (!table) return undefined;
      return ids.map((id) => {
        const record = table.rows.find((item) => item.id === id);
        return record ? recordTitle(record, table.columns) : id;
      });
    },
    ...(results.error ? { formulaError: results.error } : {}),
  };
}
