// Build first, then run: node src/desktop/directory-selection-ui-smoke.mjs.
// Real Electron, workbench actions and filesystem; every write uses an isolated library.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(
  join(root, "output/playwright/directory-selection-"),
);
const home = join(output, "home");
const env = {
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_LANGUAGE: "zh-CN",
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, home, checks: [] };
let app, page;
const errors = [];
try {
  app = await _electron.launch({
    executablePath: electron,
    args: [root],
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const invoke = (action, args) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  assert.equal((await invoke("app:info")).home, home);
  const source = await invoke("projects:create", { name: "批量操作验收" });
  const other = await invoke("projects:create", { name: "另一个项目" });
  const concurrent = await invoke("projects:create", {
    name: "同时整理的项目",
  });
  const folder = await invoke("folders:create", {
    projectId: source.id,
    name: "归档资料",
  });
  const nested = await invoke("folders:create", {
    projectId: source.id,
    parentId: folder.id,
    name: "待整理",
  });
  const shelf = await invoke("folders:create", {
    projectId: source.id,
    name: "整理目标",
  });
  const destination = await invoke("folders:create", {
    projectId: other.id,
    name: "目标资料",
  });
  const pages = [];
  for (const title of ["页面 A", "页面 B", "页面 C", "页面 D"])
    pages.push(
      (await invoke("pages:create", { projectId: source.id, title })).document,
    );
  const nestedPage = (
    await invoke("pages:create", {
      projectId: source.id,
      parentId: nested.id,
      title: "子目录页面",
    })
  ).document;
  const sidebar = page.locator(".studio-sidebar");
  const openFolder = async (id) => {
    await sidebar
      .locator(`.studio-tree-row[data-library-id="${id}"] .studio-tree-main`)
      .click();
    await page.locator(".studio-page-list").waitFor();
  };
  const list = page.locator(".studio-library .studio-page-list");
  const row = (id) =>
    list.locator(`.studio-page-list-row[data-library-id="${id}"]`);
  const check = (id) => row(id).getByRole("checkbox");
  const bar = page.getByRole("region", { name: "批量操作" });
  const waitFor = async (read, accepts) => {
    const deadline = Date.now() + 15000;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (accepts(value)) return value;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.fail(`Timed out: ${JSON.stringify(value)}`);
  };
  const record = (id, projectId = source.id) =>
    invoke("pages:get", { projectId, pageId: id });
  const fileDocument = async (id, projectId = source.id) =>
    JSON.parse(
      await readFile(
        join(home, "workspace", "projects", projectId, "pages", `${id}.json`),
        "utf8",
      ),
    ).document;
  const checkedIds = () =>
    list
      .locator('.studio-page-checkbox[aria-checked="true"]')
      .evaluateAll((items) =>
        items.map(
          (item) => item.closest("[data-library-id]").dataset.libraryId,
        ),
      );
  await openFolder(source.id);
  await row(pages[3].id).waitFor();

  // Opening remains a normal click until the user starts selecting.
  await row(pages[0].id).locator(".studio-page-list-open").click();
  await page.getByRole("textbox", { name: "页面标题", exact: true }).waitFor();
  await openFolder(source.id);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  assert.equal(
    await bar.getByRole("button", { name: "移动", exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await bar
      .getByRole("button", { name: "删除", exact: true })
      .isDisabled(),
    true,
  );
  await check(pages[0].id).click();
  await check(pages[2].id).click({ modifiers: ["Shift"] });
  assert.deepEqual(
    new Set(await checkedIds()),
    new Set(pages.slice(0, 3).map((item) => item.id)),
  );
  await row(pages[1].id).locator(".studio-page-list-open").click();
  assert.equal((await checkedIds()).length, 2);
  await bar.getByRole("checkbox", { name: "全选" }).check();
  assert.equal(
    (await checkedIds()).length,
    6,
    "Select all covers the folders and pages shown, not descendant pages",
  );
  await bar.getByRole("checkbox", { name: "全选" }).uncheck();
  assert.equal((await checkedIds()).length, 0);
  result.checks.push(
    "Normal opening, checkbox and Shift range selection, row toggling, select all and disabled empty actions",
  );

  await check(pages[0].id).click();
  await openFolder(folder.id);
  await bar.waitFor({ state: "hidden" });
  await openFolder(source.id);
  await bar.waitFor({ state: "hidden" });
  assert.equal((await checkedIds()).length, 0);
  result.checks.push(
    "Selection resets when navigating away and does not reappear on return",
  );

  await check(pages[0].id).click();
  await check(pages[1].id).click();
  await page.screenshot({ path: join(output, "list-selection.png") });
  await bar.getByRole("button", { name: "移动", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "移动所选项", exact: true });
  await dialog.getByRole("combobox", { name: "目标文件夹" }).waitFor();
  await waitFor(
    () => dialog.getByRole("combobox", { name: "目标文件夹" }).isEnabled(),
    Boolean,
  );
  assert.equal(
    await dialog
      .getByRole("button", { name: "移动", exact: true })
      .isDisabled(),
    true,
    "Moving to the current folder is disabled",
  );
  await dialog
    .getByRole("combobox", { name: "目标文件夹" })
    .selectOption(nested.id);
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await row(pages[0].id).waitFor({ state: "detached" });
  assert.equal((await fileDocument(pages[0].id)).parentId, nested.id);
  assert.equal((await fileDocument(pages[1].id)).parentId, nested.id);
  assert.equal((await fileDocument(pages[2].id)).parentId, null);
  result.checks.push(
    "Batch move to a nested folder persists selected pages and preserves unselected pages",
  );

  // Open the nested folder by opening its parent first, so its sidebar row exists.
  await openFolder(folder.id);
  await openFolder(nested.id);
  await page.getByRole("button", { name: "视图", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "缩略图（中）", exact: true })
    .click();
  await waitFor(
    () => list.getAttribute("data-view"),
    (view) => view === "medium",
  );
  await check(pages[0].id).click();
  await check(pages[1].id).click();
  await page.screenshot({ path: join(output, "thumbnail-selection.png") });
  await bar.getByRole("button", { name: "移动", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移动所选项", exact: true });
  await waitFor(
    () => dialog.getByRole("combobox", { name: "目标文件夹" }).isEnabled(),
    Boolean,
  );
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await fileDocument(pages[0].id)).parentId, null);
  assert.equal((await fileDocument(nestedPage.id)).parentId, nested.id);
  result.checks.push(
    "Thumbnail selection and batch move back to the project root",
  );

  await openFolder(source.id);
  await check(pages[0].id).click();
  await check(pages[1].id).click();
  await bar.getByRole("button", { name: "移动", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移动所选项", exact: true });
  await dialog
    .getByRole("combobox", { name: "目标项目" })
    .selectOption(other.id);
  await waitFor(
    () => dialog.getByRole("combobox", { name: "目标文件夹" }).isEnabled(),
    Boolean,
  );
  await dialog
    .getByRole("combobox", { name: "目标文件夹" })
    .selectOption(destination.id);
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (await fileDocument(pages[0].id, other.id)).parentId,
    destination.id,
  );
  assert.equal(
    (await fileDocument(pages[1].id, other.id)).parentId,
    destination.id,
  );
  assert.equal(
    (await invoke("pages:list", { projectId: source.id })).some(
      (item) => item.id === pages[0].id,
    ),
    false,
  );
  result.checks.push(
    "Cross-project batch move persists pages in the selected destination",
  );

  // A concurrent real move exercises partial success and retry, with no mocked bridge.
  await check(pages[2].id).click();
  await check(pages[3].id).click();
  await bar.getByRole("button", { name: "移动", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移动所选项", exact: true });
  await dialog
    .getByRole("combobox", { name: "目标项目" })
    .selectOption(other.id);
  await waitFor(
    () => dialog.getByRole("combobox", { name: "目标文件夹" }).isEnabled(),
    Boolean,
  );
  const [firstMoved, concurrentPage] = await checkedIds();
  const moveOne = async (id, from, to) => {
    const current = await record(id, from);
    await invoke("sidebar:moveEntry", {
      kind: "page",
      projectId: from,
      id,
      destinationProjectId: to,
      parentId: null,
      baseHash: current.hash,
      baseRevision: current.revision,
    });
  };
  await moveOne(concurrentPage, source.id, concurrent.id);
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.match(
    await dialog.getByRole("alert").innerText(),
    /已完成 1 项，剩余 1 项未完成/,
  );
  assert.equal((await fileDocument(firstMoved, other.id)).parentId, null);
  await moveOne(concurrentPage, concurrent.id, source.id);
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await fileDocument(concurrentPage, other.id)).parentId, null);
  result.checks.push(
    "Partial move failure reports completed and remaining counts; retry only processes remaining pages",
  );

  await openFolder(other.id);
  await openFolder(destination.id);
  await check(pages[0].id).click();
  await check(pages[1].id).click();
  await bar.getByRole("button", { name: "删除", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除所选项", exact: true });
  assert.match(await dialog.innerText(), /删除选中的 2 项/);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await record(pages[0].id, other.id)).document.archived, false);
  assert.equal((await checkedIds()).length, 2);
  await bar.getByRole("button", { name: "删除", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除所选项", exact: true });
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await fileDocument(pages[0].id, other.id)).archived, true);
  assert.equal((await fileDocument(pages[1].id, other.id)).archived, true);
  assert.equal((await fileDocument(pages[2].id, other.id)).archived, false);
  result.checks.push(
    "Delete confirmation, cancel preserving selection, persistent batch archive and unselected-page preservation",
  );

  // Folders join batch selection; they move only inside their project and never into themselves.
  await openFolder(source.id);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await check(folder.id).click();
  await bar.getByRole("button", { name: "移动", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "移动所选项", exact: true });
  const folderSelect = dialog.getByRole("combobox", { name: "目标文件夹" });
  await waitFor(() => folderSelect.isEnabled(), Boolean);
  assert.equal(
    await dialog.getByRole("combobox", { name: "目标项目" }).isDisabled(),
    true,
  );
  const options = await folderSelect
    .locator("option")
    .evaluateAll((items) => items.map((item) => item.value));
  assert.equal(options.includes(folder.id), false);
  assert.equal(options.includes(nested.id), false);
  await folderSelect.selectOption(shelf.id);
  await dialog.getByRole("button", { name: "移动", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const folderParent = async (id) =>
    (await invoke("folders:list", { projectId: source.id })).find(
      (item) => item.id === id,
    )?.parentId;
  assert.equal(await folderParent(folder.id), shelf.id);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await check(shelf.id).click();
  await bar.getByRole("button", { name: "删除", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除所选项", exact: true });
  assert.match(await dialog.innerText(), /连同里面的内容一起删除/);
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (await invoke("folders:list", { projectId: source.id })).some(
      (item) => item.id === shelf.id,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.getByRole("alert").allTextContents(), []);
  result.checks.push(
    "Folder batch move stays in the project, excludes the folder and its descendants, and batch delete archives a folder",
  );
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page)
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, output }, null, 2));
}
