import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import {
  day,
  date,
  shift,
  removeTask,
  validate,
  conflicts,
  status,
  summarize,
  outline,
  shiftBranch,
  type GanttData,
  type Task,
} from "../../resources/catalog/task-gantt/model";
import manifest from "../../resources/catalog/task-gantt/manifest.json";
import schema from "../../resources/catalog/task-gantt/props.schema.json";

const a: Task = {
  id: "a",
  title: "任务 A",
  start: "2026-10-05",
  end: "2026-10-07",
  progress: 0,
};
const b: Task = {
  ...a,
  id: "b",
  title: "任务 B",
  start: "2026-10-08",
  end: "2026-10-10",
  dependencies: ["a"],
};
const project = (tasks = [a, b]): GanttData => ({ title: "项目", tasks });
describe("task gantt data and scheduling", () => {
  it("validates all package examples and defaults against the data contract", () => {
    const check = new Ajv().compile(schema);
    for (const data of [
      manifest.defaultData,
      ...manifest.examples.map((item) => item.data),
    ]) {
      expect(check(data), JSON.stringify(check.errors)).toBe(true);
      expect(validate(data as GanttData)).toBeNull();
    }
  });
  it("rejects calendar overflow and calculates inclusive schedules without timezone drift", () => {
    expect(day("2026-02-29")).toBeNaN();
    expect(date(day("2024-02-29") + 1)).toBe("2024-03-01");
    expect(day("2026-10-07") - day("2026-10-05") + 1).toBe(3);
    expect(validate(project([{ ...a, end: "2026-02-30" }]))).toContain("有效");
  });
  it("moves whole schedules and clamps resizing at the opposite edge", () => {
    expect(shift(a, 4, "move")).toMatchObject({
      start: "2026-10-09",
      end: "2026-10-11",
    });
    expect(shift(a, 10, "start").start).toBe(a.end);
    expect(shift(a, -10, "end").end).toBe(a.start);
    expect(
      shift({ ...a, end: a.start, milestone: true }, 2, "end"),
    ).toMatchObject({ start: "2026-10-07", end: "2026-10-07" });
  });
  it("rejects duplicate ids, missing dependencies, cycles and invalid milestones", () => {
    expect(validate(project([a, a]))).toContain("唯一");
    expect(validate(project([b]))).toContain("不存在");
    expect(validate(project([{ ...a, dependencies: ["b"] }, b]))).toContain(
      "循环",
    );
    expect(validate(project([{ ...a, dependencies: ["a"] }]))).toContain(
      "循环",
    );
    expect(validate(project([{ ...a, milestone: true }]))).toContain("相同");
  });
  it("removes every reference to a deleted task without mutating source", () => {
    const data = project();
    expect(removeTask(data, "a").tasks).toEqual([{ ...b, dependencies: [] }]);
    expect(data.tasks).toEqual([a, b]);
  });
  it("flags same-day predecessor overlap and distinguishes overdue from complete", () => {
    expect(conflicts({ ...b, start: a.end }, [a, b])).toEqual([a]);
    expect(conflicts(b, [a, b])).toEqual([]);
    expect(status(a, "2026-10-08")).toBe("已逾期");
    expect(status({ ...a, progress: 100 }, "2026-10-08")).toBe("已完成");
  });
  it("rejects parent cycles, orphan tasks, and children of milestones", () => {
    expect(validate(project([{ ...a, parentId: "missing" }]))).toContain(
      "父任务不存在",
    );
    expect(
      validate(
        project([
          { ...a, parentId: "b" },
          { ...b, parentId: "a" },
        ]),
      ),
    ).toContain("嵌套不能形成循环");
    expect(validate(project([{ ...a, parentId: "a" }]))).toContain(
      "嵌套不能形成循环",
    );
    expect(
      validate(
        project([
          { ...a, end: a.start, milestone: true },
          { ...b, parentId: "a" },
        ]),
      ),
    ).toContain("里程碑不能");
  });
  it("shows depth-first nesting, folds branches, and retains filtered ancestors", () => {
    const tasks = [
      a,
      { ...b, parentId: "a" },
      { ...b, id: "c", title: "孙任务", parentId: "b" },
    ];
    expect(
      outline(tasks, new Set()).map((row) => [row.task.id, row.depth]),
    ).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    expect(outline(tasks, new Set(["a"])).map((row) => row.task.id)).toEqual([
      "a",
    ]);
    expect(
      outline(tasks, new Set(["a"]), (task) => task.id === "c").map(
        (row) => row.task.id,
      ),
    ).toEqual(["a", "b", "c"]);
  });
  it("summarizes each leaf once and moves a nested branch as a unit", () => {
    const tasks = [
      a,
      { ...b, parentId: "a", progress: 100 },
      { ...b, id: "c", parentId: "a" },
      {
        ...b,
        id: "d",
        parentId: "c",
        progress: 50,
        start: "2026-10-12",
        end: "2026-10-15",
      },
    ];
    expect(summarize(tasks)[0]).toMatchObject({
      start: "2026-10-08",
      end: "2026-10-15",
      progress: 75,
    });
    expect(
      shiftBranch(tasks, "c", 2, "move").find((task) => task.id === "d"),
    ).toMatchObject({ start: "2026-10-14", end: "2026-10-17" });
    expect(
      shiftBranch(tasks, "c", 2, "move").find((task) => task.id === "b"),
    ).toEqual(tasks[1]);
    expect(shiftBranch(tasks, "a", 3, "end")).toEqual(tasks);
  });
  it("promotes children when removing a parent while keeping deeper branches", () => {
    const tasks = [
      a,
      { ...b, parentId: "a" },
      { ...b, id: "c", parentId: "b" },
    ];
    expect(removeTask(project(tasks), "b").tasks).toEqual([
      { ...a, dependencies: [] },
      { ...tasks[2], parentId: "a", dependencies: ["a"] },
    ]);
    expect(removeTask(project(tasks), "a").tasks).toEqual([
      { ...b, dependencies: [] },
      { ...tasks[2], dependencies: [] },
    ]);
  });
  it("validates configurable columns and preserves their order", () => {
    expect(
      validate({ ...project(), columns: ["title", "progress", "owner"] }),
    ).toBeNull();
    expect(validate({ ...project(), columns: ["owner", "title"] })).toContain(
      "显示列",
    );
    expect(
      validate({ ...project(), columns: ["title", "owner", "owner"] }),
    ).toContain("显示列");
  });
});
