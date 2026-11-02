import { describe, expect, it } from "vitest";
import { resolveBinding, shareBlock, splitBindingChange } from "./binding.mjs";
import { bindingEditable, canEdit, componentDataState } from "./editable.mjs";

// A table whose rows come from a sheet: title and status are mapped, owner is
// derived from the team list, anything else is kept with the block.
const sheet = () => ({
  team: [{ id: "u1", name: "Ada" }],
  tasks: [
    { id: "t1", title: "Plan", status: "todo", owner: "u1" },
    { id: "t2", title: "Ship", status: "done", owner: "u1" },
  ],
});
const table = () => ({
  title: "Tasks",
  columns: [
    { id: "title", name: "Title", type: "text" },
    { id: "status", name: "Status", type: "text" },
    { id: "owner", name: "Owner", type: "text" },
    { id: "note", name: "Note", type: "text" },
  ],
  rows: [{ id: "m1", title: "Manual", status: "todo", note: "" }],
  $binding: {
    dataset: "sheet",
    collections: [
      {
        key: "task",
        into: "rows",
        from: "tasks[*]",
        fields: { title: "title", status: "status" },
        derived: {
          owner: { lookup: "team", by: "owner", field: "name" },
        },
      },
    ],
  },
});

describe("editable paths of a bound block", () => {
  it("keeps the block's own items and fields writable next to rows from read-only data", () => {
    const resolved = resolveBinding("database", table(), sheet(), undefined, {
      writable: false,
    });
    const editable = bindingEditable(resolved);
    expect(editable).toEqual({
      paths: [
        "*",
        "rows[*]",
        "!rows[id=task:*].owner",
        "!rows[id=task:*].title",
        "!rows[id=task:*].status",
      ],
    });
    expect(canEdit(editable, "title")).toBe(true);
    expect(canEdit(editable, "columns")).toBe(true);
    expect(canEdit(editable, "rows", "m1", "title")).toBe(true);
    expect(canEdit(editable, "rows", "task:t1", "title")).toBe(false);
    expect(canEdit(editable, "rows", "task:t1", "owner")).toBe(false);
    expect(canEdit(editable, "rows", "task:t1", "note")).toBe(true);
    // The list as a whole has read-only parts.
    expect(canEdit(editable, "rows")).toBe(false);
    expect(resolved.projected.get("task:t1")).toMatchObject({
      writable: [],
      readOnly: ["owner", "title", "status"],
    });
  });

  it("is true for writable data without derived fields, and names derived fields otherwise", () => {
    const plain = table();
    delete (plain.$binding.collections[0] as { derived?: unknown }).derived;
    expect(bindingEditable(resolveBinding("database", plain, sheet()))).toBe(
      true,
    );
    expect(
      bindingEditable(resolveBinding("database", table(), sheet())),
    ).toEqual({ paths: ["*", "rows[*]", "!rows[id=task:*].owner"] });
  });

  it("names records without a stable id one by one", () => {
    const value = sheet();
    delete (value.tasks[1] as { id?: string }).id;
    const plain = table();
    delete (plain.$binding.collections[0] as { derived?: unknown }).derived;
    const editable = bindingEditable(resolveBinding("database", plain, value));
    expect(editable).toEqual({
      paths: [
        "*",
        "rows[*]",
        "!rows[id=task:#1].title",
        "!rows[id=task:#1].status",
      ],
    });
    expect(canEdit(editable, "rows", "task:#1", "title")).toBe(false);
    expect(canEdit(editable, "rows", "task:t1", "title")).toBe(true);
  });

  it("leaves only the local keys of a props binding over read-only data", () => {
    const { data } = shareBlock(
      "database",
      { title: "Tasks", columns: [], rows: [] },
      "sheet",
      ["title"],
    );
    const value = { columns: [], rows: [{ id: "a", title: "A" }] };
    const editable = bindingEditable(
      resolveBinding("database", data, value, undefined, { writable: false }),
    );
    expect(editable).toEqual({ paths: ["title"] });
    expect(canEdit(editable, "title")).toBe(true);
    expect(canEdit(editable, "columns")).toBe(false);
    expect(canEdit(editable, "rows", "a", "title")).toBe(false);
  });

  it("is false when nothing belongs to the block", () => {
    const { data } = shareBlock("chart", { series: [1] }, "sheet");
    expect(
      bindingEditable(
        resolveBinding("chart", data, { series: [1] }, undefined, {
          writable: false,
        }),
      ),
    ).toBe(false);
    expect(canEdit(false, "series")).toBe(false);
    expect(canEdit(true, "rows", "x", "y")).toBe(true);
  });
});

describe("changes of a block over read-only data", () => {
  it("stores the block's own changes and rejects those that reach the data", () => {
    const data = table();
    const value = sheet();
    const { props } = resolveBinding("database", data, value, undefined, {
      writable: false,
    });
    const rows = (props.rows as Record<string, unknown>[]).map((row) =>
      row.id === "task:t1"
        ? { ...row, title: "Changed", note: "kept here" }
        : row.id === "m1"
          ? { ...row, title: "Manual 2" }
          : row,
    );
    const result = splitBindingChange({
      kind: "database",
      data,
      value,
      nextProps: { ...props, title: "Renamed", rows },
      writable: false,
    });
    expect(result.operations).toEqual([]);
    expect(result.rejected).toEqual([
      { id: "task:t1", field: "title", reason: "source-read-only" },
    ]);
    expect(result.data.title).toBe("Renamed");
    expect(result.data.rows).toEqual([
      { id: "m1", title: "Manual 2", status: "todo", note: "" },
    ]);
    expect((result.data.$binding as { overlay?: unknown }).overlay).toEqual({
      "task:t1": { note: "kept here" },
    });
  });

  it("rejects changes of shared props", () => {
    const { data } = shareBlock(
      "database",
      { title: "Tasks", columns: [], rows: [] },
      "sheet",
      ["title"],
    );
    const value = { columns: [], rows: [] };
    const { props } = resolveBinding("database", data, value, undefined, {
      writable: false,
    });
    const result = splitBindingChange({
      kind: "database",
      data,
      value,
      nextProps: { ...props, columns: [{ id: "c", name: "C", type: "text" }] },
      writable: false,
    });
    expect(result.operations).toEqual([]);
    expect(result.rejected).toEqual([
      { field: "columns", reason: "source-read-only" },
    ]);
  });
});

describe("the dataState prop of components", () => {
  it("binds canEdit to the editable value and closes read-only blocks", () => {
    const state = componentDataState(
      { status: "stale", editable: { paths: ["*", "!rows[id=a].x"] } },
      false,
    );
    expect(state.status).toBe("stale");
    expect(state.canEdit("title")).toBe(true);
    const readOnly = componentDataState({ status: "ok", editable: true }, true);
    expect(readOnly.editable).toBe(false);
    expect(readOnly.canEdit("title")).toBe(false);
    // Hosts before dataState: current data, editable with the block.
    expect(componentDataState(undefined, false)).toMatchObject({
      status: "ok",
      editable: true,
    });
  });

  it("works when its source is embedded in a component frame", () => {
    const check = new Function(`return (${canEdit.toString()})`)();
    const make = new Function(`return (${componentDataState.toString()})`)();
    const state = make(
      {
        status: "ok",
        editable: { paths: ["*", "rows[*]", "!rows[id=t:*].a"] },
      },
      false,
      check,
    );
    expect(state.canEdit("rows", "t:1", "a")).toBe(false);
    expect(state.canEdit("rows", "t:1", "b")).toBe(true);
    expect(state.canEdit("rows", "local", "a")).toBe(true);
  });
});
