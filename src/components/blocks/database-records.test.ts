import { describe, expect, it } from "vitest";
import {
  queryRecords,
  readFilter,
  type FilterGroup,
} from "../../datasets/record-query.mjs";
import type { DatabaseColumn } from "./types";
import {
  recordFilterDefaults,
  databaseRecordTargets,
} from "./database-records";

describe("database record preview navigation", () => {
  it("follows the filtered/sorted rows of the clicked page property", () => {
    expect(
      databaseRecordTargets(
        [
          {
            id: "b",
            doc: "showai://project/research/page/two",
            other: "showai://project/research/page/other",
          },
          { id: "empty", doc: "" },
          { id: "invalid", doc: "https://example.com" },
          { id: "a", doc: "showai://project/research/page/one" },
        ],
        "doc",
      ),
    ).toEqual([
      { projectId: "research", pageId: "two", recordId: "b" },
      { projectId: "research", pageId: "one", recordId: "a" },
    ]);
  });

  it("uses each record's first linked page for navigation from its title", () => {
    const link = "showai://project/demo/page/";
    expect(
      databaseRecordTargets(
        [
          { id: "one", first: link + "a", second: link + "unused" },
          { id: "two", second: link + "b" },
        ],
        ["first", "second"],
      ),
    ).toEqual([
      { projectId: "demo", pageId: "a", recordId: "one" },
      { projectId: "demo", pageId: "b", recordId: "two" },
    ]);
  });

  it("keeps row identity when multiple records point to the same page", () => {
    const doc = "showai://project/research/page/one";
    expect(
      databaseRecordTargets(
        [
          { id: "first", doc },
          { id: "second", doc },
        ],
        "doc",
      ),
    ).toEqual([
      { projectId: "research", pageId: "one", recordId: "first" },
      { projectId: "research", pageId: "one", recordId: "second" },
    ]);
  });
});

describe("new records in saved views", () => {
  const fields: DatabaseColumn[] = [
    {
      id: "status",
      name: "Status",
      type: "select",
      options: ["Live", "Planned"],
    },
    { id: "tags", name: "Tags", type: "multiSelect" },
    { id: "count", name: "Count", type: "number" },
    { id: "day", name: "Day", type: "date" },
    { id: "done", name: "Done", type: "checkbox" },
    { id: "total", name: "Total", type: "formula" },
  ];
  it("prepopulates typed filters and the former single-condition format", () => {
    expect(
      recordFilterDefaults(
        readFilter({ column: "count", value: "0" }, fields),
        fields,
      ),
    ).toEqual({ count: 0 });
    const filter: FilterGroup = {
      join: "and",
      conditions: [
        { column: "status", operator: "includesAny", value: ["Live"] },
        { column: "done", operator: "unchecked" },
        { column: "count", operator: "between", value: [3, 3] },
        { column: "day", operator: "is", value: "2026-11-22" },
        { column: "tags", operator: "includesAll", value: ["a", "b"] },
        { column: "tags", operator: "includesAny", value: ["c"] },
      ],
    };
    const row = { id: "new", ...recordFilterDefaults(filter, fields) };
    expect(row).toEqual({
      id: "new",
      status: "Live",
      done: false,
      count: 3,
      day: "2026-11-22",
      tags: ["a", "b", "c"],
    });
    expect(queryRecords([row], fields, { filter })).toEqual([row]);
  });

  it("inherits only values imposed by every alternative and skips computed fields", () => {
    const filter: FilterGroup = {
      join: "and",
      conditions: [
        { column: "total", operator: "is", value: 8 },
        { column: "count", operator: "gt", value: 15 },
        {
          join: "or",
          conditions: [
            { column: "tags", operator: "includesAll", value: ["a", "b"] },
            { column: "tags", operator: "includesAll", value: ["b", "c"] },
          ],
        },
        {
          join: "or",
          conditions: [
            { column: "status", operator: "is", value: "Live" },
            { column: "status", operator: "is", value: "Planned" },
          ],
        },
      ],
    };
    expect(recordFilterDefaults(filter, fields)).toEqual({ tags: ["b"] });
    expect(
      recordFilterDefaults(
        {
          join: "or",
          conditions: [
            { column: "status", operator: "is", value: "Live" },
            { column: "done", operator: "checked" },
          ],
        },
        fields,
      ),
    ).toEqual({});
    expect(recordFilterDefaults(null, fields)).toEqual({});
  });
});
