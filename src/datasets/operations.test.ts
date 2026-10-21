import { describe, expect, it } from "vitest";
import {
  applyOperations,
  diffValues,
  formatPath,
  parsePath,
  refineOperations,
  validateOperations,
  valueAt,
} from "./operations.mjs";

type Task = { id: string; title: string; due?: string; done?: boolean };
type Plan = {
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
const plan = (): Plan => ({
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
      keyResults: [
        {
          id: "k1",
          title: "文档",
          status: "todo",
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

describe("dataset paths", () => {
  it("formats and parses id, index and key segments", () => {
    const path = [
      "objectives",
      { id: "o1" },
      "keyResults",
      0,
      "tasks",
      { id: "t1" },
      "due",
    ];
    const text = formatPath(path);
    expect(text).toBe("objectives[id=o1].keyResults[0].tasks[id=t1].due");
    expect(parsePath(text)).toEqual(path);
    expect(valueAt(plan(), path)).toBe("2026-10-22");
    expect(() => parsePath(["__proto__"])).toThrow(/reserved/);
  });
});

describe("dataset diff and apply", () => {
  it("diffs records by id and reproduces the target", () => {
    const base = plan();
    const next = plan();
    next.objectives[0].keyResults[0].tasks[1].done = true;
    next.objectives[0].keyResults[0].tasks.unshift({
      id: "t0",
      title: "新事项",
    });
    next.objectives.reverse();
    delete next.split;
    const operations = diffValues(base, next);
    expect(operations.some((op) => op.op === "insert")).toBe(true);
    expect(operations.some((op) => op.op === "move")).toBe(true);
    const result = applyOperations(base, operations);
    expect(result.conflicts).toEqual([]);
    expect(result.value).toEqual(next);
  });

  it("merges writes to different records and fields", () => {
    const base = plan();
    const mine = plan();
    mine.objectives[0].keyResults[0].tasks[0].due = "2026-10-25";
    const theirs = plan();
    theirs.objectives[0].keyResults[0].tasks[1].done = true;
    theirs.objectives[1].title = "出行";
    const result = applyOperations(theirs, diffValues(base, mine));
    expect(result.conflicts).toEqual([]);
    const merged = result.value as Plan;
    expect(merged.objectives[0].keyResults[0].tasks[0].due).toBe("2026-10-25");
    expect(merged.objectives[0].keyResults[0].tasks[1].done).toBe(true);
    expect(merged.objectives[1].title).toBe("出行");
  });

  it("reports a conflict when the same field changed differently and applies nothing", () => {
    const base = plan();
    const mine = plan();
    mine.objectives[0].keyResults[0].tasks[0].due = "2026-10-25";
    mine.objectives[1].title = "出行";
    const theirs = plan();
    theirs.objectives[0].keyResults[0].tasks[0].due = "2026-10-30";
    const result = applyOperations(theirs, diffValues(base, mine));
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        reason: "changed",
        base: "2026-10-22",
        mine: "2026-10-25",
        theirs: "2026-10-30",
      }),
    ]);
    expect(result.value).toEqual(theirs);
    const partial = applyOperations(theirs, diffValues(base, mine), {
      atomic: false,
    });
    expect((partial.value as Plan).objectives[1].title).toBe("出行");
  });

  it("treats identical concurrent writes as merged", () => {
    const base = plan();
    const mine = plan();
    mine.objectives[1].title = "出行";
    expect(applyOperations(mine, diffValues(base, mine)).conflicts).toEqual([]);
  });

  it("does not silently drop an edit to a record removed elsewhere", () => {
    const base = plan();
    const mine = plan();
    mine.objectives[0].keyResults[0].tasks[0].title = "改名";
    const theirs = plan();
    theirs.objectives[0].keyResults[0].tasks.splice(0, 1);
    expect(
      applyOperations(theirs, diffValues(base, mine)).conflicts[0].reason,
    ).toBe("missing");
    // And removing a record someone edited is a conflict too.
    const removal = applyOperations(mine, diffValues(base, theirs));
    expect(removal.conflicts[0]).toMatchObject({
      op: "remove",
      reason: "changed",
    });
  });

  it("replaces arrays without ids as one value", () => {
    const base = { tags: ["a", "b"], x: 1 };
    const operations = diffValues(base, { tags: ["a", "c"], x: 1 });
    expect(operations).toEqual([
      { op: "set", path: ["tags"], value: ["a", "c"], before: ["a", "b"] },
    ]);
    const theirs = { tags: ["a", "b", "d"], x: 1 };
    expect(applyOperations(theirs, operations).conflicts).toHaveLength(1);
  });

  it("refines a coarse Agent write against its read baseline", () => {
    const base = plan();
    const theirs = plan();
    theirs.objectives[0].keyResults[0].tasks[1].done = true;
    const wanted = plan().objectives;
    wanted[1].title = "出行";
    const coarse = validateOperations([
      { op: "set", path: "objectives", value: wanted },
    ]);
    const result = applyOperations(theirs, refineOperations(coarse, base));
    expect(result.conflicts).toEqual([]);
    const merged = result.value as Plan;
    expect(merged.objectives[1].title).toBe("出行");
    expect(merged.objectives[0].keyResults[0].tasks[1].done).toBe(true);
  });

  it("validates operation shapes", () => {
    expect(() => validateOperations([{ op: "drop", path: [] }])).toThrow(
      /op must/,
    );
    expect(() => validateOperations([{ op: "set", path: ["a"] }])).toThrow(
      /value/,
    );
    expect(() =>
      validateOperations([{ op: "move", path: ["a", 0], after: null }]),
    ).toThrow(/record selector/);
  });
});
