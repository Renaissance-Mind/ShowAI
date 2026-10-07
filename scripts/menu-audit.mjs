// Capture the current native desktop menu surfaces with isolated, real data.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { _electron } from "playwright";

const root = resolve(import.meta.dirname, "..");
const status = JSON.parse(
  execFileSync(
    process.execPath,
    [join(root, "scripts/dev-open.mjs"), "--status"],
    { encoding: "utf8" },
  ),
);
assert.equal(status.ready, true);
assert.equal(status.root, root);
assert.equal(status.mode, "desktop");
assert.equal(status.branch, "main");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/menu-audit-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_DEV_URL: status.url,
  SHOWAI_DEV_RUNTIME: resolve(status.cli.args[0], "../.."),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  args: [join(root, ".showai-dev/desktop-5173/desktop")],
  cwd: root,
  env,
});
const page = await app.firstWindow();
const result = { output, passed: false, steps: [], errors: [] };
page.on("pageerror", (error) => result.errors.push(error.message));
page.setDefaultTimeout(15000);
await page.setViewportSize({ width: 1440, height: 1000 });
const api = (action, args = {}) =>
  page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
    action,
    args,
  });
const paragraph = (text) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const capture = async (label) => {
  const number = String(result.steps.length + 1).padStart(2, "0");
  const path = join(output, `${number}-${label}.png`);
  await page.screenshot({ path, animations: "disabled" });
  const menus = await page
    .locator(
      '[role="toolbar"], [role="group"][aria-label], [role="dialog"], .sb-header, .sf-controls, .viewport-lock-button, .sb-g2-toolbar, .custom-props-trigger, .sb-primitive-editor, .surface-object-header',
    )
    .evaluateAll((elements) =>
      elements
        .filter(
          (el) =>
            el.getBoundingClientRect().width &&
            el.getBoundingClientRect().height,
        )
        .map((el) => ({
          tag: el.tagName,
          classes: el.className,
          label: el.getAttribute("aria-label"),
          controls: Array.from(
            el.querySelectorAll("button,summary,select"),
            (button) =>
              button.getAttribute("aria-label") || button.textContent.trim(),
          ),
        })),
    );
  result.steps.push({ number, label, path, menus });
};
try {
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  assert.equal((await api("app:info")).home, env.SHOWAI_HOME);
  const project = await api("projects:create", { name: "菜单入口检查" });
  const open = async (title, content) => {
    const record = await api("pages:create", {
      projectId: project.id,
      document: { id: randomUUID(), title, content: { type: "doc", content } },
    });
    const url = new URL(status.url);
    url.searchParams.set("project", project.id);
    url.searchParams.set("page", record.document.id);
    url.searchParams.set("focus", "1");
    await page.goto(url.href);
    await page.locator(".container-page .tiptap").waitFor();
    return record;
  };
  await open("文档菜单", [
    paragraph("检查文字选择、表格选择、悬停和右键菜单。"),
    {
      type: "table",
      content: Array.from({ length: 3 }, (_, row) => ({
        type: "tableRow",
        content: Array.from({ length: 3 }, (_, col) => ({
          type: row ? "tableCell" : "tableHeader",
          content: [paragraph(`${row + 1}-${col + 1}`)],
        })),
      })),
    },
  ]);
  await page.locator(".document-content > p").first().click({ clickCount: 3 });
  await page.getByRole("toolbar", { name: "选中文字格式" }).waitFor();
  await capture("text-selection");
  const table = page.locator(".document-content > .tableWrapper table");
  await table.locator("th").first().click();
  await table.locator("th").first().hover();
  await page.locator(".table-global-alignment").waitFor();
  await capture("table-hover");
  await table.locator("td").first().click();
  await table
    .locator("td")
    .nth(4)
    .click({ modifiers: ["Shift"] });
  await capture("table-selection");
  await table.locator("td").nth(4).click({ button: "right" });
  await capture("table-context");
  await page.keyboard.press("Escape");
  const metadata = (
    await Promise.all(
      ["components", "primitives", "g2"].map(async (name) =>
        JSON.parse(
          await readFile(join(root, `resources/catalog/${name}.json`), "utf8"),
        ),
      ),
    )
  ).flat();
  for (const kind of [
    "table",
    "text",
    "image",
    "chart",
    "g2-bar",
    "flowchart",
    "database",
    "gallery",
    "metrics",
    "playground",
    "bookmark",
  ]) {
    const definition = metadata.find((item) => item.kind === kind);
    const data = structuredClone(
      definition.examples?.[0]?.data ?? definition.defaultData,
    );
    await open(`组件入口：${definition.name}`, [
      paragraph("检查组件已有菜单及设置位置。"),
      { type: "widget", attrs: { kind, data } },
    ]);
    const widget = page.locator(`.document-widget[data-widget-kind="${kind}"]`);
    await widget.waitFor();
    if (kind === "g2-bar") await widget.locator(".sb-g2-plot svg").waitFor();
    await widget.hover();
    await capture(`component-${kind}-hover`);
    const headerActions = widget.locator(".sb-header .sb-actions");
    if (await headerActions.count()) {
      await headerActions.hover();
      await capture(`component-${kind}-actions`);
    }
    if (kind === "g2-bar") {
      await widget
        .getByRole("button", { name: "编辑区块", exact: true })
        .click();
      await capture("g2-settings");
    }
    if (kind === "database") {
      await widget.getByLabel("数据库视图与筛选", { exact: true }).click();
      await capture("database-views");
    }
    if (kind === "flowchart") {
      await widget.locator(".react-flow__node").first().click();
      await capture("flow-node-selection");
    }
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "inventory.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await app.close();
  console.log(
    JSON.stringify(
      {
        passed: result.passed,
        output,
        steps: result.steps.length,
        errors: result.errors,
        error: result.error,
      },
      null,
      2,
    ),
  );
}
