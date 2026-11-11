import { describe, expect, it } from "vitest";
import { validateDatabaseData } from "./database-contract.mjs";
import {
  changeView,
  pruneViews,
  upgradeViewQuery,
  withViews,
} from "./database-views";
import { validateDocument } from "../../portable/validation.mjs";
import {
  queryRecords,
  readFilter,
  readSorts,
} from "../../datasets/record-query.mjs";
import type { DatabaseColumn, DatabaseView } from "./types";

// Data in the shape the database saved before field registries: a single
// {column, value} filter and a single sort per view.
const legacy = {
  title: "Reading list",
  columns: [
    { id: "name", name: "Name", type: "text", options: [] },
    { id: "status", name: "Status", type: "select", options: ["Todo", "Done"] },
    { id: "read", name: "Read", type: "checkbox", options: [] },
    { id: "due", name: "Due", type: "date", options: [] },
    { id: "pages", name: "Pages", type: "number", options: [] },
    {
      id: "note",
      name: "Note",
      type: "page",
      options: [],
      folder: "notes",
      titleColumn: "name",
    },
  ],
  rows: [
    { id: "a", name: "Alpha", status: "Todo", read: false, due: "2026-11-01", pages: 120, note: "" },
    { id: "b", name: "Beta", status: "Done", read: true, due: "", pages: 80, note: "showai://project/p1/page/x1" },
    { id: "c", name: "Gamma", status: "Done", read: true, due: "2026-10-01", pages: "", note: "" },
  ],
  views: [
    {
      id: "default",
      name: "Done first",
      type: "table",
      sort: { column: "pages", direction: "desc" },
      filter: { column: "status", value: "Done" },
      columnWidths: { name: 300 },
    },
    { id: "read", name: "Read", type: "board", groupBy: "status", filter: { column: "read", value: "true" } },
  ],
};
const columns = legacy.columns as DatabaseColumn[];
const name = (type: string) => type;

describe("data saved before field registries", () => {
  it("validates in the contract and in the portable validator unchanged", () => {
    const copy = structuredClone(legacy);
    expect(validateDatabaseData(copy)).toEqual(legacy);
    const document = {
      id: "legacy",
      title: "Legacy",
      content: {
        type: "doc",
        content: [{ type: "widget", attrs: { id: "db", kind: "database", data: copy } }],
      },
    };
    expect(validateDocument(document).content.content?.[0].attrs?.data).toEqual(legacy);
  });
  it("keeps legacy views as they are until the view is edited", () => {
    const views = legacy.views as DatabaseView[];
    expect(pruneViews(views, columns)).toEqual(views);
    const renamed = changeView(views[1], { name: "Shelf" }, name);
    expect(renamed.sort).toBeUndefined();
    expect(renamed.filter).toEqual({ column: "read", value: "true" });
    expect(withViews(legacy, views).views).toEqual(views);
  });
  it("shows the same records as before", () => {
    const view = legacy.views[0];
    expect(
      queryRecords(legacy.rows, columns, {
        filter: view.filter,
        sorts: readSorts(view as DatabaseView),
      }).map((row) => row.id),
    ).toEqual(["b", "c"]);
    expect(
      queryRecords(legacy.rows, columns, {
        filter: legacy.views[1].filter,
      }).map((row) => row.id),
    ).toEqual(["b", "c"]);
  });
  it("writes an edited view back as a filter group and a sort list", () => {
    const view = legacy.views[0] as DatabaseView;
    const next = changeView(
      view,
      { ...upgradeViewQuery(view, columns), columnWidths: { name: 320 } },
      name,
    );
    expect(next).toEqual({
      id: "default",
      name: "Done first",
      type: "table",
      sorts: [{ column: "pages", direction: "desc" }],
      filter: {
        join: "and",
        conditions: [{ column: "status", operator: "is", value: "Done" }],
      },
      columnWidths: { name: 320 },
    });
    const board = changeView(
      legacy.views[1] as DatabaseView,
      upgradeViewQuery(legacy.views[1] as DatabaseView, columns),
      name,
    );
    expect(board.filter).toEqual({
      join: "and",
      conditions: [{ column: "read", operator: "checked" }],
    });
    const upgraded = { ...legacy, views: [next, board] };
    expect(() => validateDatabaseData(structuredClone(upgraded))).not.toThrow();
    expect(
      queryRecords(legacy.rows, columns, {
        filter: next.filter,
        sorts: next.sorts,
      }).map((row) => row.id),
    ).toEqual(["b", "c"]);
  });
  it("drops filter conditions on deleted columns", () => {
    const view = {
      id: "v",
      name: "V",
      type: "table",
      filter: {
        join: "or",
        conditions: [
          { column: "status", operator: "is", value: "Done" },
          { join: "and", conditions: [{ column: "gone", operator: "isEmpty" }] },
        ],
      },
      sorts: [{ column: "gone", direction: "asc" }],
    } as DatabaseView;
    expect(pruneViews([view], columns)[0]).toEqual({
      id: "v",
      name: "V",
      type: "table",
      filter: {
        join: "or",
        conditions: [{ column: "status", operator: "is", value: "Done" }],
      },
    });
    expect(readFilter(pruneViews([view], columns)[0].filter, columns)).not.toBeNull();
  });
});

describe("new field types in the contract", () => {
  const base = {
    columns: [
      { id: "name", name: "Name", type: "text" },
      { id: "tags", name: "Tags", type: "multiSelect", options: ["a", "b"], colors: { a: "blue" } },
      { id: "project", name: "Project", type: "relation", relation: { dataset: "projects", reverse: { name: "Tasks" } } },
      { id: "count", name: "Count", type: "rollup", rollup: { relation: "project", aggregate: "count" } },
      { id: "label", name: "Label", type: "formula", formula: { expression: 'prop("Name") + "!"' } },
      { id: "rating", name: "Rating", type: "custom", component: { componentId: "star-rating", version: "1.0.0" }, config: { max: 5 } },
    ],
    rows: [{ id: "r", name: "x", tags: ["a"], project: ["p1"], rating: 4 }],
  };
  it("accepts lists, configs and custom fields", () => {
    expect(() => validateDatabaseData(structuredClone(base))).not.toThrow();
  });
  it("rejects misplaced settings and bad values with a path", () => {
    const bad = (change: (data: typeof base) => void) => {
      const data = structuredClone(base);
      change(data);
      return () => validateDatabaseData(data);
    };
    expect(bad((d) => ((d.columns[1] as Record<string, unknown>).colors = { a: "teal" }))).toThrow(
      "columns[1].colors.a",
    );
    expect(bad((d) => ((d.rows[0] as Record<string, unknown>).name = ["x"]))).toThrow(
      "rows[0].name must be text",
    );
    expect(bad((d) => ((d.columns[3] as Record<string, unknown>).rollup = { relation: "name", aggregate: "count" }))).toThrow(
      "must name a relation column",
    );
    expect(bad((d) => ((d.columns[3] as Record<string, unknown>).rollup = { relation: "project", aggregate: "sum" }))).toThrow(
      "column is required",
    );
    expect(bad((d) => ((d.columns[0] as Record<string, unknown>).formula = { expression: "1" }))).toThrow(
      "only belongs to formula",
    );
    expect(bad((d) => ((d.columns[2] as Record<string, unknown>).relation = {}))).toThrow(
      "relation.dataset",
    );
    expect(bad((d) => ((d.columns[5] as Record<string, unknown>).component = { componentId: "Bad" }))).toThrow(
      "columns[5].component",
    );
  });
});
