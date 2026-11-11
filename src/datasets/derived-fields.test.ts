import { describe, expect, it } from "vitest";
import {
  deriveValues,
  formulaInputs,
  formulaPlan,
  formulaReferences,
  recordTitle,
  reverseColumns,
} from "./derived-fields.mjs";

const tasks = {
  columns: [
    { id: "title", name: "Title", type: "text" },
    { id: "hours", name: "Hours", type: "number" },
    { id: "done", name: "Done", type: "checkbox" },
    {
      id: "project",
      name: "Project",
      type: "relation",
      relation: { dataset: "projects", reverse: { name: "Tasks" } },
    },
  ],
  rows: [
    { id: "t1", title: "Write", hours: 3, done: true, project: ["p1"] },
    { id: "t2", title: "Test", hours: 5, done: false, project: ["p1"] },
    { id: "t3", title: "Ship", hours: 1, done: true, project: ["p2"] },
  ],
};

describe("relations and rollups", () => {
  const reverse = reverseColumns("projects", [
    { datasetId: "tasks", name: "Task list", value: tasks },
  ]);
  const columns = [
    { id: "name", name: "Name", type: "text" },
    ...reverse,
    ...[
      "count",
      "sum",
      "average",
      "min",
      "max",
      "unique",
      "percentChecked",
    ].map((aggregate) => ({
      id: aggregate,
      name: aggregate,
      type: "rollup",
      rollup: {
        relation: reverse[0].id,
        column: aggregate === "percentChecked" ? "done" : "hours",
        aggregate,
      },
    })),
  ];
  const rows = [
    { id: "p1", name: "Site" },
    { id: "p2", name: "App" },
    { id: "p3", name: "Empty" },
  ];
  const values = deriveValues(columns, rows, {
    related: (id) => (id === "tasks" ? tasks : undefined),
  });
  it("shows the records linking to each record on the target", () => {
    expect(reverse).toEqual([
      {
        id: "rev-tasks-project",
        name: "Tasks",
        type: "relation",
        relation: { dataset: "tasks", reverseOf: "project" },
      },
    ]);
    expect(values.get("p1")![reverse[0].id]).toEqual(["t1", "t2"]);
    expect(values.get("p3")![reverse[0].id]).toEqual([]);
  });
  it("aggregates over a relation", () => {
    expect(values.get("p1")).toMatchObject({
      count: 2,
      sum: 8,
      average: 4,
      min: 3,
      max: 5,
      unique: 2,
      percentChecked: 50,
    });
    expect(values.get("p3")).toMatchObject({ count: 0, sum: 0, average: "" });
  });
  it("names records by their first text field", () => {
    expect(recordTitle(tasks.rows[0], tasks.columns)).toBe("Write");
    expect(recordTitle({ id: "x" }, [])).toBe("x");
  });
});

describe("formula plans", () => {
  it("reads quoted prop() names only", () => {
    expect(formulaReferences(`prop("Price") * prop('Qty')`)).toEqual([
      "Price",
      "Qty",
    ]);
    expect(() => formulaReferences("prop(name)")).toThrow("quoted");
  });
  it("orders formulas by dependency and reports cycles and unknown names", () => {
    const plan = formulaPlan([
      { id: "price", name: "Price", type: "number" },
      {
        id: "total",
        name: "Total",
        type: "formula",
        formula: { expression: 'prop("Tax") + prop("Price")' },
      },
      {
        id: "tax",
        name: "Tax",
        type: "formula",
        formula: { expression: 'prop("Price") * 0.1' },
      },
      {
        id: "a",
        name: "A",
        type: "formula",
        formula: { expression: 'prop("B")' },
      },
      {
        id: "b",
        name: "B",
        type: "formula",
        formula: { expression: 'prop("A")' },
      },
      {
        id: "bad",
        name: "Bad",
        type: "formula",
        formula: { expression: 'prop("Nope")' },
      },
    ]);
    expect(plan.order.indexOf("tax")).toBeLessThan(plan.order.indexOf("total"));
    expect(plan.errors.a).toContain("Circular reference");
    expect(plan.errors.b).toContain("Circular reference");
    expect(plan.errors.bad).toContain("Unknown property");
    expect(plan.errors.total).toBeUndefined();
  });
  it("sends only the fields formulas read", () => {
    const inputs = formulaInputs(
      [
        { id: "price", name: "Price", type: "number" },
        { id: "note", name: "Note", type: "text" },
        {
          id: "double",
          name: "Double",
          type: "formula",
          formula: { expression: 'prop("Price") * 2' },
        },
      ],
      [{ id: "r1", price: 4, note: "x" }],
    );
    expect(inputs!.rows).toEqual([{ id: "r1", values: { price: 4 } }]);
  });
});
