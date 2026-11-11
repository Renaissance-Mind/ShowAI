import { describe, expect, it } from "vitest";
import {
  queryRecords,
  readFilter,
  readSorts,
  validateFilter,
  groupKeys,
} from "./record-query.mjs";
import {
  KIND_OPERATORS,
  OPERATORS,
  operatorsOf,
  parseDay,
  testOperator,
  valueTypeOf,
} from "./value-types.mjs";

const columns = [
  { id: "name", name: "Name", type: "text" },
  { id: "price", name: "Price", type: "number" },
  { id: "due", name: "Due", type: "date" },
  { id: "status", name: "Status", type: "select", options: ["Open", "Done"] },
  { id: "tags", name: "Tags", type: "multiSelect", options: ["a", "b", "c"] },
  { id: "done", name: "Done", type: "checkbox" },
  { id: "link", name: "Link", type: "relation", relation: { dataset: "d" } },
];
const rows = [
  {
    id: "r1",
    name: "Alpha",
    price: 10,
    due: "2026-11-01",
    status: "Open",
    tags: ["a", "b"],
    done: true,
    link: ["x"],
  },
  {
    id: "r2",
    name: "beta",
    price: 2,
    due: "2026-11-10",
    status: "Done",
    tags: ["c"],
    done: false,
    link: [],
  },
  {
    id: "r3",
    name: "Gamma",
    price: "",
    due: "",
    status: "",
    tags: [],
    done: false,
    link: ["x", "y"],
  },
];
const today = parseDay("2026-11-12")!;
const ids = (filter: unknown, sorts: unknown[] = []) =>
  queryRecords(
    rows,
    columns,
    { filter: filter as never, sorts: sorts as never },
    { today },
  ).map((row) => row.id);
const where = (column: string, operator: string, value?: unknown) => ({
  join: "and",
  conditions: [{ column, operator, ...(value === undefined ? {} : { value }) }],
});

describe("operators", () => {
  it("every kind's operators have an operand kind", () => {
    for (const operators of Object.values(KIND_OPERATORS))
      for (const operator of operators)
        expect(OPERATORS).toHaveProperty(operator);
  });
  it("text", () => {
    expect(ids(where("name", "contains", "AL"))).toEqual(["r1"]);
    expect(ids(where("name", "notContains", "a"))).toEqual([]);
    expect(ids(where("name", "is", "beta"))).toEqual(["r2"]);
    expect(ids(where("name", "isNot", "beta"))).toEqual(["r1", "r3"]);
  });
  it("number", () => {
    expect(ids(where("price", "gt", 2))).toEqual(["r1"]);
    expect(ids(where("price", "lt", 10))).toEqual(["r2"]);
    expect(ids(where("price", "gte", 2))).toEqual(["r1", "r2"]);
    expect(ids(where("price", "lte", 2))).toEqual(["r2"]);
    expect(ids(where("price", "is", 10))).toEqual(["r1"]);
    expect(ids(where("price", "isNot", 10))).toEqual(["r2", "r3"]);
    expect(ids(where("price", "between", [3, 1]))).toEqual(["r2"]);
    expect(ids(where("price", "isEmpty"))).toEqual(["r3"]);
    expect(ids(where("price", "isNotEmpty"))).toEqual(["r1", "r2"]);
  });
  it("date, including relative windows", () => {
    expect(ids(where("due", "before", "2026-11-05"))).toEqual(["r1"]);
    expect(ids(where("due", "after", "2026-11-01"))).toEqual(["r2"]);
    expect(ids(where("due", "onOrBefore", "2026-11-10"))).toEqual(["r1", "r2"]);
    expect(ids(where("due", "onOrAfter", "2026-11-10"))).toEqual(["r2"]);
    expect(ids(where("due", "is", "2026-11-10"))).toEqual(["r2"]);
    expect(ids(where("due", "between", ["2026-10-30", "2026-11-02"]))).toEqual([
      "r1",
    ]);
    expect(ids(where("due", "within", { direction: "past", days: 7 }))).toEqual(
      ["r2"],
    );
    expect(ids(where("due", "within", { direction: "next", days: 7 }))).toEqual(
      [],
    );
    expect(ids(where("due", "isEmpty"))).toEqual(["r3"]);
  });
  it("select", () => {
    expect(ids(where("status", "is", "Open"))).toEqual(["r1"]);
    expect(ids(where("status", "isNot", "Open"))).toEqual(["r2", "r3"]);
    expect(ids(where("status", "includesAny", ["Open", "Done"]))).toEqual([
      "r1",
      "r2",
    ]);
  });
  it("multi-select and relations", () => {
    expect(ids(where("tags", "includesAny", ["b", "c"]))).toEqual(["r1", "r2"]);
    expect(ids(where("tags", "includesAll", ["a", "b"]))).toEqual(["r1"]);
    expect(ids(where("tags", "includesNone", ["a"]))).toEqual(["r2", "r3"]);
    expect(ids(where("tags", "isEmpty"))).toEqual(["r3"]);
    expect(ids(where("link", "includesAll", ["x", "y"]))).toEqual(["r3"]);
    expect(ids(where("link", "isNotEmpty"))).toEqual(["r1", "r3"]);
  });
  it("checkbox", () => {
    expect(ids(where("done", "checked"))).toEqual(["r1"]);
    expect(ids(where("done", "unchecked"))).toEqual(["r2", "r3"]);
  });
  it("offers only the operators of a column's kind", () => {
    expect(operatorsOf(columns[1])).not.toContain("contains");
    expect(operatorsOf(columns[4])).toContain("includesAll");
    expect(testOperator("boolean", true, "checked", undefined, today)).toBe(
      true,
    );
  });
});

describe("filter groups and sorts", () => {
  it("joins with all/any and nests one level", () => {
    const filter = {
      join: "or",
      conditions: [
        { column: "done", operator: "checked" },
        {
          join: "and",
          conditions: [
            { column: "status", operator: "is", value: "Done" },
            { column: "price", operator: "lt", value: 5 },
          ],
        },
      ],
    };
    expect(ids(filter)).toEqual(["r1", "r2"]);
    expect(() =>
      validateFilter(
        { join: "and", conditions: [{ join: "or", conditions: [filter] }] },
        "filter",
      ),
    ).toThrow("nests deeper");
  });
  it("ignores conditions on deleted columns", () => {
    expect(ids(where("gone", "is", "x"))).toEqual(["r1", "r2", "r3"]);
  });
  it("sorts by several keys, empties last in both directions", () => {
    expect(ids(null, [{ column: "price", direction: "asc" }])).toEqual([
      "r2",
      "r1",
      "r3",
    ]);
    expect(ids(null, [{ column: "price", direction: "desc" }])).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(
      ids(null, [
        { column: "done", direction: "asc" },
        { column: "name", direction: "desc" },
      ]),
    ).toEqual(["r3", "r2", "r1"]);
  });
  it("reads a legacy single filter and sort", () => {
    expect(readFilter({ column: "status", value: "Open" }, columns)).toEqual(
      where("status", "is", "Open"),
    );
    expect(readFilter({ column: "done", value: "true" }, columns)).toEqual(
      where("done", "checked"),
    );
    expect(readFilter({ column: "price", value: "10" }, columns)).toEqual(
      where("price", "is", 10),
    );
    expect(readFilter({ column: "status", value: "" }, columns)).toEqual(
      where("status", "isEmpty"),
    );
    expect(readFilter({ column: "", value: "" })).toBeNull();
    expect(readSorts({ sort: { column: "price", direction: "desc" } })).toEqual(
      [{ column: "price", direction: "desc" }],
    );
    expect(ids({ column: "status", value: "Open" })).toEqual(["r1"]);
  });
  it("rejects operators a column type does not offer and bad operands", () => {
    expect(() =>
      validateFilter(where("price", "contains", "x"), "f", columns),
    ).toThrow("does not apply");
    expect(() =>
      validateFilter(where("due", "before", "soon"), "f", columns),
    ).toThrow("YYYY-MM-DD");
    expect(() =>
      validateFilter(
        where("due", "within", { direction: "past" }),
        "f",
        columns,
      ),
    ).toThrow("direction");
  });
  it("groups records by select, multi-select and checkbox values", () => {
    expect(groupKeys(rows[0], columns[4])).toEqual(["a", "b"]);
    expect(groupKeys(rows[2], columns[4])).toEqual([""]);
    expect(groupKeys(rows[0], columns[5])).toEqual(["true"]);
    expect(valueTypeOf(columns[4]).regroup!(["a", "b"], "a", "c")).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("performance", () => {
  it("filters and sorts 10,000 records interactively", () => {
    const many = Array.from({ length: 10000 }, (_, index) => ({
      id: `r${index}`,
      name: `Record ${index}`,
      price: (index * 7919) % 1000,
      due: `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
      status: index % 3 ? "Open" : "Done",
      tags: index % 2 ? ["a"] : ["b", "c"],
      done: index % 5 === 0,
      link: [],
    }));
    const filter = {
      join: "and",
      conditions: [
        { column: "status", operator: "is", value: "Open" },
        {
          join: "or",
          conditions: [
            { column: "price", operator: "gt", value: 500 },
            { column: "tags", operator: "includesAny", value: ["c"] },
          ],
        },
        { column: "name", operator: "contains", value: "record" },
      ],
    };
    const sorts = [
      { column: "due", direction: "desc" },
      { column: "price", direction: "asc" },
    ];
    queryRecords(
      many,
      columns,
      { filter: filter as never, sorts: sorts as never },
      { today },
    );
    const started = performance.now();
    const result = queryRecords(
      many,
      columns,
      { search: "1", filter: filter as never, sorts: sorts as never },
      { today },
    );
    const ms = performance.now() - started;
    console.log(
      `10,000 records: ${result.length} shown in ${ms.toFixed(1)} ms`,
    );
    expect(result.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(250);
  });
});
