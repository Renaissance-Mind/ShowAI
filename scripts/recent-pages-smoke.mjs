// Real Electron development renderer and filesystem, isolated from the user's library.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import electron from "electron";
import { _electron } from "playwright";

const root = resolve(import.meta.dirname, "..");
const status = JSON.parse(
  (
    await promisify(execFile)(
      process.execPath,
      ["scripts/dev-open.mjs", "--status"],
      { cwd: root },
    )
  ).stdout,
);
assert.equal(status.ready, true);
assert.equal(status.mode, "desktop");
assert.equal(status.root, root);
assert.equal(status.branch, "main");
assert.equal(status.url, "http://127.0.0.1:5173/");
const session = JSON.parse(
  await readFile(join(root, ".showai-dev/desktop-5173/session.json"), "utf8"),
);
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/recent-pages-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_DEV_URL: status.url,
  SHOWAI_DEV_RUNTIME: session.runtime,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electron,
  args: [join(root, ".showai-dev/desktop-5173/desktop"), "--no-focus"],
  cwd: root,
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
const result = { passed: false, output, checks: [], errors: [] };
page.on("pageerror", (error) => result.errors.push(error.message));
const api = (action, args = {}) =>
  page.evaluate(
    async ({ action, args }) => {
      const result = await window.showai.invoke(action, args);
      return result;
    },
    { action, args },
  );
const poll = async (read, test, label) => {
  const end = Date.now() + 20000;
  let value;
  while (Date.now() < end) {
    value = await read();
    if (test(value)) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
};
const nav = () =>
  page.getByRole("navigation", { name: "主要导航", exact: true });
const rows = () => page.locator("[data-recent-page]");
const rowIds = () =>
  rows().evaluateAll((elements) => elements.map((el) => el.dataset.recentPage));
const clickNav = async (name) => {
  const shell = page.locator(".studio-sidebar-shell");
  if (await shell.count()) {
    const mode = await shell.getAttribute("data-sidebar-mode");
    if (mode === "hidden") {
      await page.mouse.move(2, 400);
      await poll(
        () => shell.getAttribute("data-sidebar-mode"),
        (mode) => mode === "overlay",
        "sidebar reveal",
      );
    }
  }
  await nav().getByRole("button", { name, exact: true }).click();
};
const checkNav = async () => {
  const layout = await nav()
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect(),
          style = getComputedStyle(button);
        return {
          label: button.getAttribute("aria-label"),
          text: button.textContent.trim(),
          iconCount: button.querySelectorAll("svg").length,
          selected: button.matches(".active, [aria-current], [aria-pressed]"),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fontSize: style.fontSize,
          overflow: button.scrollWidth > button.clientWidth,
        };
      }),
    );
  assert.deepEqual(
    layout.map((item) => item.label),
    ["最近", "模板", "组件", "设置"],
  );
  for (const item of layout) {
    assert.equal(item.text, "");
    assert.equal(item.iconCount, 1);
    assert.equal(item.selected, false);
    assert.equal(item.y, layout[3].y);
    assert.equal(item.height, 32);
    assert.equal(item.fontSize, "14px");
    assert.ok(Math.abs(item.width - layout[3].width) < 1);
    assert.equal(item.overflow, false);
  }
  assert.equal(await page.locator(".studio-main-nav").count(), 1);
  // Move away after activation: neither the route nor pointer focus should leave a highlight.
  await page.mouse.move(700, 350);
  await poll(
    () =>
      nav()
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const style = getComputedStyle(button);
            return [style.backgroundColor, style.color];
          }),
        ),
    (styles) =>
      styles.every(
        (style) => JSON.stringify(style) === JSON.stringify(styles[0]),
      ) && styles[0][0] === "rgba(0, 0, 0, 0)",
    "navigation stays neutral after clicking",
  );
  return layout;
};
try {
  await nav().waitFor();
  await page
    .getByRole("heading", { name: "暂无最近编辑的页面", exact: true })
    .waitFor();
  result.layout = await checkNav();
  for (const label of ["最近", "模板", "组件", "设置"]) {
    const button = nav().getByRole("button", { name: label, exact: true });
    assert.equal(await button.getAttribute("title"), label);
    await button.hover();
    const tooltip = page.locator(".showai-icon-tooltip:popover-open");
    if (await page.locator(".showai-icon-tooltip").count()) {
      await poll(
        () => tooltip.textContent(),
        (text) => text === label,
        `hover tooltip ${label}`,
      );
    }
    await page.mouse.move(700, 350);
    await poll(
      () => button.getAttribute("title"),
      (title) => title === label,
      `hover ends ${label}`,
    );
  }
  result.checks.push(
    "Four icon-only navigation controls show their label on hover and never keep a selected state after activation",
  );
  const a = await api("projects:create", { name: "视觉研究" });
  const b = await api("projects:create", { name: "产品设计" });
  const older = await api("pages:create", {
    projectId: a.id,
    title: "共同页面",
  });
  await api("pages:pin", {
    projectId: a.id,
    pageId: older.document.id,
    pinned: true,
    baseHash: older.hash,
    baseRevision: older.revision,
  });
  const newest = await api("pages:create", {
    projectId: b.id,
    title: "共同页面",
  });
  const third = await api("pages:create", {
    projectId: a.id,
    title: "研究进展",
  });
  await poll(
    rowIds,
    (ids) => ids.length === 3,
    "all projects visible without opening their trees",
  );
  assert.deepEqual(await rowIds(), [
    third.document.id,
    newest.document.id,
    older.document.id,
  ]);
  assert.equal(
    await page
      .locator(
        `[data-recent-page="${older.document.id}"] .studio-recent-page-project`,
      )
      .textContent(),
    "视觉研究",
  );
  assert.equal(
    await page
      .locator(
        `[data-recent-page="${newest.document.id}"] .studio-recent-page-project`,
      )
      .textContent(),
    "产品设计",
  );
  result.checks.push(
    "All projects contribute pages; descending edit time ignores pin priority and distinguishes duplicate page names by project",
  );

  await page
    .locator(`[data-recent-page="${older.document.id}"] button`)
    .click();
  await page.getByRole("textbox", { name: "页面标题", exact: true }).waitFor();
  const lock = page.getByRole("button", { name: "锁定项目栏", exact: true });
  await page.mouse.move(2, 400);
  if (await lock.count()) await lock.click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "页面标题", exact: true })
      .inputValue(),
    "共同页面",
  );
  assert.equal(
    await page
      .locator(".studio-breadcrumb")
      .getByRole("button", { name: "视觉研究", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("textbox", { name: "页面标题", exact: true })
    .fill("修改后的页面");
  await clickNav("最近");
  await poll(
    rowIds,
    (ids) => ids[0] === older.document.id,
    "saved edit becomes most recent",
  );
  assert.equal(
    await rows().first().locator("strong").textContent(),
    "修改后的页面",
  );
  const saved = await api("pages:get", {
    projectId: a.id,
    pageId: older.document.id,
  });
  assert.equal(saved.document.title, "修改后的页面");
  result.checks.push(
    "Recent opens the correct project/page; navigation flushes edits to disk and updates order and title",
  );

  await clickNav("模板");
  await page.getByRole("heading", { name: "模板", exact: true }).waitFor();
  await checkNav();
  await clickNav("组件");
  await page.getByRole("heading", { name: "组件", exact: true }).waitFor();
  await checkNav();
  await clickNav("设置");
  await page
    .getByRole("navigation", { name: "设置分类", exact: true })
    .waitFor();
  await checkNav();
  assert.equal(
    await nav()
      .getByRole("button", { name: "设置", exact: true })
      .getAttribute("aria-current"),
    null,
  );
  await clickNav("最近");
  await rows().first().waitFor();
  await nav().getByRole("button", { name: "设置", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("navigation", { name: "设置分类", exact: true })
    .waitFor();
  await clickNav("最近");
  result.checks.push(
    "Templates, components and settings retain existing views; the same footer stays available in settings and supports keyboard activation",
  );

  await api("projects:rename", { projectId: b.id, name: "产品迭代" });
  await poll(
    () =>
      page
        .locator(
          `[data-recent-page="${newest.document.id}"] .studio-recent-page-project`,
        )
        .textContent(),
    (name) => name === "产品迭代",
    "project rename refreshes provenance",
  );
  await api("pages:remove", { projectId: b.id, pageId: newest.document.id });
  await poll(
    rowIds,
    (ids) => ids.length === 2 && !ids.includes(newest.document.id),
    "archived page removed",
  );
  await api("projects:remove", { projectId: a.id });
  await page
    .getByRole("heading", { name: "暂无最近编辑的页面", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "暂无最近编辑的页面", exact: true })
    .waitFor();
  result.checks.push(
    "Project rename refreshes sources; archived pages and projects are excluded and stay excluded after reload",
  );

  const long = await api("pages:create", {
    projectId: b.id,
    title: "这是一份用于窄窗口验收的较长页面名称",
  });
  await poll(
    rowIds,
    (ids) => ids.includes(long.document.id),
    "restored recent list",
  );
  await page.setViewportSize({ width: 780, height: 620 });
  const resize = page.getByRole("separator", {
    name: "调整项目栏宽度",
    exact: true,
  });
  await resize.focus();
  await page.keyboard.press("Home");
  assert.equal(await resize.getAttribute("aria-valuenow"), "200");
  await checkNav();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: join(output, "recent-narrow-dark.png") });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.setViewportSize({ width: 1320, height: 880 });
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: join(output, "recent-desktop.png") });
  result.checks.push(
    "Four equal 32px controls remain on one line at the 200px sidebar minimum and in dark theme",
  );
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  await app.close();
  console.log(JSON.stringify(result, null, 2));
}
