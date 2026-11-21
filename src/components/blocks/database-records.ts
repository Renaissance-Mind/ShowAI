import { parsePageCell } from "./database-contract.mjs";
import type {
  FilterCondition,
  FilterGroup,
} from "../../datasets/record-query.mjs";
import { valueTypeOf } from "../../datasets/value-types.mjs";
import type { DatabaseColumn, DatabaseRow, DatabaseValue } from "./types";

export function sameDatabaseValue(
  a: DatabaseValue | undefined,
  b: DatabaseValue | undefined,
): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => value === b[index])
    );
  return a === b;
}

function requiredValue(
  condition: FilterCondition | FilterGroup,
  column: DatabaseColumn,
): DatabaseValue | undefined {
  if ("conditions" in condition) {
    const alternatives = condition.conditions.map((item) =>
      requiredValue(item, column),
    );
    const values = alternatives.filter((value) => value !== undefined);
    if (
      !values.length ||
      (condition.join === "or" && values.length !== alternatives.length)
    )
      return undefined;
    const [first] = values;
    if (Array.isArray(first) && values.every((value) => Array.isArray(value))) {
      return condition.join === "and"
        ? [...new Set(values.flat())]
        : first.filter((item) => values.every((value) => value.includes(item)));
    }
    return values.every((value) => value === first) ? first : undefined;
  }
  if (condition.column !== column.id) return undefined;
  const { operator, value } = condition;
  const type = valueTypeOf(column);
  if (operator === "checked" || operator === "unchecked")
    return operator === "checked";
  if (operator === "isEmpty") return type.blank() as DatabaseValue;
  if (operator === "is" && value !== undefined)
    return type.normalize(value, column) as DatabaseValue;
  if (Array.isArray(value)) {
    if (
      operator === "includesAll" ||
      (operator === "includesAny" && value.length === 1)
    )
      return type.normalize(value, column) as DatabaseValue;
    if (operator === "between" && value[0] === value[1])
      return type.normalize(value[0], column) as DatabaseValue;
  }
  return undefined;
}

export function recordFilterDefaults(
  filter: FilterGroup | null,
  columns: DatabaseColumn[],
) {
  const defaults: Record<string, DatabaseValue> = {};
  if (!filter) return defaults;
  for (const column of columns) {
    const type = valueTypeOf(column);
    if (
      type.derived ||
      type.unknown ||
      column.relation?.reverseOf ||
      column.type === "page" ||
      column.type === "custom"
    )
      continue;
    const value = requiredValue(filter, column);
    if (value !== undefined) defaults[column.id] = value;
  }
  return defaults;
}

export function databaseRecordTargets(
  rows: DatabaseRow[],
  columns: string | string[],
) {
  const fields = Array.isArray(columns) ? columns : [columns];
  return rows.flatMap((row) => {
    for (const field of fields) {
      const target = parsePageCell(row[field]);
      if (target) return [{ ...target, recordId: row.id }];
    }
    return [];
  });
}
