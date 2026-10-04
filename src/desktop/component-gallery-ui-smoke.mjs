import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(
  join(root, "output/playwright/component-gallery-"),
);
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: electron,
  args: [root],
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
  const a = await api("projects:create", { name: "项目 A" }),
    b = await api("projects:create", { name: "项目 B" });
  const ca = await api("components:createExample", { projectId: a.id });
  await api("components:createExample", { projectId: b.id });
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("目录项目", { exact: true }).inputValue(),
    "all",
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".studio-component-card").length === 16,
  );
  const picker = await page.locator(".component-project-picker").boundingBox();
  const button = await page
    .getByRole("button", { name: "导入组件", exact: true })
    .boundingBox();
  assert.ok(
    picker.x + picker.width <= button.x &&
      Math.abs(picker.y + picker.height / 2 - button.y - button.height / 2) < 2,
    "project picker is left of actions on the same row",
  );
  assert.equal(await page.locator(".catalog-scope-controls").count(), 0);
  assert.equal(await page.locator(".studio-component-card footer").count(), 0);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".component-preview-error").length > 0 ||
      document.querySelectorAll(
        '.component-category[aria-label="文本组件"] .component-card-preview img',
      ).length === 6,
    {},
    { timeout: 60000 },
  );
  assert.equal(
    await page.locator(".component-preview-error").count(),
    0,
    JSON.stringify(
      await page
        .locator(".component-preview-error")
        .evaluateAll((els) => els.map((el) => el.title)),
    ),
  );
  await page.screenshot({
    path: join(output, "gallery-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  const nav = page.getByRole("navigation", { name: "组件类型" });
  for (const label of ["图片", "表格", "数据", "流程", "其他"]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(
      (label) => {
        const section = document.querySelector(
          `.component-category[aria-label="${label}组件"]`,
        );
        return (
          section &&
          section.querySelectorAll(".component-card-preview img").length ===
            section.querySelectorAll(".studio-component-card").length
        );
      },
      label,
      { timeout: 60000 },
    );
    await page.screenshot({
      path: join(output, `gallery-${label}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  assert.equal(await page.locator(".component-card-preview img").count(), 16);
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
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: "计数器 项目 B", exact: true }),
    })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "定制组件", exact: true }).click();
  await dialog
    .getByLabel("组件说明", { exact: true })
    .fill("项目 B 的真实组件预览");
  await dialog
    .getByRole("button", { name: "保存项目新版本", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".catalog-component-version")
        ?.textContent.trim() === "1.0.1",
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
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByLabel("目录项目", { exact: true }).selectOption(a.id);
  await page.waitForFunction(
    () => document.querySelectorAll(".studio-component-card").length === 15,
  );
  await page
    .getByRole("navigation", { name: "组件来源" })
    .getByRole("button", { name: "自定义", exact: true })
    .click();
  assert.equal(await page.locator(".studio-component-card").count(), 1);
  await page.locator(".studio-component-card").click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "定制组件", exact: true }).click();
  assert.equal(
    await dialog.getByLabel("组件说明", { exact: true }).inputValue(),
    ca.description,
  );
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByLabel("目录项目", { exact: true }).selectOption("all");
  await page.waitForFunction(
    () => document.querySelectorAll(".studio-component-card").length === 3,
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
