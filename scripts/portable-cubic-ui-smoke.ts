/** Real production browser bundle, loopback Workbench, SQLite/FileStore and
 * cold reopen. No substitute services, source models or geometry producers. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { preview } from "vite";
import {
  serializeArtifact,
  injectArtifactIntoHtml,
} from "../src/portable/validation.mjs";
import { pathToFileURL } from "node:url";
import { startBrowserServer } from "../src/browser/server";

process.env.SHOWAI_LANGUAGE = "zh-CN";
const directory = await mkdtemp(join(tmpdir(), "showai-cubic-ui-"));
const server = await startBrowserServer({
  home: join(directory, "library"),
  webRoot: resolve("dist"),
  cliEntry: resolve("dist-runtime/scripts/cli.mjs"),
  settingsPath: join(directory, "profile/settings.json"),
  registerAgentRuntime: false,
});
const browser = await chromium.launch({
  executablePath:
    process.env.SHOWAI_BROWSER_EXECUTABLE ??
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
});
const errors: string[] = [];
const checks: string[] = [];
let staticPreview: Awaited<ReturnType<typeof preview>> | undefined;
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  await page.addInitScript(() => {
    (window as any).__cubicMainDerivations = [];
    window.__showaiNativePerf = (stage, ms) => {
      if (stage === "surface.cubic.prepare.sync")
        (window as any).__cubicMainDerivations.push(ms);
    };
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.url);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = <T>(action: string, args: Record<string, unknown> = {}) =>
    page.evaluate(
      async ({ action, args }) => await window.showai!.invoke(action, args),
      { action, args },
    ) as Promise<T>;
  const project = await api<{ id: string }>("projects:create", {
    name: "Cubic actual writer",
  });
  const created = await api<{ document: { id: string }; path: string }>(
    "pages:create",
    {
      projectId: project.id,
      title: "Portable cubic acceptance",
      document: {
        id: "cubic-ui",
        title: "Portable cubic acceptance",
        content: {
          type: "surface",
          attrs: { id: "cubic-board", kind: "board", name: "Board" },
          content: [],
        },
        layout: {},
        surfaceViews: {},
        foreignState: { keep: "unknown root" },
      },
    },
  );
  await page
    .getByRole("button", { name: "Cubic actual writer", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Portable cubic acceptance", exact: true })
    .click();
  const scene = page.locator('[data-container-root="cubic-board"]');
  await scene.waitFor();
  const read = () =>
    api<any>("pages:get", {
      projectId: project.id,
      pageId: created.document.id,
    });
  async function poll(predicate: (value: any) => boolean, label: string) {
    const deadline = Date.now() + 20000;
    let value: any;
    while (Date.now() < deadline) {
      value = await read();
      if (predicate(value)) return value;
      await new Promise((done) => setTimeout(done, 60));
    }
    throw new Error(label + ": " + JSON.stringify(value).slice(-2000));
  }
  const strokes = (record: any) =>
    record.document.content.content.filter(
      (node: any) => node.type === "drawing" && node.attrs?.ink,
    );
  await scene.getByRole("button", { name: "画笔", exact: true }).click();
  const input = scene.locator('[data-cubic-input="2"]');
  await input.waitFor();
  const box = (await input.boundingBox())!;
  const x = box.x + 350,
    y = box.y + 330;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 20, { steps: 35 });
  await page.mouse.up();
  const one = await poll(
      (value) => strokes(value).length === 1,
      "first actual stroke saved",
    ),
    first = strokes(one)[0],
    id = first.attrs.id;
  assert.equal(first.attrs.ink.format, "showai-ink-v2");
  assert.ok(first.attrs.ink.capture.raw.length >= 30);
  assert.equal(first.attrs.ink.samples, undefined);
  assert.equal(first.attrs.inkFragments, undefined);
  assert.equal(first.attrs.inkInput, undefined);
  assert.equal(one.document.foreignState.keep, "unknown root");
  const source = JSON.stringify(first.attrs.ink);
  checks.push(
    "actual DOM pointer writing saves only v2 center/radius and full raw capture",
  );
  // Rapid sequential contacts must retain acceptance order and separate Undo.
  await page.mouse.move(x + 130, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y + 20, { steps: 29 });
  await page.mouse.up();
  await page.mouse.move(x + 240, y);
  await page.mouse.down();
  await page.mouse.move(x + 300, y + 20, { steps: 25 });
  await page.mouse.up();
  let three = await poll(
    (value) => strokes(value).length === 3,
    "three actual strokes",
  );
  const ids = strokes(three).map((n: any) => n.attrs.id);
  assert.equal(ids[0], id);
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await poll((value) => strokes(value).length === 2, "first Undo");
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await poll((value) => strokes(value).length === 1, "second Undo");
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  await poll((value) => strokes(value).length === 2, "first Redo");
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  three = await poll((value) => strokes(value).length === 3, "second Redo");
  assert.deepEqual(
    strokes(three).map((n: any) => n.attrs.id),
    ids,
  );
  checks.push("three actual contacts have independent ordered Undo/Redo");
  // Leave drawing, select exact geometry then edit the existing source style.
  await scene.getByRole("button", { name: "选择工具", exact: true }).click();
  await page.mouse.click(x + 45, y + 10);
  await page.screenshot({ path: join(directory, "selected.png") });
  const sliders = scene.locator('input[type="range"]');
  await sliders.first().waitFor();
  {
    await sliders.first().focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await poll(
      (value) =>
        strokes(value)[0].attrs.strokeWidth !== first.attrs.strokeWidth,
      "width edit saved",
    );
  }
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await poll(
    (value) => strokes(value)[0].attrs.strokeWidth === first.attrs.strokeWidth,
    "width Undo",
  );
  assert.deepEqual(
    await page.evaluate(() => (window as any).__cubicMainDerivations),
    [],
    "actual newly accepted v2 sources must not prepare a second Main-thread outline",
  );
  const after = await read();
  assert.equal(JSON.stringify(strokes(after)[0].attrs.ink), source);
  checks.push("style edit/Undo retains complete source curves and raw capture");
  await scene.locator(".board-color-picker summary").first().click();
  await scene
    .locator('.board-color-presets button[aria-label*="#ef4444"]')
    .click();
  await poll(
    (value) => strokes(value)[0].attrs.color === "#ef4444",
    "color edit",
  );
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  await poll(
    (value) => strokes(value)[0].attrs.color === first.attrs.color,
    "color Undo",
  );
  await page.getByRole("button", { name: "重做操作", exact: true }).click();
  await poll(
    (value) => strokes(value)[0].attrs.color === "#ef4444",
    "color Redo",
  );
  await scene.getByRole("button", { name: "笔迹橡皮", exact: true }).click();
  await page.mouse.move(x + 45, y + 10);
  await page.mouse.down();
  await page.mouse.move(x + 46, y + 11);
  await page.mouse.up();
  await poll(
    (value) => !strokes(value).some((node: any) => node.attrs.id === id),
    "erase logical stroke",
  );
  await page.getByRole("button", { name: "撤销操作", exact: true }).click();
  const erasedUndo = await poll(
    (value) => strokes(value).some((node: any) => node.attrs.id === id),
    "erase Undo",
  );
  assert.equal(
    JSON.stringify(
      strokes(erasedUndo).find((node: any) => node.attrs.id === id).attrs.ink,
    ),
    source,
  );
  checks.push(
    "actual style/color/erase/Undo retain original center/radius and capture",
  );

  await page.reload();
  await page
    .locator('[data-surface-id="' + id + '"] [data-portable-ink="2"]')
    .first()
    .waitFor();
  const reopened = await read();
  assert.deepEqual(
    await page.evaluate(() => (window as any).__cubicMainDerivations),
    [],
    "cold editor geometry must be prepared by the real Worker",
  );
  assert.equal(JSON.stringify(strokes(reopened)[0].attrs.ink), source);
  assert.equal(reopened.document.foreignState.keep, "unknown root");
  const disk = JSON.parse(await readFile(created.path, "utf8"));
  assert.equal(
    disk.document.content.content[0].attrs.ink.format,
    "showai-ink-v2",
  );
  checks.push(
    "formal FileStore save and browser cold reopen retain editable v2",
  );
  const lifecycleAsset = (await readdir(resolve("dist/assets"))).find((name) =>
    /^lifecycle-.*\.js$/.test(name),
  );
  if (!lifecycleAsset)
    throw new Error(
      "Build the real lifecycle acceptance entry with the production bundle",
    );
  await page.addScriptTag({
    type: "module",
    url: new URL("assets/" + lifecycleAsset, server.url).href,
  });
  await page.waitForFunction(
    () => typeof (window as any).__cubicPendingLifecycle === "function",
  );
  const lifecycle = [];
  for (const kind of ["leave", "clear", "dispose", "switch"])
    lifecycle.push(
      await page.evaluate(
        ({ projectId, kind }) =>
          (window as any).__cubicPendingLifecycle(projectId, kind),
        { projectId: project.id, kind },
      ),
    );
  checks.push(
    "accepted actual Worker input survives leave, clear, dispose and page switch through real recovery/CAS",
  );
  // Pause the actual new Worker at its debugger start barrier, not a fake
  // producer or timeout. Main UI authoring and the independent source owner
  // remain live while the accepted A contact is deterministically not ready.
  const race = await api<any>("pages:create", {
    projectId: project.id,
    title: "Actual pending A then B",
    document: {
      id: "race-page",
      title: "Actual pending A then B",
      content: {
        type: "surface",
        attrs: { id: "race-board", kind: "board", name: "Board" },
        content: [],
      },
      layout: {},
      surfaceViews: {},
    },
  });
  await page.goto(
    server.url +
      "?" +
      new URLSearchParams({ project: project.id, page: race.document.id }),
  );
  const raceScene = page.locator('[data-container-root="race-board"]');
  await raceScene.waitFor();
  const cdp = await page.context().newCDPSession(page);
  let paused: string | undefined;
  let sequence = 0;
  const sendWorker = (sessionId: string, method: string) =>
    cdp.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id: ++sequence, method }),
    });
  const resume = async (sessionId: string) => {
    await sendWorker(sessionId, "Debugger.resume");
    await sendWorker(sessionId, "Runtime.runIfWaitingForDebugger");
  };
  let signalPause!: () => void;
  const pauseReady = new Promise<void>((resolve) => {
    signalPause = resolve;
  });
  cdp.on("Target.receivedMessageFromTarget", ({ sessionId, message }) => {
    const packet = JSON.parse(message);
    if (sessionId === paused && packet.method === "Debugger.paused")
      signalPause();
  });
  cdp.on(
    "Target.attachedToTarget",
    ({ sessionId, targetInfo, waitingForDebugger }) => {
      if (
        waitingForDebugger &&
        targetInfo.url.includes("portable-cubic-input-worker")
      ) {
        paused = sessionId;
        void sendWorker(sessionId, "Debugger.enable")
          .then(() => sendWorker(sessionId, "Debugger.pause"))
          .then(() => sendWorker(sessionId, "Runtime.runIfWaitingForDebugger"));
      } else void sendWorker(sessionId, "Runtime.runIfWaitingForDebugger");
    },
  );
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  });
  try {
    await raceScene.getByRole("button", { name: "画笔", exact: true }).click();
    const area = raceScene.locator('[data-cubic-input="2"]');
    await area.waitFor();
    const bounds = (await area.boundingBox())!;
    await page.mouse.move(bounds.x + 330, bounds.y + 300);
    await page.mouse.down();
    await Promise.race([
      pauseReady,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("Actual cubic Worker did not reach Debugger.paused"),
            ),
          5000,
        ),
      ),
    ]);
    await page.mouse.move(bounds.x + 420, bounds.y + 320, { steps: 25 });
    await page.mouse.up();
    assert.ok(paused, "actual cubic worker must be held before its first work");
    await raceScene.getByRole("button", { name: "矩形", exact: true }).click();
    const shapeArea = raceScene.locator("[data-board-drawing-input]");
    await shapeArea.waitFor();
    await page.mouse.move(bounds.x + 500, bounds.y + 350);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 600, bounds.y + 430, { steps: 8 });
    await page.mouse.up();
    assert.equal(
      await raceScene.locator(".surface-object.is-drawing").count(),
      1,
      "B exists while A has no canonical geometry",
    );
    assert.equal(await raceScene.locator("[data-portable-ink]").count(), 0);
    await resume(paused!);
    paused = undefined;
    const raceRead = () =>
      api<any>("pages:get", {
        projectId: project.id,
        pageId: race.document.id,
      });
    const racePoll = async (
      predicate: (record: any) => boolean,
      label: string,
    ) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const value = await raceRead();
        if (predicate(value)) return value;
        await new Promise((done) => setTimeout(done, 60));
      }
      throw new Error(label);
    };
    const accepted = await racePoll(
      (record) => record.document.content.content.length === 2,
      "ordered A+B saved",
    );
    assert.deepEqual(
      accepted.document.content.content.map((node: any) => node.attrs.tool),
      ["pen", "rectangle"],
    );
    await page.getByRole("button", { name: "撤销操作", exact: true }).click();
    const undoneB = await racePoll(
      (record) => record.document.content.content.length === 1,
      "Undo B preserving A",
    );
    assert.equal(
      undoneB.document.content.content[0].attrs.ink.format,
      "showai-ink-v2",
    );
    await page.getByRole("button", { name: "撤销操作", exact: true }).click();
    await racePoll(
      (record) => record.document.content.content.length === 0,
      "Undo A",
    );
    await page.getByRole("button", { name: "重做操作", exact: true }).click();
    await racePoll(
      (record) => record.document.content.content.length === 1,
      "Redo A",
    );
    await page.getByRole("button", { name: "重做操作", exact: true }).click();
    const both = await racePoll(
      (record) => record.document.content.content.length === 2,
      "Redo B",
    );
    assert.deepEqual(
      both.document.content.content.map((node: any) => node.attrs.tool),
      ["pen", "rectangle"],
    );
    checks.push(
      "actual debugger-held Worker A plus later real UI B preserve paint order and independent Undo/Redo",
    );
  } finally {
    if (paused) await resume(paused);
    await cdp.send("Target.setAutoAttach", {
      autoAttach: false,
      waitForDebuggerOnStart: false,
      flatten: false,
    });
    await cdp.detach();
  }
  staticPreview = await preview({
    configFile: false,
    root: process.cwd(),
    preview: { host: "127.0.0.1", port: 0 },
    build: { outDir: "dist" },
  });
  const standalone = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  standalone.on("pageerror", (error) => errors.push(error.message));
  const artifact = serializeArtifact(reopened.document, []);
  await standalone.addInitScript(
    ({ artifact }) => {
      if (!localStorage.getItem("showai.canvas.v1"))
        localStorage.setItem("showai.canvas.v1", artifact);
    },
    { artifact },
  );
  await standalone.goto(staticPreview.resolvedUrls!.local[0]);
  const standaloneScene = standalone.locator(
    '[data-container-root="cubic-board"]',
  );
  await standaloneScene.waitFor();
  await standaloneScene.locator('[data-portable-ink="2"]').first().waitFor();
  await standaloneScene
    .getByRole("button", { name: "画笔", exact: true })
    .click();
  const localInput = standaloneScene.locator('[data-cubic-input="2"]');
  await localInput.waitFor();
  const localBox = (await localInput.boundingBox())!;
  await standalone.mouse.move(localBox.x + 380, localBox.y + 520);
  await standalone.mouse.down();
  await standalone.mouse.move(localBox.x + 500, localBox.y + 545, {
    steps: 31,
  });
  await standalone.mouse.up();
  await standalone.waitForFunction(() => {
    const artifact = JSON.parse(localStorage.getItem("showai.canvas.v1")!);
    return (
      artifact.document.content.content.filter((node: any) => node.attrs?.ink)
        .length === 4
    );
  });
  const localSaved = await standalone.evaluate(() =>
    JSON.parse(localStorage.getItem("showai.canvas.v1")!),
  );
  assert.equal(
    localSaved.document.content.content[3].attrs.ink.format,
    "showai-ink-v2",
  );
  assert.ok(
    localSaved.document.content.content[3].attrs.ink.capture.raw.length >= 30,
  );
  await standalone.reload();
  await standalone.locator('[data-portable-ink="2"]').first().waitFor();
  assert.equal(
    await standalone.locator(".surface-object.is-drawing").count(),
    4,
  );
  await standalone.close();
  checks.push(
    "standalone CanvasApp creates v2 with actual Workers and localStorage cold recovery",
  );
  const portable = await readFile(
      resolve("dist-portable/portable.html"),
      "utf8",
    ),
    htmlPath = join(directory, "actual-v2-self-contained.html");
  await writeFile(
    htmlPath,
    injectArtifactIntoHtml(portable, reopened.document, []),
  );
  const reader = await browser.newPage();
  reader.on("pageerror", (error) => errors.push(error.message));
  const requests: string[] = [];
  reader.on("requestfailed", (request) => requests.push(request.url()));
  await reader.goto(pathToFileURL(htmlPath).href);
  await reader.locator('[data-portable-ink="2"]').first().waitFor();
  assert.equal(await reader.locator('[data-portable-ink="2"]').count(), 6);
  assert.deepEqual(requests, []);
  await reader.close();
  checks.push(
    "actual self-contained file HTML displays all v2 as shared vector paths without Worker/assets",
  );
  assert.deepEqual(errors, []);
  await mkdir("output/playwright", { recursive: true });
  await writeFile(
    "output/playwright/portable-cubic-ui-result.json",
    JSON.stringify(
      { passed: true, directory, checks, lifecycle, errors, ids },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, directory, checks, errors }));
} catch (error) {
  for (const active of browser
    .contexts()
    .flatMap((context) => context.pages())) {
    await active
      .screenshot({ path: join(directory, "failure.png") })
      .catch(() => {});
    console.error(
      JSON.stringify({
        errors,
        url: active.url(),
        alerts: await active.getByRole("alert").allTextContents(),
        body: (await active.locator("body").innerText()).slice(-2500),
      }),
    );
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
  await new Promise<void>((resolve, reject) =>
    staticPreview
      ? staticPreview.httpServer.close((error) =>
          error ? reject(error) : resolve(),
        )
      : resolve(),
  );
}
