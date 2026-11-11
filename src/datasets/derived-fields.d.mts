import type { TypedField } from "./value-types.mjs";

type Row = { id: string } & Record<string, unknown>;
export interface RecordTable {
  columns: TypedField[];
  rows: Row[];
}
export interface FormulaInputs {
  order: string[];
  formulas: {
    id: string;
    expression: string;
    references: Record<string, string>;
    error?: string;
  }[];
  rows: { id: string; values: Record<string, unknown> }[];
}
/** Formula results by record id and column id: a value or {error}. */
export type FormulaResults = Record<string, Record<string, unknown>>;
export declare const ROLLUP_AGGREGATES: string[];
export declare const FORMULA_SCRIPT: string;
export declare function recordTable(value: unknown): RecordTable | null;
export declare function recordTitle(
  record: Record<string, unknown> & { id: string },
  columns?: TypedField[],
): string;
export declare function reverseColumnId(
  datasetId: string,
  columnId: string,
): string;
export declare function reverseColumns(
  selfDataset: string,
  incoming: { datasetId: string; name?: string; value: unknown }[],
): TypedField[];
export declare function deriveValues(
  columns: TypedField[],
  rows: Row[],
  context?: {
    related?: (datasetId: string) => RecordTable | null | undefined;
    formulas?: FormulaResults;
  },
): Map<string, Record<string, unknown>>;
export declare function formulaReferences(expression: string): string[];
export declare function formulaPlan(columns: TypedField[]): {
  order: string[];
  references: Record<string, Record<string, string>>;
  errors: Record<string, string>;
};
export declare function formulaInputs(
  columns: TypedField[],
  rows: Row[],
  values?: (row: Row) => Record<string, unknown> | undefined,
): FormulaInputs | null;
export declare function isErrorValue(
  value: unknown,
): value is { error: string };
