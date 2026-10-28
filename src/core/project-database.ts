import { CoreError } from "./model";
import type { JSONContent } from "@tiptap/core";
import { validateDatabaseData } from "../components/blocks/database-contract.mjs";
import { validateProjectDatabaseIntroduction } from "./project-database-introduction";
import type { DatabaseColumn, DatabaseRow } from "../components/blocks/types";

/** Browser-safe contract shared by the project view and persistence layer. */
export interface ProjectDatabase {
  datasetId: string;
}

export interface ProjectDatabaseView {
  id: string;
  name: string;
  type: "table" | "board" | "list";
  filter?: { column: string; value: string };
  sort?: { column: string; direction: "asc" | "desc" } | null;
  groupBy?: string;
  /** Table widths follow property identities, including the fixed $page-title key. */
  columnWidths?: Record<string, number>;
}

export const MIN_DATABASE_COLUMN_WIDTH = 80;
export const MAX_DATABASE_COLUMN_WIDTH = 1200;

export interface ProjectDatabaseData {
  columns: DatabaseColumn[];
  /** Each id is the id of a real page; its title remains on the page. */
  rows: DatabaseRow[];
  /** Omitted in older databases; the view layer supplies the default views. */
  views?: ProjectDatabaseView[];
  /** Native rich text shown above every view of this database. */
  intro?: JSONContent;
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validateViews(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error("Database views must contain 1–50 entries.");
  const ids = new Set<string>();
  const reference = (value: unknown) =>
    typeof value === "string" && value.length > 0 && value.length <= 200;
  for (const view of value) {
    if (
      !object(view) ||
      Object.keys(view).some(
        (key) =>
          ![
            "id",
            "name",
            "type",
            "filter",
            "sort",
            "groupBy",
            "columnWidths",
          ].includes(key),
      ) ||
      typeof view.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(view.id) ||
      /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]|constructor|prototype)$/i.test(
        view.id,
      ) ||
      ids.has(view.id) ||
      typeof view.name !== "string" ||
      !view.name.trim() ||
      view.name.length > 200 ||
      (view.type !== "table" && view.type !== "board" && view.type !== "list")
    )
      throw new Error("Invalid database view identity, name or type.");
    ids.add(view.id);
    if (
      view.filter !== undefined &&
      (!object(view.filter) ||
        Object.keys(view.filter).some(
          (key) => !["column", "value"].includes(key),
        ) ||
        !reference(view.filter.column) ||
        typeof view.filter.value !== "string")
    )
      throw new Error("Invalid database view filter.");
    if (
      view.sort !== undefined &&
      view.sort !== null &&
      (!object(view.sort) ||
        Object.keys(view.sort).some(
          (key) => !["column", "direction"].includes(key),
        ) ||
        !reference(view.sort.column) ||
        (view.sort.direction !== "asc" && view.sort.direction !== "desc"))
    )
      throw new Error("Invalid database view sort.");
    if (view.groupBy !== undefined && !reference(view.groupBy))
      throw new Error("Invalid database view grouping.");
    if (
      view.columnWidths !== undefined &&
      (!object(view.columnWidths) ||
        ![Object.prototype, null].includes(
          Object.getPrototypeOf(view.columnWidths),
        ) ||
        Object.entries(view.columnWidths).some(
          ([key, width]) =>
            !reference(key) ||
            ["id", "__proto__", "prototype", "constructor"].includes(key) ||
            typeof width !== "number" ||
            !Number.isInteger(width) ||
            width < MIN_DATABASE_COLUMN_WIDTH ||
            width > MAX_DATABASE_COLUMN_WIDTH,
        ))
    )
      throw new Error("Invalid database table column widths.");
  }
}

export function defaultProjectDatabaseViews(): ProjectDatabaseView[] {
  return [
    { id: "table", name: "表格", type: "table", columnWidths: {} },
    { id: "board", name: "看板", type: "board", groupBy: "status" },
    { id: "list", name: "列表", type: "list" },
  ];
}

export function validateProjectDatabase(value: unknown): ProjectDatabase {
  if (
    !object(value) ||
    Object.keys(value).some((key) => key !== "datasetId") ||
    typeof value.datasetId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.datasetId) ||
    /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i.test(value.datasetId)
  )
    throw new CoreError(
      "INVALID_DATA",
      "Invalid project database configuration.",
    );
  return value as unknown as ProjectDatabase;
}

export function validateProjectDatabaseData(
  value: unknown,
): ProjectDatabaseData {
  if (
    !object(value) ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.rows) ||
    Object.keys(value).some(
      (key) => !["columns", "rows", "views", "intro"].includes(key),
    )
  )
    throw new CoreError(
      "INVALID_DATA",
      "A project database needs columns and rows.",
    );
  try {
    validateDatabaseData({ columns: value.columns, rows: value.rows });
    if (value.views !== undefined) validateViews(value.views);
    if (value.intro !== undefined)
      validateProjectDatabaseIntroduction(value.intro);
    if (value.columns.some((column) => column.id === "$page-title"))
      throw new Error(
        "The $page-title property is reserved for the page title.",
      );
    for (const row of value.rows)
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.id))
        throw new Error("A project database row id must be a page identifier.");
  } catch (error) {
    throw new CoreError(
      "INVALID_DATA",
      error instanceof Error ? error.message : String(error),
    );
  }
  return value as unknown as ProjectDatabaseData;
}

export function createProjectDatabaseData(): ProjectDatabaseData {
  return {
    columns: [
      {
        id: "status",
        name: "状态",
        type: "select",
        options: ["待开始", "进行中", "已完成"],
      },
      { id: "date", name: "日期", type: "date" },
    ],
    rows: [],
    views: defaultProjectDatabaseViews(),
  };
}
