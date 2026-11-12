import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { DatasetStore } from "./datasets";
import { deriveDatabase, evaluateFormulas } from "./database-derive";
import { resolveDocumentDatasets } from "./dataset-resolution";
import { formulaInputs } from "../datasets/derived-fields.mjs";
import type { ShowDocument } from "../types";

const directories: string[] = [];
async function library() {
  const root = await mkdtemp(join(tmpdir(), "showai-database-derive-"));
  directories.push(root);
  const store = new FileStore(root);
  const projectId = (await store.createProject({ name: "Fields" })).id;
  return { store, projectId, datasets: new DatasetStore(store) };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const projects = {
  columns: [
    { id: "name", name: "Name", type: "text" },
    { id: "budget", name: "Budget", type: "number" },
  ],
  rows: [
    { id: "p1", name: "Site", budget: 100 },
    { id: "p2", name: "App", budget: 40 },
  ],
};
const tasks = {
  columns: [
    { id: "title", name: "Title", type: "text" },
    { id: "hours", name: "Hours", type: "number" },
    { id: "rate", name: "Rate", type: "number" },
    {
      id: "project",
      name: "Project",
      type: "relation",
      relation: { dataset: "projects", reverse: { name: "Tasks" } },
    },
    { id: "budget", name: "Budget", type: "rollup", rollup: { relation: "project", column: "budget", aggregate: "sum" } },
    { id: "cost", name: "Cost", type: "formula", formula: { expression: 'prop("Hours") * prop("Rate")', kind: "number" } },
    { id: "share", name: "Share", type: "formula", formula: { expression: 'prop("Cost") / prop("Budget")', kind: "number" } },
    { id: "broken", name: "Broken", type: "formula", formula: { expression: "prop(\"Hours\") +" } },
    { id: "loopA", name: "Loop A", type: "formula", formula: { expression: 'prop("Loop B")' } },
    { id: "loopB", name: "Loop B", type: "formula", formula: { expression: 'prop("Loop A")' } },
    { id: "throws", name: "Throws", type: "formula", formula: { expression: 'prop("Title").toUpperCase().missing()' } },
  ],
  rows: [
    { id: "t1", title: "Write", hours: 3, rate: 10, project: ["p1"] },
    { id: "t2", title: "Test", hours: 2, rate: 5, project: ["p2"] },
  ],
};

describe("formulas in the transform runtime", () => {
  it("evaluates per row with per-cell errors and cycles", async () => {
    const inputs = formulaInputs(tasks.columns, tasks.rows, (row) => ({
      budget: row.id === "t1" ? 100 : 40,
    }));
    const results = await evaluateFormulas(inputs);
    expect(results.t1.cost).toBe(30);
    expect(results.t1.share).toBeCloseTo(0.3);
    expect(results.t2.cost).toBe(10);
    expect(results.t1.broken).toMatchObject({ error: expect.stringContaining("unexpected token") });
    expect(results.t1.loopA).toMatchObject({ error: expect.stringContaining("Circular reference") });
    expect(results.t1.loopB).toMatchObject({ error: expect.stringContaining("Circular reference") });
    expect(results.t1.throws).toMatchObject({ error: expect.stringContaining("not a function") });
  });
  it("rejects malformed inputs", async () => {
    await expect(evaluateFormulas({ order: [] })).rejects.toThrow("malformed");
  });
});

describe("derived snapshots for readers and Agents", () => {
  it("carry relations, reverse sides, rollups and formula values", async () => {
    const { store, projectId, datasets } = await library();
    await datasets.create(projectId, { id: "projects", name: "Projects", value: projects });
    await datasets.create(projectId, { id: "tasks", name: "Tasks", value: tasks });
    const own = await deriveDatabase(store, projectId, tasks);
    expect(own).toMatchObject({
      values: { t1: { budget: 100, cost: 30 }, t2: { budget: 40, cost: 10 } },
      titles: { projects: { p1: "Site", p2: "App" } },
      columns: [],
    });
    const document = {
      id: "page",
      title: "Projects",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              id: "projects-block",
              kind: "database",
              data: {
                title: "Projects",
                $binding: { dataset: "projects", props: { local: ["title"] } },
              },
            },
          },
        ],
      },
    } as unknown as ShowDocument;
    const resolved = await resolveDocumentDatasets(store, projectId, document);
    const data = resolved.document.content.content![0].attrs!.data as Record<string, unknown>;
    expect(data.$derived).toMatchObject({
      columns: [{ id: "rev-tasks-project", name: "Tasks", type: "relation" }],
      values: { p1: { "rev-tasks-project": ["t1"] }, p2: { "rev-tasks-project": ["t2"] } },
      titles: { tasks: { t1: "Write", t2: "Test" } },
    });
  });
  it("reach databases nested in a text block's rich text", async () => {
    const { store, projectId, datasets } = await library();
    await datasets.create(projectId, { id: "projects", name: "Projects", value: projects });
    await datasets.create(projectId, { id: "tasks", name: "Tasks", value: tasks });
    const database = {
      type: "widget",
      attrs: {
        id: "nested-projects",
        kind: "database",
        data: {
          title: "Projects",
          $binding: { dataset: "projects", props: { local: ["title"] } },
        },
      },
    };
    const document = {
      id: "page",
      title: "Projects",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              id: "note",
              kind: "text",
              data: { content: { type: "doc", content: [database] } },
            },
          },
        ],
      },
    } as unknown as ShowDocument;
    const resolved = await resolveDocumentDatasets(store, projectId, document);
    const text = resolved.document.content.content![0].attrs!.data as {
      content: { content: { attrs: { data: Record<string, unknown> } }[] };
    };
    expect(text.content.content[0].attrs.data.$derived).toMatchObject({
      values: { p1: { "rev-tasks-project": ["t1"] }, p2: { "rev-tasks-project": ["t2"] } },
    });
  });
});
