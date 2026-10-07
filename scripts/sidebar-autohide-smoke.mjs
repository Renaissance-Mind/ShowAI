// Real navigation interactions in an isolated development library/profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const desktop = process.argv.includes("--desktop");
const mode = desktop ? "desktop" : "browser";
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/sidebar-autohide-"));
const freePort = async () => {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
};
const port = await freePort(),
  debugPort = await freePort();
const env = {
  ...process.env,
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_DEV_DEBUG_PORT: String(debugPort),
};
delete env.ELECTRON_RUN_AS_NODE;
const service = spawn(
  process.execPath,
  [
    "scripts/dev.mjs",
    mode,
    "--port",
    String(port),
    "--home",
    join(output, "home"),
    "--no-open",
  ],
  { cwd: root, env },
);
let logs = "";
service.stdout.on("data", (chunk) => {
  logs += chunk;
});
service.stderr.on("data", (chunk) => {
  logs += chunk;
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(read, test, label) {
  const deadline = Date.now() + 30000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (test(value)) return value;
    await delay(100);
  }
  throw new Error(`${label}: ${JSON.stringify(value)}\n${logs.slice(-2000)}`);
}
let browser, page;
const result = { mode, output, passed: false, checks: [], errors: [] };
try {
  await poll(
    () =>
      readFile(
        join(root, `.showai-dev/${mode}-${port}/session.json`),
        "utf8",
      ).then(JSON.parse, (error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    Boolean,
    "development ready",
  );
  browser = desktop
    ? await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
    : await chromium.launch();
  page = desktop ? browser.contexts()[0].pages()[0] : await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 960 });
  if (!desktop) await page.goto(`http://127.0.0.1:${port}`);
  page.on("pageerror", (error) => result.errors.push(error.message));
  const api = (action, args = {}) =>
    page.evaluate(
      async ({ action, args }) => {
        try {
          return await window.showai.invoke(action, args);
        } catch (error) {
          throw new Error(JSON.stringify(error));
        }
      },
      {
        action,
        args,
      },
    );
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const project = await api("projects:create", { name: "导航验收" });
  const created = await api("pages:create", {
    projectId: project.id,
    title: "自动收起交互",
  });
  const shell = page.locator(".studio-sidebar-shell");
  const sidebar = page.locator(".studio-sidebar");
  const modeIs = (expected) =>
    poll(
      () => shell.getAttribute("data-sidebar-mode"),
      (value) => value === expected,
      `sidebar ${expected}`,
    );
  const moveOut = () => page.mouse.move(700, 260);
  const width = () =>
    page
      .locator(".studio-main")
      .evaluate((el) => el.getBoundingClientRect().width);
  const reveal = async () => {
    await page.mouse.move(2, 400);
    await modeIs("overlay");
    await sidebar
      .getByRole("button", { name: "锁定项目栏", exact: true })
      .waitFor();
    await poll(
      () => sidebar.evaluate((el) => el.getBoundingClientRect().x),
      (value) => Math.abs(value) < 1,
      "overlay finishes opening",
    );
    await page.mouse.move(120, 120);
  };
  await moveOut();
  await page.waitForTimeout(650);
  await modeIs("docked");
  result.checks.push("Without an open document, navigation stays docked");
  await sidebar.getByRole("button", { name: "导航验收", exact: true }).click();
  const documentRow = sidebar.locator(
    `[data-library-id="${created.document.id}"]`,
  );
  await page.keyboard.press("Escape");
  await documentRow.locator(".studio-tree-main").click();
  await page.locator(".studio-scroll.has-page-surface").waitFor();
  await modeIs("docked");
  const dockedWidth = await width();
  await moveOut();
  await modeIs("hidden");
  await poll(
    width,
    (value) => value >= dockedWidth + 239,
    "document widens after hiding",
  );
  const expandedWidth = await width();
  assert.equal(await sidebar.evaluate((el) => el.inert), true);
  await reveal();
  assert.equal(await width(), expandedWidth);
  await page.screenshot({ path: join(output, "overlay.png") });
  await moveOut();
  await modeIs("hidden");
  await page.mouse.move(2, 400);
  await page.mouse.move(600, 400);
  await page.waitForTimeout(120);
  await page.mouse.move(120, 120);
  await page.waitForTimeout(500);
  await modeIs("overlay");
  result.checks.push(
    "Leaving collapses and widens the document; edge reveals overlay without reflow; quick re-entry cancels hiding",
  );

  // Portaled row menus must keep the panel and its anchor stable.
  await documentRow.hover();
  await documentRow.getByRole("button", { name: /的操作$/ }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await menu.hover();
  await page.waitForTimeout(550);
  await modeIs("overlay");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await moveOut();
  await page.locator(".studio-main").click({ position: { x: 650, y: 160 } });
  await modeIs("hidden");
  await reveal();
  await documentRow.getByRole("button", { name: /的操作$/ }).click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await moveOut();
  await page.waitForTimeout(550);
  await modeIs("overlay");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.locator(".studio-main").click({ position: { x: 650, y: 160 } });
  await modeIs("hidden");
  result.checks.push(
    "Sidebar context menus and dialogs suspend automatic hiding",
  );

  await page.getByRole("button", { name: "展开项目导航", exact: true }).focus();
  await modeIs("overlay");
  await poll(
    () => sidebar.evaluate((el) => el.contains(document.activeElement)),
    Boolean,
    "keyboard edge reveal transfers focus into navigation",
  );
  await moveOut();
  await page.waitForTimeout(550);
  await modeIs("overlay");
  await page.keyboard.press("Escape");
  await modeIs("hidden");
  result.checks.push(
    "Keyboard reveal keeps navigation open while focused; Escape hides and removes hidden controls from focus",
  );

  await reveal();
  await sidebar
    .getByRole("button", { name: "锁定项目栏", exact: true })
    .click();
  await modeIs("docked");
  await moveOut();
  await page.waitForTimeout(650);
  await modeIs("docked");
  await poll(
    width,
    (value) => Math.abs(value - dockedWidth) < 1,
    "lock reserves navigation width",
  );
  await page.reload();
  await sidebar
    .getByRole("button", {
      name: "解锁项目栏，打开文档后自动收起",
      exact: true,
    })
    .waitFor();
  await sidebar.getByRole("button", { name: "导航验收", exact: true }).click();
  await page.keyboard.press("Escape");
  await documentRow.locator(".studio-tree-main").click();
  await moveOut();
  await page.waitForTimeout(650);
  await modeIs("docked");
  await sidebar
    .getByRole("button", {
      name: "解锁项目栏，打开文档后自动收起",
      exact: true,
    })
    .click();
  await moveOut();
  await modeIs("hidden");
  result.checks.push(
    "Lock docks persistently across reloads; unlocking re-enables hiding",
  );

  await page.setViewportSize({ width: 860, height: 720 });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await reveal();
  assert.equal(
    await sidebar.evaluate((el) => el.getBoundingClientRect().width),
    208,
  );
  await page.screenshot({ path: join(output, "narrow-dark.png") });
  await sidebar
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "项目", exact: true })
    .click();
  await modeIs("docked");
  await moveOut();
  await page.waitForTimeout(650);
  await modeIs("docked");
  await sidebar.getByRole("button", { name: "组件", exact: true }).click();
  await moveOut();
  await page.waitForTimeout(650);
  await modeIs("docked");
  result.checks.push(
    "Narrow/dark overlay renders; leaving the document restores docked navigation in project and component views",
  );

  await page.setViewportSize({ width: 1440, height: 960 });
  const separator = sidebar.getByRole("separator", { name: "调整项目栏宽度" });
  const navigationWidth = () =>
    sidebar.evaluate((el) => el.getBoundingClientRect().width);
  const waitWidth = (expected) =>
    poll(
      navigationWidth,
      (value) => Math.abs(value - expected) < 1,
      `navigation width ${expected}`,
    );
  const dragWidth = async (next, release = true) => {
    const box = await separator.boundingBox();
    const start = box.x + box.width / 2;
    const delta = next - (await navigationWidth());
    await page.mouse.move(start, 450);
    await page.mouse.down();
    await page.mouse.move(start + delta, 450, { steps: 12 });
    if (release) await page.mouse.up();
  };
  await dragWidth(360);
  await waitWidth(360);
  await poll(
    width,
    (value) => value === 1080,
    "docked resize changes document space",
  );
  await dragWidth(20);
  await waitWidth(200);
  await dragWidth(1300);
  await waitWidth(480);
  await dragWidth(360);
  await page.reload();
  await separator.waitFor();
  await waitWidth(360);
  await page.setViewportSize({ width: 600, height: 720 });
  await waitWidth(240);
  assert.equal(await separator.getAttribute("aria-valuemax"), "240");
  await poll(
    width,
    (value) => value === 360,
    "narrow window preserves document space",
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await waitWidth(360);
  result.checks.push(
    "Dragging resizes docked navigation between 200–480px; width persists after reload and temporarily clamps in narrow windows without losing the preference",
  );

  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await waitWidth(352);
  await page.keyboard.press("Shift+ArrowRight");
  await waitWidth(384);
  await page.keyboard.press("Home");
  await waitWidth(200);
  await page.keyboard.press("End");
  await waitWidth(480);
  await separator.dblclick({ position: { x: 4, y: 400 } });
  await waitWidth(240);
  await dragWidth(360);
  await dragWidth(420, false);
  await waitWidth(420);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await waitWidth(360);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("showai:sidebar-width")),
    "360",
  );
  result.checks.push(
    "Keyboard steps and range endpoints work; double-click restores default; Escape cancels an unfinished drag",
  );

  await sidebar.getByRole("button", { name: "导航验收", exact: true }).click();
  await page.keyboard.press("Escape");
  await documentRow.locator(".studio-tree-main").click();
  await moveOut();
  await page.locator(".studio-main").click({ position: { x: 650, y: 160 } });
  await modeIs("hidden");
  await reveal();
  const overlayDocumentWidth = await width();
  await dragWidth(460, false);
  await page.mouse.move(1300, 450, { steps: 12 });
  await page.waitForTimeout(650);
  await modeIs("overlay");
  await waitWidth(480);
  assert.equal(await width(), overlayDocumentWidth);
  await page.mouse.up();
  await modeIs("hidden");
  await reveal();
  await waitWidth(480);
  await page.screenshot({ path: join(output, "resized-overlay.png") });
  await sidebar
    .getByRole("button", { name: "锁定项目栏", exact: true })
    .click();
  await modeIs("docked");
  await poll(width, (value) => value === 960, "locking reserves resized width");
  result.checks.push(
    "Overlay resize stays open throughout captured drag outside the panel, preserves document width, hides after release and shares its saved width with the locked panel",
  );
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.failure = error.stack;
  if (page) {
    await page.screenshot({ path: join(output, "failure.png") });
    result.ui = await page.locator("body").innerText();
  }
  process.exitCode = 1;
} finally {
  if (!desktop) await browser?.close();
  service.kill("SIGTERM");
  await once(service, "exit");
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
