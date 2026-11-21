import {
  DATABASE_VIEWS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "./database-contract.mjs";
import type {
  DatabaseCalendarConfig,
  DatabaseColumn,
  DatabaseView,
  DatabaseViewType,
} from "./types";
import {
  filterConditions,
  readFilter,
  readSorts,
} from "../../datasets/record-query.mjs";
import { valueTypeOf } from "../../datasets/value-types.mjs";

export const DEFAULT_VIEW_ID = "default";
export const FIRST_COLUMN_WIDTH = 280;
export const COLUMN_WIDTH = 165;
export const ROW_ACTION_WIDTH = 33;

export type ViewOverride = Partial<
  Pick<
    DatabaseView,
    | "type"
    | "groupBy"
    | "sort"
    | "sorts"
    | "filter"
    | "hiddenColumns"
    | "calendar"
  >
>;

const isViewType = (value: unknown): value is DatabaseViewType =>
  DATABASE_VIEWS.includes(value as string);

export function databaseViews(
  data: Record<string, unknown>,
  name: (type: DatabaseViewType) => string,
): { views: DatabaseView[]; saved: boolean } {
  if (Array.isArray(data.views) && data.views.length)
    return { views: data.views as DatabaseView[], saved: true };
  const type = isViewType(data.view) ? data.view : "table";
  return {
    views: [
      {
        id: DEFAULT_VIEW_ID,
        name: name(type),
        type,
        ...(typeof data.groupBy === "string" && data.groupBy
          ? { groupBy: data.groupBy }
          : {}),
      },
    ],
    saved: false,
  };
}

export function withViews(
  data: Record<string, unknown>,
  views: DatabaseView[],
): Record<string, unknown> {
  const { view: _view, groupBy: _groupBy, ...rest } = data;
  return { ...rest, views };
}

export function changeView(
  view: DatabaseView,
  changes: Partial<DatabaseView>,
  name: (type: DatabaseViewType) => string,
): DatabaseView {
  const next: DatabaseView = { ...view, ...changes };
  if (
    changes.type &&
    changes.type !== view.type &&
    view.name === name(view.type)
  )
    next.name = name(changes.type);
  if ("sorts" in changes) delete next.sort;
  for (const key of ["groupBy", "sort", "sorts", "filter"] as const)
    if (
      next[key] === undefined ||
      next[key] === null ||
      (key === "filter" && !filterConditions(readFilter(next.filter)).length) ||
      (key === "sorts" && !next.sorts?.length) ||
      (key === "groupBy" && !next.groupBy)
    )
      delete next[key];
  if (next.columnWidths && !Object.keys(next.columnWidths).length)
    delete next.columnWidths;
  if (!next.hiddenColumns?.length && next.type !== "calendar")
    delete next.hiddenColumns;
  return next;
}

export function upgradeViewQuery(
  view: DatabaseView,
  columns: DatabaseColumn[],
): Partial<DatabaseView> {
  return {
    ...(view.filter && "value" in view.filter
      ? { filter: readFilter(view.filter, columns) ?? undefined }
      : {}),
    ...(view.sort !== undefined ? { sorts: readSorts(view) } : {}),
  };
}

export function newViewId(views: DatabaseView[]): string {
  const used = new Set(views.map((view) => view.id));
  for (let index = views.length + 1; ; index += 1)
    if (!used.has(`view-${index}`)) return `view-${index}`;
}

export function duplicateDatabaseView(
  view: DatabaseView,
  views: DatabaseView[],
  copyName: (name: string) => string,
): DatabaseView {
  const names = new Set(views.map((item) => item.name));
  const base = copyName(view.name.slice(0, 185)).slice(0, 194);
  let name = base;
  for (let index = 2; names.has(name); index++) name = `${base} ${index}`;
  return { ...structuredClone(view), id: newViewId(views), name };
}

export function columnWidth(
  view: DatabaseView,
  id: string,
  index: number,
): number {
  const width = view.columnWidths?.[id];
  return Number.isInteger(width) &&
    width! >= MIN_COLUMN_WIDTH &&
    width! <= MAX_COLUMN_WIDTH
    ? width!
    : index === 0
      ? FIRST_COLUMN_WIDTH
      : COLUMN_WIDTH;
}

export function moveColumnTo<T extends { id: string }>(
  columns: T[],
  id: string,
  target: string,
  placement: "before" | "after",
): T[] {
  const moved = columns.find((column) => column.id === id);
  if (!moved || id === target) return columns;
  const next = columns.filter((column) => column.id !== id);
  const index = next.findIndex((column) => column.id === target);
  if (index < 0) return columns;
  next.splice(placement === "before" ? index : index + 1, 0, moved);
  return next;
}

export function pruneCalendarConfig(
  config: DatabaseCalendarConfig | undefined,
  columns: DatabaseColumn[],
): DatabaseCalendarConfig | undefined {
  if (!config) return undefined;
  const next: DatabaseCalendarConfig = { ...config };
  const pick = (
    fields: DatabaseColumn[],
    id: string | undefined,
    type: DatabaseColumn["type"],
  ) => fields.find((field) => field.id === id && field.type === type);
  const keep = (
    key:
      | "dateColumn"
      | "endDateColumn"
      | "startTimeColumn"
      | "endTimeColumn"
      | "colorColumn"
      | "doneColumn",
    type: DatabaseColumn["type"],
  ) => {
    if (next[key] !== undefined && !pick(columns, next[key], type))
      delete next[key];
  };
  keep("dateColumn", "date");
  keep("endDateColumn", "date");
  keep("startTimeColumn", "text");
  keep("endTimeColumn", "text");
  if (next.colorColumn !== "") keep("colorColumn", "select");
  keep("doneColumn", "checkbox");
  if (
    next.contextColumn !== undefined &&
    !pick(columns, next.contextColumn, "text") &&
    !pick(columns, next.contextColumn, "select")
  )
    delete next.contextColumn;
  if (next.endDateColumn && next.endDateColumn === next.dateColumn)
    delete next.endDateColumn;
  if (!next.startTimeColumn) delete next.endTimeColumn;
  return next;
}

export function pruneViews(
  views: DatabaseView[],
  columns: DatabaseColumn[],
): DatabaseView[] {
  const ids = new Set(columns.map((column) => column.id));
  const groupable = new Set(
    columns
      .filter((column) => valueTypeOf(column).groups)
      .map((column) => column.id),
  );
  return views.map((view) => {
    const next: DatabaseView = { ...view };
    if (next.groupBy && !groupable.has(next.groupBy)) delete next.groupBy;
    if (next.sort && !ids.has(next.sort.column)) delete next.sort;
    if (next.sorts) {
      const sorts = readSorts(next).filter((sort) => ids.has(sort.column));
      if (sorts.length) next.sorts = sorts;
      else delete next.sorts;
    }
    if (next.filter) {
      const group = readFilter(next.filter, columns);
      const kept = group && {
        join: group.join,
        conditions: group.conditions
          .map((item) =>
            "conditions" in item
              ? {
                  ...item,
                  conditions: item.conditions.filter(
                    (entry) => "column" in entry && ids.has(entry.column),
                  ),
                }
              : item,
          )
          .filter((item) =>
            "conditions" in item
              ? item.conditions.length
              : ids.has(item.column),
          ),
      };
      if (kept && filterConditions(kept).length)
        next.filter = "column" in next.filter ? next.filter : kept;
      else delete next.filter;
    }
    if (next.columnWidths) {
      const widths = Object.fromEntries(
        Object.entries(next.columnWidths).filter(([id]) => ids.has(id)),
      );
      if (Object.keys(widths).length) next.columnWidths = widths;
      else delete next.columnWidths;
    }
    if (next.hiddenColumns) {
      next.hiddenColumns = next.hiddenColumns.filter((id) => ids.has(id));
      if (!next.hiddenColumns.length && next.type !== "calendar")
        delete next.hiddenColumns;
    }
    if (next.calendar)
      next.calendar = pruneCalendarConfig(next.calendar, columns);
    return next;
  });
}

export interface TitlePair {
  key: string;
  stored: string;
  live: string;
}

export function titleSyncActions(
  pairs: TitlePair[],
  synced: Map<string, string>,
  pending: Set<string>,
): { write: Map<string, string>; rename: Map<string, string> } {
  const write = new Map<string, string>();
  const rename = new Map<string, string>();
  for (const { key, stored, live } of pairs) {
    if (stored === live) {
      synced.set(key, live);
      continue;
    }
    if (pending.has(key)) continue;
    const previous = synced.get(key);
    if (previous !== undefined && live === previous) {
      if (stored.trim()) rename.set(key, stored);
      continue;
    }
    write.set(key, live);
    synced.set(key, live);
  }
  return { write, rename };
}
