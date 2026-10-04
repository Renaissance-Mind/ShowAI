// Real browser workbench, canonical files, reload and offline HTML export.
// Build first: npm run build. Run: node scripts/table-ui-smoke.mjs.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const repository = resolve(import.meta.dirname, "..");
await mkdir(join(repository, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(repository, "output/playwright/table-ui-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, output, checks: [], errors: [] };
const paragraph = (value) => ({
  type: "paragraph",
  content: [{ type: "text", text: value }],
});
let app, page, serverProcess;
try {
  const server = spawn(
    process.execPath,
    [join(repository, "dist-agent/cli.mjs"), "serve", "--no-open", "--json"],
    { cwd: repository, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  serverProcess = server;
  const startup = await new Promise((done, reject) => {
    let text = "";
    server.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) done(JSON.parse(text.split("\n")[0]).data);
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Server exited ${code}`)));
  });
  app = await chromium.launch({ headless: true });
  const context = await app.newContext();
  page = await context.newPage();
  await page.goto(startup.url);
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => result.errors.push(error.message));
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
  const project = await api("projects:create", { name: "表格对齐验收" });
  const record = await api("pages:create", {
    projectId: project.id,
    document: {
      id: "table-alignment-acceptance",
      title: "表格对齐",
      content: {
        type: "doc",
        content: [
          paragraph("悬停表头调整单列，表格右上角或右键统一调整。"),
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: ["名称", "数量", "说明"].map((value) => ({
                  type: "tableHeader",
                  content: [paragraph(value)],
                })),
              },
              ...[
                ["文本框", "3", "观点与解释"],
                ["图像框", "2", "视觉材料"],
              ].map((row) => ({
                type: "tableRow",
                content: row.map((value) => ({
                  type: "tableCell",
                  content: [paragraph(value)],
                })),
              })),
            ],
          },
          paragraph("组件库的基础表格同样支持对齐："),
          {
            type: "widget",
            attrs: {
              kind: "table",
              data: {
                title: "基础内容对照",
                columns: ["组件", "数量", "内容"],
                rows: [
                  ["文本框", 3, "观点与解释"],
                  ["基础表格", 1, "二维对照"],
                ],
              },
            },
          },
        ],
      },
    },
  });
  const read = () =>
    api("pages:get", { projectId: project.id, pageId: record.document.id });
  const open = async () => {
    await page.reload();
    await page
      .getByRole("button", { name: "表格对齐验收", exact: true })
      .click();
    await page
      .getByRole("button", { name: /表格对齐$/ })
      .first()
      .click();
    await page.locator(".surface-document .tiptap").waitFor();
  };
  await open();
  const native = page.locator(".document-content > .tableWrapper table");
  const basic = page.locator(".document-widget .sb-table");
  const styles = (locator) =>
    locator.evaluateAll((cells) =>
      cells.map((cell) => getComputedStyle(cell).textAlign),
    );
  await native.locator("tr").first().locator("th").nth(1).hover();
  await page
    .locator(".document-table-controls.table-column-alignment")
    .getByRole("button", { name: "第 2 列居中", exact: true })
    .click();
  assert.deepEqual(await styles(native.locator("tr > :nth-child(2)")), [
    "center",
    "center",
    "center",
  ]);
  assert.deepEqual(await styles(native.locator("tr > :first-child")), [
    "left",
    "left",
    "left",
  ]);
  await native.locator("th").nth(1).hover();
  await page.screenshot({ path: join(output, "native-column.png") });
  await page
    .locator(".document-table-controls.table-global-alignment")
    .getByRole("button", { name: "整个表格右对齐", exact: true })
    .click();
  assert.ok(
    (await styles(native.locator("th, td"))).every(
      (value) => value === "right",
    ),
  );
  await native.locator("td").first().click({ button: "right" });
  await page
    .getByRole("dialog", { name: "表格对齐设置" })
    .getByRole("button", { name: "整个表格居中", exact: true })
    .click();
  assert.ok(
    (await styles(native.locator("th, td"))).every(
      (value) => value === "center",
    ),
  );
  await native.locator("th").nth(1).hover();
  await page
    .locator(".table-column-alignment")
    .getByRole("button", { name: "第 2 列右对齐", exact: true })
    .click();
  const geometry = () =>
    page
      .locator(".document-content > p, .document-content > .tableWrapper")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        }),
      );
  const beforeSelection = await geometry();
  await native.locator("td").last().click();
  assert.deepEqual(
    await geometry(),
    beforeSelection,
    "Selecting a table must not move document content",
  );
  await native.locator("td").last().hover();
  await page.getByRole("button", { name: "表格操作", exact: true }).click();
  const triggerRect = await page
    .getByRole("button", { name: "表格操作", exact: true })
    .boundingBox();
  const tableRect = await native.boundingBox();
  assert.ok(
    Math.abs(
      triggerRect.x + triggerRect.width - tableRect.x - tableRect.width,
    ) < 15,
    "Table operations must be anchored to the table's right edge",
  );
  assert.ok(
    Math.abs(triggerRect.y + triggerRect.height - tableRect.y) < 10,
    "Table operations must float above the table",
  );
  assert.deepEqual(
    await geometry(),
    beforeSelection,
    "Opening the operations menu must not change document layout",
  );
  await page.screenshot({ path: join(output, "table-menu.png") });
  await page
    .getByRole("menu", { name: "表格操作菜单" })
    .getByRole("menuitem", { name: "添加行", exact: true })
    .click();
  assert.deepEqual(await styles(native.locator("tr > :nth-child(2)")), [
    "right",
    "right",
    "right",
    "right",
  ]);
  await native.locator("th").nth(1).hover();
  await page
    .locator(".table-global-alignment")
    .getByRole("button", { name: "整个表格居中", exact: true })
    .click();
  result.checks.push(
    "Native table header hover, column alignment, corner controls, context menu and inherited alignment in new rows",
  );

  await basic.locator("th").nth(1).hover();
  const headerInput = await basic.locator("th input").nth(1).boundingBox();
  const columnControl = await basic
    .locator(".sb-table-column-alignment")
    .nth(1)
    .boundingBox();
  assert.ok(
    headerInput.y >= columnControl.y + columnControl.height,
    "Column controls must not cover header text",
  );
  await basic
    .getByRole("button", { name: "第 2 列右对齐", exact: true })
    .click();
  assert.deepEqual(await styles(basic.locator("tr > :nth-child(2)")), [
    "right",
    "right",
    "right",
  ]);
  assert.equal(
    await basic
      .locator("tbody input")
      .nth(1)
      .evaluate((input) => getComputedStyle(input).textAlign),
    "right",
  );
  await basic.locator("th").nth(1).hover();
  await page.screenshot({ path: join(output, "basic-column.png") });
  await basic
    .locator(".sb-table-global-alignment")
    .getByRole("button", { name: "整个表格居中", exact: true })
    .click();
  assert.ok(
    (await styles(basic.locator("th, td"))).every(
      (value) => value === "center",
    ),
  );
  await basic.locator("td").first().click({ button: "right" });
  await basic
    .getByRole("dialog", { name: "表格对齐设置" })
    .getByRole("button", { name: "整个表格左对齐", exact: true })
    .click();
  assert.ok(
    (await styles(basic.locator("th, td"))).every((value) => value === "left"),
  );
  await basic.locator("th").nth(1).hover();
  await basic.getByRole("button", { name: "第 2 列居中", exact: true }).click();
  await basic.getByRole("button", { name: "添加行", exact: true }).click();
  assert.deepEqual(await styles(basic.locator("tr > :nth-child(2)")), [
    "center",
    "center",
    "center",
    "center",
  ]);
  result.checks.push(
    "Basic table column and whole-table alignment, inherited input styling and added rows",
  );
  await page.locator(".studio-save-state.saved").waitFor();
  const saved = await read();
  const savedNative = saved.document.content.content.find(
    (node) => node.type === "table",
  );
  const savedBasic = saved.document.content.content.find(
    (node) => node.type === "widget",
  ).attrs.data;
  assert.equal(savedNative.attrs.textAlign, "center");
  assert.deepEqual(savedBasic.columnAlignments, [null, "center", null]);
  await open();
  assert.ok(
    (await styles(native.locator("th, td"))).every(
      (value) => value === "center",
    ),
  );
  assert.deepEqual(await styles(basic.locator("tr > :nth-child(2)")), [
    "center",
    "center",
    "center",
    "center",
  ]);
  result.checks.push(
    "Real auto-save, canonical JSON and page reload preserve alignment",
  );

  const html = join(output, "table-alignment.html");
  execFileSync(
    process.execPath,
    [
      join(repository, "dist-agent/cli.mjs"),
      "export",
      "--project",
      project.id,
      "--page",
      record.document.id,
      "--format",
      "html",
      "--out",
      html,
      "--json",
    ],
    { env, cwd: repository },
  );
  const viewer = await page.context().newPage();
  await viewer.goto(pathToFileURL(html).href);
  await viewer.locator(".portable-content table").first().waitFor();
  assert.ok(
    (
      await styles(
        viewer.locator(".portable-table-scroll th, .portable-table-scroll td"),
      )
    ).every((value) => value === "center"),
  );
  assert.deepEqual(
    await styles(viewer.locator(".sb-table tr > :nth-child(2)")),
    ["center", "center", "center", "center"],
  );
  assert.equal(await viewer.locator(".table-alignment-buttons").count(), 0);
  await viewer.screenshot({ path: join(output, "export.png") });
  result.checks.push(
    "Offline HTML export renders saved alignments without editing controls",
  );
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  if (page && !page.isClosed())
    await page.screenshot({ path: join(output, "failure.png") });
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  if (serverProcess) serverProcess.kill("SIGTERM");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
