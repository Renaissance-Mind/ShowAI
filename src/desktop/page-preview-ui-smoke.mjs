// Supplementary real Electron regression; UI acceptance also uses the official computer tool.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  writeFile,
  rm,
  readFile,
  readdir,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";
import { stopTestProcess } from "../../scripts/stop-test-process.mjs";

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
process.once("exit", () => {
  const child = app?.process();
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
});
let driverCrash = false;
process.on("uncaughtException", async (error) => {
  if (driverCrash) return;
  driverCrash = true;
  result.error = error.stack ?? String(error);
  process.stderr.write(`${result.error}\n`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  result.log = await readFile(
    join(env.SHOWAI_USER_DATA, "logs/showai-main.log"),
    "utf8",
  ).then(
    (text) => text.slice(-16000),
    () => undefined,
  );
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  if (app) await stopTestProcess(app.process());
  process.exit(1);
});
try {
  app = await _electron.launch({
    executablePath: process.env.SHOWAI_TEST_EXECUTABLE ?? electron,
    args: process.env.SHOWAI_TEST_EXECUTABLE
      ? []
      : [process.env.SHOWAI_TEST_DESKTOP_ENTRY ?? root],
    cwd: root,
    env,
  });
  app.process().stderr.on("data", (data) => process.stderr.write(data));
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
  await page.waitForFunction(
    () => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]');
      return (
        tab &&
        !tab.hasAttribute("disabled") &&
        document.querySelector('[data-navigation-state="current"]')
      );
    },
    undefined,
    { timeout: 60000 },
  );
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
  const entries = async () => {
    const directory = join(env.SHOWAI_USER_DATA, "page-previews-v2");
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      names
        .filter((name) => /^latest-[a-f0-9]{64}\.json$/.test(name))
        .map(async (name) =>
          JSON.parse(await readFile(join(directory, name), "utf8")),
        ),
    );
  };
  const waitForCache = async (predicate) => {
    const deadline = Date.now() + 90000;
    let nextDiagnostic = Date.now() + 5000;
    while (Date.now() < deadline) {
      const cached = await entries();
      if (predicate(cached)) return cached;
      if (Date.now() > nextDiagnostic) {
        console.log(
          "Preview progress:",
          await page
            .evaluate(() => window.showai.diagnostics())
            .then((text) =>
              text
                .split("\n")
                .filter((line) => line.startsWith("Page previews:"))
                .join(""),
            ),
        );
        nextDiagnostic = Date.now() + 15000;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Background cache did not finish in time");
  };
  if (process.env.SHOWAI_TEST_EXPECT_PERSISTENT) {
    const started = performance.now();
    const warmed = await waitForCache((cached) =>
      cached.some((entry) => entry.home === home && entry.fingerprint),
    );
    result.unopenedCacheMs = performance.now() - started;
    result.unopenedCachedPages = warmed.length;
    result.checks.push(
      "Background rendering caches real pages before opening a project directory",
    );
  }
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
  if (!process.env.SHOWAI_TEST_LOAD_ONLY) {
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
    for (const delta of [450, 450, -450, -450])
      await page.mouse.wheel(0, delta);
  }
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
    // Continuous background warming may still be active; let its current shot
    // finish while admission is paused before inspecting the empty capture shells.
    await invoke("pages:thumbnailActivity", { paused: true });
    if (process.env.SHOWAI_TEST_EXPECT_PERSISTENT) {
      await app.evaluate(async ({ BrowserWindow }) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const busy = await Promise.all(
            BrowserWindow.getAllWindows()
              .filter((window) =>
                window.webContents.getURL().includes("pagePreview="),
              )
              .map((window) =>
                window.webContents.executeJavaScript(
                  "!!document.querySelector('.studio-page-thumbnail-content')",
                ),
              ),
          );
          if (busy.every((value) => !value)) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Background capture did not yield to input");
      });
    }
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
    await invoke("pages:thumbnailActivity", { paused: true });
    assert.equal(
      await invoke("pages:thumbnail", {
        ...reference,
        requestId: crypto.randomUUID(),
      }),
      first,
    );
    await invoke("pages:thumbnailActivity", { paused: false });
    result.checks.push(
      "Input pauses capture admission without blocking cached images",
    );
  }
  const dark = await invoke("pages:thumbnail", {
    ...reference,
    theme: "dark",
    requestId: crypto.randomUUID(),
  });
  assert.notEqual(dark, first);
  result.checks.push("Appearance participates in cache identity");
  if (process.env.SHOWAI_TEST_EXPECT_PERSISTENT) {
    await invoke("pages:thumbnail", {
      ...reference,
      theme: "light",
      requestId: crypto.randomUUID(),
    });
    const cachedOnly = {
      ...reference,
      width: 128,
      height: 80,
      padding: 3,
      cachedOnly: true,
      requestId: crypto.randomUUID(),
    };
    const initial = await invoke("pages:thumbnail", cachedOnly);
    assert.ok(initial.startsWith("data:image/png;base64,"));
    assert.equal(
      await invoke("pages:thumbnail", {
        ...cachedOnly,
        width: 768,
        height: 512,
        requestId: crypto.randomUUID(),
      }),
      initial,
    );
    const before = (await entries()).find(
      (entry) =>
        entry.home === home &&
        entry.projectId === projectId &&
        entry.pageId === reference.pageId &&
        entry.theme === "light",
    );
    const record = await invoke("pages:get", {
      projectId,
      pageId: reference.pageId,
    });
    await invoke("pages:save", {
      projectId,
      pageId: reference.pageId,
      baseHash: record.hash,
      baseRevision: record.revision,
      document: {
        ...record.document,
        title: record.document.title + " cache refresh",
      },
    });
    const started = performance.now();
    assert.ok(
      (
        await invoke("pages:thumbnail", {
          ...cachedOnly,
          requestId: crypto.randomUUID(),
        })
      ).startsWith("data:image/png;base64,"),
    );
    result.staleReadMs = performance.now() - started;
    await waitForCache((cached) =>
      cached.some(
        (entry) =>
          entry.projectId === projectId &&
          entry.pageId === reference.pageId &&
          entry.theme === "light" &&
          entry.fingerprint &&
          entry.fingerprint !== before.fingerprint,
      ),
    );
    result.checks.push(
      "Card sizes share one snapshot; edits keep the prior image and refresh it in the background",
    );
  }
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
  if (process.env.SHOWAI_TEST_EXPECT_PERSISTENT) {
    const query = {
      ...reference,
      cachedOnly: true,
      requestId: crypto.randomUUID(),
    };
    const expected = await invoke("pages:thumbnail", query);
    await app.close();
    app = await _electron.launch({
      executablePath: process.env.SHOWAI_TEST_EXECUTABLE ?? electron,
      args: process.env.SHOWAI_TEST_EXECUTABLE
        ? []
        : [process.env.SHOWAI_TEST_DESKTOP_ENTRY ?? root],
      cwd: root,
      env,
    });
    page = await app.firstWindow();
    await page.waitForFunction(
      () =>
        window.showai?.pageThumbnails &&
        document.querySelector(
          '[role="tab"][aria-selected="true"]:not([disabled])',
        ),
    );
    const started = performance.now();
    assert.equal(
      await invoke("pages:thumbnail", {
        ...query,
        requestId: crypto.randomUUID(),
      }),
      expected,
    );
    result.restartCacheMs = performance.now() - started;
    result.checks.push(
      "A new app process reuses the persisted snapshot without opening its page",
    );
  }
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page)
    result.state = await page.evaluate(() => ({
      readyState: document.readyState,
      navigation: document
        .querySelector("[data-navigation-state]")
        ?.getAttribute("data-navigation-state"),
      text: document.body.innerText.slice(0, 3000),
      images: document.querySelectorAll(".studio-page-thumbnail > img").length,
      errors: [
        ...document.querySelectorAll(".studio-page-thumbnail [title]"),
      ].map((e) => e.getAttribute("title")),
      stats: window.__previewPerf,
    }));
  const log = join(env.SHOWAI_USER_DATA, "logs/showai-main.log");
  result.log = await readFile(log, "utf8").then(
    (text) => text.slice(-16000),
    () => undefined,
  );
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
      await stopTestProcess(child);
      clearTimeout(timeout);
    }
  }
  await rm(join(output, "profile"), { recursive: true, force: true });
  if (!process.env.SHOWAI_TEST_HOME)
    await rm(home, { recursive: true, force: true });
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
