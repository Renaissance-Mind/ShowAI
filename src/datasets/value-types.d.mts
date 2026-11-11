export type ValueKind =
  "text" | "number" | "date" | "option" | "list" | "boolean";
export type FilterOperator =
  | "contains"
  | "notContains"
  | "is"
  | "isNot"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "between"
  | "before"
  | "after"
  | "onOrBefore"
  | "onOrAfter"
  | "within"
  | "includesAny"
  | "includesAll"
  | "includesNone"
  | "checked"
  | "unchecked";
export type OperandKind =
  "none" | "text" | "value" | "number" | "range" | "date" | "relative" | "list";

/** A typed field definition: anything with id and type (e.g. a database column). */
export interface TypedField {
  id: string;
  type: string;
  name?: string;
  options?: string[];
  relation?: {
    dataset: string;
    reverseOf?: string;
    reverse?: { name?: string };
  };
  formula?: { expression: string; kind?: string };
  rollup?: { relation: string; column?: string; aggregate: string };
  component?: { componentId: string; version: string };
}
export interface ValueTypeContext {
  today?: number;
  locale?: string;
  /** Stored or derived value of a record's field. */
  value?: (row: Record<string, unknown>, field: TypedField) => unknown;
  pageTitle?: (value: unknown) => string | undefined;
  recordTitles?: (field: TypedField, ids: string[]) => string[] | undefined;
  /** Value types that library components contribute (field type "custom"). */
  contributed?: (field: TypedField) => ValueType | undefined;
}
export interface ValueType {
  type: string;
  kind: ValueKind;
  derived?: boolean;
  unknown?: boolean;
  options?: boolean;
  operators?: readonly FilterOperator[];
  kindOf?: (field: TypedField) => ValueKind;
  check(value: unknown, field: TypedField): string;
  normalize(value: unknown, field: TypedField): unknown;
  project(
    value: unknown,
    field: TypedField,
    context?: ValueTypeContext,
  ): unknown;
  text(value: unknown, field: TypedField, context?: ValueTypeContext): string;
  blank(): unknown;
  groups?: (
    value: unknown,
    field: TypedField,
    context?: ValueTypeContext,
  ) => string[];
  regroup?: (value: unknown, from: string, to: string) => unknown;
  checkConfig(field: TypedField, fields: TypedField[]): void;
}

export declare const OPERATORS: Record<FilterOperator, OperandKind>;
export declare const KIND_OPERATORS: Record<ValueKind, FilterOperator[]>;
export declare const VALUE_KINDS: ValueKind[];
export declare const BUILTIN_VALUE_TYPES: string[];
export declare function parseDay(value: unknown): number | null;
export declare function formatDay(day: number): string;
export declare function localDay(date?: Date): number;
export declare function normalizeDate(value: unknown): string;
export declare function parsePageCell(
  value: unknown,
): { projectId: string; pageId: string } | null;
export declare function isErrorValue(
  value: unknown,
): value is { error: string };
export declare function emptyOf(kind: ValueKind): unknown;
export declare function isEmptyProjection(
  kind: ValueKind,
  projected: unknown,
): boolean;
export declare function operandIssue(
  operator: string,
  operand: unknown,
  kind?: ValueKind,
): string;
export declare function testOperator(
  kind: ValueKind,
  projected: unknown,
  operator: FilterOperator,
  operand: unknown,
  today: number,
): boolean;
export declare function compareProjections(
  kind: ValueKind,
  a: unknown,
  b: unknown,
  direction?: "asc" | "desc",
  locale?: string,
): number;
export declare function defineValueType(definition: ValueType): void;
export declare function projectAs(kind: ValueKind, value: unknown): unknown;
export declare function valueTypeOf(
  field: TypedField,
  context?: ValueTypeContext,
): ValueType;
export declare function kindOf(
  field: TypedField,
  context?: ValueTypeContext,
): ValueKind;
export declare function operatorsOf(
  field: TypedField,
  context?: ValueTypeContext,
): FilterOperator[];
export declare function describeValueTypes(): {
  type: string;
  kind: ValueKind;
  derived?: boolean;
  operators: FilterOperator[];
}[];
