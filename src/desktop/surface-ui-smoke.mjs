// Real Electron, native input and canonical files. Build first: npm run build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import electron from "electron";
import { _electron } from "playwright";

const repository = resolve(import.meta.dirname, "../..");
await mkdir(join(repository, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(repository, "output/playwright/surface-ui-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, output, checks: [], errors: [] };
let app, page;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(read, accept, label) {
  const until = Date.now() + 12000;
  let value;
  while (Date.now() < until) {
    value = await read();
    if (accept(value)) return value;
    await delay(60);
  }
  throw new Error(`Timed out: ${label}: ${JSON.stringify(value)}`);
}
const text = (value) => ({ type: "text", text: value });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });
try {
  app = await _electron.launch({
    executablePath: electron,
    args: [repository],
    cwd: repository,
    env,
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => result.errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 1440, height: 940 });
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  const project = await api("projects:create", { name: "文档与自由画布" });
  const record = await api("pages:create", {
    projectId: project.id,
    document: {
      id: "surface-acceptance",
      title: "从正文出发，展开思考",
      content: {
        type: "doc",
        content: [
          paragraph(
            "正文保持自然阅读与编辑。相关材料可以放到旁边，也可以随时收回正文。",
          ),
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: Array.from({ length: 4 }, (_, i) => ({
                  type: "tableCell",
                  attrs: { colwidth: [420] },
                  content: [paragraph(`可横向阅读的表格列 ${i + 1}`)],
                })),
              },
            ],
          },
          {
            type: "codeBlock",
            content: [
              text("A deliberately wide code line: " + "value + ".repeat(100)),
            ],
          },
          ...Array.from({ length: 24 }, (_, i) =>
            paragraph(
              `${i + 1}. 文档仍然按顺序展开。画布保留空间关系，便于对照与补充材料。`,
            ),
          ),
        ],
      },
    },
  });
  const read = () =>
    api("pages:get", { projectId: project.id, pageId: record.document.id });
  const canvasItems = (record) =>
    record.document.content.content.filter((node) => node.attrs?.canvas);
  await page.reload();
  await page
    .getByRole("button", { name: "文档与自由画布", exact: true })
    .click();
  await page
    .getByRole("button", { name: /从正文出发，展开思考/ })
    .first()
    .click();
  const surface = page.locator(".page-surface");
  const mode = () => surface.getAttribute("data-mode");
  await surface.waitFor();
  assert.equal(await mode(), "document");
  const initialEditor = await page
    .locator(".surface-document .tiptap")
    .elementHandle();
  const scrollTop = () =>
    page.locator(".surface-scroll").evaluate((element) => element.scrollTop);
  const camera = () =>
    page.locator(".surface-world").evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
  await page.mouse.move(980, 500);
  await page.mouse.wheel(3, 500);
  await poll(scrollTop, (n) => n > 300, "native document scroll");
  await delay(260);
  const readingPosition = await scrollTop();
  await page.mouse.wheel(900, 0);
  await delay(400);
  assert.equal(
    await mode(),
    "document",
    "one large horizontal wheel must not escape",
  );
  assert.ok(Math.abs((await camera()).x) < 1, "resistance springs back");
  assert.ok(Math.abs((await scrollTop()) - readingPosition) < 2);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(80, 0);
    await delay(40);
  }
  await poll(
    mode,
    (value) => value === "canvas",
    "deliberate horizontal escape",
  );
  assert.equal(
    await initialEditor.evaluate((node) => node.isConnected),
    true,
    "mode changes keep editor mounted",
  );
  assert.ok(
    Math.abs((await camera()).y + readingPosition) < 2,
    "escape preserves reading position",
  );
  await delay(260);
  const offset = (await camera()).x;
  // Electron's native wheel injection can scale horizontal deltas on Retina.
  // Return with a captured middle-button drag measured in screen pixels.
  await page.mouse.move(950, 500);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(950 - offset, 500, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await poll(
    mode,
    (value) => value === "document",
    "automatic return without peripheral content",
  );
  assert.ok(Math.abs((await scrollTop()) - readingPosition) < 2);
  result.checks.push(
    "native vertical scrolling, elastic resistance, deliberate escape, stable editor DOM and automatic return at the original reading position",
  );

  // Horizontal table scrolling must own even the boundary tail of its gesture.
  await page.locator(".surface-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  const code = page.locator(".surface-document .tableWrapper");
  await code.hover();
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(90, 0);
    await delay(40);
  }
  assert.ok(await code.evaluate((element) => element.scrollLeft > 100));
  assert.equal(await mode(), "document");
  result.checks.push(
    "wide table retains horizontal scrolling without escaping the document",
  );

  await page.getByRole("button", { name: "展开画布", exact: true }).click();
  await page.getByRole("button", { name: "添加内容", exact: true }).click();
  const side = page.locator(".surface-card .tiptap");
  await side.fill("旁注保存在真实页面中");
  await side.press("End");
  await page.keyboard.type(" with spaces");
  assert.match(await side.innerText(), /with spaces/);
  let saved = await poll(
    read,
    (value) => JSON.stringify(canvasItems(value)).includes("with spaces"),
    "side note persistence",
  );
  const id = canvasItems(saved)[0].attrs.id;
  const item = (value) =>
    canvasItems(value).find((node) => node.attrs.id === id);
  const beforeMove = item(saved).attrs.canvas;
  await page.getByRole("button", { name: "缩小画布", exact: true }).click();
  const zoom = (await poll(camera, (value) => value.scale < 1, "zoom frame"))
    .scale;
  const handle = page.getByRole("button", {
    name: "移动画布内容",
    exact: true,
  });
  const rect = await handle.boundingBox();
  await page.mouse.move(rect.x + 30, rect.y + 15);
  await page.mouse.down();
  await page.mouse.move(rect.x + 130, rect.y + 65, { steps: 12 });
  await page.mouse.up();
  saved = await poll(
    read,
    (value) => item(value).attrs.canvas.x > beforeMove.x + 80,
    "scaled card drag",
  );
  assert.ok(
    Math.abs(item(saved).attrs.canvas.x - beforeMove.x - 100 / zoom) < 2,
  );
  assert.ok(
    Math.abs(item(saved).attrs.canvas.y - beforeMove.y - 50 / zoom) < 2,
  );
  const resize = await page
    .getByRole("button", { name: "调整画布内容宽度", exact: true })
    .boundingBox();
  await page.mouse.move(resize.x + 10, resize.y + 10);
  await page.mouse.down();
  await page.mouse.move(resize.x + 90, resize.y + 10, { steps: 10 });
  await page.mouse.up();
  saved = await poll(
    read,
    (value) => item(value).attrs.canvas.width > 400,
    "scaled resize",
  );
  assert.ok(
    Math.abs(item(saved).attrs.canvas.width - beforeMove.width - 80 / zoom) < 2,
  );
  await handle.focus();
  const x = item(saved).attrs.canvas.x;
  await handle.press("Shift+ArrowRight");
  saved = await poll(
    read,
    (value) => item(value).attrs.canvas.x === x + 50,
    "keyboard movement",
  );
  result.checks.push(
    "editable side note, spaces while typing, scaled drag/resize, keyboard movement and canonical filesystem persistence",
  );

  // Escape cancels a partially completed card drag without persisting it.
  const originalPosition = item(saved).attrs.canvas;
  const cancelHandle = await handle.boundingBox();
  await page.mouse.move(cancelHandle.x + 20, cancelHandle.y + 12);
  await page.mouse.down();
  await page.mouse.move(cancelHandle.x + 75, cancelHandle.y + 40, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await delay(550);
  assert.deepEqual(item(await read()).attrs.canvas, originalPosition);
  await page.getByRole("button", { name: "回到正文", exact: true }).click();
  assert.equal(
    await mode(),
    "canvas",
    "existing content prevents automatic mode collapse",
  );
  await page.getByRole("button", { name: "总览画布内容", exact: true }).click();
  await page.screenshot({ path: join(output, "canvas-overview.png") });
  await page.getByRole("button", { name: "定位内容", exact: true }).click();
  await page.getByRole("button", { name: "删除画布内容", exact: true }).click();
  await poll(
    read,
    (value) => canvasItems(value).length === 0,
    "delete side note",
  );
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await poll(read, (value) => item(value), "undo delete");
  await page.reload();
  await page
    .getByRole("button", { name: "文档与自由画布", exact: true })
    .click();
  await page
    .getByRole("button", { name: /从正文出发，展开思考/ })
    .first()
    .click();
  await page.getByRole("button", { name: "定位内容", exact: true }).click();
  assert.match(await side.innerText(), /with spaces/);
  assert.deepEqual(item(await read()).attrs.canvas, originalPosition);
  result.checks.push(
    "Escape cancellation, canvas retained with side content, deletion undo and complete reload recovery",
  );

  // Export through the real CLI and open its standalone, offline reader.
  const exported = JSON.parse(
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
        join(output, "canvas.html"),
        "--json",
      ],
      { env, encoding: "utf8" },
    ),
  ).data;
  const opened = app.waitForEvent("window");
  await app.evaluate(async ({ BrowserWindow }, path) => {
    const reader = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    await reader.loadFile(path);
  }, exported.path);
  const reader = await opened;
  reader.on("pageerror", (error) => result.errors.push(error.message));
  await reader.setViewportSize({ width: 1200, height: 860 });
  await reader.locator(".page-surface").waitFor();
  await reader.getByRole("button", { name: "定位内容", exact: true }).click();
  assert.match(
    await reader.locator(".surface-card").innerText(),
    /with spaces/,
  );
  assert.equal(await reader.locator('[contenteditable="true"]').count(), 0);
  await reader
    .getByRole("button", { name: "总览画布内容", exact: true })
    .click();
  await reader.screenshot({ path: join(output, "exported-canvas.png") });
  await reader.emulateMedia({ media: "print" });
  assert.equal(
    await reader
      .locator(".surface-card")
      .evaluate((node) => getComputedStyle(node).position),
    "static",
  );
  assert.equal(await reader.locator(".surface-toolbar").isVisible(), false);
  await reader.emulateMedia({ media: "screen", reducedMotion: "reduce" });
  await reader.setViewportSize({ width: 390, height: 844 });
  await reader.getByRole("button", { name: "回到正文", exact: true }).click();
  const toolbar = await reader.locator(".surface-toolbar").boundingBox();
  assert.ok(toolbar.x >= 0 && toolbar.x + toolbar.width <= 391);
  await reader.screenshot({ path: join(output, "reader-mobile.png") });
  result.checks.push(
    "offline HTML preserves spatial content; reader is read-only, narrow-screen controls stay visible and print linearizes all content",
  );
  await reader.close();

  await page.getByRole("button", { name: "收回正文", exact: true }).click();
  saved = await poll(
    read,
    (value) =>
      canvasItems(value).length === 0 &&
      JSON.stringify(value.document.content).includes("with spaces"),
    "dock note into body",
  );
  await page.getByRole("button", { name: "回到正文", exact: true }).click();
  assert.equal(await mode(), "document");
  assert.equal(await page.locator(".surface-card").count(), 0);
  assert.match(
    await page.locator(".surface-document .tiptap").innerText(),
    /with spaces/,
  );
  assert.deepEqual(result.errors, []);
  await writeFile(
    join(output, "saved-page.json"),
    JSON.stringify(saved.document, null, 2),
  );
  const disk = JSON.parse(await readFile(saved.path, "utf8"));
  assert.match(JSON.stringify(disk), /with spaces/);
  result.checks.push(
    "docking side content back into the document retains all text and saves the canonical file",
  );
  await page.locator(".surface-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  const originalBlockId = saved.document.content.content[0].attrs.id;
  await page.locator(".surface-document .tiptap > p").first().hover();
  await page
    .getByRole("button", { name: "移动或管理内容块", exact: true })
    .click();
  await page.getByRole("button", { name: "移至画布", exact: true }).click();
  const detached = await poll(
    read,
    (value) => canvasItems(value).length === 1,
    "detach existing block",
  );
  assert.equal(canvasItems(detached)[0].content[0].attrs.id, originalBlockId);
  await page.getByRole("button", { name: "收回正文", exact: true }).click();
  await poll(
    read,
    (value) => canvasItems(value).length === 0,
    "dock detached block",
  );
  result.checks.push(
    "existing document blocks move to the canvas and back with their stable identity",
  );
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
