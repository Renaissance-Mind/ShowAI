import { describe, expect, it } from "vitest";
import type { PageSummary } from "../core/model";
import {
  validateProjectDatabaseData,
  type ProjectDatabaseData,
} from "../core/project-database";
import { applyOperations } from "../datasets/operations.mjs";
import {
  TITLE_PROPERTY,
  databaseColumnWidth,
  databaseColumnWidthOperations,
  databaseCellOperations,
  databaseAddViewOperations,
  databaseBoardGroups,
  databaseDeleteViewOperations,
  databaseMoveColumnOperations,
  databaseRemoveColumnOperations,
  databaseTypeOperations,
  databaseViewRows,
  databaseViews,
  databaseViewSelectionKey,
  databaseViewSettingOperations,
} from "./project-database-view";

const page = (id: string, title: string, archived = false): PageSummary => ({
  id,
  title,
  archived,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  icon: "",
  hash: "revision",
  blockCount: 0,
  parentId: null,
  favorite: false,
});

describe("saved database views", () => {
  it("upgrades an older database on its first view setting edit and preserves every document property", () => {
    const initial = data();
    const defaults = databaseViews(initial);
    expect(defaults.map((view) => view.type)).toEqual([
      "table",
      "board",
      "list",
    ]);
    expect(initial.views).toBeUndefined();
    const result = applyOperations(
      initial,
      databaseViewSettingOperations(
        initial,
        defaults[0].id,
        "filter",
        { column: "status", value: "待开始" },
        undefined,
      ),
    );
    const changed = validateProjectDatabaseData(result.value);
    expect(result.conflicts).toEqual([]);
    expect(changed.rows).toEqual(initial.rows);
    expect(changed.columns).toEqual(initial.columns);
    expect(changed.views?.[0].filter).toEqual({
      column: "status",
      value: "待开始",
    });
    expect(changed.views?.[1].filter).toBeUndefined();
    expect(changed.views?.[2].filter).toBeUndefined();
  });

  it("saves each view's filters, sorting, and grouping independently without replacing concurrent names or sibling settings", () => {
    const initial = { ...data(), views: databaseViews(data()) };
    const table = initial.views[0],
      board = initial.views[1];
    const local = databaseViewSettingOperations(
      initial,
      table.id,
      "filter",
      { column: "status", value: "已完成" },
      undefined,
    );
    const remote = structuredClone(initial);
    remote.views[0].name = "其他位置重命名的视图";
    remote.views[1].sort = { column: "score", direction: "desc" };
    const merged = validateProjectDatabaseData(
      applyOperations(remote, local).value,
    );
    expect(merged.views?.[0].name).toBe("其他位置重命名的视图");
    expect(merged.views?.[0].filter?.value).toBe("已完成");
    expect(merged.views?.[1].sort).toEqual({
      column: "score",
      direction: "desc",
    });
    const regrouped = validateProjectDatabaseData(
      applyOperations(
        merged,
        databaseViewSettingOperations(
          merged,
          board.id,
          "groupBy",
          "status",
          merged.views?.[1].groupBy,
        ),
      ).value,
    );
    expect(regrouped.views?.[0]).toEqual(merged.views?.[0]);
    expect(regrouped.views?.[1].groupBy).toBe("status");
  });

  it("clears a saved filter by removing it, preserves sorting, and holds conflicting changes to that same filter", () => {
    const initial = { ...data(), views: databaseViews(data()) };
    initial.views[0].filter = { column: "status", value: "待开始" };
    initial.views[0].sort = { column: "score", direction: "asc" };
    const edits = databaseViewSettingOperations(
      initial,
      initial.views[0].id,
      "filter",
      undefined,
      initial.views[0].filter,
    );
    const cleared = validateProjectDatabaseData(
      applyOperations(initial, edits).value,
    );
    expect(cleared.views?.[0].filter).toBeUndefined();
    expect(cleared.views?.[0].sort).toEqual(initial.views[0].sort);
    const remote = structuredClone(initial);
    remote.views[0].filter = { column: "status", value: "已完成" };
    const conflict = applyOperations(remote, edits, { atomic: false });
    expect(conflict.conflicts).toMatchObject([
      {
        path: ["views", { id: initial.views[0].id }, "filter"],
        reason: "changed",
      },
    ]);
    expect(
      (conflict.value as ProjectDatabaseData).views?.[0].filter?.value,
    ).toBe("已完成");
  });

  it("groups sorted documents once, including new documents, empty configured groups, and existing custom select values", () => {
    const initial = data();
    initial.rows.push({ id: "custom", status: "审核中", score: 8 });
    initial.columns[0].options = ["待开始", "已完成", "未使用"];
    const pages = [
      page("one", "待办"),
      page("two", "完成"),
      page("new-page", "新文档"),
      page("custom", "审核"),
    ];
    const rows = databaseViewRows(
      pages,
      initial,
      [],
      { column: "", value: "" },
      { column: "score", direction: "desc" },
      "zh-CN",
    );
    const board = databaseBoardGroups(rows, initial.columns, "status");
    expect(board.groups.map((group) => group.value)).toEqual([
      "待开始",
      "已完成",
      "未使用",
      "审核中",
      "",
    ]);
    expect(
      board.groups.find((group) => group.value === "未使用")?.rows,
    ).toEqual([]);
    expect(board.groups.at(-1)?.rows[0].page.id).toBe("new-page");
    expect(
      board.groups
        .flatMap((group) => group.rows.map((row) => row.page.id))
        .sort(),
    ).toEqual(pages.map((item) => item.id).sort());
    expect(
      databaseBoardGroups(rows, initial.columns, "removed-property").column?.id,
    ).toBe("status");
    const fallback = databaseBoardGroups(rows, [], "status");
    expect(fallback.column).toBeUndefined();
    expect(fallback.groups[0].rows).toEqual(rows);
  });

  it("adds and deletes views without changing documents, and refuses to remove the final view", () => {
    const initial = data();
    const extra = { id: "my-list", name: "我的列表", type: "list" as const };
    const added = validateProjectDatabaseData(
      applyOperations(initial, databaseAddViewOperations(initial, extra)).value,
    );
    expect(added.views?.length).toBe(4);
    const removed = validateProjectDatabaseData(
      applyOperations(added, databaseDeleteViewOperations(added, extra)).value,
    );
    expect(removed.rows).toEqual(initial.rows);
    expect(removed.columns).toEqual(initial.columns);
    expect(removed.views?.length).toBe(3);
    const last = { ...initial, views: [extra] };
    expect(databaseDeleteViewOperations(last, extra)).toEqual([]);
  });

  it("scopes personal view selection by library, project, and dataset", () => {
    const keys = new Set([
      databaseViewSelectionKey("/library-one", "p", "d"),
      databaseViewSelectionKey("/library-two", "p", "d"),
      databaseViewSelectionKey("/library-one", "another-project", "d"),
      databaseViewSelectionKey("/library-one", "p", "another-dataset"),
    ]);
    expect(keys.size).toBe(4);
  });
});
const data = (): ProjectDatabaseData => ({
  columns: [
    {
      id: "status",
      name: "状态",
      type: "select",
      options: ["待开始", "已完成"],
    },
    { id: "score", name: "评分", type: "number" },
  ],
  rows: [
    { id: "one", status: "待开始", score: 0 },
    { id: "two", status: "已完成", score: -3 },
    { id: "orphan", status: "已完成", score: 100 },
  ],
});

describe("table column widths", () => {
  it("uses title/property defaults and initializes older table settings without altering records", () => {
    const initial = data();
    const view = databaseViews(initial)[0];
    expect(databaseColumnWidth(view, TITLE_PROPERTY)).toBe(280);
    expect(databaseColumnWidth(view, "status")).toBe(165);
    const result = applyOperations(
      initial,
      databaseColumnWidthOperations(
        initial,
        view.id,
        TITLE_PROPERTY,
        420,
        undefined,
      ),
    );
    const saved = validateProjectDatabaseData(result.value);
    expect(result.conflicts).toEqual([]);
    expect(databaseColumnWidth(saved.views![0], TITLE_PROPERTY)).toBe(420);
    expect(saved.columns).toEqual(initial.columns);
    expect(saved.rows).toEqual(initial.rows);
    expect(saved.views?.slice(1)).toEqual(databaseViews(initial).slice(1));

    const legacy = {
      ...data(),
      views: [
        {
          id: "old",
          name: "旧表格",
          type: "table" as const,
          sort: { column: "score", direction: "desc" as const },
        },
      ],
    };
    const upgraded = applyOperations(
      legacy,
      databaseColumnWidthOperations(legacy, "old", "status", 230, undefined),
    );
    expect(upgraded.conflicts).toEqual([]);
    expect(validateProjectDatabaseData(upgraded.value).views?.[0]).toEqual({
      ...legacy.views[0],
      columnWidths: { status: 230 },
    });
  });

  it("merges independent columns by identity and preserves other table views and settings", () => {
    const initial = {
      ...data(),
      views: [
        ...databaseViews(data()),
        {
          id: "second",
          name: "另一表格",
          type: "table" as const,
          columnWidths: { status: 500 },
        },
      ],
    };
    const local = databaseColumnWidthOperations(
      initial,
      "table",
      "status",
      240,
      undefined,
    );
    const remote = validateProjectDatabaseData(
      applyOperations(
        initial,
        databaseColumnWidthOperations(
          initial,
          "table",
          "score",
          320,
          undefined,
        ),
      ).value,
    );
    remote.views![0].name = "另一处改名";
    const result = applyOperations(remote, local);
    const saved = validateProjectDatabaseData(result.value);
    expect(result.conflicts).toEqual([]);
    expect(saved.views?.[0]).toEqual({
      id: "table",
      name: "另一处改名",
      type: "table",
      columnWidths: { status: 240, score: 320 },
    });
    expect(saved.views?.slice(1)).toEqual(initial.views.slice(1));
  });

  it("checks the value captured at drag start even when the latest view has already changed", () => {
    const initial = { ...data(), views: databaseViews(data()) };
    initial.views[0].columnWidths = { status: 220 };
    const remote = structuredClone(initial);
    remote.views[0].columnWidths = { status: 300, score: 400 };
    const edits = databaseColumnWidthOperations(
      remote,
      "table",
      "status",
      260,
      220,
    );
    const result = applyOperations(remote, edits);
    expect(result.conflicts).toMatchObject([
      {
        path: ["views", { id: "table" }, "columnWidths", "status"],
        reason: "changed",
        base: 220,
        theirs: 300,
        mine: 260,
      },
    ]);
    expect(result.value).toEqual(remote);

    const firstWrites = databaseColumnWidthOperations(
      remote,
      "table",
      "score",
      450,
      undefined,
    );
    expect(applyOperations(remote, firstWrites).conflicts).toMatchObject([
      {
        path: ["views", { id: "table" }, "columnWidths", "score"],
        reason: "changed",
      },
    ]);
  });

  it("retains each width after property reordering and restores one default without changing siblings", () => {
    const initial = { ...data(), views: databaseViews(data()) };
    initial.views[0].columnWidths = {
      [TITLE_PROPERTY]: 430,
      status: 220,
      score: 300,
    };
    const moved = validateProjectDatabaseData(
      applyOperations(
        initial,
        databaseMoveColumnOperations(initial, "score", "status", "before"),
      ).value,
    );
    expect(
      moved.columns.map((column) => [
        column.id,
        databaseColumnWidth(moved.views![0], column.id),
      ]),
    ).toEqual([
      ["score", 300],
      ["status", 220],
    ]);
    const reset = validateProjectDatabaseData(
      applyOperations(
        moved,
        databaseColumnWidthOperations(
          moved,
          "table",
          TITLE_PROPERTY,
          undefined,
          430,
        ),
      ).value,
    );
    expect(databaseColumnWidth(reset.views![0], TITLE_PROPERTY)).toBe(280);
    expect(reset.views?.[0].columnWidths).toEqual({ status: 220, score: 300 });
    expect(reset.rows).toEqual(initial.rows);
    expect(
      databaseColumnWidthOperations(
        reset,
        "table",
        TITLE_PROPERTY,
        undefined,
        undefined,
      ),
    ).toEqual([]);
  });

  it("ignores missing views/properties, other view types, unchanged widths and invalid dimensions", () => {
    const initial = { ...data(), views: databaseViews(data()) };
    for (const [view, column] of [
      ["missing", "status"],
      ["board", "status"],
      ["list", "status"],
      ["table", "missing"],
      ["table", "__proto__"],
    ])
      expect(
        databaseColumnWidthOperations(initial, view, column, 250, undefined),
      ).toEqual([]);
    for (const width of [79, 1201, 165.5, NaN, Infinity])
      expect(
        databaseColumnWidthOperations(
          initial,
          "table",
          "status",
          width,
          undefined,
        ),
      ).toEqual([]);
    expect(
      databaseColumnWidthOperations(initial, "table", "status", 250, 250),
    ).toEqual([]);
  });

  it("prepares new table views for independent per-column first edits", () => {
    const initial = data();
    const extra = { id: "second", name: "另一表格", type: "table" as const };
    const saved = validateProjectDatabaseData(
      applyOperations(initial, databaseAddViewOperations(initial, extra)).value,
    );
    expect(saved.views?.at(-1)).toEqual({ ...extra, columnWidths: {} });
    const status = databaseColumnWidthOperations(
      saved,
      "second",
      "status",
      240,
      undefined,
    );
    const score = databaseColumnWidthOperations(
      saved,
      "second",
      "score",
      320,
      undefined,
    );
    const first = applyOperations(saved, status);
    const second = applyOperations(first.value, score);
    expect(second.conflicts).toEqual([]);
    expect(
      validateProjectDatabaseData(second.value).views?.at(-1)?.columnWidths,
    ).toEqual({ status: 240, score: 320 });
  });
});

describe("property ordering", () => {
  const orderedData = (): ProjectDatabaseData => ({
    columns: [
      { id: "status", name: "状态", type: "select", options: ["进行中"] },
      { id: "date", name: "日期", type: "date" },
      { id: "score", name: "评分", type: "number" },
    ],
    rows: [{ id: "one", status: "进行中", date: "2026-10-23", score: 7 }],
    views: databaseViews(data()),
  });
  it("moves first/last properties in either direction without changing values or view settings", () => {
    const initial = orderedData();
    const moved = validateProjectDatabaseData(
      applyOperations(
        initial,
        databaseMoveColumnOperations(initial, "score", "status", "before"),
      ).value,
    );
    expect(moved.columns.map((column) => column.id)).toEqual([
      "score",
      "status",
      "date",
    ]);
    const end = validateProjectDatabaseData(
      applyOperations(
        moved,
        databaseMoveColumnOperations(moved, "score", "date", "after"),
      ).value,
    );
    expect(end).toEqual(initial);
    expect(moved.rows).toEqual(initial.rows);
    expect(moved.views).toEqual(initial.views);
  });
  it("reorders by id while preserving another writer's property and record edits", () => {
    const initial = orderedData();
    const operations = databaseMoveColumnOperations(
      initial,
      "score",
      "status",
      "before",
    );
    const remote = orderedData();
    remote.columns[2].name = "并发改名后的评分";
    remote.rows[0].score = 42;
    remote.columns.push({ id: "new", name: "另一处新增", type: "text" });
    const result = applyOperations(remote, operations);
    const merged = validateProjectDatabaseData(result.value);
    expect(result.conflicts).toEqual([]);
    expect(merged.columns.map((column) => column.id)).toEqual([
      "score",
      "status",
      "date",
      "new",
    ]);
    expect(merged.columns[0].name).toBe("并发改名后的评分");
    expect(merged.rows[0].score).toBe(42);
  });
  it("ignores invalid and already adjacent targets, including the fixed document-name property", () => {
    const initial = orderedData();
    expect(
      databaseMoveColumnOperations(initial, "status", "date", "before"),
    ).toEqual([]);
    expect(
      databaseMoveColumnOperations(initial, "date", "status", "after"),
    ).toEqual([]);
    expect(
      databaseMoveColumnOperations(initial, "status", "status", "after"),
    ).toEqual([]);
    expect(
      databaseMoveColumnOperations(initial, "missing", "date", "before"),
    ).toEqual([]);
    expect(
      databaseMoveColumnOperations(initial, "status", TITLE_PROPERTY, "after"),
    ).toEqual([]);
    expect(
      databaseMoveColumnOperations(initial, TITLE_PROPERTY, "status", "before"),
    ).toEqual([]);
  });
});

describe("project database documents and properties", () => {
  it("shows every live page including pages with no properties, and never invents pages for orphan properties", () => {
    const pages = [
      page("one", "原名"),
      page("missing", "文档 B"),
      page("two", "删除的文档", true),
    ];
    const rows = databaseViewRows(
      pages,
      data(),
      [],
      { column: "", value: "" },
      null,
      "zh-CN",
    );
    expect(rows.map((row) => row.page.id)).toEqual(["one", "missing"]);
    expect(rows[1].properties).toEqual({ id: "missing" });
    pages[0] = page("one", "重命名后的文档");
    expect(
      databaseViewRows(
        pages,
        data(),
        ["重命名"],
        { column: "", value: "" },
        null,
        "zh-CN",
      )[0].page.title,
    ).toBe("重命名后的文档");
  });

  it("combines global and table search with exact filters while reading the current page title", () => {
    const pages = [
      page("one", "论文阅读"),
      page("two", "论文整理"),
      page("missing", "会议记录"),
    ];
    const rows = databaseViewRows(
      pages,
      data(),
      ["论文", "已完成"],
      { column: "status", value: "已完成" },
      null,
      "zh-CN",
    );
    expect(rows.map((row) => row.page.id)).toEqual(["two"]);
    expect(
      databaseViewRows(
        pages,
        data(),
        [],
        { column: TITLE_PROPERTY, value: "论文阅读" },
        null,
        "zh-CN",
      ).map((row) => row.page.id),
    ).toEqual(["one"]);
  });

  it("sorts real zero and negative numbers numerically and leaves empty values last in both directions", () => {
    const pages = [
      page("missing", "空值"),
      page("one", "零"),
      page("two", "负数"),
    ];
    const rows = (direction: "asc" | "desc") =>
      databaseViewRows(
        pages,
        data(),
        [],
        { column: "", value: "" },
        { column: "score", direction },
        "zh-CN",
      ).map((row) => row.page.id);
    expect(rows("asc")).toEqual(["two", "one", "missing"]);
    expect(rows("desc")).toEqual(["one", "two", "missing"]);
  });

  it("treats missing checkbox properties on new documents as unchecked for filtering and sorting", () => {
    const initial: ProjectDatabaseData = {
      columns: [{ id: "done", name: "已完成", type: "checkbox" }],
      rows: [
        { id: "checked", done: true },
        { id: "unchecked", done: false },
      ],
    };
    const pages = [
      page("checked", "完成"),
      page("new-page", "新文档"),
      page("unchecked", "待办"),
    ];
    expect(
      databaseViewRows(
        pages,
        initial,
        [],
        { column: "done", value: "false" },
        null,
        "zh-CN",
      ).map((row) => row.page.id),
    ).toEqual(["new-page", "unchecked"]);
    expect(
      databaseViewRows(
        pages,
        initial,
        [],
        { column: "", value: "" },
        { column: "done", direction: "asc" },
        "zh-CN",
      ).map((row) => row.page.id),
    ).toEqual(["new-page", "unchecked", "checked"]);
  });

  it("adds properties to a real page id without creating a second title or document body", () => {
    const initial = data();
    const result = applyOperations(
      initial,
      databaseCellOperations(
        initial,
        "new-page",
        "status",
        "待开始",
        undefined,
      ),
    );
    expect(result.conflicts).toEqual([]);
    expect((result.value as ProjectDatabaseData).rows.at(-1)).toEqual({
      id: "new-page",
      status: "待开始",
    });
    expect(
      databaseCellOperations(
        initial,
        "new-page",
        "deleted-property",
        "text",
        undefined,
      ),
    ).toEqual([]);
  });

  it("holds a stale edit as a conflict while preserving concurrent changes to another field", () => {
    const basis = data();
    const edits = databaseCellOperations(
      basis,
      "one",
      "status",
      "已完成",
      "待开始",
    );
    const remote = data();
    remote.rows[0] = { id: "one", status: "审核中", score: 42 };
    const merged = applyOperations(remote, edits, { atomic: false });
    expect(merged.conflicts).toMatchObject([
      { path: ["rows", { id: "one" }, "status"], reason: "changed" },
    ]);
    expect((merged.value as ProjectDatabaseData).rows[0]).toEqual({
      id: "one",
      status: "审核中",
      score: 42,
    });
  });

  it("preserves another writer's new row fields when first editing a page that initially had no properties", () => {
    const initial = data();
    const remote = data();
    remote.rows.push({ id: "new-page", score: 17 });
    const merged = applyOperations(
      remote,
      databaseCellOperations(
        initial,
        "new-page",
        "status",
        "待开始",
        undefined,
      ),
      { atomic: false },
    );
    expect((merged.value as ProjectDatabaseData).rows.at(-1)).toEqual({
      id: "new-page",
      score: 17,
      status: "待开始",
    });
  });

  it("converts a populated text column to valid calendar dates without disturbing other properties", () => {
    const initial: ProjectDatabaseData = {
      columns: [{ id: "date", name: "日期", type: "text" }],
      rows: [
        { id: "one", date: "2026/10/22", status: "待开始" },
        { id: "two", date: "无日期" },
      ],
    };
    const changed = applyOperations(
      initial,
      databaseTypeOperations(initial, initial.columns[0], "date"),
    );
    expect(() => validateProjectDatabaseData(changed.value)).not.toThrow();
    expect((changed.value as ProjectDatabaseData).rows).toEqual([
      { id: "one", date: "2026-10-22", status: "待开始" },
      { id: "two", date: "" },
    ]);
  });

  it("removes only the requested property and keeps page records and unrelated fields", () => {
    const initial = data();
    const changed = applyOperations(
      initial,
      databaseRemoveColumnOperations(initial, initial.columns[0]),
    );
    expect(
      (changed.value as ProjectDatabaseData).columns.map((column) => column.id),
    ).toEqual(["score"]);
    expect((changed.value as ProjectDatabaseData).rows[0]).toEqual({
      id: "one",
      score: 0,
    });
  });
});
