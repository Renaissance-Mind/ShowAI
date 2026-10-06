// Exercises the real desktop and exported reader with isolated, persistent files.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import electron from "electron";
import { _electron } from "playwright";
const root = resolve(import.meta.dirname, "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/design-ui-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = {
  passed: false,
  output,
  checks: [],
  rendererErrors: [],
  typography: {},
};
let application, page;
const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });
const fixture = [
  {
    type: "heading",
    attrs: { level: 2 },
    content: [text("从内容出发，组织清楚的表达")],
  },
  paragraph(
    "用清晰的文字层次组织观点，把相关材料放在同一页。标题帮助读者辨认结构，正文展开信息，说明文字补充来源与使用方式。",
  ),
  {
    type: "blockquote",
    content: [paragraph("给内容留出空间，让读者自然地找到重点。")],
  },
  {
    type: "widget",
    attrs: {
      kind: "text",
      data: {
        content:
          "### 基础组件，同一种表达语言\n\n文本、图像与表格使用统一的组件入口，组合自己的页面。",
        format: "markdown",
      },
    },
  },
  {
    type: "widget",
    attrs: {
      kind: "table",
      data: {
        title: "页面中的文字层次",
        columns: ["内容", "用途"],
        rows: [
          ["标题", "组织结构"],
          ["正文", "展开观点"],
          ["说明", "补充来源"],
        ],
      },
    },
  },
];
const style = (locator) =>
  locator.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      size: parseFloat(css.fontSize),
      weight: Number(css.fontWeight),
      line: parseFloat(css.lineHeight),
      family: css.fontFamily,
      color: css.color,
      background: css.backgroundColor,
      radius: css.borderRadius,
    };
  });
const luminance = (rgb) => {
  const colors = rgb
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((value) => value / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return colors[0] * 0.2126 + colors[1] * 0.7152 + colors[2] * 0.0722;
};
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
const screenshot = (name) =>
  page.screenshot({
    path: join(output, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
try {
  application = await _electron.launch({
    executablePath: electron,
    args: [root],
    cwd: root,
    env,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => result.rendererErrors.push(error.message));
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
  const project = await api("projects:create", {
    name: "内容与表达",
    description: "整理想法、视觉材料与可复用的页面。",
  });
  const document = await api("pages:create", {
    projectId: project.id,
    document: {
      id: "design-reading",
      title: "让每一页，都更容易阅读",
      content: { type: "doc", content: fixture },
    },
  });
  await page.reload();
  const createButton = page
    .getByRole("button", { name: "新建项目", exact: true })
    .first();
  await createButton.waitFor();
  const primary = await style(createButton);
  assert.equal(primary.background, "rgb(18, 10, 143)");
  assert.ok(
    contrast(primary.color, primary.background) >= 4.5,
    "primary action remains readable against the chosen anchor color",
  );
  result.primaryContrast = contrast(primary.color, primary.background);
  await screenshot("projects");
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: "Markdown 内置", exact: true }),
    })
    .waitFor();
  await screenshot("components");
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: "Markdown 内置", exact: true }),
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", { name: "让内容更容易理解", exact: true })
    .waitFor();
  const docs = await style(
      dialog.locator(".catalog-reference-section li").first(),
    ),
    overviewTitle = await style(
      dialog.locator(".catalog-reference-section h3").first(),
    );
  assert.ok(overviewTitle.size > docs.size);
  result.typography.documentation = docs;
  await screenshot("component-overview");
  await page.setViewportSize({ width: 700, height: 850 });
  const left = await dialog.locator(".catalog-documentation").boundingBox(),
    right = await dialog.locator(".catalog-live-example").boundingBox();
  assert.ok(
    right.y >= left.y + left.height,
    "explanation and example stack without horizontal clipping",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await dialog
    .getByRole("button", { name: "插入页面", exact: true })
    .scrollIntoViewIfNeeded();
  await screenshot("component-overview-narrow");
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "项目", exact: true })
    .click();
  await page
    .locator(".studio-project-card > button:first-child")
    .filter({
      has: page.getByRole("heading", { name: "内容与表达", exact: true }),
    })
    .click();
  await page
    .getByRole("button", { name: /让每一页，都更容易阅读/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "文档内容", exact: true }).waitFor();
  result.typography.editor = await style(page.locator(".document-content"));
  result.typography.basicText = await style(
    page.locator(".sb-rich-text").first(),
  );
  assert.equal(result.typography.editor.size, result.typography.basicText.size);
  assert.equal(
    result.typography.editor.family,
    result.typography.basicText.family,
  );
  await screenshot("editor");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  const darkBody = await style(page.locator(".document-content")),
    darkPaper = await style(page.locator(".studio"));
  assert.ok(contrast(darkBody.color, darkPaper.background) >= 4.5);
  await screenshot("editor-dark");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const exported = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(root, "dist-agent/cli.mjs"),
        "export",
        "--project",
        project.id,
        "--page",
        document.document.id,
        "--format",
        "html",
        "--out",
        join(output, "reading.html"),
        "--json",
      ],
      { env, encoding: "utf8" },
    ),
  ).data;
  const opened = application.waitForEvent("window");
  await application.evaluate(async ({ BrowserWindow }, path) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    await window.loadFile(path);
  }, exported.path);
  const reader = await opened;
  await reader.setViewportSize({ width: 1440, height: 1000 });
  await reader
    .getByRole("heading", { name: "让每一页，都更容易阅读", exact: true })
    .waitFor();
  result.typography.reader = await style(reader.locator(".portable-content"));
  assert.equal(result.typography.reader.size, result.typography.editor.size);
  assert.equal(
    result.typography.reader.family,
    result.typography.editor.family,
  );
  assert.equal(result.typography.reader.line, result.typography.editor.line);
  await reader.screenshot({
    path: join(output, "reader.png"),
    fullPage: true,
    animations: "disabled",
  });
  await reader.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await reader.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await reader.screenshot({
    path: join(output, "reader-narrow.png"),
    fullPage: true,
    animations: "disabled",
  });
  const file = JSON.parse(
    await readFile(
      join(
        env.SHOWAI_HOME,
        "projects",
        project.id,
        "pages",
        `${document.document.id}.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(file.document.title, "让每一页，都更容易阅读");
  result.checks.push(
    "chosen accent and accessible primary action",
    "shared typography in editor, builtin text and offline reader",
    "responsive component overview and mobile reader",
    "neutral dark theme with readable text",
    "real project and page creation, navigation and source-preserving export",
  );
  assert.deepEqual(result.rendererErrors, []);
  result.passed = true;
} catch (error) {
  result.error = String(error.stack || error);
  if (page) await screenshot("failure");
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  if (application) await application.close();
}
console.log(JSON.stringify(result, null, 2));
