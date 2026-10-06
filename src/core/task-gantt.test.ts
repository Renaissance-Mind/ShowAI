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
      expect(validate(data)).toBeNull();
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
});
