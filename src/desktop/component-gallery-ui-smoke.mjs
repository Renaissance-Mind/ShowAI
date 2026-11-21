import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

process.env.SHOWAI_LANGUAGE ??= "zh-CN";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(
  join(root, "output/playwright/component-gallery-"),
);
const env = {
  ...desktopTestEnvironment(),
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: process.env.SHOWAI_SMOKE_BINARY || electron,
  args: process.env.SHOWAI_SMOKE_BINARY ? [] : [root],
  cwd: root,
  env,
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const result = { passed: false, output, errors };
try {
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.showai.invoke("components:previewData");
        return "allowed";
      } catch (reason) {
        return reason.code;
      }
    }),
    "INVALID_PATH",
    "capture data stays restricted to the hidden preview frame",
  );
  const builtinItems = await api("components:list", { scope: "builtin" });
  assert.equal(
    builtinItems.find((item) => item.kind === "text").name,
    "富文本",
  );
  for (const kind of ["image", "table", "toggle", "callout", "divider", "code"])
    assert.ok(builtinItems.some((item) => item.kind === kind));
  const a = await api("projects:create", { name: "项目 A" }),
    b = await api("projects:create", { name: "项目 B" });
  const ca = await api("components:createExample", { projectId: a.id });
  await api("components:createExample", { projectId: b.id });
  const catalogCount = (items) =>
    new Set(
      items.map((item) =>
        "kind" in item ? item.kind : item.scope + "/" + item.id,
      ),
    ).size;
  const shared = await api("components:list", { scope: "all" });
  const sharedCount = catalogCount(shared);
  const sharedCustomCount = catalogCount(
    shared.filter((item) => !("kind" in item)),
  );
  const { projects } = await api("projects:scan");
  const localCounts = await Promise.all(
    projects.map(async (project) =>
      catalogCount(
        await api("components:list", {
          scope: "project",
          projectId: project.id,
        }),
      ),
    ),
  );
  const allProjectCount = localCounts.reduce(
    (total, count) => total + count,
    0,
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("目录项目", { exact: true }).inputValue(),
    "all",
  );
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(".studio-component-card").length === expected,
    sharedCount + allProjectCount,
  );
  const picker = await page.locator(".component-project-picker").boundingBox();
  const button = await page
    .getByRole("button", { name: "导入组件…", exact: true })
    .boundingBox();
  assert.ok(
    picker.x + picker.width <= button.x &&
      Math.abs(picker.y + picker.height / 2 - button.y - button.height / 2) < 2,
    "project picker is left of actions on the same row",
  );
  assert.equal(await page.locator(".catalog-scope-controls").count(), 0);
  assert.equal(await page.locator(".studio-component-card footer").count(), 0);
  const card = (name, owner) => {
    const items = page
      .locator(".studio-component-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    return owner
      ? items.filter({ has: page.getByText(owner, { exact: true }) })
      : items;
  };
  await card("富文本")
    .locator(".component-card-preview img")
    .waitFor({ timeout: 60000 });
  await page.screenshot({
    path: join(output, "gallery-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await card("富文本").click();
  const markdownDialog = page.getByRole("dialog", {
    name: "富文本",
    exact: true,
  });
  await markdownDialog
    .getByLabel("组件示例", { exact: true })
    .selectOption({ label: "代码与分隔线" });
  await markdownDialog.locator(".sb-text pre code").waitFor();
  assert.equal(await markdownDialog.locator(".sb-text hr").count(), 1);
  await markdownDialog
    .getByLabel("组件示例", { exact: true })
    .selectOption({ label: "引用与说明" });
  assert.equal(
    await markdownDialog.locator(".sb-text blockquote strong").innerText(),
    "关键结论",
  );
  await markdownDialog.press("Escape");
  const nav = page.getByRole("navigation", { name: "组件类型" });
  let checked = 0;
  for (const label of [
    "文本",
    "页面与白板",
    "图片",
    "表格",
    "数据",
    "流程",
    "其他",
  ]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    const cards = page
      .getByRole("region", { name: label + "组件", exact: true })
      .locator(".studio-component-card");
    await cards.first().waitFor();
    for (const item of await cards.all()) {
      await item.scrollIntoViewIfNeeded();
      await item
        .locator(".component-card-preview img")
        .waitFor({ timeout: 60000 });
      checked++;
    }
    await cards.first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(output, `gallery-${label}.png`),
      animations: "disabled",
    });
  }
  assert.equal(checked, sharedCount + allProjectCount);
  await nav.getByRole("button", { name: "页面与白板", exact: true }).click();
  for (const name of ["页面", "白板"]) {
    await card(name).click();
    const nativeDialog = page.getByRole("dialog", { name, exact: true });
    await nativeDialog
      .locator(".native-component-preview .container-workspace")
      .waitFor();
    assert.equal(
      await nativeDialog
        .getByRole("button", { name: "定制组件", exact: true })
        .count(),
      0,
    );
    await nativeDialog
      .getByLabel("组件示例", { exact: true })
      .selectOption({ label: "内容示例" });
    await nativeDialog
      .getByText("文字、图片和组件都可以放在这里。", { exact: true })
      .waitFor();
    await page.screenshot({
      path: join(
        output,
        name === "页面" ? "page-detail.png" : "board-detail.png",
      ),
      animations: "disabled",
    });
    await nativeDialog.press("Escape");
  }
  const preview = await api("components:thumbnail", {
    id: "text",
    scope: "builtin",
  });
  assert.ok(preview.startsWith("data:image/png;base64,"));
  const cacheBefore = (
    await readdir(join(output, "profile/component-previews"))
  ).length;
  assert.equal(
    await api("components:thumbnail", { id: "text", scope: "builtin" }),
    preview,
  );
  assert.equal(
    (await readdir(join(output, "profile/component-previews"))).length,
    cacheBefore,
    "repeated preview uses disk cache",
  );
  const darkPreview = await api("components:thumbnail", {
    id: "text",
    scope: "builtin",
    theme: "dark",
  });
  assert.notEqual(
    darkPreview,
    preview,
    "dark previews render different pixels",
  );
  assert.equal(
    await api("components:thumbnail", {
      id: "text",
      scope: "builtin",
      theme: "dark",
    }),
    darkPreview,
    "dark previews reuse their own cache",
  );
  assert.equal(
    (await readdir(join(output, "profile/component-previews"))).length,
    cacheBefore + 1,
    "light and dark previews have separate cache entries",
  );
  const darkImage = await app.evaluate(({ nativeImage }, data) => {
    const image = nativeImage.createFromDataURL(data);
    return [...image.toBitmap().subarray(0, 3)];
  }, darkPreview);
  assert.deepEqual(
    darkImage,
    [34, 34, 34],
    "capture background uses the dark surface",
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByRole("button", { name: "外观", exact: true }).click();
  await page.getByText("深色", { exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  await nav.getByRole("button", { name: "文本", exact: true }).click();
  await card("富文本").click();
  assert.equal(
    await page
      .locator(".catalog-preview-content .sb-text")
      .evaluate((el) => getComputedStyle(el).color),
    await page
      .getByRole("dialog", { name: "富文本" })
      .evaluate((el) => getComputedStyle(el).color),
    "rich text follows the catalog's dark foreground",
  );
  await page.screenshot({
    path: join(output, "markdown-dark.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: "全部", exact: true }).click();
  await card("计数器", "项目 B").click();
  let dialog = page.getByRole("dialog");
  const sandbox = page.frameLocator(".catalog-preview-content iframe");
  await sandbox.locator('html[data-theme="dark"]').waitFor();
  assert.equal(
    await sandbox.locator("body").evaluate((el) => getComputedStyle(el).color),
    "rgb(247, 247, 247)",
    "custom preview receives host theme and tokens",
  );
  await dialog.getByRole("button", { name: "版本操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "复制到项目…", exact: true })
    .click();
  const fork = page.getByRole("dialog", { name: /复制.*计数器.*到项目/ });
  assert.equal(
    await fork.getByRole("combobox").inputValue(),
    b.id,
  );
  await fork.getByLabel("名称", { exact: true }).fill("项目 B 的计数器");
  await fork.getByRole("button", { name: "复制", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".catalog-component-version")
        ?.textContent.trim() === "v1.0.1",
  );
  assert.equal(
    (await api("components:list", { projectId: a.id, scope: "project" }))
      .length,
    1,
    "all-project editing preserves A",
  );
  assert.equal(
    (await api("components:list", { projectId: b.id, scope: "project" }))
      .length,
    2,
    "all-project editing saves back into owner B",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("目录项目", { exact: true }).selectOption(a.id);
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(".studio-component-card").length === expected,
    sharedCount + 1,
  );
  await page
    .getByRole("navigation", { name: "组件来源" })
    .getByRole("button", { name: "自定义", exact: true })
    .click();
  assert.equal(
    await page.locator(".studio-component-card").count(),
    sharedCustomCount + 1,
  );
  await card("计数器").click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "版本", exact: true }).click();
  await dialog
    .getByRole("tabpanel", { name: "版本", exact: true })
    .getByText(ca.version, { exact: false })
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await page.getByLabel("目录项目", { exact: true }).selectOption("all");
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(".studio-component-card").length === expected,
    sharedCustomCount + allProjectCount,
  );
  await page
    .getByRole("navigation", { name: "组件来源" })
    .getByRole("button", { name: "全部", exact: true })
    .click();
  await page.setViewportSize({ width: 700, height: 850 });
  assert.equal(
    await page
      .locator(".studio-scroll")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page
    .locator(".studio-scroll")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: join(output, "gallery-narrow.png"),
    fullPage: true,
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  result.passed = true;
  result.cachedPreviews = cacheBefore;
  result.previewBytes = Buffer.from(preview.split(",")[1], "base64").length;
} catch (error) {
  result.error = String(error.stack || error);
  await page
    .screenshot({ path: join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}
