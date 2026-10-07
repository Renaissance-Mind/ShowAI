// Real development workbench, filesystem and component compiler; isolated library/profile.
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
const output = await mkdtemp(join(root, "output/playwright/viewport-lock-"));
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
  const project = await api("projects:create", { name: "阅读锁验收" });
  const created = await api("pages:create", {
    projectId: project.id,
    title: "阅读锁交互",
  });
  const catalog = await api("components:list", { scope: "builtin" });
  const source = await api("components:source", {
    id: "flowchart",
    scope: "builtin",
  });
  const derived = await api("components:save", {
    projectId: project.id,
    ...source,
    manifest: {
      ...source.manifest,
      id: "reading-lock-flow",
      name: "沙盒阅读锁流程图",
    },
  });
  const widget = (kind, id) => ({
    type: "widget",
    attrs: {
      id,
      kind,
      data: catalog.find((item) => item.kind === kind).defaultData,
    },
  });
  const paragraph = (id) => ({
    type: "paragraph",
    attrs: { id },
    content: [{ type: "text", text: "正常阅读滚动内容。".repeat(170) }],
  });
  const content = {
    ...created.document.content,
    content: [
      widget("flowchart", "flow-one"),
      widget("flowchart", "flow-two"),
      widget("g2-bar", "chart-one"),
      {
        type: "surface",
        attrs: { id: "board-one", kind: "board", name: "锁定白板" },
        content: [
          {
            type: "widget",
            attrs: {
              id: "board-toggle",
              kind: "toggle",
              data: {
                title: "点击仍可展开",
                summary: "点击仍可展开",
                content: "锁定时也能阅读内容。",
                open: false,
              },
            },
          },
          widget("flowchart", "board-flow"),
        ],
      },
      {
        type: "widget",
        attrs: {
          id: "sandbox-flow",
          kind: "custom",
          data: {
            componentId: derived.id,
            version: derived.version,
            integrity: derived.integrity,
            props: derived.defaultData,
          },
        },
      },
      paragraph("reading-tail"),
    ],
  };
  await api("pages:save", {
    projectId: project.id,
    pageId: created.document.id,
    baseHash: created.hash,
    baseRevision: created.revision,
    document: {
      ...created.document,
      content,
      surfaceViews: {
        [content.attrs.id]: {
          initial: null,
          saved: [],
          readingOrder: content.content.map((node) => node.attrs.id),
        },
        "board-one": {
          initial: null,
          saved: [],
          readingOrder: ["board-toggle", "board-flow"],
        },
      },
      layout: {
        ...created.document.layout,
        "board-one": {
          x: 0,
          y: 0,
          width: 760,
          height: 520,
          heightMode: "fixed",
        },
        "board-toggle": { x: 30, y: 30, width: 320 },
        "board-flow": { x: 450, y: 30, width: 640 },
      },
    },
  });
  await page
    .getByRole("button", { name: "阅读锁验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /阅读锁交互/ })
    .first()
    .click();
  const rootPage = page.locator(
    `[data-container-root="${created.document.content.attrs.id}"]`,
  );
  const flow = page.locator('[data-block-id="flow-one"] .sf-block');
  const viewport = flow.locator(".react-flow__viewport");
  const matrix = () => viewport.getAttribute("style");
  await flow.getByRole("button", { name: "解锁流程图", exact: true }).waitFor();
  await delay(500);
  await flow.scrollIntoViewIfNeeded();
  const before = await matrix();
  const box = await flow.locator(".react-flow").boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  const scroll = await rootPage.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 180);
  await poll(
    () => rootPage.evaluate((element) => element.scrollTop),
    (value) => value > scroll + 30,
    "locked flow passes reading wheel",
  );
  assert.equal(await matrix(), before);
  await flow.scrollIntoViewIfNeeded();
  const card = flow.locator(".sf-node").first();
  await card.click();
  assert.equal(await flow.locator(".sf-node.is-selected").count(), 1);
  await card.evaluate((element) => {
    element.addEventListener(
      "contextmenu",
      () => {
        element.dataset.contextReceived = "yes";
      },
      { once: true },
    );
  });
  await card.click({ button: "right" });
  assert.equal(await card.getAttribute("data-context-received"), "yes");
  await page.keyboard.press("Escape");
  await flow.getByRole("button", { name: "解锁流程图", exact: true }).click();
  await page.mouse.move(box.x + 20, box.y + 40);
  const unlockedBefore = await matrix();
  await page.mouse.wheel(0, -100);
  await poll(
    matrix,
    (value) => value !== unlockedBefore,
    "unlocked flow zooms",
  );
  await flow.getByRole("button", { name: "锁定流程图", exact: true }).click();
  await delay(600);
  const lockedMatrix = await matrix();
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  const nodeBeforeDrag = await card.locator("..").getAttribute("style");
  await page.mouse.move(cardBox.x + 40, cardBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 120, cardBox.y + 100, { steps: 8 });
  await page.mouse.up();
  assert.equal(await matrix(), lockedMatrix);
  assert.equal(await card.locator("..").getAttribute("style"), nodeBeforeDrag);
  result.checks.push(
    "Flowchart defaults locked, passes wheel to Page, retains click/contextmenu, unlocks zoom, relocks drag",
  );

  await flow.getByRole("button", { name: "解锁流程图", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "阅读锁验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /阅读锁交互/ })
    .first()
    .click();
  await flow.getByRole("button", { name: "锁定流程图", exact: true }).waitFor();
  await page
    .locator('[data-block-id="flow-two"]')
    .getByRole("button", { name: "解锁流程图", exact: true })
    .waitFor();
  result.checks.push(
    "Lock persistence after reload is independent per component instance",
  );
  const chart = page.locator('[data-block-id="chart-one"] .sb-g2-chart');
  await chart.scrollIntoViewIfNeeded();
  await poll(
    () => chart.locator(".sb-g2-plot").getAttribute("aria-busy"),
    (value) => value === "false",
    "chart ready",
  );
  assert.equal(
    await chart
      .locator("[data-surface-gesture]")
      .getAttribute("data-surface-gesture"),
    "",
  );
  await chart
    .getByRole("combobox", { name: "图表主题", exact: true })
    .selectOption("dark");
  await chart.getByRole("button", { name: "解锁图表", exact: true }).click();
  assert.equal(
    await chart
      .locator("[data-surface-gesture]")
      .getAttribute("data-surface-gesture"),
    "x y zoom",
  );
  result.checks.push(
    "G2 releases reading gestures while locked and keeps theme controls interactive",
  );

  const board = page.locator('[data-container-root="board-one"]');
  await board.scrollIntoViewIfNeeded();
  const world = () =>
    board.locator(".surface-world").first().getAttribute("style");
  await delay(600);
  const boardBefore = await world();
  const boardBox = await board.boundingBox();
  await page.mouse.move(boardBox.x + 20, boardBox.y + 100);
  const boardScroll = await rootPage.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 150);
  await poll(
    () => rootPage.evaluate((element) => element.scrollTop),
    (value) => value > boardScroll + 20,
    "locked board passes scroll",
  );
  assert.equal(await world(), boardBefore);
  await board.scrollIntoViewIfNeeded();
  await board.locator(".sb-toggle > summary").click();
  assert.equal(await board.locator(".sb-toggle").getAttribute("open"), "");
  await board.getByRole("button", { name: "解锁白板", exact: true }).click();
  await page.mouse.move(boardBox.x + 20, boardBox.y + 100);
  await page.mouse.wheel(120, 0);
  await poll(world, (value) => value !== boardBefore, "unlocked board pans");
  await board.getByRole("button", { name: "锁定白板", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "阅读锁验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /阅读锁交互/ })
    .first()
    .click();
  await board.scrollIntoViewIfNeeded();
  await board.getByRole("button", { name: "解锁白板", exact: true }).waitFor();
  await page
    .locator('[data-surface-id="board-one"]')
    .getByRole("button", { name: "展开 锁定白板", exact: true })
    .click();
  await board.locator('.page-surface[data-viewport-locked="false"]').waitFor();
  assert.equal(
    await board.getByRole("button", { name: /^(解锁|锁定)白板$/ }).count(),
    0,
  );
  await page.getByRole("button", { name: "返回上层", exact: true }).click();
  await board.getByRole("button", { name: "解锁白板", exact: true }).waitFor();
  result.checks.push(
    "embedded Board keeps click interaction, passes locked wheel to Page and restores its lock after an unlocked expanded view",
  );
  const sandboxHost = page.locator('[data-block-id="sandbox-flow"]');
  await sandboxHost.scrollIntoViewIfNeeded();
  const sandbox = sandboxHost.frameLocator("iframe");
  await sandbox
    .getByRole("button", { name: "解锁流程图", exact: true })
    .waitFor();
  const frameBox = await sandboxHost.locator("iframe").boundingBox();
  const sandboxScroll = await rootPage.evaluate((element) => element.scrollTop);
  await page.mouse.move(frameBox.x + 20, frameBox.y + 80);
  await page.mouse.wheel(0, 150);
  await poll(
    () => rootPage.evaluate((element) => element.scrollTop),
    (value) => value > sandboxScroll + 20,
    "sandbox forwards locked reading scroll",
  );
  await sandbox
    .getByRole("button", { name: "解锁流程图", exact: true })
    .click();
  await sandbox
    .getByRole("button", { name: "锁定流程图", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "阅读锁验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /阅读锁交互/ })
    .first()
    .click();
  await sandboxHost.scrollIntoViewIfNeeded();
  await sandbox
    .getByRole("button", { name: "锁定流程图", exact: true })
    .waitFor();
  result.checks.push(
    "A real compiled sandbox component forwards locked wheel and persists its own lock through the host",
  );
  await page.screenshot({
    path: join(output, "reading-lock.png"),
    fullPage: true,
  });
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
