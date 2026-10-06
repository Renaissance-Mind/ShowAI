// Real CLI, filesystem, local browser bridge and exported readers. No mocked services.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, _electron } from "playwright";
const root = resolve(import.meta.dirname, "..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/whiteboard-v2-"));
const cli = resolve(
  process.env.SHOWAI_V2_CLI || join(root, "dist-runtime/scripts/cli.mjs"),
);
const node = process.env.SHOWAI_V2_NODE || process.execPath;
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
  const project = await api("projects:create", { name: "白板根模型验收" });
  const created = await api("pages:create", {
    projectId: project.id,
    title: "多区域工作页",
  });
  const pageId = created.document.id;
  const read = () => api("pages:get", { projectId: project.id, pageId });
  const roots = (record) => record.document.content.content;
  const firstId = roots(created)[0].attrs.id;
  assert.equal(created.document.content.type, "surface");
  assert.equal(JSON.parse(await readFile(created.path, "utf8")).version, 2);
  await page
    .getByRole("button", { name: "白板根模型验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /多区域工作页/ })
    .first()
    .click();
  const surface = page.getByRole("region", { name: "白板", exact: true });
  const object = (id) => page.locator(`[data-surface-id="${id}"]`);
  const settled = async () => {
    await delay(80);
    await poll(
      () => surface.getAttribute("data-settling"),
      (value) => value === null,
      "viewport settled",
    );
  };
  await object(firstId)
    .locator(".tiptap")
    .fill("区域都是平等的。文字仍然可以自然地从上往下阅读。");
  await poll(
    read,
    (record) => JSON.stringify(record.document).includes("自然地"),
    "text persisted",
  );
  assert.equal(
    await page.getByRole("button", { name: "回到正文", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "展开画布", exact: true }).count(),
    0,
  );
  result.checks.push(
    "new pages persist a surface root; a normal flow region remains directly editable without modes",
  );

  const camera = () =>
    surface.locator(".surface-world").evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
  const resistance = async (id) => {
    await settled();
    await poll(
      () => surface.getAttribute("data-anchor"),
      (value) => value === id,
      "region anchor",
    );
    const before = await camera();
    const bounds = await surface.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    for (const direction of [1, -1]) {
      await page.mouse.wheel(24 * direction, 0);
      const pulled = await poll(
        camera,
        (value) => Math.abs(value.x - before.x) > 2,
        "visible elastic pull",
      );
      assert.ok(Math.abs(pulled.x - before.x) < 24);
      await poll(
        () => surface.getAttribute("data-settling"),
        (value) => value === "true",
        "spring animation",
      );
      assert.ok(Math.abs((await camera()).x - before.x) > 0.05);
      await settled();
      assert.ok(Math.abs((await camera()).x - before.x) < 0.3);
    }
    await page.mouse.wheel(24, 0);
    await poll(
      () => surface.getAttribute("data-settling"),
      (value) => value === "true",
      "spring interruption",
    );
    const interrupted = await camera();
    await page.mouse.wheel(-10, 0);
    await delay(40);
    assert.ok(Math.abs((await camera()).x - interrupted.x) < 25);
    await settled();
    assert.equal(await surface.getAttribute("data-mode"), null);
  };
  const colors = await surface.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    image: getComputedStyle(element).backgroundImage,
  }));
  assert.deepEqual(colors, { background: "rgb(255, 255, 255)", image: "none" });
  const longEditor = object(firstId).locator(".tiptap");
  await longEditor.press("End");
  await longEditor.press("Enter");
  await page.keyboard.insertText(
    "长文阅读保持连续，编辑、选择和浏览共享同一个区域。".repeat(120),
  );
  await poll(
    read,
    (record) => JSON.stringify(record.document).includes("长文阅读"),
    "long article persisted",
  );
  await settled();
  await page.getByLabel("区域与视图", { exact: true }).click();
  await page
    .locator(".surface-navigation-row")
    .getByRole("button", { name: roots(created)[0].attrs.name, exact: true })
    .click();
  await settled();
  const beforeReading = await camera();
  result.reading = {
    before: beforeReading,
    anchorBefore: await surface.getAttribute("data-anchor"),
    bounds: await object(firstId).boundingBox(),
  };
  const readingBox = await surface.boundingBox();
  await page.mouse.move(
    readingBox.x + readingBox.width / 2,
    readingBox.y + readingBox.height / 2,
  );
  // Keep the wheel step inside the article across native OS delta scaling.
  await page.mouse.wheel(0, 80);
  await poll(
    camera,
    (value) => value.y < beforeReading.y - 40,
    "uninterrupted vertical reading",
  );
  await settled();
  assert.ok(Math.abs((await camera()).x - beforeReading.x) < 1);
  result.reading.after = await camera();
  result.reading.anchorAfter = await surface.getAttribute("data-anchor");
  await resistance(firstId);
  result.checks.push(
    "white background, visible resistance in both directions and interruptible animated return in a normal reading region",
  );

  await page.getByLabel("添加内容", { exact: true }).click();
  await page.getByRole("button", { name: "网格区域", exact: true }).click();
  let saved = await poll(
    read,
    (record) => roots(record).length === 2,
    "grid created",
  );
  const gridId = roots(saved).find((item) => item.attrs.id !== firstId).attrs
    .id;
  await settled();
  await resistance(gridId);
  const beforeMove = (await read()).document.layout[gridId];
  await page.getByRole("button", { name: "缩小白板", exact: true }).click();
  await settled();
  const zoom = (await camera()).scale;
  const regionHandle = object(gridId).getByRole("button", {
    name: "移动 网格区域",
    exact: true,
  });
  const drag = async (locator, dx, dy, cancel = false) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 10 },
    );
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  await drag(regionHandle, 60, 30);
  let moved = await poll(
    read,
    (record) => record.document.layout[gridId].x > beforeMove.x + 10,
    "scaled region drag",
  );
  assert.ok(
    Math.abs(moved.document.layout[gridId].x - beforeMove.x - 60 / zoom) < 2,
  );
  assert.ok(
    Math.abs(moved.document.layout[gridId].y - beforeMove.y - 30 / zoom) < 2,
  );
  const beforeResize = moved.document.layout[gridId];
  await drag(
    object(gridId).getByRole("button", {
      name: "调整 网格区域 宽度",
      exact: true,
    }),
    -50,
    0,
  );
  moved = await poll(
    read,
    (record) => record.document.layout[gridId].width < beforeResize.width - 10,
    "scaled resize",
  );
  assert.ok(
    Math.abs(
      moved.document.layout[gridId].width - beforeResize.width + 50 / zoom,
    ) < 2,
  );
  const beforeCancel = moved.document.layout[gridId];
  await drag(regionHandle, 70, 30, true);
  await delay(600);
  assert.deepEqual((await read()).document.layout[gridId], beforeCancel);
  await page.getByRole("button", { name: "定位所选", exact: true }).click();
  await settled();
  result.checks.push(
    "scaled drag and resize persist world coordinates; Escape cancels a pending drag without changing saved layout",
  );

  result.checks.push(
    "a second region snaps and keeps the same resistance without changing modes",
  );
  await object(gridId)
    .getByRole("button", { name: "设置 网格区域", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "内容名称", exact: true })
    .fill("对照区域");
  await page
    .getByRole("button", { name: "添加文本到区域", exact: true })
    .click();
  await object(gridId).locator(".tiptap").first().fill("第一组材料");
  await object(gridId)
    .getByRole("button", { name: "设置 对照区域", exact: true })
    .click();
  await page
    .getByRole("button", { name: "添加文本到区域", exact: true })
    .click();
  await object(gridId).locator(".tiptap").nth(1).fill("第二组材料");
  saved = await poll(
    read,
    (record) => JSON.stringify(record.document).includes("第二组材料"),
    "grid content saved",
  );
  const grid = roots(saved).find((item) => item.attrs.id === gridId),
    childId = grid.content[0].attrs.id;
  const cells = await object(gridId)
    .locator(".surface-layout-grid > .surface-object")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      }),
    );
  assert.ok(cells[1].x > cells[0].x && Math.abs(cells[1].y - cells[0].y) < 3);
  await page.getByLabel("区域布局", { exact: true }).selectOption("free");
  await poll(
    read,
    (record) => record.document.layout[gridId].mode === "free",
    "free layout saved",
  );
  await page.getByRole("button", { name: "关闭内容设置", exact: true }).click();
  const handle = await object(childId)
    .getByRole("button", { name: "移动 文本", exact: true })
    .boundingBox();
  const startFrame = (await read()).document.layout[childId];
  await page.mouse.move(handle.x + 20, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x + 100, handle.y + 60, { steps: 10 });
  await page.mouse.up();
  await poll(
    read,
    (record) => record.document.layout[childId].x > startFrame.x + 30,
    "free child movement",
  );
  result.checks.push(
    "grid layout, nested editing, layout switching and free child positioning use the same content identities",
  );

  await object(childId)
    .getByRole("button", { name: "设置 文本", exact: true })
    .click();
  await page.getByLabel("内容名称", { exact: true }).fill("独立观点");
  await page.getByLabel("所属区域", { exact: true }).selectOption("");
  saved = await poll(
    read,
    (record) => roots(record).some((item) => item.attrs.id === childId),
    "child moved to root",
  );
  await settled();
  await page.getByRole("button", { name: "关闭内容设置", exact: true }).click();
  await page.getByLabel("区域与视图", { exact: true }).click();
  await page.getByLabel("视图名称", { exact: true }).fill("观点视图");
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page
    .getByRole("button", { name: "设为初始视图 观点视图", exact: true })
    .click();
  saved = await poll(
    read,
    (record) => !!record.document.views.initial,
    "initial view saved",
  );
  assert.deepEqual(saved.document.views.saved[0].targets, [childId]);
  await page
    .getByRole("button", { name: "前移 独立观点 阅读顺序", exact: true })
    .click();
  await poll(
    read,
    (record) => record.document.views.readingOrder[1] === childId,
    "reading order saved",
  );
  await page.getByLabel("区域与视图", { exact: true }).click();
  const beforeCamera = (await read()).hash;
  await page.mouse.move(280, 650);
  await page.mouse.wheel(20, 0);
  await delay(850);
  assert.equal(
    (await read()).hash,
    beforeCamera,
    "viewport movement must not save content",
  );
  result.checks.push(
    "reparenting retains identity; named/initial views and reading order persist; camera changes stay outside page hashes",
  );

  await page.getByLabel("区域与视图", { exact: true }).click();
  await page
    .locator(".surface-navigation-row")
    .getByRole("button", { name: "内容区域", exact: true })
    .click();
  await settled();
  await object(firstId)
    .getByRole("button", { name: "删除 内容区域", exact: true })
    .click();
  saved = await poll(
    read,
    (record) => !roots(record).some((item) => item.attrs.id === firstId),
    "initial region deleted",
  );
  assert.equal(saved.document.content.type, "surface");
  assert.equal(roots(saved).length, 2);
  await page.reload();
  await page
    .getByRole("button", { name: "白板根模型验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /多区域工作页/ })
    .first()
    .click();
  await settled();
  assert.equal(await object(firstId).count(), 0);
  await object(childId)
    .locator(".tiptap")
    .fill("首个区域删除以后，独立观点仍然可以编辑。");
  await poll(
    read,
    (record) => JSON.stringify(record.document).includes("仍然可以编辑"),
    "surviving content edited",
  );
  await page.getByRole("button", { name: "总览", exact: true }).click();
  await settled();
  await page.screenshot({ path: join(output, "equal-regions.png") });
  result.checks.push(
    "deleting the original region leaves a complete, reloadable and editable page",
  );

  saved = await read();
  const sourceFile = join(output, "template.json");
  await writeFile(
    sourceFile,
    JSON.stringify({
      id: "whiteboard-layout",
      name: "白板布局",
      version: "1.0.0",
      description: "验收区域布局",
      scenarios: ["验收"],
      document: saved.document,
      contentGuide: [],
      related: [],
      examples: [],
    }),
  );
  await run("template", "save", "--project", project.id, "--input", sourceFile);
  const count = roots(saved).length;
  const inserted = await run(
    "template",
    "apply",
    "whiteboard-layout",
    "--project",
    project.id,
    "--scope",
    "project",
    "--page",
    pageId,
    "--base-hash",
    saved.hash,
  );
  assert.equal(roots(inserted).length, count * 2);
  const allIds = [];
  const visit = (node) => {
    if (node.attrs?.id) allIds.push(node.attrs.id);
    node.content?.forEach(visit);
  };
  visit(inserted.document.content);
  assert.equal(new Set(allIds).size, allIds.length);
  const sideExport = await run(
    "export",
    "--project",
    project.id,
    "--page",
    pageId,
    "--format",
    "html",
    "--out",
    join(output, "whiteboard.html"),
  );
  const readingExport = await run(
    "export",
    "--project",
    project.id,
    "--page",
    pageId,
    "--format",
    "html",
    "--presentation",
    "reading",
    "--out",
    join(output, "reading.html"),
  );
  const sourceArtifact = JSON.parse(
    await readFile(join(output, "reading.showai.json"), "utf8"),
  );
  assert.equal(sourceArtifact.version, 2);
  assert.equal(sourceArtifact.document.content.type, "surface");
  const reader = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  reader.on("pageerror", (error) => result.errors.push(error.message));
  await reader.goto(`file://${sideExport.path}`);
  await reader.getByRole("region", { name: "白板", exact: true }).waitFor();
  assert.equal(await reader.locator('[contenteditable="true"]').count(), 0);
  await reader.getByRole("button", { name: "总览", exact: true }).click();
  await delay(850);
  await reader.screenshot({ path: join(output, "spatial-export.png") });
  await reader.goto(`file://${readingExport.path}`);
  await reader.locator(".surface-reading").waitFor();
  assert.match(await reader.locator("body").innerText(), /仍然可以编辑/);
  await reader.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await reader.evaluate(() => document.documentElement.scrollWidth <= 391),
  );
  await reader.screenshot({ path: join(output, "reading-mobile.png") });
  await reader.pdf({ path: join(output, "reading.pdf"), format: "A4" });
  await reader.close();
  result.checks.push(
    "templates insert into existing boards with fresh references; spatial and responsive reading exports retain the same v2 source; PDF prints all content",
  );

  const picture = await api("pages:create", {
    projectId: project.id,
    document: {
      id: "only-image",
      title: "Only image",
      content: {
        type: "surface",
        content: [
          {
            type: "image",
            attrs: {
              id: "image",
              name: "图像",
              src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD44AAAAASUVORK5CYII=",
              alt: "Verification image",
            },
          },
        ],
      },
      layout: { image: { x: -200, y: -100, width: 240 } },
    },
  });
  await page.reload();
  await page
    .getByRole("button", { name: "白板根模型验收", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Only image/ })
    .first()
    .click();
  await object("image").locator("img").waitFor();
  await delay(700);
  const imagePage = await api("pages:get", {
    projectId: project.id,
    pageId: picture.document.id,
  });
  assert.equal(imagePage.document.content.content.length, 1);
  assert.equal(imagePage.document.content.content[0].type, "image");
  assert.equal(await page.locator(".tiptap").count(), 0);
  result.checks.push(
    "a page containing only an independent image works without creating a document or text area",
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: /^关键指标/ }),
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "插入页面", exact: true })
    .click();
  const withComponent = await poll(
    () =>
      api("pages:get", { projectId: project.id, pageId: picture.document.id }),
    (record) =>
      record.document.content.content.some((node) => node.type === "widget"),
    "catalog component insertion",
  );
  const widget = withComponent.document.content.content.find(
    (node) => node.type === "widget",
  );
  assert.equal(withComponent.document.content.content.length, 2);
  assert.ok(withComponent.document.layout[widget.attrs.id]);
  await object(widget.attrs.id).waitFor();
  await settled();
  const widgetBox = await object(widget.attrs.id).boundingBox();
  const viewportBox = await surface.boundingBox();
  assert.ok(
    widgetBox.x >= viewportBox.x - 1 &&
      widgetBox.x + widgetBox.width <= viewportBox.x + viewportBox.width + 1,
    "inserted component is revealed",
  );
  await page.getByLabel("区域与视图", { exact: true }).click();
  await page
    .locator(".surface-navigation-row")
    .getByRole("button", { name: "图像", exact: true })
    .click();
  await settled();
  await object("image")
    .getByRole("button", { name: "删除 图像", exact: true })
    .click();
  const componentOnly = await poll(
    () =>
      api("pages:get", { projectId: project.id, pageId: picture.document.id }),
    (record) => record.document.content.content.length === 1,
    "component-only page",
  );
  assert.equal(componentOnly.document.content.content[0].type, "widget");
  assert.equal(await page.locator(".tiptap").count(), 0);
  result.checks.push(
    "catalog insertion creates and reveals an independent component; an all-component page needs no hidden text body",
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
