import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import catalog from "../../../resources/catalog/components.json";
import { DatabaseBlock } from "./Database";
import { pruneCalendarConfig, resolveCalendar } from "./DatabaseCalendar";
import {
  calendarEntries,
  entriesByDay,
  formatDay,
  heatmapSummary,
  normalizeDate,
  parseDay,
  parseTime,
  startOfWeek,
  timeLanes,
  validateDatabaseData,
} from "./database-contract.mjs";
import type { DatabaseColumn } from "./types";

const day = (iso: string) => parseDay(iso)!;
const weekPlan = (): any => ({
  title: "本周安排",
  view: "calendar",
  columns: [
    { id: "title", name: "安排", type: "text" },
    { id: "date", name: "日期", type: "date" },
    { id: "start", name: "开始", type: "text" },
    { id: "end", name: "结束", type: "text" },
    {
      id: "category",
      name: "类别",
      type: "select",
      options: ["工作", "运动"],
    },
    { id: "done", name: "已完成", type: "checkbox" },
  ],
  rows: [
    {
      id: "a",
      title: "周会",
      date: "2026-10-12",
      start: "9:00",
      end: "12:00",
      category: "工作",
      done: true,
    },
    {
      id: "b",
      title: "慢跑",
      date: "2026-10-12",
      start: "10:30",
      end: "11:15",
      category: "运动",
      done: false,
    },
    {
      id: "c",
      title: "出差",
      date: "2026-10-14",
      start: "",
      end: "",
      category: "工作",
      done: false,
    },
  ],
  calendar: {
    dateColumn: "date",
    startTimeColumn: "start",
    endTimeColumn: "end",
    colorColumn: "category",
    doneColumn: "done",
    mode: "week",
    initialDate: "2026-10-12",
  },
});
const render = (data: unknown, readOnly = true) =>
  renderToStaticMarkup(
    createElement(DatabaseBlock, {
      data: data as any,
      readOnly,
      onChange: () => {},
    }),
  );

describe("database contract", () => {
  it("keeps existing data valid and accepts calendar settings", () => {
    for (const example of catalog.find((item) => item.kind === "database")!
      .examples)
      expect(() => validateDatabaseData(example.data)).not.toThrow();
    expect(() => validateDatabaseData({ columns: [], rows: [] })).not.toThrow();
    expect(() => validateDatabaseData(weekPlan())).not.toThrow();
  });

  it("rejects bad dates, mistyped references and unusable views with a field path", () => {
    const badDate = weekPlan();
    badDate.rows[0].date = "10-12";
    expect(() => validateDatabaseData(badDate)).toThrow(/rows\[0\]\.date/);
    const impossible = weekPlan();
    impossible.rows[1].date = "2026-02-30";
    expect(() => validateDatabaseData(impossible)).toThrow(/rows\[1\]\.date/);
    const wrongType = weekPlan();
    wrongType.calendar.colorColumn = "title";
    expect(() => validateDatabaseData(wrongType)).toThrow(
      /calendar\.colorColumn must refer to a select column/,
    );
    const missing = weekPlan();
    missing.calendar.doneColumn = "absent";
    expect(() => validateDatabaseData(missing)).toThrow(
      /missing column absent/,
    );
    const noDate = weekPlan();
    noDate.columns = noDate.columns.filter(
      (column: DatabaseColumn) => column.type !== "date",
    );
    delete noDate.calendar;
    expect(() => validateDatabaseData(noDate)).toThrow(
      /requires a date column/,
    );
    const weeks = weekPlan();
    weeks.calendar.weeks = 60;
    expect(() => validateDatabaseData(weeks)).toThrow(/calendar\.weeks/);
    const unknown = weekPlan();
    unknown.calendar.color = "#fff";
    expect(() => validateDatabaseData(unknown)).toThrow(/calendar\.color/);
    const duplicate = weekPlan();
    duplicate.rows.push({ ...duplicate.rows[0] });
    expect(() => validateDatabaseData(duplicate)).toThrow(/duplicate id a/);
    const reserved = weekPlan();
    reserved.columns[0].id = "id";
    expect(() => validateDatabaseData(reserved)).toThrow(/reserved/);
  });

  it("parses days, times and loose dates", () => {
    expect(formatDay(day("2026-10-18"))).toBe("2026-10-18");
    expect(parseDay("2026-13-01")).toBeNull();
    expect(normalizeDate("2026/1/5 09:00")).toBe("2026-01-05");
    expect(normalizeDate("10-14")).toBe("");
    expect(parseTime("9:30")).toBe(570);
    expect(parseTime("24:00")).toBe(1440);
    expect(parseTime("9:75")).toBeNull();
    // 2026-10-18 is a Sunday.
    expect(formatDay(startOfWeek(day("2026-10-18"), 1))).toBe("2026-10-12");
    expect(formatDay(startOfWeek(day("2026-10-18"), 0))).toBe("2026-10-18");
  });
});

describe("calendar entries", () => {
  it("spans end dates, ignores undated rows and collapses reversed ranges", () => {
    const rows = [
      { id: "trip", d: "2026-10-30", e: "2026-11-02" },
      { id: "reversed", d: "2026-10-31", e: "2026-10-01" },
      { id: "undated", d: "", e: "" },
    ];
    const entries = calendarEntries(rows, {
      dateColumn: "d",
      endDateColumn: "e",
    });
    expect(entries.map((entry) => entry.row.id)).toEqual(["trip", "reversed"]);
    const byDay = entriesByDay(entries, day("2026-11-01"), day("2026-11-03"));
    expect(byDay.get(day("2026-11-01"))!.map((e) => e.row.id)).toEqual([
      "trip",
    ]);
    expect(byDay.get(day("2026-11-03"))).toEqual([]);
    expect(entries[1].end).toBe(entries[1].start);
  });

  it("places overlapping timed records in separate lanes", () => {
    const entries = calendarEntries(weekPlan().rows, {
      dateColumn: "date",
      startTimeColumn: "start",
      endTimeColumn: "end",
    });
    const { placed, laneCount } = timeLanes(
      entries.filter((entry) => entry.start === day("2026-10-12")),
    );
    expect(laneCount).toBe(2);
    expect(placed.map((item) => [item.entry.row.id, item.lane])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("counts heatmap days and streaks, waiting for today before breaking a streak", () => {
    const dates = [
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-07",
    ];
    const rows = dates.map((date, index) => ({
      id: `r${index}`,
      date,
      done: index !== 0,
    }));
    const entries = calendarEntries(rows, {
      dateColumn: "date",
      doneColumn: "done",
    });
    const summary = heatmapSummary(entries, {
      endDay: day("2026-10-08"),
      today: day("2026-10-08"),
      weeks: 2,
    });
    expect(summary.cells).toHaveLength(14);
    expect(formatDay(summary.from)).toBe("2026-09-28");
    expect(summary.current).toBe(3);
    expect(summary.longest).toBe(3);
    expect(summary.activeDays).toBe(6);
    expect(summary.elapsedDays).toBe(11);
    expect(summary.max).toBe(2);
    expect(
      summary.cells.find((cell) => cell.day === day("2026-10-07"))!.level,
    ).toBe(4);
    const wide = heatmapSummary(entries, {
      endDay: day("2026-10-08"),
      today: day("2026-10-09"),
      weeks: 3,
      countDone: true,
    });
    // Oct 1 is not done, Oct 4 and Oct 8 are empty.
    expect(wide.longest).toBe(3);
    expect(wide.current).toBe(0);
  });
});

describe("database calendar view", () => {
  it("resolves defaults and prunes settings that no longer fit the columns", () => {
    const data = weekPlan();
    const resolved = resolveCalendar(data.columns, {});
    expect(resolved.dateColumn?.id).toBe("date");
    expect(resolved.colorColumn?.id).toBe("category");
    expect(resolved.doneColumn).toBeUndefined();
    expect(
      resolveCalendar(data.columns, { colorColumn: "" }).colorColumn,
    ).toBeUndefined();
    const columns = data.columns.map((column: DatabaseColumn) =>
      column.id === "start" ? { ...column, type: "number" } : column,
    );
    expect(pruneCalendarConfig(data.calendar, columns)).toEqual({
      dateColumn: "date",
      colorColumn: "category",
      doneColumn: "done",
      mode: "week",
      initialDate: "2026-10-12",
    });
  });

  it("renders a week time grid with lanes, colors, done marks and an agenda", () => {
    const html = render(weekPlan());
    expect(html).toContain("sb-dbc-weekgrid is-timed");
    expect(html.match(/class="sb-dbc-slot"/g)).toHaveLength(2);
    expect(html).toContain("周会");
    expect(html).toContain("9:00–12:00");
    expect(html).toContain("sb-dbc-chip is-done");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("sb-dbc-agenda");
    // Read-only pages never offer to add records.
    expect(html).not.toContain("sb-dbc-add");
  });

  it("renders a month grid around the initial date and offers adding when editable", () => {
    const data = weekPlan();
    data.calendar.mode = "month";
    const html = render(data, false);
    expect(html).toContain("sb-dbc-month");
    expect(html.match(/class="sb-dbc-day[ "]/g)!.length % 7).toBe(0);
    expect(html).toContain("出差");
    expect(html).toContain("sb-dbc-add");
  });

  it("renders a heatmap with streak statistics", () => {
    const data = weekPlan();
    data.calendar = { mode: "heatmap", weeks: 4, initialDate: "2026-10-12" };
    const html = render(data);
    expect(html.match(/<button[^>]*sb-dbc-heat-cell/g)).toHaveLength(28);
    expect(html).toContain("sb-dbc-stats");
  });

  it("explains a missing date column and keeps old data in the table view", () => {
    const old = catalog.find((item) => item.kind === "database")!.examples[0]
      .data;
    const table = render(old);
    expect(table).toContain("sb-database-table");
    expect(table).not.toContain("sb-dbc");
    expect(render({ ...old, view: "calendar" })).toContain("sb-empty");
  });
});
