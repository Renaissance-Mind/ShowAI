import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseBlock } from "./Database";
import { PageLinkContext, type PageLinkBridge } from "../page-links";
import { parsePageCell, validateDatabaseData } from "./database-contract.mjs";
import {
  changeView,
  columnWidth,
  databaseViews,
  moveColumnTo,
  newViewId,
  pruneViews,
  withViews,
} from "./database-views";
import type { DatabaseColumn, DatabaseView, DatabaseViewType } from "./types";

const name = (type: DatabaseViewType) =>
  ({ table: "表格", board: "看板", list: "列表", calendar: "日历" })[type];
const columns: DatabaseColumn[] = [
  { id: "title", name: "名称", type: "text" },
  { id: "status", name: "状态", type: "select", options: ["进行中", "完成"] },
  { id: "doc", name: "文档", type: "page" },
];
const link = "showai://project/research/page/notes-1";
const records = () => ({
  title: "文档",
  columns: columns.map((column) => ({ ...column })),
  rows: [
    { id: "a", title: "实验记录", status: "进行中", doc: link },
    { id: "b", title: "周报", status: "完成", doc: "" },
  ],
});

describe("database page cells and views contract", () => {
  it("accepts page links and empty page cells, and rejects other values", () => {
    expect(() => validateDatabaseData(records())).not.toThrow();
    expect(parsePageCell(link)).toEqual({
      projectId: "research",
      pageId: "notes-1",
    });
    for (const value of [
      "https://example.com",
      "showai://project/research/page/notes-1?blocks=a",
      "showai://project/research/page/",
      42,
    ]) {
      const data: any = records();
      data.rows[0].doc = value;
      expect(() => validateDatabaseData(data)).toThrow(
        typeof value === "number" ? /rows\[0\]\.doc/ : /showai:\/\/project/,
      );
    }
  });
  it("keeps a folder only on page columns", () => {
    const data: any = records();
    data.columns[2].folder = "notes-folder";
    expect(() => validateDatabaseData(data)).not.toThrow();
    data.columns[0].folder = "notes-folder";
    expect(() => validateDatabaseData(data)).toThrow(/columns\[0\]\.folder/);
    data.columns[0] = { ...data.columns[0], folder: undefined };
    data.columns[2].folder = "../up";
    expect(() => validateDatabaseData(data)).toThrow(/columns\[2\]\.folder/);
  });
  it("accepts named views and names the invalid field", () => {
    const views: DatabaseView[] = [
      {
        id: "all",
        name: "全部",
        type: "table",
        sort: { column: "title", direction: "asc" },
        filter: { column: "status", value: "进行中" },
        columnWidths: { title: 240 },
      },
      { id: "progress", name: "进度", type: "board", groupBy: "status" },
      { id: "docs", name: "文档", type: "list", sort: null },
    ];
    expect(() => validateDatabaseData({ ...records(), views })).not.toThrow();
    const invalid: [unknown, RegExp][] = [
      [[], /views must be an array of 1 to 20/],
      [[{ ...views[0], id: "a b" }], /views\[0\]\.id/],
      [[views[0], { ...views[1], id: "all" }], /duplicate id all/],
      [[{ ...views[0], name: " " }], /views\[0\]\.name/],
      [[{ ...views[0], type: "gallery" }], /views\[0\]\.type/],
      [
        [{ ...views[0], hidden: [] }],
        /views\[0\]\.hidden is not a supported setting/,
      ],
      [
        [{ ...views[0], sort: { column: "title", direction: "up" } }],
        /views\[0\]\.sort/,
      ],
      [[{ ...views[0], filter: { column: "status" } }], /views\[0\]\.filter/],
      [
        [{ ...views[0], columnWidths: { title: 40 } }],
        /views\[0\]\.columnWidths\.title/,
      ],
    ];
    for (const [value, error] of invalid)
      expect(() =>
        validateDatabaseData({ ...records(), views: value }),
      ).toThrow(error);
  });
  it("keeps the older single-view data valid", () => {
    expect(() =>
      validateDatabaseData({
        title: "旧数据",
        view: "board",
        groupBy: "status",
        columns: columns.slice(0, 2),
        rows: [{ id: "a", title: "x", status: "完成" }],
      }),
    ).not.toThrow();
  });
});

describe("database views", () => {
  it("reads the older view and grouping as one unsaved view", () => {
    expect(databaseViews({ view: "board", groupBy: "status" }, name)).toEqual({
      views: [
        { id: "default", name: "看板", type: "board", groupBy: "status" },
      ],
      saved: false,
    });
    expect(databaseViews({ view: "gallery" }, name).views[0].type).toBe(
      "table",
    );
    const saved = [{ id: "x", name: "X", type: "list" as const }];
    expect(databaseViews({ view: "board", views: saved }, name)).toEqual({
      views: saved,
      saved: true,
    });
  });
  it("writes views in place of the older fields", () => {
    const next = withViews({ ...records(), view: "board", groupBy: "status" }, [
      { id: "default", name: "看板", type: "board", groupBy: "status" },
    ]);
    expect(next).not.toHaveProperty("view");
    expect(next).not.toHaveProperty("groupBy");
    expect(() => validateDatabaseData(next)).not.toThrow();
  });
  it("renames a view that still carries its type name, and drops cleared settings", () => {
    const table: DatabaseView = {
      id: "a",
      name: "表格",
      type: "table",
      sort: { column: "title", direction: "asc" },
      filter: { column: "status", value: "完成" },
    };
    expect(changeView(table, { type: "board" }, name).name).toBe("看板");
    expect(
      changeView({ ...table, name: "我的视图" }, { type: "board" }, name).name,
    ).toBe("我的视图");
    const cleared = changeView(
      table,
      { sort: null, filter: undefined, columnWidths: {} },
      name,
    );
    expect(cleared).toEqual({ id: "a", name: "表格", type: "table" });
  });
  it("creates unused view ids, reads widths and moves columns", () => {
    expect(
      newViewId([
        { id: "view-2", name: "2", type: "table" },
        { id: "default", name: "1", type: "table" },
      ]),
    ).toBe("view-3");
    const view: DatabaseView = {
      id: "v",
      name: "V",
      type: "table",
      columnWidths: { status: 200, doc: 40 },
    };
    expect(columnWidth(view, "title", 0)).toBe(280);
    expect(columnWidth(view, "status", 1)).toBe(200);
    // Widths outside the contract fall back to the default.
    expect(columnWidth(view, "doc", 2)).toBe(165);
    const ids = (list: DatabaseColumn[]) => list.map((column) => column.id);
    expect(ids(moveColumnTo(columns, "doc", "title", "before"))).toEqual([
      "doc",
      "title",
      "status",
    ]);
    expect(ids(moveColumnTo(columns, "title", "doc", "after"))).toEqual([
      "status",
      "doc",
      "title",
    ]);
    expect(moveColumnTo(columns, "missing", "title", "before")).toBe(columns);
    expect(moveColumnTo(columns, "title", "title", "after")).toBe(columns);
  });
  it("drops view settings that refer to removed or retyped columns", () => {
    const [view] = pruneViews(
      [
        {
          id: "a",
          name: "A",
          type: "board",
          groupBy: "status",
          sort: { column: "doc", direction: "asc" },
          filter: { column: "status", value: "完成" },
          columnWidths: { title: 200, doc: 300 },
        },
      ],
      [
        { id: "title", name: "名称", type: "text" },
        { id: "status", name: "状态", type: "text" },
      ],
    );
    expect(view).toEqual({
      id: "a",
      name: "A",
      type: "board",
      filter: { column: "status", value: "完成" },
      columnWidths: { title: 200 },
    });
  });
});

describe("database rendering", () => {
  const bridge: PageLinkBridge = {
    projectId: "research",
    pageId: "index",
    pages: [
      { id: "index", title: "目录" },
      { id: "notes-1", title: "实验笔记" },
    ],
    copyLink: () => {},
  };
  const render = (data: unknown, readOnly: boolean, pages = bridge) =>
    renderToStaticMarkup(
      createElement(
        PageLinkContext.Provider,
        { value: pages },
        createElement(DatabaseBlock, {
          data: data as any,
          readOnly,
          onChange: () => {},
        }),
      ),
    );
  it("shows page cells as links titled after the page", () => {
    const html = render(records(), true);
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('data-open-page="notes-1"');
    expect(html).toContain("实验笔记");
  });
  it("offers the project's other pages when editing a page cell", () => {
    const html = render(records(), false);
    expect(html).toContain('class="sb-cell-page"');
    expect(html).toContain(">实验笔记</option>");
    expect(html).not.toContain(">目录</option>");
  });
  it("labels links outside the listed pages without guessing a title", () => {
    const html = render(records(), true, { ...bridge, projectId: "other" });
    expect(html).toContain("链接的页面");
    expect(html).not.toContain("实验笔记");
  });
  it("shows view tabs for several views and renders the first one", () => {
    const html = render(
      {
        ...records(),
        views: [
          { id: "docs", name: "文档清单", type: "list" },
          {
            id: "wide",
            name: "宽表",
            type: "table",
            columnWidths: { title: 300 },
          },
        ],
      },
      true,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain("文档清单");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("sb-database-list");
    expect(html).not.toContain("sb-database-table");
  });
  it("sizes table columns from the view and offers adding properties", () => {
    const html = render(
      {
        ...records(),
        views: [
          {
            id: "wide",
            name: "宽表",
            type: "table",
            columnWidths: { title: 300 },
          },
        ],
      },
      false,
    );
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain(
      '<col data-column-width-id="title" style="width:300px"/>',
    );
    expect(html).toContain(
      '<col data-column-width-id="status" style="width:165px"/>',
    );
    expect(html).toContain("sb-add-property");
    expect(html).toContain('role="separator"');
  });
  it("sorts page cells by their titles", () => {
    const data = {
      ...records(),
      rows: [
        { id: "a", title: "一", status: "", doc: link },
        {
          id: "b",
          title: "二",
          status: "",
          doc: "showai://project/research/page/index",
        },
      ],
      views: [
        {
          id: "v",
          name: "V",
          type: "list",
          sort: { column: "doc", direction: "asc" },
        },
      ],
    };
    const html = render(data, true, {
      ...bridge,
      pages: [
        { id: "index", title: "Alpha" },
        { id: "notes-1", title: "Beta" },
      ],
    });
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Beta"));
  });
});
