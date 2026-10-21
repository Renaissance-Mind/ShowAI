import { describe, expect, it } from "vitest";
import {
  compileBinding,
  resolveBinding,
  shareBlock,
  snapshotBinding,
  splitBindingChange,
  suggestCollections,
} from "./binding.mjs";
import { applyOperations } from "./operations.mjs";

type Task = { id: string; title: string; due?: string; done?: boolean };
type Okr = {
  split?: number;
  areas: { id: string; name: string }[];
  objectives: {
    id: string;
    area: string;
    title: string;
    status: string;
    due?: string;
    keyResults: {
      id: string;
      title: string;
      status: string;
      due?: string;
      tasks: Task[];
    }[];
  }[];
};
export const okr = (): Okr => ({
  split: 0.6,
  areas: [
    { id: "work", name: "工作" },
    { id: "life", name: "生活" },
  ],
  objectives: [
    {
      id: "o1",
      area: "work",
      title: "发布",
      status: "doing",
      due: "2026-10-31",
      keyResults: [
        {
          id: "k1",
          title: "文档",
          status: "todo",
          due: "2026-10-28",
          tasks: [
            { id: "t1", title: "写指南", due: "2026-10-22" },
            { id: "t2", title: "审稿", done: false },
          ],
        },
      ],
    },
    { id: "o2", area: "life", title: "旅行", status: "todo", keyResults: [] },
  ],
});

export const scheduleBinding = (dataset = "okr") => ({
  dataset,
  collections: [
    {
      key: "task",
      into: "rows",
      from: "objectives[*].keyResults[*].tasks[*]",
      where: { field: "due", exists: true },
      label: "全景 · 任务",
      fields: {
        title: "title",
        date: { from: "due", empty: "remove" },
        done: "done",
      },
      derived: {
        project: "../../title",
        cat: { lookup: "areas", by: "../../area", field: "name" },
        source: { template: "全景 · {../title}" },
      },
      defaults: { kind: "截止", confirm: "已确认" },
    },
    {
      key: "kr",
      into: "rows",
      from: "objectives[*].keyResults[*]",
      where: { field: "due", exists: true },
      fields: {
        title: "title",
        date: { from: "due", empty: "remove" },
        done: {
          from: "status",
          map: { true: "done", false: "todo" },
          otherwise: false,
        },
      },
      derived: {
        project: "../title",
        cat: { lookup: "areas", by: "../area", field: "name" },
        source: { value: "全景 · 关键目标" },
      },
      defaults: { kind: "截止" },
    },
    {
      key: "objective",
      into: "rows",
      from: "objectives[*]",
      where: { field: "due", exists: true },
      fields: {
        title: "title",
        date: { from: "due", empty: "remove" },
        done: {
          from: "status",
          map: { true: "done", false: "todo" },
          otherwise: false,
        },
      },
      derived: {
        project: "title",
        cat: { lookup: "areas", by: "area", field: "name" },
        source: { value: "全景 · 目标" },
      },
    },
  ],
});

const columns = [
  { id: "title", name: "事项", type: "text" },
  { id: "cat", name: "类别", type: "select", options: [] },
  { id: "project", name: "项目", type: "text" },
  { id: "kind", name: "类型", type: "select", options: ["截止", "会议"] },
  { id: "date", name: "截止日期", type: "date" },
  { id: "time", name: "时间", type: "text" },
  { id: "prep", name: "开始准备", type: "date" },
  { id: "confirm", name: "确认", type: "select", options: ["已确认"] },
  { id: "done", name: "完成", type: "checkbox" },
  { id: "source", name: "来源与说明", type: "text" },
];
const manual = {
  id: "m1",
  title: "体检",
  kind: "固定日程",
  date: "2026-10-23",
  done: false,
};
const schedule = () => ({
  title: "日程",
  columns,
  rows: [manual],
  view: "calendar",
  $binding: scheduleBinding(),
});

describe("collection mapping", () => {
  it("projects dated records of every level next to manual rows", () => {
    const { props, projected, issues } = resolveBinding(
      "database",
      schedule(),
      okr(),
    );
    expect(issues).toEqual([]);
    const rows = props.rows as Record<string, unknown>[];
    expect(rows.map((row) => row.id)).toEqual([
      "m1",
      "task:t1",
      "kr:k1",
      "objective:o1",
    ]);
    expect(rows[1]).toEqual({
      id: "task:t1",
      kind: "截止",
      confirm: "已确认",
      title: "写指南",
      date: "2026-10-22",
      project: "发布",
      cat: "工作",
      source: "全景 · 文档",
    });
    expect(rows[2]).toMatchObject({
      done: false,
      project: "发布",
      cat: "工作",
    });
    expect(projected.get("task:t1")?.source).toEqual([
      "objectives",
      { id: "o1" },
      "keyResults",
      { id: "k1" },
      "tasks",
      { id: "t1" },
    ]);
    expect(props).not.toHaveProperty("$binding");
  });

  it("writes mapped fields back, keeps local fields with the block and leaves manual rows alone", () => {
    const data = schedule();
    const value = okr();
    const { props } = resolveBinding("database", data, value);
    const rows = (props.rows as Record<string, unknown>[]).map((row) =>
      row.id === "task:t1"
        ? { ...row, date: "2026-10-24", done: true, prep: "2026-10-20" }
        : row.id === "kr:k1"
          ? { ...row, done: true }
          : row,
    );
    const result = splitBindingChange({
      kind: "database",
      data,
      value,
      nextProps: { ...props, rows },
    });
    expect(result.rejected).toEqual([]);
    const applied = applyOperations(value, result.operations);
    expect(applied.conflicts).toEqual([]);
    const next = applied.value as Okr;
    expect(next.objectives[0].keyResults[0].tasks[0]).toEqual({
      id: "t1",
      title: "写指南",
      due: "2026-10-24",
      done: true,
    });
    expect(next.objectives[0].keyResults[0].status).toBe("done");
    expect(result.data.rows).toEqual([manual]);
    expect((result.data.$binding as { overlay: unknown }).overlay).toEqual({
      "task:t1": { prep: "2026-10-20" },
    });
    const again = resolveBinding("database", result.data, next).props
      .rows as Record<string, unknown>[];
    expect(again.find((row) => row.id === "task:t1")).toMatchObject({
      prep: "2026-10-20",
      date: "2026-10-24",
      done: true,
    });
  });

  it("clearing a date removes the source field and the row", () => {
    const data = schedule();
    const value = okr();
    const { props } = resolveBinding("database", data, value);
    const rows = (props.rows as Record<string, unknown>[]).map((row) =>
      row.id === "task:t1" ? { ...row, date: "" } : row,
    );
    const result = splitBindingChange({
      kind: "database",
      data,
      value,
      nextProps: { ...props, rows },
    });
    const next = applyOperations(value, result.operations).value as Okr;
    expect(next.objectives[0].keyResults[0].tasks[0]).not.toHaveProperty("due");
    expect(
      (
        resolveBinding("database", data, next).props.rows as { id: string }[]
      ).map((row) => row.id),
    ).not.toContain("task:t1");
  });

  it("rejects edits of derived fields and removal of mapped rows instead of dropping them", () => {
    const data = schedule();
    const value = okr();
    const { props } = resolveBinding("database", data, value);
    const rows = (props.rows as Record<string, unknown>[])
      .filter((row) => row.id !== "kr:k1")
      .map((row) => (row.id === "task:t1" ? { ...row, project: "别的" } : row));
    const result = splitBindingChange({
      kind: "database",
      data,
      value,
      nextProps: { ...props, rows },
    });
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        { id: "task:t1", field: "project", reason: "derived" },
        { id: "kr:k1", reason: "removed" },
      ]),
    );
    expect(result.operations).toEqual([]);
  });

  it("a removed column is not a cleared value", () => {
    const data = schedule();
    const value = okr();
    const { props } = resolveBinding("database", data, value);
    const rows = (props.rows as Record<string, unknown>[]).map(
      ({ date: _date, ...row }) => row,
    );
    expect(
      splitBindingChange({
        kind: "database",
        data,
        value,
        nextProps: { ...props, rows },
      }).operations,
    ).toEqual([]);
  });

  it("a stale basis conflicts instead of overwriting a newer change", () => {
    const data = schedule();
    const basis = okr();
    const { props } = resolveBinding("database", data, basis);
    const latest = okr();
    latest.objectives[0].keyResults[0].tasks[0].due = "2026-10-29";
    const rows = (props.rows as Record<string, unknown>[]).map((row) =>
      row.id === "task:t1" ? { ...row, date: "2026-10-24" } : row,
    );
    const result = splitBindingChange({
      kind: "database",
      data,
      value: latest,
      nextProps: { ...props, rows },
      basis: { value: basis, props },
    });
    expect(
      applyOperations(latest, result.operations).conflicts[0],
    ).toMatchObject({ theirs: "2026-10-29", mine: "2026-10-24" });
  });

  it("suggests mappings from dated record lists", () => {
    const suggestions = suggestCollections(okr(), columns);
    expect(suggestions.map((item) => item.from)).toEqual([
      "objectives[*]",
      "objectives[*].keyResults[*]",
      "objectives[*].keyResults[*].tasks[*]",
    ]);
    expect(suggestions[2].fields).toMatchObject({
      date: { from: "due", empty: "remove" },
      title: "title",
      done: "done",
    });
    for (const suggestion of suggestions) {
      const { count: _count, ...collection } = suggestion;
      compileBinding({ dataset: "x", collections: [collection] });
    }
  });

  it("validates bindings with useful messages", () => {
    expect(() => compileBinding({ dataset: "okr" })).toThrow(
      /props, collections/,
    );
    expect(() =>
      compileBinding({
        dataset: "okr",
        collections: [
          { key: "t", into: "rows", from: "a[*]", fields: { x: "../y" } },
        ],
      }),
    ).toThrow(/derived/);
    expect(() =>
      compileBinding({
        dataset: "okr",
        collections: [
          { key: "t", into: "rows", from: "a[*]", derived: { x: "../y" } },
        ],
      }),
    ).toThrow(/climbs/);
  });
});

describe("props binding", () => {
  const block = () => ({
    componentId: "okr-board",
    version: "1.4.1",
    props: { ...okr(), title: "全景" },
  });

  it("shares a block and resolves it back to the same props", () => {
    const shared = shareBlock("custom", block(), "okr", ["title"]);
    expect(shared.data).toEqual({
      componentId: "okr-board",
      version: "1.4.1",
      props: { title: "全景" },
      $binding: { dataset: "okr", props: { local: ["title"] } },
    });
    expect(resolveBinding("custom", shared.data, shared.value).props).toEqual(
      block().props,
    );
    expect(snapshotBinding("custom", shared.data, shared.value)).toEqual(
      block(),
    );
  });

  it("routes a component change: shared keys to the dataset, local keys to the block", () => {
    const shared = shareBlock("custom", block(), "okr", ["title"]);
    const { props } = resolveBinding("custom", shared.data, shared.value);
    const next = structuredClone(props) as Okr & { title: string };
    next.title = "全景 2";
    next.objectives[0].keyResults[0].tasks[1].due = "2026-10-26";
    next.objectives[1].due = "2026-11-02";
    const result = splitBindingChange({
      kind: "custom",
      data: shared.data,
      value: shared.value,
      nextProps: next,
    });
    expect(result.data.props).toEqual({ title: "全景 2" });
    expect(result.operations).toEqual([
      {
        op: "set",
        path: [
          "objectives",
          { id: "o1" },
          "keyResults",
          { id: "k1" },
          "tasks",
          { id: "t2" },
          "due",
        ],
        value: "2026-10-26",
        absent: true,
      },
      {
        op: "set",
        path: ["objectives", { id: "o2" }, "due"],
        value: "2026-11-02",
        absent: true,
      },
    ]);
  });
});
