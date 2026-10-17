import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoadmapBlock } from "./Roadmap";
import { WaterfallBlock } from "./Waterfall";
import {
  dayNumber,
  itemLinks,
  ownerWorkload,
  roadmapWindow,
  validatePlanData,
  waterfallBridge,
  waterfallMismatches,
} from "./plan-contract.mjs";

const roadmap = (): any => ({
  title: "发布计划",
  start: "2026-11-02",
  end: "2026-11-15",
  today: "2026-11-04",
  deadline: { date: "2026-11-13", label: "上线" },
  owners: [
    { id: "a", label: "Ann", color: "#3b74b8" },
    { id: "b", label: "Ben" },
  ],
  lanes: [
    { id: "build", label: "开发" },
    { id: "launch", label: "发布" },
  ],
  items: [
    {
      id: "design",
      lane: "build",
      owner: "a",
      title: "方案设计",
      start: "2026-11-02",
      end: "2026-11-04",
      status: "done",
    },
    {
      id: "impl",
      lane: "build",
      owner: "b",
      title: "实现与测试",
      start: "2026-11-05",
      end: "2026-11-11",
      status: "active",
      progress: 0.5,
      depends: ["design"],
      doneWhen: "全部测试通过。",
    },
    {
      id: "release",
      lane: "launch",
      title: "发布与公告",
      start: "2026-11-12",
      end: "2026-11-13",
      status: "blocked",
      depends: ["impl"],
    },
  ],
  milestones: [{ date: "2026-11-13", label: "1.0" }],
});

const waterfall = (): any => ({
  title: "加载时间",
  upIsGood: false,
  format: { suffix: " s", divisor: 1000, decimals: 1 },
  steps: [
    { id: "before", label: "优化前", kind: "total", value: 3500 },
    {
      id: "images",
      label: "图片",
      kind: "down",
      value: 1400,
      breakdown: {
        title: "按类型",
        items: [
          { label: "横幅", value: 1000 },
          { label: "缩略图", value: 400 },
        ],
      },
    },
    { id: "widget", label: "推荐模块", kind: "up", value: 400 },
    { id: "after", label: "优化后", kind: "total", value: 2500 },
  ],
});

describe("roadmap contract", () => {
  it("accepts a plan and reads only real calendar dates", () => {
    expect(() => validatePlanData("roadmap", roadmap())).not.toThrow();
    expect(dayNumber("2026-02-29")).toBeNaN();
    expect(dayNumber("2026-1-05")).toBeNaN();
    expect(dayNumber("2026-11-03") - dayNumber("2026-11-02")).toBe(1);
  });
  it("names the field when dates are malformed or reversed", () => {
    const bad = roadmap();
    bad.items[1].start = "2026/11/05";
    expect(() => validatePlanData("roadmap", bad)).toThrow(/items\[1\]\.start/);
    const reversed = roadmap();
    reversed.items[0].end = "2026-11-01";
    expect(() => validatePlanData("roadmap", reversed)).toThrow(
      /items\[0\]\.end must be on or after/,
    );
    const window = roadmap();
    window.end = "2026-11-10";
    expect(() => validatePlanData("roadmap", window)).toThrow(
      /items\[1\]\.end 2026-11-11 is outside/,
    );
  });
  it("rejects unknown references, duplicate ids and dependency cycles", () => {
    const lane = roadmap();
    lane.items[0].lane = "absent";
    expect(() => validatePlanData("roadmap", lane)).toThrow(/items\[0\]\.lane/);
    const owner = roadmap();
    owner.items[0].owner = "absent";
    expect(() => validatePlanData("roadmap", owner)).toThrow(
      /items\[0\]\.owner/,
    );
    const depends = roadmap();
    depends.items[1].depends = ["absent"];
    expect(() => validatePlanData("roadmap", depends)).toThrow(
      /items\[1\]\.depends\[0\]/,
    );
    const duplicate = roadmap();
    duplicate.items[2].id = "design";
    expect(() => validatePlanData("roadmap", duplicate)).toThrow(
      /duplicate id design/,
    );
    const cycle = roadmap();
    cycle.items[0].depends = ["release"];
    expect(() => validatePlanData("roadmap", cycle)).toThrow(
      /cycle: design → release → impl → design/,
    );
    const status = roadmap();
    status.items[0].status = "late";
    expect(() => validatePlanData("roadmap", status)).toThrow(/status late/);
  });
  it("derives the window, workload and links", () => {
    const data = roadmap();
    delete data.start;
    delete data.end;
    expect(roadmapWindow(data)).toEqual({
      start: dayNumber("2026-11-02"),
      end: dayNumber("2026-11-13"),
    });
    expect(ownerWorkload(data)).toEqual({
      a: { scheduled: 3, open: 0, items: 1 },
      b: { scheduled: 7, open: 3.5, items: 1 },
      "": { scheduled: 2, open: 2, items: 1 },
    });
    expect(itemLinks(data, "impl")).toEqual({
      depends: ["design"],
      unblocks: ["release"],
    });
  });
  it("renders every task, the today and deadline lines and the selected detail", () => {
    const data = roadmap();
    data.initialItem = "impl";
    const html = renderToStaticMarkup(
      createElement(RoadmapBlock, { data, readOnly: true }),
    );
    for (const item of data.items) expect(html).toContain(item.title);
    expect(html).toContain("rm-today");
    expect(html).toContain("上线");
    expect(html).toContain("全部测试通过。");
    // The selected task's neighbours are outlined.
    expect(html.match(/is-related/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("rm-tone-blocked");
  });
});

describe("waterfall contract", () => {
  it("accepts a bridge and computes running levels", () => {
    expect(() => validatePlanData("waterfall", waterfall())).not.toThrow();
    const { spans, end, mismatches } = waterfallBridge(waterfall().steps);
    expect(spans).toEqual([
      [0, 3500],
      [2100, 3500],
      [2100, 2500],
      [0, 2500],
    ]);
    expect(end).toBe(2500);
    expect(mismatches).toEqual([]);
  });
  it("reports totals that the steps do not reach, within display precision", () => {
    const data = waterfall();
    data.steps[3].value = 2540;
    expect(waterfallMismatches(data)).toEqual([]);
    data.steps[3].value = 2600;
    expect(waterfallMismatches(data)).toEqual([
      { id: "after", stated: 2600, computed: 2500 },
    ]);
  });
  it("names the field for invalid steps, formats and floors", () => {
    const negative = waterfall();
    negative.steps[1].value = -1400;
    expect(() => validatePlanData("waterfall", negative)).toThrow(
      /steps\[1\]\.value must be a positive magnitude/,
    );
    const kind = waterfall();
    kind.steps[2].kind = "flat";
    expect(() => validatePlanData("waterfall", kind)).toThrow(
      /steps\[2\]\.kind/,
    );
    const divisor = waterfall();
    divisor.format.divisor = 0;
    expect(() => validatePlanData("waterfall", divisor)).toThrow(
      /format\.divisor/,
    );
    const floor = waterfall();
    floor.axisFloor = 2200;
    expect(() => validatePlanData("waterfall", floor)).toThrow(
      /axisFloor 2200 cuts steps\[1\]/,
    );
    floor.axisFloor = 2000;
    expect(() => validatePlanData("waterfall", floor)).not.toThrow();
    const initial = waterfall();
    initial.initialStep = "absent";
    expect(() => validatePlanData("waterfall", initial)).toThrow(/initialStep/);
    expect(() => validatePlanData("gantt", {})).toThrow(/Unknown plan/);
  });
  it("renders signed values, shares and the mismatch warning", () => {
    const data = waterfall();
    data.initialStep = "images";
    data.steps[3].value = 2600;
    const html = renderToStaticMarkup(
      createElement(WaterfallBlock, { data, readOnly: true }),
    );
    expect(html).toContain("−1.4 s");
    expect(html).toContain("+0.4 s");
    expect(html).toContain("71%");
    expect(html).toContain("wf-warn");
    // With upIsGood false, a decrease uses the favourable tone.
    expect(html).toMatch(/wf-bar wf-tone-good is-active/);
  });
});
