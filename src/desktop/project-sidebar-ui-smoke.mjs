// Real desktop acceptance for project creation, grouping, pinning and compact headers.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import electron from "electron";
import { _electron } from "playwright";

const root = resolve(import.meta.dirname, "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/project-sidebar-"));
const home = join(output, "home");
const env = {
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, output, checks: [], rendererErrors: [] };
let app, page;
async function launch() {
  app = await _electron.launch({
    executablePath: electron,
    args: [root],
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => result.rendererErrors.push(error.message));
  await page
    .locator('.studio-sidebar [data-project-section="projects"]')
    .waitFor();
}
async function poll(read, accepts) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise((done) => setTimeout(done, 75));
  }
  throw new Error("Timed out waiting for persistent sidebar state");
}
const sidebarData = async () =>
  JSON.parse(await readFile(join(home, "sidebar.json"), "utf8"));
const sidebar = () => page.locator(".studio-sidebar");
const section = (id) => sidebar().locator(`[data-project-section="${id}"]`);
const row = (id) => sidebar().locator(`[data-library-id="${id}"]`);
async function projectMenu(id, label) {
  await row(id).hover();
  await row(id)
    .getByRole("button", { name: /的操作$/ })
    .click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function groupMenu(id, label) {
  await section(id).locator(".studio-sidebar-label").hover();
  await section(id)
    .getByRole("button", { name: /的分组操作$/ })
    .click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function createProject(name, groupId = "projects") {
  await section(groupId).locator(".studio-sidebar-label").hover();
  await section(groupId)
    .getByRole("button", { name: /新建项目$/ })
    .click();
  await page.getByRole("textbox", { name: "项目名称" }).fill(name);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  return (
    await page.evaluate(() => window.showai.invoke("projects:list"))
  ).find((item) => item.name === name);
}
try {
  await launch();
  const first = await createProject("视觉研究");
  const second = await createProject("产品设计");
  await row(second.id).waitFor();
  await sidebar()
    .locator(".studio-main-nav")
    .getByRole("button", { name: "最近", exact: true })
    .focus();
  await page.locator(".studio-brand").hover();
  const add = section("projects").getByRole("button", {
    name: "新建项目",
    exact: true,
  });
  await poll(
    () => add.evaluate((element) => getComputedStyle(element).opacity),
    (opacity) => opacity === "0",
  );
  await section("projects").locator(".studio-sidebar-label").hover();
  await poll(
    () => add.evaluate((element) => getComputedStyle(element).opacity),
    (opacity) => opacity === "1",
  );
  const layout = await page.evaluate(() => {
    const header = document.querySelector(
      '[data-project-section="projects"] .studio-sidebar-label',
    );
    const row = document.querySelector(
      '[data-project-section="projects"] .studio-tree-row',
    );
    const settings = [
      ...document.querySelectorAll(".studio-sidebar-bottom button"),
    ].find((item) => item.textContent.includes("设置"));
    return {
      headerSize: getComputedStyle(header).fontSize,
      settingsSize: getComputedStyle(settings).fontSize,
      gap:
        row.getBoundingClientRect().top - header.getBoundingClientRect().bottom,
    };
  });
  assert.equal(layout.headerSize, layout.settingsSize);
  assert.equal(layout.headerSize, "14px");
  assert.ok(layout.gap >= 0 && layout.gap <= 2, JSON.stringify(layout));
  result.layout = layout;
  await page.locator(".studio-brand").hover();
  await add.focus();
  await poll(
    () => add.evaluate((element) => getComputedStyle(element).opacity),
    (opacity) => opacity === "1",
  );
  await add.press("Enter");
  await page.getByRole("textbox", { name: "项目名称" }).waitFor();
  await page.keyboard.press("Escape");
  result.checks.push(
    "14px header matches Settings; 2px gap; hover and keyboard creation entry",
  );

  await section("projects")
    .getByRole("button", { name: "项目列表操作" })
    .click();
  await page.getByRole("menuitem", { name: "新建分组", exact: true }).click();
  await page.getByRole("textbox", { name: "分组名称" }).fill("研究");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const group = (await sidebarData()).groups[0];
  await projectMenu(second.id, "移到分组…");
  await page.getByRole("combobox", { name: "目标分组" }).selectOption(group.id);
  await page.getByRole("button", { name: "移动", exact: true }).click();
  await poll(sidebarData, (data) => data.projectGroups[second.id] === group.id);
  await section(group.id).locator(`[data-library-id="${second.id}"]`).waitFor();
  const third = await createProject("论文阅读", group.id);
  assert.equal((await sidebarData()).projectGroups[third.id], group.id);
  await section(group.id)
    .getByRole("button", { name: "研究", exact: true })
    .click();
  assert.equal(await row(second.id).count(), 0);
  await section(group.id)
    .getByRole("button", { name: "研究", exact: true })
    .click();
  await projectMenu(first.id, "置顶");
  await section("pinned").locator(`[data-library-id="${first.id}"]`).waitFor();
  await projectMenu(second.id, "置顶");
  await section("pinned").locator(`[data-library-id="${second.id}"]`).waitFor();
  assert.equal(await row(second.id).count(), 1);
  await projectMenu(second.id, "取消置顶");
  await section(group.id).locator(`[data-library-id="${second.id}"]`).waitFor();
  await groupMenu(group.id, "重命名分组");
  await page.getByRole("textbox", { name: "分组名称" }).fill("研究资料");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await poll(sidebarData, (data) => data.groups[0].name === "研究资料");
  await page.screenshot({
    path: join(output, "sidebar-light.png"),
    fullPage: true,
  });
  result.checks.push(
    "Create, rename and collapse groups; create directly inside a group; move and pin without duplicate rows",
  );

  await app.close();
  await launch();
  await section(group.id).locator(`[data-library-id="${third.id}"]`).waitFor();
  await section("pinned").locator(`[data-library-id="${first.id}"]`).waitFor();
  assert.equal(
    await section(group.id)
      .getByRole("button", { name: "研究资料", exact: true })
      .count(),
    1,
  );
  await projectMenu(third.id, "移出分组");
  await section("projects")
    .locator(`[data-library-id="${third.id}"]`)
    .waitFor();
  await groupMenu(group.id, "移除分组");
  await section("projects")
    .locator(`[data-library-id="${second.id}"]`)
    .waitFor();
  assert.deepEqual(await sidebarData(), { groups: [], projectGroups: {} });
  assert.equal(
    (await page.evaluate(() => window.showai.invoke("projects:list"))).length,
    3,
  );
  result.checks.push(
    "Full application restart retains organization; removing groups preserves projects",
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.screenshot({
    path: join(output, "sidebar-dark.png"),
    fullPage: true,
  });
  await app
    .browserWindow(page)
    .then((window) => window.evaluate((window) => window.setSize(860, 720)));
  await page.screenshot({
    path: join(output, "sidebar-narrow.png"),
    fullPage: true,
  });
  assert.deepEqual(await page.getByRole("alert").allTextContents(), []);
  assert.deepEqual(result.rendererErrors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  if (app && app.process().exitCode === null)
    await app.close().catch(() => app.process().kill("SIGTERM"));
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
