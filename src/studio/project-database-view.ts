import type { PageSummary } from "../core/model";
import {
  defaultProjectDatabaseViews,
  MAX_DATABASE_COLUMN_WIDTH,
  MIN_DATABASE_COLUMN_WIDTH,
  type ProjectDatabaseData,
  type ProjectDatabaseView,
} from "../core/project-database";
import type {
  ColumnType,
  DatabaseColumn,
  DatabaseRow,
} from "../components/blocks/types";
import { normalizeDate } from "../components/blocks/database-contract.mjs";
import type { DatasetOperation } from "../datasets/operations.mjs";

/** A view-only key: titles always come from the page, never the dataset. */
export const TITLE_PROPERTY = "$page-title";
export type DatabaseValue = string | number | boolean;
export interface DatabaseViewRow {
  page: PageSummary;
  properties: DatabaseRow;
}
export interface DatabaseViewFilter {
  column: string;
  value: string;
}
export interface DatabaseViewSort {
  column: string;
  direction: "asc" | "desc";
}

export function databaseViewSelectionKey(
  home: string,
  projectId: string,
  datasetId: string,
): string {
  return `showai:database-view:${JSON.stringify([home, projectId, datasetId])}`;
}

export function databaseViews(
  data: ProjectDatabaseData,
): ProjectDatabaseView[] {
  return data.views ?? defaultProjectDatabaseViews();
}

function initializeViews(data: ProjectDatabaseData): DatasetOperation[] {
  return data.views
    ? []
    : [
        {
          op: "set",
          path: ["views"],
          value: defaultProjectDatabaseViews(),
          absent: true,
        },
      ];
}

export function databaseColumnWidth(
  view: ProjectDatabaseView,
  columnId: string,
): number {
  const width = Object.hasOwn(view.columnWidths ?? {}, columnId)
    ? view.columnWidths?.[columnId]
    : undefined;
  return width !== undefined &&
    Number.isInteger(width) &&
    width >= MIN_DATABASE_COLUMN_WIDTH &&
    width <= MAX_DATABASE_COLUMN_WIDTH
    ? width
    : columnId === TITLE_PROPERTY
      ? 280
      : 165;
}

/** Persist only the resized property, checking its value at gesture start. */
export function databaseColumnWidthOperations(
  data: ProjectDatabaseData,
  viewId: string,
  columnId: string,
  width: number | undefined,
  before: number | undefined,
): DatasetOperation[] {
  const view = databaseViews(data).find((item) => item.id === viewId);
  if (
    view?.type !== "table" ||
    (columnId !== TITLE_PROPERTY &&
      !data.columns.some((column) => column.id === columnId)) ||
    ["id", "__proto__", "prototype", "constructor"].includes(columnId) ||
    (width !== undefined &&
      (!Number.isInteger(width) ||
        width < MIN_DATABASE_COLUMN_WIDTH ||
        width > MAX_DATABASE_COLUMN_WIDTH)) ||
    width === before
  )
    return [];
  const path = ["views", { id: viewId }, "columnWidths", columnId];
  return [
    ...initializeViews(data),
    ...(view.columnWidths === undefined
      ? [
          {
            op: "set" as const,
            path: ["views", { id: viewId }, "columnWidths"],
            value: {},
            absent: true as const,
          },
        ]
      : []),
    width === undefined
      ? { op: "remove", path, before }
      : {
          op: "set",
          path,
          value: width,
          ...(before === undefined ? { absent: true as const } : { before }),
        },
  ];
}

/** Patch a view field by id: changing a filter never replaces another view's settings. */
export function databaseViewSettingOperations<
  K extends "name" | "filter" | "sort" | "groupBy",
>(
  data: ProjectDatabaseData,
  viewId: string,
  field: K,
  value: ProjectDatabaseView[K] | undefined,
  before: ProjectDatabaseView[K] | undefined,
): DatasetOperation[] {
  if (!databaseViews(data).some((view) => view.id === viewId)) return [];
  if (value === undefined && before === undefined) return [];
  return [
    ...initializeViews(data),
    value === undefined
      ? { op: "remove", path: ["views", { id: viewId }, field], before }
      : {
          op: "set",
          path: ["views", { id: viewId }, field],
          value,
          ...(before === undefined ? { absent: true as const } : { before }),
        },
  ];
}

export function databaseAddViewOperations(
  data: ProjectDatabaseData,
  view: ProjectDatabaseView,
): DatasetOperation[] {
  return [
    ...initializeViews(data),
    {
      op: "insert",
      path: ["views"],
      value:
        view.type === "table" && view.columnWidths === undefined
          ? { ...view, columnWidths: {} }
          : view,
    },
  ];
}

export function databaseDeleteViewOperations(
  data: ProjectDatabaseData,
  view: ProjectDatabaseView,
): DatasetOperation[] {
  if (
    databaseViews(data).length <= 1 ||
    !databaseViews(data).some((item) => item.id === view.id)
  )
    return [];
  return [
    ...initializeViews(data),
    { op: "remove", path: ["views", { id: view.id }], before: view },
  ];
}

export interface DatabaseBoardGroup {
  value: string;
  rows: DatabaseViewRow[];
}

/** Keep configured empty groups, existing custom values, and documents without properties. */
export function databaseBoardGroups(
  rows: DatabaseViewRow[],
  columns: DatabaseColumn[],
  groupBy?: string,
): {
  column: DatabaseColumn | undefined;
  groups: DatabaseBoardGroup[];
} {
  const column =
    columns.find((item) => item.id === groupBy && item.type === "select") ??
    columns.find((item) => item.type === "select");
  if (!column) return { column: undefined, groups: [{ value: "", rows }] };
  const values = Array.from(
    new Set([
      ...(column.options ?? []),
      ...rows.map((row) => String(row.properties[column.id] ?? "")),
      "",
    ]),
  ).filter(Boolean);
  values.push("");
  const groups = values.map((value) => ({
    value,
    rows: [] as DatabaseViewRow[],
  }));
  const byValue = new Map(groups.map((group) => [group.value, group]));
  for (const row of rows)
    byValue.get(String(row.properties[column.id] ?? ""))!.rows.push(row);
  return { column, groups };
}

export function databaseViewRows(
  pages: PageSummary[],
  data: ProjectDatabaseData,
  queries: string[],
  filter: DatabaseViewFilter,
  sort: DatabaseViewSort | null,
  locale: string,
): DatabaseViewRow[] {
  const properties = new Map(data.rows.map((row) => [row.id, row]));
  const needles = queries
    .map((query) => query.trim().toLocaleLowerCase(locale))
    .filter(Boolean);
  const value = (row: DatabaseViewRow, key: string) =>
    key === TITLE_PROPERTY
      ? row.page.title
      : data.columns.find((column) => column.id === key)?.type === "checkbox"
        ? row.properties[key] === true
        : (row.properties[key] ?? "");
  const shown = pages
    .filter((page) => !page.archived)
    .map((page) => ({
      page,
      properties: properties.get(page.id) ?? { id: page.id },
    }))
    .filter((row) => {
      const values = [
        row.page.title,
        ...data.columns.map((column) => row.properties[column.id]),
      ];
      return (
        needles.every((needle) =>
          values.some((item) =>
            String(item ?? "")
              .toLocaleLowerCase(locale)
              .includes(needle),
          ),
        ) &&
        (!filter.column || String(value(row, filter.column)) === filter.value)
      );
    });
  if (!sort) return shown;
  const column = data.columns.find((item) => item.id === sort.column);
  return shown.sort((a, b) => {
    const left = value(a, sort.column),
      right = value(b, sort.column);
    // Empty values consistently follow filled values in both directions.
    if (left === "" || right === "")
      return left === right ? 0 : left === "" ? 1 : -1;
    const comparison =
      column?.type === "number"
        ? Number(left) - Number(right)
        : column?.type === "checkbox"
          ? Number(Boolean(left)) - Number(Boolean(right))
          : String(left).localeCompare(String(right), locale, {
              numeric: true,
            });
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

/** Only the edited field is addressed, so unrelated concurrent edits survive. */
export function databaseCellOperations(
  data: ProjectDatabaseData,
  pageId: string,
  columnId: string,
  value: DatabaseValue,
  before: DatabaseValue | undefined,
): DatasetOperation[] {
  if (!data.columns.some((column) => column.id === columnId)) return [];
  const operations: DatasetOperation[] = [];
  if (!data.rows.some((row) => row.id === pageId))
    operations.push({ op: "insert", path: ["rows"], value: { id: pageId } });
  operations.push({
    op: "set",
    path: ["rows", { id: pageId }, columnId],
    value,
    ...(before === undefined ? { absent: true as const } : { before }),
  });
  return operations;
}

/** Move one property by identity, preserving concurrent edits to its definition and values. */
export function databaseMoveColumnOperations(
  data: ProjectDatabaseData,
  columnId: string,
  targetId: string,
  placement: "before" | "after",
): DatasetOperation[] {
  const index = data.columns.findIndex((column) => column.id === columnId);
  if (index < 0 || columnId === targetId) return [];
  const remaining = data.columns.filter((column) => column.id !== columnId);
  const target = remaining.findIndex((column) => column.id === targetId);
  if (target < 0) return [];
  const destination = target + (placement === "after" ? 1 : 0);
  const after = destination ? remaining[destination - 1].id : null;
  const from = index ? data.columns[index - 1].id : null;
  return after === from
    ? []
    : [{ op: "move", path: ["columns", { id: columnId }], after, from }];
}

function converted(value: DatabaseValue, type: ColumnType): DatabaseValue {
  if (value === "") return "";
  switch (type) {
    case "date":
      return normalizeDate(String(value));
    case "number": {
      const number = Number(value);
      return Number.isFinite(number) ? number : "";
    }
    case "checkbox":
      return value === true || value === 1 || value === "true" || value === "1";
    default:
      return String(value);
  }
}

/** Type changes include compatible field conversions instead of corrupting dates. */
export function databaseTypeOperations(
  data: ProjectDatabaseData,
  column: DatabaseColumn,
  type: ColumnType,
): DatasetOperation[] {
  if (
    !data.columns.some((item) => item.id === column.id) ||
    type === column.type
  )
    return [];
  return [
    {
      op: "set",
      path: ["columns", { id: column.id }, "type"],
      value: type,
      before: column.type,
    },
    ...data.rows.flatMap((row): DatasetOperation[] => {
      const before = row[column.id];
      if (before === undefined) return [];
      const value = converted(before, type);
      return value === before
        ? []
        : [
            {
              op: "set",
              path: ["rows", { id: row.id }, column.id],
              before,
              value,
            },
          ];
    }),
  ];
}

export function databaseRemoveColumnOperations(
  data: ProjectDatabaseData,
  column: DatabaseColumn,
): DatasetOperation[] {
  return [
    { op: "remove", path: ["columns", { id: column.id }], before: column },
    ...data.rows.flatMap((row): DatasetOperation[] =>
      row[column.id] === undefined
        ? []
        : [
            {
              op: "remove",
              path: ["rows", { id: row.id }, column.id],
              before: row[column.id],
            },
          ],
    ),
  ];
}
