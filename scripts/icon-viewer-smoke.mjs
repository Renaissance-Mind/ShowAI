// Development Electron renderer + real IPC/filesystem, with isolated content and profile.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron } from "playwright";

const root = resolve(import.meta.dirname, "..");
const status = JSON.parse(
  execFileSync(process.execPath, ["scripts/dev-open.mjs", "--status"], {
    cwd: root,
    encoding: "utf8",
  }),
);
assert.equal(status.ready, true);
assert.equal(status.root, root);
assert.equal(status.branch, "main");
assert.equal(status.mode, "desktop");
assert.equal(status.home, "/Users/chunqiu/.showai");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/icon-viewer-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_DEV_URL: status.url,
  SHOWAI_DEV_RUNTIME: resolve(status.cli.args[0], "../.."),
  SHOWAI_VIEWER: join(
    resolve(status.cli.args[0], "../.."),
    "assets/viewer.html",
  ),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, output, checks: [], errors: [] };
let app, page;
try {
  app = await _electron.launch({
    args: [join(root, ".showai-dev/desktop-5173/desktop")],
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => result.errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  assert.equal((await api("app:info")).home, env.SHOWAI_HOME);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "图标", exact: true }).click();
  const viewer = page.getByRole("region", { name: "应用图标浏览器" });
  await viewer.waitFor();
  const registry = await readFile(join(root, "src/ui/icons.ts"), "utf8");
  const count = registry
    .match(/export \{([\s\S]+?)\}/)[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean).length;
  assert.equal(await viewer.locator(".icon-viewer-tile").count(), count);
  assert.equal(await viewer.locator(".icon-viewer-tile svg").count(), count);
  if (
    await viewer.getByRole("button", { name: "搜索图标", exact: true }).count()
  )
    await viewer.getByRole("button", { name: "搜索图标", exact: true }).click();
  await page.screenshot({
    animations: "disabled",
    path: join(output, "viewer.png"),
  });
  await viewer.locator('input[aria-label="搜索图标"]').fill("FolderMinus");
  assert.equal(await viewer.locator(".icon-viewer-tile").count(), 1);
  await viewer
    .getByRole("button", { name: "FolderMinus", exact: true })
    .click();
  await viewer
    .getByRole("slider", { name: "图标尺寸", exact: true })
    .fill("40");
  await viewer
    .getByRole("slider", { name: "图标线宽", exact: true })
    .fill("2.5");
  assert.equal(
    await viewer.locator(".icon-viewer-specimen svg").getAttribute("width"),
    "40",
  );
  assert.equal(
    await viewer
      .locator(".icon-viewer-specimen svg")
      .getAttribute("stroke-width"),
    "2.5",
  );
  await viewer.getByRole("button", { name: "复制名称", exact: true }).click();
  await viewer
    .getByRole("status")
    .filter({ hasText: "已复制图标名称" })
    .waitFor();
  assert.equal(
    await app.evaluate(({ clipboard }) => clipboard.readText()),
    "FolderMinus",
  );
  await viewer.getByRole("button", { name: "复制 SVG", exact: true }).click();
  await viewer.getByRole("status").filter({ hasText: "已复制 SVG" }).waitFor();
  const svg = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /width="40"/);
  assert.match(svg, /stroke-width="2.5"/);
  await app.evaluate(({ session }, output) => {
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(`${output}/${item.getFilename()}`);
      item.once("done", (_event, state) => {
        globalThis.iconDownloadState = state;
      });
    });
  }, output);
  await viewer.getByRole("button", { name: "下载 SVG", exact: true }).click();
  const deadline = Date.now() + 10000;
  while (
    (await app.evaluate(() => globalThis.iconDownloadState)) !== "completed"
  ) {
    if (Date.now() > deadline)
      throw new Error("Electron SVG download did not complete");
    await page.waitForTimeout(100);
  }
  assert.equal(await readFile(join(output, "FolderMinus.svg"), "utf8"), svg);
  if (
    await viewer.getByRole("button", { name: "搜索图标", exact: true }).count()
  )
    await viewer.getByRole("button", { name: "搜索图标", exact: true }).click();
  await viewer.locator('input[aria-label="搜索图标"]').fill("no-such-icon");
  assert.equal(await viewer.locator(".icon-viewer-tile").count(), 0);
  await viewer.getByRole("button", { name: "显示全部图标" }).click();
  await viewer.getByRole("button", { name: "文件与项目", exact: true }).click();
  const subset = await viewer.locator(".icon-viewer-tile").count();
  assert.ok(subset > 0 && subset < count);
  await viewer.getByRole("button", { name: "全部", exact: true }).click();
  await viewer.getByRole("button", { name: "深色", exact: true }).click();
  assert.equal(
    await viewer
      .locator(".icon-viewer-specimen")
      .evaluate((el) => getComputedStyle(el).color),
    "rgb(237, 237, 237)",
  );
  await page.setViewportSize({ width: 780, height: 800 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  assert.equal(
    await viewer.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.screenshot({
    animations: "disabled",
    path: join(output, "viewer-narrow-dark.png"),
  });
  await viewer.getByRole("button", { name: "重置图标预览" }).click();
  assert.equal(
    await viewer.locator(".icon-viewer-specimen svg").getAttribute("width"),
    "24",
  );
  result.checks.push(
    `All ${count} registry icons render; search, category, empty state, preview controls, clipboard, SVG download and narrow/dark layout pass`,
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "返回工作区" }).click();
  const project = await api("projects:create", { name: "图标菜单验收" });
  const paragraph = (text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  const record = await api("pages:create", {
    projectId: project.id,
    document: {
      id: "icon-menu-page",
      title: "菜单图标",
      content: {
        type: "doc",
        content: [
          paragraph("段落样式验收"),
          {
            type: "table",
            content: Array.from({ length: 2 }, (_, row) => ({
              type: "tableRow",
              content: [1, 2].map((column) => ({
                type: row ? "tableCell" : "tableHeader",
                content: [paragraph(`${row}-${column}`)],
              })),
            })),
          },
        ],
      },
    },
  });
  await page.reload();
  await page.getByRole("button", { name: "图标菜单验收", exact: true }).click();
  await page.getByRole("button", { name: "导出网站", exact: true }).click();
  const assertIcons = async (menu) => {
    await menu.waitFor();
    const missing = await menu
      .locator('button[role="menuitem"]')
      .evaluateAll((buttons) =>
        buttons
          .filter((el) => !el.querySelector("svg"))
          .map((el) => el.textContent),
      );
    assert.deepEqual(missing, []);
  };
  await assertIcons(page.getByRole("menu", { name: "网站导出方式" }));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const row = page.locator(`[data-library-id="${record.document.id}"]`);
  await row.locator(".studio-tree-main").click();
  await page.locator(".container-page .tiptap").waitFor();
  await page.getByRole("button", { name: "页面操作", exact: true }).click();
  await assertIcons(page.getByRole("menu", { name: "菜单图标的操作" }));
  await page.screenshot({
    animations: "disabled",
    path: join(output, "page-menu.png"),
  });
  await page.keyboard.press("Escape");
  const table = page.locator(".document-content .tableWrapper table").first();
  await table.locator("th").first().click({ button: "right" });
  const tableMenu = page.getByRole("menu", { name: "表格操作菜单" });
  await assertIcons(tableMenu);
  await page.screenshot({
    animations: "disabled",
    path: join(output, "table-menu.png"),
  });
  await tableMenu
    .getByRole("menuitem", { name: "添加行", exact: true })
    .click();
  assert.equal(await table.locator("tr").count(), 3);
  result.checks.push(
    "Project export, page actions and table context menus have icons; keyboard dismiss and real table action pass",
  );
  await page.keyboard.press("Escape");
  const textBlock = page
    .locator(".container-page .tiptap > p")
    .filter({ hasText: "段落样式验收" });
  await textBlock.click();
  await textBlock.hover();
  await page
    .getByRole("button", { name: "移动或管理内容块", exact: true })
    .click();
  const styles = page.getByRole("group", { name: "内容块样式", exact: true });
  assert.equal(await styles.locator("button svg").count(), 4);
  await styles.getByRole("button", { name: "标题 2", exact: true }).click();
  await page
    .locator(".container-page .tiptap > h2")
    .filter({ hasText: "段落样式验收" })
    .waitFor();
  result.checks.push(
    "Paragraph/heading icon choices preserve the target block and perform the formatting action",
  );
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.failure = error.stack;
  if (page) {
    await page.screenshot({
      animations: "disabled",
      path: join(output, "failure.png"),
    });
    result.ui = await page.locator("body").innerText();
  }
  process.exitCode = 1;
} finally {
  await app?.close();
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
