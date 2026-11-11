import type {
  FilterOperator,
  TypedField,
  ValueTypeContext,
} from "./value-types.mjs";

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value?: unknown;
}
export interface FilterGroup {
  join: "and" | "or";
  conditions: (FilterCondition | FilterGroup)[];
}
/** The filter of a view saved before filter groups. */
export interface LegacyFilter {
  column: string;
  value: string;
}
export interface RecordSort {
  column: string;
  direction: "asc" | "desc";
}
export interface RecordQuery {
  search?: string;
  filter?: FilterGroup | LegacyFilter | null;
  sorts?: RecordSort[];
}
export declare const MAX_FILTER_CONDITIONS: number;
export declare const MAX_SORTS: number;
export declare function readFilter(
  filter: unknown,
  columns?: TypedField[],
): FilterGroup | null;
export declare function readSorts(view: {
  sorts?: RecordSort[];
  sort?: RecordSort | null;
}): RecordSort[];
export declare function filterConditions(
  group: FilterGroup | null,
): FilterCondition[];
export declare function validateFilter(
  filter: unknown,
  path: string,
  columns?: TypedField[],
  context?: ValueTypeContext,
): void;
export declare function validateSorts(sorts: unknown, path: string): void;
export declare function queryRecords<Row extends { id: string }>(
  rows: Row[],
  columns: TypedField[],
  query?: RecordQuery,
  context?: ValueTypeContext,
): Row[];
export declare function groupKeys(
  row: Record<string, unknown>,
  column: TypedField,
  context?: ValueTypeContext,
): string[];
