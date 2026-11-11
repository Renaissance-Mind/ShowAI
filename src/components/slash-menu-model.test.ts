import { describe, expect, test } from "vitest";
import {
  RECENT_LIMIT,
  isChartKind,
  readRecentSlashItems,
  rememberSlashItem,
  slashMenuRows,
  type SlashEntry,
} from "./slash-menu-model";

const entry = (
  id: string,
  group: string,
  extra: Partial<SlashEntry> = {},
): SlashEntry => ({ id, title: id, keywords: "", group, ...extra });

const items: SlashEntry[] = [
  entry("text", "basic"),
  entry("heading-1", "basic", { keywords: "heading" }),
  entry("heading-4", "basic", { keywords: "heading", hidden: true }),
  entry("table", "rich"),
  entry("catalog:chart", "components", { chart: true }),
  entry("catalog:timeline", "components"),
  entry("catalog:g2-bar", "components", { chart: true, keywords: "bar" }),
];
const labels = { recent: "Recent", charts: "Charts" };
const keys = (rows: ReturnType<typeof slashMenuRows>) =>
  rows.map((row) => row.key);

describe("slashMenuRows", () => {
  test("the first level hides typed-only items and folds charts into one entry", () => {
    const rows = slashMenuRows(items, {
      query: "",
      level: "root",
      recent: [],
      labels,
    });
    expect(keys(rows)).toEqual([
      "text",
      "heading-1",
      "table",
      "charts",
      "catalog:timeline",
    ]);
    expect(rows[3]).toMatchObject({ type: "charts", group: "components" });
  });

  test("recent items lead the first level in their own group", () => {
    const rows = slashMenuRows(items, {
      query: "",
      level: "root",
      recent: ["catalog:g2-bar", "removed", "heading-4"],
      labels,
    });
    expect(keys(rows).slice(0, 3)).toEqual([
      "recent:catalog:g2-bar",
      "recent:heading-4",
      "text",
    ]);
    expect(rows[0].group).toBe("Recent");
  });

  test("the chart level lists every chart type", () => {
    const rows = slashMenuRows(items, {
      query: "",
      level: "charts",
      recent: ["text"],
      labels,
    });
    expect(keys(rows)).toEqual(["catalog:chart", "catalog:g2-bar"]);
    expect(rows.every((row) => row.group === "Charts")).toBe(true);
  });

  test("a query searches everything, from either level", () => {
    for (const level of ["root", "charts"] as const) {
      expect(
        keys(
          slashMenuRows(items, { query: "Heading", level, recent: [], labels }),
        ),
      ).toEqual(["heading-1", "heading-4"]);
      expect(
        keys(slashMenuRows(items, { query: " bar", level, recent: [], labels })),
      ).toEqual(["catalog:g2-bar"]);
    }
  });
});

describe("recent slash items", () => {
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as Storage;
  };

  test("most recent first, without repeats, up to the limit", () => {
    const store = storage();
    expect(readRecentSlashItems(store)).toEqual([]);
    for (const id of ["a", "b", "c", "a", "d", "e", "f", "g"])
      rememberSlashItem(store, id);
    expect(readRecentSlashItems(store)).toEqual(["g", "f", "e", "d", "a"]);
    expect(readRecentSlashItems(store)).toHaveLength(RECENT_LIMIT);
  });
});

test("chart kinds are the generic chart and G2 chart types", () => {
  expect(isChartKind("chart")).toBe(true);
  expect(isChartKind("g2-line")).toBe(true);
  expect(isChartKind("metrics")).toBe(false);
});
