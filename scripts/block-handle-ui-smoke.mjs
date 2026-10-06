// Real local workbench and files. Build first: npm run build.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/block-handle-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, output, checks: [], errors: [] };
let browser, server, page;
const paragraph = (id, text) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
try {
  server = spawn(
    process.execPath,
    [
      join(root, "dist-runtime/scripts/cli.mjs"),
      "serve",
      "--no-open",
      "--json",
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const startup = await new Promise((done, reject) => {
    let text = "";
    server.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes("\n")) done(JSON.parse(text.split("\n")[0]).data);
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Server exited ${code}`)));
  });
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page.goto(startup.url);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  const project = await api("projects:create", { name: "块手柄验收" });
  const created = await api("pages:create", {
    projectId: project.id,
    document: {
      id: "block-handle-acceptance",
      title: "块手柄验收",
      content: {
        type: "surface",
        content: [
          {
            type: "region",
            attrs: { id: "handle-region", name: "手柄操作" },
            content: [
              paragraph("first-block", "第一段：鼠标向左移动到拖动手柄。"),
              paragraph("second-block", "第二段：停留、点击和拖动时保持可用。"),
              paragraph("third-block", "第三段：移开后正常隐藏。"),
            ],
          },
        ],
      },
      layout: {
        "handle-region": {
          x: 0,
          y: 0,
          width: 700,
          mode: "flow",
          columns: 2,
          gap: 24,
        },
      },
      views: { initial: null, saved: [], readingOrder: ["handle-region"] },
    },
  });
  await page
    .getByRole("button", { name: "块手柄验收", exact: true })
    .first()
    .click();
  await page.locator(".studio-page-list-open").first().click();
  const editor = page.locator(".tiptap").first();
  const block = (id) => editor.locator(`[data-block-id="${id}"]`);
  const handle = page.getByRole("button", {
    name: "移动或管理内容块",
    exact: true,
  });
  await block("first-block").waitFor();
  // Pauses inside the gap are deliberately longer than the hide delay.
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 850, height: 960 },
    { width: 600, height: 960 },
  ]) {
    await page.setViewportSize(viewport);
    await page
      .getByRole("button", { name: "显示全部内容", exact: true })
      .count()
      .then(async (count) => {
        if (count)
          await page
            .getByRole("button", { name: "显示全部内容", exact: true })
            .click();
      });
    await block("first-block").hover({ position: { x: 30, y: 8 } });
    await handle.waitFor();
    const blockRect = await block("first-block").boundingBox();
    const handleRect = await handle.boundingBox();
    const barRect = await page.locator(".block-handle").boundingBox();
    const y = Math.max(
      blockRect.y + 3,
      Math.min(blockRect.y + 8, handleRect.y + handleRect.height / 2),
    );
    await page.mouse.move(blockRect.x + 2, y, { steps: 8 });
    const bridgeX = (blockRect.x + barRect.x + barRect.width) / 2;
    await page.mouse.move(bridgeX, y, { steps: 8 });
    await page.waitForTimeout(650);
    assert.equal(
      await handle.count(),
      1,
      "Handle must remain present while paused between the content and the handle",
    );
    await page.mouse.move(
      handleRect.x + handleRect.width / 2,
      handleRect.y + handleRect.height / 2,
      { steps: 8 },
    );
    await page.waitForTimeout(650);
    assert.equal(
      await handle.count(),
      1,
      "Handle must remain present while the pointer is on it",
    );
    await handle.click();
    await page.locator(".block-menu").waitFor();
    await page.waitForTimeout(650);
    assert.equal(await page.locator(".block-menu").count(), 1);
    await page.keyboard.press("Escape");
    result.checks.push(
      `Slow leftward crossing, stationary hover and menu click at ${viewport.width}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await block("first-block").hover({ position: { x: 30, y: 8 } });
  const drag = await handle.boundingBox();
  const destination = await block("third-block").boundingBox();
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    drag.x + drag.width / 2 + 12,
    drag.y + drag.height / 2,
    { steps: 6 },
  );
  await page.waitForTimeout(650);
  assert.equal(
    await handle.count(),
    1,
    "Handle must remain available during a drag",
  );
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height - 2,
    { steps: 16 },
  );
  await page.mouse.up();
  await page.locator(".studio-save-state.saved").waitFor();
  const saved = await api("pages:get", {
    projectId: project.id,
    pageId: created.document.id,
  });
  const order = saved.document.content.content[0].content.map(
    (node) => node.attrs.id,
  );
  assert.notEqual(
    order.indexOf("first-block"),
    0,
    "Native drag must actually reorder the block",
  );
  assert.equal(new Set(order).size, 3);
  result.checks.push(
    "Native drag crosses the handle boundary, remains active after the delay and persists reordered blocks",
  );
  await block("second-block").hover();
  await handle.waitFor();
  await page.mouse.move(300, 50);
  await page.waitForTimeout(100);
  assert.equal(
    await handle.count(),
    1,
    "Leaving the block must allow a short grace period",
  );
  await page.waitForTimeout(500);
  assert.equal(
    await handle.count(),
    0,
    "Handle must hide after the pointer leaves the interaction area",
  );
  await page.screenshot({ path: join(output, "verified.png") });
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  if (page && !page.isClosed())
    await page.screenshot({ path: join(output, "failure.png") });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill("SIGTERM");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
