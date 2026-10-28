// Named views of the database built-in. Data without `views` shows one view
// built from the older `view` and `groupBy` fields; the first saved change
// writes that view into `views`.
import {
  DATABASE_VIEWS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "./database-contract.mjs";
import type { DatabaseColumn, DatabaseView, DatabaseViewType } from "./types";

export const DEFAULT_VIEW_ID = "default";
/** Default table widths: the first property names the record. */
export const FIRST_COLUMN_WIDTH = 280;
export const COLUMN_WIDTH = 165;
export const ROW_ACTION_WIDTH = 33;

/** Settings a reader may change for a view without editing the page. */
export type ViewOverride = Partial<
  Pick<DatabaseView, "type" | "groupBy" | "sort" | "filter">
>;

const isViewType = (value: unknown): value is DatabaseViewType =>
  DATABASE_VIEWS.includes(value as string);

/** The saved views, or the single view older data describes. */
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

/** Data with these views; the older single-view fields are folded into them. */
export function withViews(
  data: Record<string, unknown>,
  views: DatabaseView[],
): Record<string, unknown> {
  const { view: _view, groupBy: _groupBy, ...rest } = data;
  return { ...rest, views };
}

/**
 * A view with changed settings. A view still named after its type follows a
 * type change, so a renamed view keeps its name.
 */
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
  for (const key of ["groupBy", "sort", "filter"] as const)
    if (
      next[key] === undefined ||
      next[key] === null ||
      (key === "filter" && !next.filter?.column) ||
      (key === "groupBy" && !next.groupBy)
    )
      delete next[key];
  if (next.columnWidths && !Object.keys(next.columnWidths).length)
    delete next.columnWidths;
  return next;
}

/** A view id that is not used yet. */
export function newViewId(views: DatabaseView[]): string {
  const used = new Set(views.map((view) => view.id));
  for (let index = views.length + 1; ; index += 1)
    if (!used.has(`view-${index}`)) return `view-${index}`;
}

/** The saved width of a table column in this view, or its default. */
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

/** Columns with one moved before or after another. */
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

/** Views whose settings refer only to existing columns of a fitting type. */
export function pruneViews(
  views: DatabaseView[],
  columns: DatabaseColumn[],
): DatabaseView[] {
  const ids = new Set(columns.map((column) => column.id));
  const selects = new Set(
    columns
      .filter((column) => column.type === "select")
      .map((column) => column.id),
  );
  return views.map((view) => {
    const next: DatabaseView = { ...view };
    if (next.groupBy && !selects.has(next.groupBy)) delete next.groupBy;
    if (next.sort && !ids.has(next.sort.column)) delete next.sort;
    if (next.filter && !ids.has(next.filter.column)) delete next.filter;
    if (next.columnWidths) {
      const widths = Object.fromEntries(
        Object.entries(next.columnWidths).filter(([id]) => ids.has(id)),
      );
      if (Object.keys(widths).length) next.columnWidths = widths;
      else delete next.columnWidths;
    }
    return next;
  });
}
