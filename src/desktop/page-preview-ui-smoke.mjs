// Supplementary real Electron regression; UI acceptance also uses the official computer tool.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot =
  process.env.SHOWAI_TEST_OUTPUT_ROOT ??
  join(homedir(), "ShowAI-Development/development/tests");
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(join(outputRoot, "page-preview-"));
const home = resolve(process.env.SHOWAI_TEST_HOME ?? join(output, "library"));
assert.notEqual(
  home,
  join(homedir(), ".showai"),
  "Use an isolated library or an authorized copy",
);
const env = {
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_LANGUAGE: "zh-CN",
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, checks: [], home, output };
let app, page;
try {
  app = await _electron.launch({
    executablePath: process.env.SHOWAI_TEST_EXECUTABLE ?? electron,
    args: process.env.SHOWAI_TEST_EXECUTABLE
      ? []
      : [process.env.SHOWAI_TEST_DESKTOP_ENTRY ?? root],
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      console.log("Workbench navigation:", frame.url());
  });
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.setBackgroundThrottling(false);
  });
  page.setDefaultTimeout(20000);
  await page.locator(".studio-sidebar").waitFor();
  await page.waitForFunction(() => {
    const tab = document.querySelector('[role="tab"][aria-selected="true"]');
    return (
      tab &&
      !tab.hasAttribute("disabled") &&
      document.querySelector('[data-navigation-state="current"]')
    );
  });
  const invoke = (action, args = {}) =>
    page.evaluate(
      ({ action, args }) =>
        window.showai.invoke(action, args).catch((error) => {
          throw new Error(`${action}: ${JSON.stringify(error)}`);
        }),
      {
        action,
        args,
      },
    );
  assert.equal((await invoke("app:info")).home, home);
  assert.equal(await page.evaluate(() => window.showai.pageThumbnails), true);
  console.log("Native preview bridge ready");
  let projectId = process.env.SHOWAI_TEST_PROJECT;
  if (!projectId) {
    projectId = (
      await invoke("projects:create", { name: "Page preview regression" })
    ).id;
    for (let i = 0; i < 8; i++)
      await invoke("pages:create", { projectId, title: `Page ${i + 1}` });
  }
  await page
    .locator(
      `.studio-sidebar .studio-tree-row[data-library-id="${projectId}"] .studio-tree-main`,
    )
    .click();
  await page.locator(".studio-page-list").waitFor();
  await page.evaluate(() => {
    const started = performance.now();
    window.__previewLoad = { started, images: [] };
    const observer = new MutationObserver(() => {
      const count = document.querySelectorAll(
        ".studio-page-thumbnail > img",
      ).length;
      const timings = window.__previewLoad.images;
      if (count > timings.length)
        timings.push(
          ...Array(count - timings.length).fill(performance.now() - started),
        );
    });
    observer.observe(document.querySelector(".studio-scroll"), {
      childList: true,
      subtree: true,
    });
  });
  await page.getByRole("button", { name: "视图", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "缩略图（中）", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector('.studio-page-list[data-view="medium"]'),
  );
  console.log("Thumbnail directory ready");
  await page.evaluate(() => {
    window.__previewPerf = {
      longTasks: [],
      input: [],
      frames: [],
      last: performance.now(),
      running: true,
      eventDelay: [],
    };
    new PerformanceObserver((list) =>
      window.__previewPerf.eventDelay.push(
        ...list.getEntries().map((event) => ({
          name: event.name,
          delay: event.processingStart - event.startTime,
          duration: event.duration,
        })),
      ),
    ).observe({ type: "event", durationThreshold: 16 });
    new PerformanceObserver((list) =>
      window.__previewPerf.longTasks.push(
        ...list.getEntries().map((e) => e.duration),
      ),
    ).observe({ type: "longtask" });
    for (const type of ["pointerdown", "pointermove", "wheel", "keydown"])
      window.addEventListener(
        type,
        (event) =>
          window.__previewPerf.input.push(performance.now() - event.timeStamp),
        true,
      );
    const frame = (now) => {
      const p = window.__previewPerf;
      p.frames.push(now - p.last);
      p.last = now;
      if (p.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const scroll = page.locator(".studio-scroll");
  const bounds = await scroll.boundingBox();
  // Selection stays usable while the first background captures are being generated.
  await page.mouse.move(bounds.x + 18, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.7,
    { steps: 40 },
  );
  await page.mouse.up();
  assert.ok(await page.locator(".studio-page-list .selected").count());
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".studio-page-list .selected").count(), 0);
  // Cancel while the pointer is still down: transient DOM highlights must clear.
  await page.mouse.move(bounds.x + 18, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.65,
    bounds.y + bounds.height * 0.7,
    { steps: 20 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await page.locator(".studio-page-list .selected").count(), 0);
  for (const delta of [450, 450, -450, -450]) await page.mouse.wheel(0, delta);
  console.log("Input gestures completed; waiting for background previews");
  await page.waitForFunction(
    () => {
      const failure = document.querySelector(".studio-page-thumbnail [title]");
      if (failure) throw new Error(failure.getAttribute("title"));
      return (
        document.querySelectorAll(".studio-page-thumbnail > img").length >= 3
      );
    },
    undefined,
    { timeout: 90000 },
  );
  const geometry = await page.evaluate(() => ({
    renderedReaders: document.querySelectorAll(
      ".studio-page-thumbnail .catalog-preview",
    ).length,
    liveIframes: document.querySelectorAll(".studio-page-thumbnail iframe")
      .length,
    raster: document.querySelectorAll(".studio-page-thumbnail > img").length,
    nodes: document.querySelectorAll(".studio-page-list *").length,
  }));
  assert.equal(geometry.renderedReaders, 0);
  assert.equal(geometry.liveIframes, 0);
  result.geometry = geometry;
  result.loadMs = await page.evaluate(() => window.__previewLoad.images);
  console.log("First previews ready:", result.loadMs);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-preview-raster]")]
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.bottom > 150 &&
            bounds.top < innerHeight &&
            bounds.right > 240
          );
        })
        .every((element) => element.querySelector("img")),
    undefined,
    { timeout: 90000 },
  );
  result.viewportLoadMs = await page.evaluate(
    () => window.__previewLoad.images,
  );
  result.checks.push(
    "Cold preview generation, marquee and scrolling retain only raster images in the directory",
  );
  const pages = await invoke("pages:list", { projectId });
  const reference = {
    projectId,
    pageId: pages[0].id,
    hash: pages[0].hash,
    theme: "light",
    width: 384,
    height: 256,
    padding: 16,
  };
  const first = await invoke("pages:thumbnail", {
    ...reference,
    requestId: crypto.randomUUID(),
  });
  const started = performance.now();
  const cached = await invoke("pages:thumbnail", {
    ...reference,
    requestId: crypto.randomUUID(),
  });
  result.cacheMs = performance.now() - started;
  assert.equal(first, cached);
  assert.ok(first.startsWith("data:image/png;base64,"));
  result.checks.push("Persistent raster cache returns the same image");
  if (process.env.SHOWAI_TEST_EXPECT_WARM) {
    const warm = await app.evaluate(async ({ BrowserWindow }) => {
      const captures = BrowserWindow.getAllWindows().filter((window) =>
        window.webContents.getURL().includes("pagePreview="),
      );
      if (!captures.length) throw new Error("Missing warm capture shell");
      globalThis.__previewNavigations = 0;
      return Promise.all(
        captures.map((capture) => {
          capture.webContents.on(
            "did-finish-load",
            () => globalThis.__previewNavigations++,
          );
          return capture.webContents.executeJavaScript(`
        window.__captureUpdates = 0;
        window.addEventListener('showai:page-preview', () => window.__captureUpdates++);
        ({ empty: !document.querySelector('.studio-page-thumbnail-content'), iframes: document.querySelectorAll('iframe').length });
      `);
        }),
      );
    });
    assert.ok(warm.every((capture) => capture.empty && capture.iframes === 0));
    const other = (await invoke("projects:list")).find(
      (project) => project.id !== projectId,
    );
    assert.ok(other);
    await invoke("projects:rename", {
      projectId: other.id,
      name: `${other.name} cache check`,
    });
    const afterEdit = performance.now();
    assert.equal(
      await invoke("pages:thumbnail", {
        ...reference,
        requestId: crypto.randomUUID(),
      }),
      first,
    );
    result.cacheAfterUnrelatedEditMs = performance.now() - afterEdit;
    assert.equal(
      await app.evaluate(async ({ BrowserWindow }) => {
        const captures = BrowserWindow.getAllWindows().filter((window) =>
          window.webContents.getURL().includes("pagePreview="),
        );
        const counts = await Promise.all(
          captures.map((capture) =>
            capture.webContents.executeJavaScript("window.__captureUpdates"),
          ),
        );
        return counts.reduce((sum, count) => sum + count, 0);
      }),
      0,
    );
    result.checks.push(
      "Unrelated library edits keep existing page snapshots cached",
    );
  }
  const dark = await invoke("pages:thumbnail", {
    ...reference,
    theme: "dark",
    requestId: crypto.randomUUID(),
  });
  assert.notEqual(dark, first);
  result.checks.push("Appearance participates in cache identity");
  if (process.env.SHOWAI_TEST_EXPECT_WARM) {
    assert.equal(await app.evaluate(() => globalThis.__previewNavigations), 0);
    result.checks.push(
      "Successive captures reuse the renderer without application navigation",
    );
  }
  await assert.rejects(invoke("pages:previewData"), /./);
  await assert.rejects(
    invoke("pages:thumbnail", {
      ...reference,
      width: 100000,
      requestId: crypto.randomUUID(),
    }),
    /./,
  );
  result.checks.push(
    "Capture data is inaccessible to the workbench; invalid dimensions are rejected",
  );
  result.processes = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      pid: w.webContents.getOSProcessId(),
      visible: w.isVisible(),
      url: w.webContents.getURL(),
    })),
  );
  assert.ok(
    new Set(result.processes.map((p) => p.pid)).size > 1,
    "Capture has its own renderer process",
  );
  result.checks.push(
    "Capture renderers run outside the workbench process and unmount page content between captures",
  );
  result.performance = await page.evaluate(() => {
    const p = window.__previewPerf;
    p.running = false;
    const percentile = (values, percentile) =>
      [...values].sort((a, b) => a - b)[
        Math.floor(values.length * percentile)
      ] ?? 0;
    return {
      longTasks: p.longTasks,
      inputP95: percentile(p.input, 0.95),
      inputMax: Math.max(0, ...p.input),
      frameP95: percentile(p.frames, 0.95),
      frameMax: Math.max(0, ...p.frames),
      eventDelay: p.eventDelay,
    };
  });
  await page.screenshot({ path: join(output, "directory.png") });
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page)
    result.state = await page.evaluate(() => ({
      images: document.querySelectorAll(".studio-page-thumbnail > img").length,
      errors: [
        ...document.querySelectorAll(".studio-page-thumbnail [title]"),
      ].map((e) => e.getAttribute("title")),
      stats: window.__previewPerf,
    }));
  if (page) await page.screenshot({ path: join(output, "failure.png") });
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  if (app) {
    const child = app.process();
    const timeout = setTimeout(() => {
      result.forcedShutdown = true;
      child.kill("SIGKILL");
    }, 10000);
    try {
      await app.close();
    } finally {
      clearTimeout(timeout);
    }
  }
  await rm(join(output, "profile"), { recursive: true, force: true });
  if (!process.env.SHOWAI_TEST_HOME)
    await rm(home, { recursive: true, force: true });
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
