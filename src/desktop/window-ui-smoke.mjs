import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parent = join(repository, "output/playwright");
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "window-ui-"));
const env = {
  ...desktopTestEnvironment(),
  SHOWAI_LANGUAGE: "zh-CN",
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, output, checks: [] };
const errors = [];
let application, source;

async function verifyTabReorder(page) {
  const list = page.getByRole("tablist", { name: "工作区标签页" });
  const tabs = list.getByRole("tab");
  const add = page.getByRole("button", { name: "新建标签页", exact: true });
  await add.click();
  await tabs.nth(1).waitFor();
  await add.click();
  await tabs.nth(2).waitFor();
  const order = () => tabs.evaluateAll((items) => items.map((item) => item.id));
  const [first, second, active] = await order();
  const centers = () =>
    tabs.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }),
    );
  const drag = async (from, to) => {
    const points = await centers();
    await page.mouse.move(points[from].x, points[from].y);
    await page.mouse.down();
    await page.mouse.move(points[to].x, points[to].y, { steps: 16 });
  };
  const ghost = page.locator(".studio-tab-drag-ghost");
  await drag(0, 2);
  await page.mouse.up();
  await page.reload();
  await tabs.nth(2).waitFor();
  assert.deepEqual(await order(), [second, active, first]);
  assert.equal(
    await list.getByRole("tab", { selected: true }).getAttribute("id"),
    active,
  );
  await drag(2, 0);
  await ghost.waitFor();
  assert.deepEqual(await order(), [first, second, active]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await ghost.waitFor({ state: "detached" });
  assert.deepEqual(await order(), [second, active, first]);
  await drag(2, 0);
  await page.mouse.up();
  await ghost.waitFor({ state: "detached" });
  assert.deepEqual(await order(), [first, second, active]);
  assert.equal(
    await list.getByRole("tab", { selected: true }).getAttribute("id"),
    active,
  );
  await tabs.first().click();
  await tabs
    .first()
    .and(list.getByRole("tab", { selected: true }))
    .waitFor();

  const session = await page.context().newCDPSession(page);
  const touch = (type, point) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [point] : [],
    });
  const [left, middle, right] = await centers();
  await touch("touchStart", left);
  await touch("touchMove", middle);
  await touch("touchMove", right);
  await touch("touchEnd");
  await ghost.waitFor({ state: "detached" });
  assert.deepEqual(await order(), [second, active, first]);
  await session.detach();
}

try {
  application = await _electron.launch({
    executablePath: electron,
    args: [repository],
    cwd: repository,
    env,
    timeout: 30000,
  });
  source = await application.firstWindow();
  source.setDefaultTimeout(15000);
  source.on("pageerror", (error) => errors.push(error.message));
  await source
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  await verifyTabReorder(source);
  result.checks.push(
    "Mouse and touch reorder workspace tabs, drops survive reload, Escape cancels and clicks select",
  );
  const target = await source.evaluate(async () => {
    const api = window.showai;
    const project = await api.invoke("projects:create", {
      name: "Window navigation",
    });
    const folder = await api.invoke("folders:create", {
      projectId: project.id,
      name: "Nested folder",
    });
    const first = await api.invoke("pages:create", {
      projectId: project.id,
      parentId: folder.id,
      title: "Target page",
    });
    const second = await api.invoke("pages:create", {
      projectId: project.id,
      parentId: folder.id,
      title: "Other page",
    });
    localStorage.setItem("showai:sidebar-locked", "true");
    return {
      project: project.id,
      page: first.document.id,
      other: second.document.id,
    };
  });
  const url = new URL(source.url());
  url.search = new URLSearchParams({
    project: target.project,
    page: target.page,
  }).toString();
  await source.goto(url.href);
  const title = (page) =>
    page.getByRole("textbox", { name: "页面标题", exact: true });
  await title(source).waitFor();
  assert.equal(await title(source).inputValue(), "Target page");
  const row = (page, id) =>
    page.locator(`.studio-sidebar .studio-tree-row[data-library-id="${id}"]`);
  await row(source, target.page).hover();
  await row(source, target.page).locator(".studio-row-menu").click();
  const opening = application.waitForEvent("window");
  await source
    .getByRole("menuitem", { name: "在新窗口打开", exact: true })
    .click();
  const opened = await opening;
  opened.setDefaultTimeout(15000);
  opened.on("pageerror", (error) => errors.push(error.message));
  await title(opened).waitFor();
  assert.equal(await title(opened).inputValue(), "Target page");
  assert.equal(new URL(opened.url()).searchParams.has("focus"), false);
  const header = opened.locator(".studio-window-topbar");
  const addressRow = opened.locator(".studio-address-row");
  await addressRow.getByText("ShowAI", { exact: true }).waitFor();
  await addressRow.locator(".studio-address-brand img").waitFor();
  const tab = header.getByRole("tab", { name: /Target page/ });
  const lock = header.locator(".studio-sidebar-lock");
  const centerY = async (element) => {
    const box = await element.boundingBox();
    return box.y + box.height / 2;
  };
  assert.ok(
    Math.abs(
      (await centerY(lock)) - (await centerY(tab.locator("span").last())),
    ) < 1,
  );
  const address = opened.locator(".studio-address");
  const navigation = addressRow.locator(".studio-address-navigation");
  const toolbar = addressRow.locator(".studio-topbar");
  const waitForSidebarLayout = (visible) =>
    opened.waitForFunction((visible) => {
      const box = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const tools = box(".studio-address-tools");
      const bar = box(".studio-address-row > .studio-topbar");
      const side = box(".studio-sidebar-shell");
      const main = box(".studio-main");
      return (
        tools.x === 0 &&
        tools.right === bar.x &&
        bar.right === innerWidth &&
        tools.bottom === side.top &&
        Math.abs(main.x - (visible ? bar.x : 0)) < 0.5
      );
    }, visible);
  assert.deepEqual(
    await navigation
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
    ["后退", "前进", "在侧栏中定位当前页面"],
  );
  await row(opened, target.page).waitFor();
  const windowSize = await opened.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await opened.setViewportSize({ width: 760, height: 640 });
  const resizer = opened.getByRole("separator", { name: "调整侧栏宽度" });
  const tabLeft = (await tab.boundingBox()).x;
  assert.ok(tabLeft < (await resizer.boundingBox()).x);
  await resizer.press("End");
  await waitForSidebarLayout(true);
  assert.equal(
    await resizer.getAttribute("aria-valuenow"),
    await resizer.getAttribute("aria-valuemax"),
  );
  assert.equal((await tab.boundingBox()).x, tabLeft);
  const addressBox = await address.boundingBox();
  const actionsBox = await opened
    .locator(".studio-header-actions")
    .boundingBox();
  assert.ok(addressBox.y + addressBox.height <= actionsBox.y);
  await resizer.dblclick();
  await opened.setViewportSize(windowSize);
  await waitForSidebarLayout(true);
  await opened.screenshot({
    path: join(output, "full-window.png"),
    fullPage: true,
  });
  result.checks.push(
    "A native window puts navigation beside the address and keeps tabs in place when the sidebar is resized",
  );

  const sidebarSearch = opened.locator(".studio-sidebar").getByRole("button", {
    name: "搜索",
    exact: true,
  });
  const newEntry = opened.locator(".studio-new-project");
  const searchBox = await sidebarSearch.boundingBox();
  assert.ok(searchBox.y + searchBox.height <= (await newEntry.boundingBox()).y);
  const jump = opened.getByRole("dialog", { name: "快速跳转" });
  const query = jump.getByRole("combobox");
  const match = jump
    .getByRole("group", { name: "页面", exact: true })
    .getByRole("option", { name: /Other page/ });
  await opened.keyboard.press("ControlOrMeta+k");
  await query.fill("Other page");
  const shortcutResult = await match.innerText();
  await query.press("Escape");
  await jump.waitFor({ state: "detached" });
  await sidebarSearch.click();
  await query.waitFor();
  assert.ok(await query.evaluate((input) => input === document.activeElement));
  await opened.keyboard.type("Other page");
  assert.equal(await match.innerText(), shortcutResult);
  await match.click();
  await opened.waitForFunction(
    () =>
      document.querySelector('input[aria-label="页面标题"]')?.value ===
      "Other page",
  );
  assert.equal(await title(source).inputValue(), "Target page");
  result.checks.push(
    "Sidebar search above New and the keyboard shortcut open the same focused Quick Jump and find the same page",
    "The new window can navigate to a search result while the source keeps its original page",
  );

  await navigation.getByRole("button", { name: "后退", exact: true }).click();
  await opened.waitForFunction(
    () =>
      document.querySelector('input[aria-label="页面标题"]')?.value ===
      "Target page",
  );
  await navigation.getByRole("button", { name: "前进", exact: true }).click();
  await opened
    .locator('.studio-page-title-input[value="Other page"]')
    .waitFor();
  result.checks.push(
    "Back and forward restore both pages from the address bar",
  );

  await row(opened, target.project).locator(".studio-tree-chevron").click();
  await row(opened, target.other).waitFor({ state: "hidden" });
  const toolbarBeforeHide = await toolbar.boundingBox();
  const docsToggle = addressRow.getByRole("button", {
    name: "ShowAI 文档",
    exact: true,
  });
  await docsToggle.click();
  await opened.locator("#studio-docs-navigation").waitFor();
  await lock.click();
  await header.getByRole("tab", { selected: true }).hover({
    position: { x: 6, y: 8 },
  });
  const sidebar = (mode) =>
    opened.locator(`.studio-sidebar-shell[data-sidebar-mode="${mode}"]`);
  await sidebar("hidden").waitFor({ state: "attached" });
  await waitForSidebarLayout(false);
  assert.deepEqual(await toolbar.boundingBox(), toolbarBeforeHide);
  await docsToggle.click();
  await sidebar("revealed").locator("#studio-docs-navigation").waitFor();
  await docsToggle.click();
  await header.getByRole("tab", { selected: true }).hover();
  await waitForSidebarLayout(false);
  await opened.locator(".studio-sidebar-edge").hover();
  await waitForSidebarLayout(true);
  assert.deepEqual(await toolbar.boundingBox(), toolbarBeforeHide);
  await navigation
    .getByRole("button", { name: "在侧栏中定位当前页面" })
    .click();
  await sidebar("revealed")
    .locator(`.studio-tree-row.is-located[data-library-id="${target.other}"]`)
    .waitFor();
  await lock.click();
  await sidebar("docked").locator(".studio-sidebar").waitFor();
  result.checks.push(
    "Reveal expands the hidden sidebar to the current page and pin docks it again",
  );
  assert.deepEqual(await opened.getByRole("alert").allTextContents(), []);
  assert.deepEqual(errors, []);
  await opened.close();
  assert.equal(await title(source).inputValue(), "Target page");
  result.passed = true;
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  if (application) {
    for (const [index, window] of application.windows().entries()) {
      await window.screenshot({
        path: join(output, `failure-${index}.png`),
        fullPage: true,
      });
      await writeFile(
        join(output, `failure-${index}.txt`),
        await window.locator("body").innerText(),
      );
    }
  }
  process.exitCode = 1;
} finally {
  if (application) await application.close();
  result.rendererErrors = errors;
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
