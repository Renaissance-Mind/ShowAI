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
    await page.locator(".container-page .tiptap").waitFor();
  };
  await open();
  const native = page.locator(".document-content > .tableWrapper table");
  const basic = page.locator(".document-widget .sb-table");
  const basicControls = page.locator(".table-hover-controls");
  const styles = (locator) =>
    locator.evaluateAll((cells) =>
      cells.map((cell) => getComputedStyle(cell).textAlign),
    );
  const bodyFont = await page
    .locator(".document-content > p")
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize);
  for (const cells of [
    native.locator("th, td, p"),
    basic.locator("th, td, input"),
  ]) {
    assert.ok(
      (
        await cells.evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).fontSize),
        )
      ).every((size) => size === bodyFont),
      "Table text must match the document font size",
    );
  }
  for (const headers of [native.locator("th"), basic.locator("th")]) {
    assert.ok(
      (
        await headers.evaluateAll((elements) =>
          elements.map((element) =>
            parseFloat(getComputedStyle(element).paddingTop),
          ),
        )
      ).every((padding) => padding <= 16),
      "Headers must not reserve blank space for controls",
    );
  }
  const stableHover = async (table, toolbar) => {
    await table.locator("th").nth(1).hover();
    await toolbar.waitFor();
    assert.equal(
      (await toolbar.innerText()).trim(),
      "",
      "Controls must contain icons without a visible table label",
    );
    const owner = await toolbar.getAttribute("data-table-controls-owner");
    await page.evaluate((owner) => {
      window.tableHoverRemovals = 0;
      window.tableHoverObserver = new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.removedNodes) {
            if (
              node instanceof Element &&
              node.getAttribute("data-table-controls-owner") === owner &&
              (node.classList.contains("table-global-alignment") ||
                node.classList.contains("sb-table-global-alignment"))
            )
              window.tableHoverRemovals++;
          }
      });
      window.tableHoverObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }, owner);
    const tableRect = await table.boundingBox();
    const controlRect = await toolbar.boundingBox();
    await page.mouse.move(
      controlRect.x + controlRect.width / 2,
      tableRect.y + 5,
    );
    await page.mouse.move(
      controlRect.x + controlRect.width / 2,
      tableRect.y - 3,
    );
    await page.waitForTimeout(350); // Pause deliberately in the gap between table and controls.
    await toolbar.waitFor();
    await page.mouse.move(
      controlRect.x + controlRect.width / 2,
      controlRect.y + controlRect.height / 2,
      { steps: 12 },
    );
    await page.waitForTimeout(350);
    assert.equal(
      await page.evaluate(() => window.tableHoverRemovals),
      0,
      "Crossing slowly into controls must never remove or recreate them",
    );
    await page.evaluate(() => window.tableHoverObserver.disconnect());
  };
  await stableHover(
    native,
    page.locator(".document-table-controls.table-global-alignment"),
  );
  await stableHover(
    basic.locator("table"),
    page.locator(".table-hover-controls.sb-table-global-alignment"),
  );
  result.checks.push(
    "Stable slow hover into controls, compact headers, icon-only controls and body-sized table text",
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
    .getByRole("button", { name: "表格右对齐", exact: true })
    .click();
  assert.ok(
    (await styles(native.locator("th, td"))).every(
      (value) => value === "right",
    ),
  );
  await native.locator("td").first().click({ button: "right" });
  await page
    .getByRole("dialog", { name: "表格对齐设置" })
    .getByRole("button", { name: "表格居中", exact: true })
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
    .getByRole("button", { name: "表格居中", exact: true })
    .click();
  result.checks.push(
    "Native table header hover, column alignment, corner controls, context menu and inherited alignment in new rows",
  );

  await basic.locator("th").nth(1).hover();
  const headerInput = await basic.locator("th input").nth(1).boundingBox();
  const columnControl = await page
    .locator(".table-hover-controls.sb-table-column-alignment")
    .boundingBox();
  assert.ok(
    headerInput.y >= columnControl.y + columnControl.height,
    "Column controls must not cover header text",
  );
  await basicControls
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
  await page
    .locator(".table-hover-controls.sb-table-global-alignment")
    .getByRole("button", { name: "表格居中", exact: true })
    .click();
  assert.ok(
    (await styles(basic.locator("th, td"))).every(
      (value) => value === "center",
    ),
  );
  await basic.locator("td").first().click({ button: "right" });
  await page
    .getByRole("dialog", { name: "表格对齐设置" })
    .getByRole("button", { name: "表格左对齐", exact: true })
    .click();
  assert.ok(
    (await styles(basic.locator("th, td"))).every((value) => value === "left"),
  );
  await basic.locator("th").nth(1).hover();
  await basicControls
    .getByRole("button", { name: "第 2 列居中", exact: true })
    .click();
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
  const findNode = (node, type) =>
    node.type === type
      ? node
      : node.content?.map((child) => findNode(child, type)).find(Boolean);
  const savedNative = findNode(saved.document.content, "table");
  const savedBasic = findNode(saved.document.content, "widget").attrs.data;
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
  const viewerFont = await viewer
    .locator(".portable-content > p")
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize);
  assert.ok(
    (
      await viewer
        .locator(".portable-content th, .portable-content td")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).fontSize),
        )
    ).every((size) => size === viewerFont),
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
