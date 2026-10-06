// Real CLI, filesystem, local browser bridge and exported readers. No mocked services.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium, _electron } from "playwright";
const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/containers-"));
const cli = resolve(
  process.env.SHOWAI_CONTAINERS_CLI ||
    join(root, "dist-runtime/scripts/cli.mjs"),
);
const node = process.env.SHOWAI_CONTAINERS_NODE || process.execPath;
const desktop =
  process.argv.includes("--desktop") ||
  Boolean(process.env.SHOWAI_SMOKE_BINARY);
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const execute = promisify(execFile);
let cliCommand = node,
  cliPrefix = [cli],
  cliEnv = env;
const run = async (...args) =>
  JSON.parse(
    (
      await execute(cliCommand, [...cliPrefix, ...args, "--json"], {
        env: cliEnv,
      }).catch((error) => {
        throw new Error(error.stdout || error.stderr || error.message);
      })
    ).stdout,
  ).data;
const server = desktop
  ? null
  : spawn(node, [cli, "serve", "--no-open", "--json"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
let serverErrors = "";
server?.stderr.on("data", (data) => {
  serverErrors += data;
});
const startup = desktop
  ? null
  : new Promise((resolve, reject) => {
      let out = "";
      server.stdout.on("data", (chunk) => {
        out += chunk;
        if (out.includes("\n")) resolve(JSON.parse(out.split("\n")[0]).data);
      });
      server.once("error", reject);
      server.once("exit", (code) =>
        reject(new Error(`Server exited ${code}: ${serverErrors}`)),
      );
    });
const startupTimer = desktop
  ? null
  : setTimeout(() => server.kill("SIGTERM"), 20000);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(read, test, label) {
  const deadline = Date.now() + 15000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (test(value)) return value;
    await delay(70);
  }
  throw new Error(`Timed out: ${label}: ${JSON.stringify(value).slice(-1500)}`);
}
const result = { passed: false, output, cli, checks: [], errors: [] };
let browser, page, application;
try {
  browser = await chromium.launch();
  if (desktop) {
    application = await _electron.launch({
      executablePath:
        process.env.SHOWAI_SMOKE_BINARY || (await import("electron")).default,
      args: process.env.SHOWAI_SMOKE_BINARY ? [] : [root],
      cwd: root,
      env,
    });
    page = await application.firstWindow();
    await page.setViewportSize({ width: 1440, height: 960 });
    const info = await page.evaluate(() => window.showai.invoke("app:info"));
    cliCommand = info.cli.command;
    cliPrefix = info.cli.args;
    cliEnv = { ...env, ...info.cli.env };
    result.runtime = info;
  } else {
    const { url } = await startup;
    clearTimeout(startupTimer);
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(url);
  }
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  const project = await api("projects:create", { name: "Page / Board 验收" });
  const created = await api("pages:create", {
    projectId: project.id,
    title: "递归内容工作页",
  });
  const pageId = created.document.id,
    rootId = created.document.content.attrs.id;
  const read = () => api("pages:get", { projectId: project.id, pageId });
  const find = (node, id) =>
    node.attrs?.id === id
      ? node
      : node.content?.map((child) => find(child, id)).find(Boolean);
  const object = (id) => page.locator(`[data-surface-id="${id}"]`);
  const scene = (id) => page.locator(`[data-container-root="${id}"]`);
  const savedText = async (text) =>
    poll(
      read,
      (record) => JSON.stringify(record.document.content).includes(text),
      "saved text",
    );
  assert.equal(created.document.content.attrs.kind, "page");
  assert.equal(JSON.parse(await readFile(created.path, "utf8")).version, 3);
  await page
    .getByRole("button", { name: "Page / Board 验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /递归内容工作页/ })
    .first()
    .click();
  await scene(rootId)
    .locator(".tiptap")
    .fill(
      "文章按顺序阅读，局部白板可以展开编辑。" +
        "长内容保留自然的上下阅读与文字选择。".repeat(110),
    );
  await savedText("文章按顺序阅读");
  const add = async (owner, label) => {
    const container = scene(owner);
    assert.equal(
      await page
        .locator(
          ".container-add-component, .container-page-add, .surface-add-to-region",
        )
        .count(),
      0,
    );
    if (
      await container.evaluate((element) =>
        element.classList.contains("container-page"),
      )
    ) {
      const text = container
        .locator(
          ":scope > .container-page-column > .surface-layout-flow > div > .document-editor .tiptap",
        )
        .last();
      await text.click();
      await text.press("ControlOrMeta+End");
      await text.press("Enter");
      await text.pressSequentially("/" + label);
    } else {
      const board = container.locator(
        ":scope > .container-board-scene > .page-surface",
      );
      await board.focus();
      await board.press("/");
      await page
        .getByRole("textbox", { name: "搜索内容块", exact: true })
        .fill(label);
    }
    const menu = page.getByRole("dialog", { name: "插入内容", exact: true });
    if (label === "Board 白板" || label === "Page 页面")
      await page.screenshot({
        path: join(
          output,
          label === "Board 白板" ? "document-slash.png" : "board-slash.png",
        ),
      });
    await menu.getByRole("option").filter({ hasText: label }).last().click();
    await menu.waitFor({ state: "detached" });
  };

  await add(rootId, "Board 白板");
  let saved = await poll(
    read,
    (record) =>
      record.document.content.content.some((node) => node.type === "surface"),
    "embedded Board",
  );
  const boardId = saved.document.content.content.find(
    (node) => node.type === "surface",
  ).attrs.id;
  const initialFrame = structuredClone(saved.document.layout[boardId]);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await poll(
    read,
    (record) => !find(record.document.content, boardId),
    "slash insertion undoes as one action",
  );
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  await poll(
    read,
    (record) => !!find(record.document.content, boardId),
    "slash insertion restores the same container",
  );
  assert.equal(
    await scene(boardId).locator(".container-board-enter").count(),
    1,
  );
  assert.equal(
    await scene(boardId)
      .locator(".page-surface")
      .getAttribute("data-input-surface"),
    null,
  );
  const parentPage = scene(rootId);
  const world = () =>
    scene(boardId)
      .locator(".surface-world")
      .first()
      .evaluate((element) => getComputedStyle(element).transform);
  const inactiveCamera = await world();
  const scrollBefore = await parentPage.evaluate(
    (element) => element.scrollTop,
  );
  const embedRect = await object(boardId).boundingBox();
  await page.mouse.move(embedRect.x + 60, embedRect.y + 160);
  await page.mouse.wheel(0, -100);
  await poll(
    () => parentPage.evaluate((element) => element.scrollTop),
    (value) => value < scrollBefore - 20,
    "inactive Board preserves Page scrolling",
  );
  assert.equal(await world(), inactiveCamera);
  await scene(boardId)
    .getByRole("button", { name: "操作白板", exact: true })
    .click();
  await add(boardId, "Page 页面");
  saved = await poll(
    read,
    (record) =>
      find(record.document.content, boardId).content.some(
        (node) => node.type === "surface",
      ),
    "Page inside Board",
  );
  const nestedPageId = find(saved.document.content, boardId).content[0].attrs
    .id;
  await object(nestedPageId)
    .locator(".tiptap")
    .fill("同一个 Page 在白板中编辑。");
  await savedText("同一个 Page 在白板中编辑");
  const activeBoard = scene(boardId).locator(".page-surface").first();
  await poll(
    () => activeBoard.getAttribute("data-settling"),
    (value) => value === null,
    "board focused",
  );
  const outerScroll = await parentPage.evaluate((element) => element.scrollTop),
    innerCamera = await world();
  const bounds = await activeBoard.boundingBox();
  await page.mouse.move(bounds.x + 18, bounds.y + 90);
  await page.mouse.wheel(60, 0);
  await poll(
    world,
    (value) => value !== innerCamera,
    "active Board moves independently",
  );
  assert.ok(
    Math.abs(
      (await parentPage.evaluate((element) => element.scrollTop)) - outerScroll,
    ) < 1,
  );
  await delay(900);
  result.checks.push(
    "new content defaults to Page; an embedded Board owns its viewport and contains an editable Page",
  );
  await object(nestedPageId)
    .getByRole("button", { name: "展开 Page", exact: true })
    .click();
  await scene(nestedPageId)
    .locator(".tiptap")
    .fill("展开后继续编辑同一个 Page。");
  await savedText("展开后继续编辑同一个 Page");
  assert.equal(
    await page.locator(`[data-container-root="${nestedPageId}"]`).count(),
    1,
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  await page
    .locator(".studio-component-card")
    .filter({ has: page.getByRole("heading", { name: /^关键指标/ }) })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "插入页面", exact: true })
    .click();
  saved = await poll(
    read,
    (record) =>
      find(record.document.content, nestedPageId).content.some(
        (node) => node.type === "widget",
      ),
    "component inserted into active nested Page",
  );
  assert.equal(
    saved.document.content.content.some((node) => node.type === "widget"),
    false,
  );
  await scene(nestedPageId).locator(".sb-metrics").waitFor();
  const customComponent = await api("components:createExample", {
    projectId: project.id,
  });
  await add(nestedPageId, customComponent.name);
  const customFrame = scene(nestedPageId).frameLocator(
    `iframe[title="${customComponent.name}"]`,
  );
  await customFrame.getByRole("button", { name: "增加", exact: true }).click();
  await poll(
    read,
    (record) =>
      find(record.document.content, nestedPageId).content.some(
        (node) =>
          node.attrs?.data?.componentId === customComponent.id &&
          node.attrs.data.props.value === customComponent.defaultData.value + 1,
      ),
    "custom component inserted and edited through slash menu",
  );
  result.checks.push(
    "component catalog inserts into the active nested container and returns to that container",
  );
  await add(nestedPageId, "Board 白板");
  saved = await poll(
    read,
    (record) =>
      find(record.document.content, nestedPageId).content.some(
        (node) => node.type === "surface",
      ),
    "deep Board",
  );
  const sketchId = find(saved.document.content, nestedPageId).content.find(
    (node) => node.type === "surface",
  ).attrs.id;
  await object(sketchId)
    .getByRole("button", { name: "展开 Board", exact: true })
    .click();
  await scene(sketchId)
    .getByRole("button", { name: "矩形", exact: true })
    .click();
  const drawing = scene(sketchId).getByLabel("绘画区域", { exact: true });
  const rect = await drawing.boundingBox();
  await page.mouse.move(rect.x + 140, rect.y + 120);
  await page.mouse.down();
  await page.mouse.move(rect.x + 340, rect.y + 240, { steps: 12 });
  await page.mouse.up();
  saved = await poll(
    read,
    (record) =>
      find(record.document.content, sketchId).content.some(
        (node) => node.type === "drawing",
      ),
    "drawing persistence",
  );
  const drawingId = find(saved.document.content, sketchId).content[0].attrs.id;
  assert.equal(find(saved.document.content, drawingId).attrs.tool, "rectangle");
  assert.ok(saved.document.layout[drawingId].width > 190);
  assert.ok(saved.document.layout[drawingId].height > 110);
  assert.deepEqual(saved.document.layout[boardId], initialFrame);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await poll(
    read,
    (record) => !find(record.document.content, drawingId),
    "drawing undo",
  );
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  await poll(
    read,
    (record) => !!find(record.document.content, drawingId),
    "drawing redo",
  );
  await scene(sketchId)
    .getByRole("button", { name: "画笔", exact: true })
    .click();
  await page.mouse.move(rect.x + 180, rect.y + 300);
  await page.mouse.down();
  await page.mouse.move(rect.x + 260, rect.y + 340, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await delay(650);
  assert.equal(
    find((await read()).document.content, sketchId).content.length,
    1,
  );
  result.checks.push(
    "Page → Board → Page → Board edits share one source; drawing, undo/redo and Escape cancellation preserve parent frames",
  );
  await page.getByRole("button", { name: "返回上层", exact: true }).click();
  assert.match(
    await scene(nestedPageId).locator(".tiptap").first().innerText(),
    /展开后继续编辑/,
  );
  await page.getByRole("button", { name: "返回上层", exact: true }).click();
  await object(nestedPageId)
    .getByRole("button", { name: "设置 Page", exact: true })
    .click();
  await page.getByLabel("所属容器", { exact: true }).selectOption(rootId);
  saved = await poll(
    read,
    (record) =>
      record.document.content.content.some(
        (node) => node.attrs.id === nestedPageId,
      ),
    "cross-container move",
  );
  assert.ok(find(saved.document.content, sketchId));
  assert.equal(find(saved.document.content, boardId).content.length, 0);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  saved = await poll(
    read,
    (record) =>
      find(record.document.content, boardId).content.some(
        (node) => node.attrs.id === nestedPageId,
      ),
    "atomic move undo",
  );
  assert.equal(
    saved.document.content.content.some(
      (node) => node.attrs.id === nestedPageId,
    ),
    false,
  );
  result.checks.push(
    "cross-container moves retain every descendant id and undo as one transaction",
  );
  await page.getByLabel("容器操作", { exact: true }).click();
  await page.getByRole("button", { name: "放入 Board", exact: true }).click();
  saved = await poll(
    read,
    (record) => record.document.content.attrs.kind === "board",
    "root wrapping",
  );
  assert.equal(saved.document.content.content[0].attrs.id, rootId);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  saved = await poll(
    read,
    (record) => record.document.content.attrs.id === rootId,
    "wrap undo",
  );
  assert.equal(saved.document.content.attrs.kind, "page");
  const latestHash = saved.hash;
  await page.reload();
  await page
    .getByRole("button", { name: "Page / Board 验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /递归内容工作页/ })
    .first()
    .click();
  await object(boardId).waitFor();
  await object(nestedPageId).locator(".tiptap").first().waitFor();
  assert.match(
    await object(nestedPageId).locator(".tiptap").first().innerText(),
    /展开后继续编辑/,
  );
  await object(boardId).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "page-with-board.png"),
    fullPage: true,
  });
  assert.equal((await read()).hash, latestHash);
  const template = await run(
    "template",
    "save",
    "--project",
    project.id,
    "--page",
    pageId,
    "--name",
    "Recursive template",
  );
  const applied = await run(
    "template",
    "apply",
    template.id,
    "--project",
    project.id,
    "--title",
    "Nested copy",
  );
  const copy = applied.document;
  assert.equal(copy.content.attrs.kind, "page");
  const originalIds = new Set();
  const walk = (node) => {
    if (node.attrs?.id) originalIds.add(node.attrs.id);
    node.content?.forEach(walk);
  };
  walk(saved.document.content);
  const copiedIds = [];
  const walkCopy = (node) => {
    if (node.attrs?.id) copiedIds.push(node.attrs.id);
    node.content?.forEach(walkCopy);
  };
  walkCopy(copy.content);
  assert.ok(copiedIds.every((id) => !originalIds.has(id)));
  const standalone = await run(
    "export",
    "--project",
    project.id,
    "--page",
    pageId,
    "--format",
    "html",
    "--out",
    join(output, "nested.html"),
  );
  const partial = await run(
    "export",
    "--project",
    project.id,
    "--page",
    pageId,
    "--blocks",
    sketchId,
    "--format",
    "inline",
    "--out",
    join(output, "sketch-inline.html"),
  );
  const source = JSON.parse(
    await readFile(join(output, "nested.showai.json"), "utf8"),
  );
  assert.equal(source.version, 3);
  assert.equal(source.document.content.attrs.kind, "page");
  const reader = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  reader.on("pageerror", (error) => result.errors.push(error.message));
  await reader.goto(pathToFileURL(standalone.path).href);
  await reader.locator(".container-page.is-root").waitFor();
  assert.equal(await reader.locator('[contenteditable="true"]').count(), 0);
  await reader
    .locator(`[data-surface-id="${boardId}"]`)
    .locator(":scope > .surface-object-header")
    .getByRole("button", { name: "展开 Board", exact: true })
    .click();
  await reader
    .locator(`[data-surface-id="${nestedPageId}"]`)
    .locator(":scope > .surface-object-header")
    .getByRole("button", { name: "展开 Page", exact: true })
    .click();
  await reader
    .locator(`[data-surface-id="${sketchId}"]`)
    .locator(":scope > .surface-object-header")
    .getByRole("button", { name: "展开 Board", exact: true })
    .click();
  await reader.locator(".board-drawing").waitFor();
  await reader.screenshot({ path: join(output, "expanded-drawing.png") });
  await reader.goto(pathToFileURL(partial.path).href);
  await reader.locator(".container-workspace").waitFor();
  assert.equal(
    await reader
      .getByText("文章按顺序阅读，局部白板可以展开编辑。", { exact: true })
      .count(),
    0,
  );
  await reader.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await reader.evaluate(() => document.documentElement.scrollWidth <= 391),
  );
  await reader.emulateMedia({ media: "print" });
  await reader.locator(".board-drawing").waitFor();
  const printGeometry = await reader
    .locator(".board-drawing rect")
    .first()
    .boundingBox();
  assert.ok(
    printGeometry && printGeometry.width > 5 && printGeometry.height > 3,
  );
  assert.ok(
    Math.abs(printGeometry.width / printGeometry.height - 200 / 120) < 0.12,
  );
  await reader.screenshot({
    path: join(output, "print-layout.png"),
    fullPage: true,
  });
  await reader.pdf({ path: join(output, "nested.pdf"), format: "A4" });
  await reader.close();
  result.checks.push(
    "reload, templates, recursive offline HTML, partial inline delivery and narrow-screen reading preserve container structure",
  );
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  process.exitCode = 1;
  if (page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
} finally {
  clearTimeout(startupTimer);
  await browser?.close();
  await application?.close();
  server?.kill("SIGTERM");
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
