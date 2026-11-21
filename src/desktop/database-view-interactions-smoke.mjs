import assert from "node:assert/strict";

const title = "场次视图验收";

export async function prepareDatabaseViewTest(tool, projectId) {
  const note = await tool("page_create", {
    title: "开幕日",
    blocks: [
      {
        kind: "text",
        data: { format: "markdown", content: "## 开幕日的放映笔记" },
      },
    ],
  });
  const columns = [
    { id: "name", name: "场次", type: "text" },
    { id: "status", name: "状态", type: "select", options: ["在展", "预备"] },
    { id: "city", name: "城市", type: "text" },
    { id: "day", name: "开幕", type: "date" },
    { id: "note", name: "笔记", type: "page", titleColumn: "name" },
  ];
  const rows = [
    {
      id: "live",
      name: "开幕日",
      city: "上海",
      day: "2026-11-01",
      status: "在展",
      note: `showai://project/${projectId}/page/${note.document.id}`,
    },
    {
      id: "future",
      name: "闭幕日",
      city: "北京",
      day: "2026-11-30",
      status: "预备",
    },
  ];
  const { dataset } = await tool("dataset_write", {
    action: "create",
    name: "场次记录",
    value: { columns, rows },
  });
  await tool("page_create", {
    title,
    blocks: [
      {
        kind: "database",
        data: {
          title: "展览场次",
          views: [
            {
              id: "active",
              name: "在展",
              type: "table",
              filter: { column: "status", value: "在展" },
            },
            { id: "board", name: "分组", type: "board", groupBy: "status" },
            { id: "list", name: "场次清单", type: "list" },
            { id: "calendar", name: "日程", type: "calendar" },
          ],
          calendar: { initialDate: "2026-11-01", dateColumn: "day" },
          $binding: {
            dataset: dataset.id,
            props: { local: ["title", "view", "views", "groupBy", "calendar"] },
          },
        },
      },
    ],
  });
}

export async function checkDatabaseViewEdits(window) {
  await window
    .locator(".studio-sidebar")
    .getByText(title, { exact: true })
    .first()
    .click();
  const block = window.getByRole("region", { name: "展览场次", exact: true });
  const button = (name) => block.getByRole("button", { name, exact: true });
  const tab = (name) => block.getByRole("tab", { name, exact: true });
  const menu = block.getByText("视图与筛选", { exact: true });
  const count = (value) => block.getByText(value, { exact: true }).waitFor();

  await count("1 / 2 条记录");
  await menu.click();
  await button("新建").click();
  await count("2 / 3 条记录");
  await menu.click();
  // Leave and reopen the page to read the saved filter and the shared rows.
  await window
    .locator(".studio-sidebar")
    .getByText("数据读取层验收", { exact: true })
    .first()
    .click();
  await window
    .locator(".studio-sidebar")
    .getByText(title, { exact: true })
    .first()
    .click();
  await count("2 / 3 条记录");
  const added = block
    .getByRole("row")
    .filter({
      has: window.getByRole("button", { name: "打开记录未命名", exact: true }),
    });
  assert.equal(
    await added.getByRole("combobox", { name: "状态" }).inputValue(),
    "在展",
  );

  for (const [name, record] of [
    ["在展", "打开记录开幕日"],
    ["分组", "打开记录开幕日"],
    ["场次清单", "打开记录开幕日"],
    ["日程", "开幕日"],
  ]) {
    await tab(name).click();
    await button(record).first().click();
    await window.getByRole("heading", { name: "开幕日的放映笔记" }).waitFor();
    await window.getByRole("button", { name: "关闭文档侧栏" }).click();
  }

  await tab("在展").click();
  await menu.click();
  await button("复制视图").click();
  await block.getByText("显示字段", { exact: true }).click();
  await block.getByRole("checkbox", { name: "城市", exact: true }).uncheck();
  await menu.click();
  assert.equal(
    await block.getByRole("columnheader", { name: /城市/ }).count(),
    0,
  );
  await tab("在展").click();
  await block.getByRole("columnheader", { name: /城市/ }).waitFor();

  await block.getByRole("checkbox", { name: "选择全部 2 条结果" }).check();
  const bulk = block.getByRole("region", { name: "批量编辑" });
  await bulk
    .getByRole("combobox", { name: "选择要修改的字段" })
    .selectOption("status");
  await bulk.getByRole("combobox", { name: "状态" }).selectOption("预备");
  await bulk.getByRole("button", { name: "应用" }).click();
  await count("0 / 3 条记录");
  await button("撤销批量修改").click();
  await count("2 / 3 条记录");

  await tab("场次清单").click();
  await button("打开记录闭幕日").click();
  const detail = window.getByRole("dialog", { name: "闭幕日" });
  await detail.waitFor();
  assert.equal(
    await detail.getByRole("textbox", { name: "城市" }).inputValue(),
    "北京",
  );
  await window.keyboard.press("Escape");
  await detail.waitFor({ state: "detached" });
}
