import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
  symlink,
  rm,
  open,
  cp,
  copyFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { homedir, cpus, totalmem, platform } from "node:os";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
import {
  snapshotLibrary,
  selectPerfPages,
} from "./interaction-perf-fixture.mjs";
import {
  distribution,
  installInteractionProbe,
  profileSummary,
} from "./interaction-perf-metrics.mjs";

const { values: args } = parseArgs({
  options: {
    "source-home": { type: "string" },
    output: { type: "string" },
    run: { type: "string" },
    document: { type: "string" },
    board: { type: "string" },
    iterations: { type: "string", default: "10" },
    list: { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (args.help) {
  console.log(
    "node scripts/interaction-perf.mjs --source-home /library --output /existing/output [--iterations 10] [--document ID --board ID] [--list]\nResume an owned snapshot with --run /output/run-… . Source SQLite is opened read-only. Run npm run build first. PageDown is the page-turn scenario; this does not measure PDF pagination or physical display latency.",
  );
  process.exit(0);
}
const root = resolve(import.meta.dirname, "..");
const iterations = Number(args.iterations);
assert.ok(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100);
const execute = promisify(execFile);
const json = (path, data) =>
  writeFile(path, JSON.stringify(data, null, 2) + "\n");
let output, snapshot;
if (args.run) {
  output = await realpath(args.run);
  snapshot = JSON.parse(await readFile(join(output, "snapshot.json"), "utf8"));
  assert.equal(snapshot.destination, join(output, "library"));
  assert.equal(snapshot.sourceOpenedReadOnly, true);
} else {
  assert.ok(args["source-home"], "Pass --source-home or --run");
  const source = await realpath(args["source-home"]);
  const parent = await realpath(
    args.output ?? join(homedir(), "ShowAI-Performance"),
  );
  assert.ok(
    parent !== source && !parent.startsWith(source + sep),
    "Output must be outside the source library",
  );
  output = await mkdtemp(join(parent, "run-"));
  snapshot = await snapshotLibrary(source, join(output, "library"));
  await json(join(output, "snapshot.json"), snapshot);
}
assert.ok(
  output !== snapshot.source && !output.startsWith(snapshot.source + sep),
);
const lock = await open(join(output, "running.lock"), "wx");
await lock.writeFile(String(process.pid));
const home = join(output, "library"),
  profile = join(output, "profile"),
  runtime = join(output, "runtime");
const entry = join(runtime, "server.mjs");
const env = {
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_USER_DATA: profile,
  SHOWAI_AGENT_WORKSPACES: join(output, "agent-workspaces"),
  SHOWAI_INDEX_WORKER: join(root, "dist-agent/index-worker.mjs"),
  SHOWAI_LANGUAGE: "zh-CN",
  SHOWAI_BACKGROUND: "1",
};
const report = {
  version: 1,
  startedAt: new Date().toISOString(),
  output,
  snapshot,
  iterations,
  passed: false,
  scenarios: [],
  diagnostics: [],
  errors: [],
  limitations: [
    "Headless browser backend, not Electron IPC or physical display latency",
    "contentReady is an asserted DOM/content milestone, not proof of presentation",
    "rAF intervals are main-thread scheduling opportunities, not display FPS",
    "Event Timing omits continuous inputs and entries below its threshold",
    "Page turn uses PageDown in a real document; PDF/slide pagination is not covered",
    "Catalog discovery warms backend caches; first-open refers to a fresh renderer, not cold disk",
  ],
};
let server,
  browser,
  page,
  cdp,
  serverLog = "";
const interrupt = () => {
  report.interrupted = true;
  process.exitCode = 130;
  void browser?.close();
  server?.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => json(join(output, "results.json"), report);
try {
  assert.equal(
    await realpath(home),
    home,
    "Snapshot directory must not be a symlink",
  );
  await mkdir(runtime, { recursive: true });
  await mkdir(profile, { recursive: true });
  await mkdir(join(output, "evidence"), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(runtime, "node_modules"),
  ).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  await build({
    entryPoints: [join(root, "scripts/interaction-perf-server.ts")],
    outfile: entry,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    plugins: [rawSourcePlugin],
    banner: {
      js: 'import {createRequire as __cr} from "node:module"; const require=__cr(import.meta.url);',
    },
  });
  await cp(join(root, "dist"), join(runtime, "web"), { recursive: true });
  await copyFile(
    join(root, "dist-agent/index-worker.mjs"),
    join(runtime, "index-worker.mjs"),
  );
  env.SHOWAI_INDEX_WORKER = join(runtime, "index-worker.mjs");
  server = spawn(
    process.execPath,
    [
      entry,
      home,
      profile,
      join(runtime, "web"),
      join(root, "dist-runtime/scripts/cli.mjs"),
      output,
      args.document ?? "",
      args.board ?? "",
      args.list ? "list" : "",
    ],
    { env, cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stderr.on("data", (chunk) => {
    serverLog += chunk;
  });
  const startup = await new Promise((done, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Server startup timed out: ${serverLog.slice(-3000)}`),
        ),
      300000,
    );
    let buffer = "";
    server.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        if (line.startsWith('{"url":')) {
          clearTimeout(timer);
          done(JSON.parse(line));
          return;
        }
      }
    });
    server.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${serverLog}`));
    });
  });
  report.server = startup;
  await json(join(output, "session.json"), {
    root,
    branch: (
      await execute("git", ["branch", "--show-current"], { cwd: root })
    ).stdout.trim(),
    ...startup,
    profile,
    runtime,
    output,
    purpose:
      "User-requested interaction benchmark; source library read-only; snapshot has no local sync configuration",
    retention:
      "Retain results, source snapshot and selected materials; remove runtime/profile after completed run",
  });
  const catalog = JSON.parse(
    await readFile(join(output, "catalog.json"), "utf8"),
  );
  if (args.list) {
    console.log(JSON.stringify({ output, pages: catalog }, null, 2));
    report.catalogOnly = true;
  } else {
    const { document, board } = selectPerfPages(catalog, args);
    report.pages = { document, board };
    await json(join(output, "selection.json"), report.pages);
    browser = await chromium.launch({ channel: "chromium", headless: true });
    const browserCdp = await browser.newBrowserCDPSession();
    const gpu = await browserCdp.send("SystemInfo.getInfo");
    report.environment = {
      browser: browser.version(),
      gpu: gpu.gpu,
      platform: platform(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemory: totalmem(),
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 1,
      commit: (
        await execute("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim(),
      dirty: (
        await execute("git", ["status", "--short"], { cwd: root })
      ).stdout.trim(),
      build: JSON.parse(
        await readFile(join(root, "dist-desktop/build-info.json"), "utf8"),
      ),
    };
    async function newPage() {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
        locale: "zh-CN",
        reducedMotion: "no-preference",
      });
      await context.addInitScript(installInteractionProbe);
      page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", (e) =>
        report.errors.push({ message: e.message, at: Date.now() }),
      );
      cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      await page.goto(`${startup.url}?project=${document.projectId}`);
      await page.locator(".studio-sidebar").waitFor();
      await page.waitForFunction(
        () =>
          window.showai?.invoke &&
          document.querySelector("[data-navigation-state=current]"),
      );
      await page.evaluate(() => window.__interactionPerf.attachHost());
      const info = await page.evaluate(() => window.showai.invoke("app:info"));
      assert.equal(info.home, home, "Workbench must use the owned snapshot");
      return context;
    }
    const surface = (target) =>
      `[data-container-root="${target.rootId}"], [data-board-id="${target.rootId}"]`;
    async function ready(target) {
      await page.waitForFunction((selector) => {
        const fatal = document.querySelector('main[role="alert"]');
        if (fatal) throw new Error(fatal.textContent);
        const el = [...document.querySelectorAll(selector)].find(
          (n) => n.getClientRects().length,
        );
        if (
          !el ||
          !el.querySelector(".ProseMirror, .surface-object, .sb-block, iframe")
        )
          return false;
        const box = el.getBoundingClientRect();
        const visible = (n) => {
          const r = n.getBoundingClientRect();
          return (
            r.width && r.height && r.bottom > box.top && r.top < box.bottom
          );
        };
        const problem = [...el.querySelectorAll(".component-status")].find(
          visible,
        );
        if (problem) throw new Error(problem.textContent);
        return ![
          ...el.querySelectorAll('.showai-pending, [aria-busy="true"]'),
        ].some(visible);
      }, surface(target));
    }
    async function clickPage(target, modifiers = []) {
      let button = page
        .locator(`[data-open-page="${target.pageId}"]`)
        .filter({ visible: true })
        .first();
      if (!(await button.count())) {
        const projectRow = page
          .locator(
            `.studio-tree-row[data-kind="project"][data-library-id="${target.projectId}"]`,
          )
          .first();
        await projectRow.locator(".studio-tree-main").click();
        for (const folder of target.folders ?? []) {
          await page
            .locator(
              `[data-library-id="${folder}"] .studio-tree-main, [data-library-id="${folder}"] .studio-page-list-open`,
            )
            .first()
            .click();
        }
        button = page
          .locator(`[data-open-page="${target.pageId}"]`)
          .filter({ visible: true })
          .first();
      }
      await button.waitFor();
      await button.click({ modifiers });
      await ready(target);
    }
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send("Performance.getMetrics")).metrics.map(
          ({ name, value }) => [name, value],
        ),
      );
    async function measure(name, action, index, diagnostic = false, verify) {
      await delay(250);
      const before = await metrics();
      if (diagnostic) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
        await cdp.send("Tracing.start", {
          categories: "devtools.timeline,blink.user_timing,loading",
          transferMode: "ReturnAsStream",
        });
      }
      await page.evaluate(() => window.__interactionPerf.begin());
      let assertion, failure;
      try {
        assertion = await action();
      } catch (error) {
        failure = error.stack ?? String(error);
      }
      await page.evaluate(() => window.__interactionPerf.end());
      const after = await metrics();
      await delay(120);
      const sample = await page.evaluate(() => window.__interactionPerf.read());
      if (!sample.trustedInput)
        failure ??= `${name} did not receive browser input`;
      if (!failure && verify) {
        try {
          await verify(assertion);
        } catch (error) {
          failure = error.stack ?? String(error);
        }
      }
      sample.name = name;
      sample.index = index;
      sample.assertion = assertion;
      sample.failure = failure;
      sample.raf = distribution(sample.rafIntervals);
      sample.mainThread = Object.fromEntries(
        [
          "TaskDuration",
          "ScriptDuration",
          "LayoutDuration",
          "RecalcStyleDuration",
          "LayoutCount",
          "RecalcStyleCount",
        ].map((key) => {
          assert.ok(
            Number.isFinite(before[key]) && Number.isFinite(after[key]),
            `CDP metric unavailable: ${key}`,
          );
          return [key, after[key] - before[key]];
        }),
      );
      if (diagnostic) {
        const { profile: cpu } = await cdp.send("Profiler.stop");
        sample.profile = profileSummary(cpu);
        await json(join(output, "evidence", `${name}.cpuprofile`), cpu);
        const completion = new Promise((done) =>
          cdp.once("Tracing.tracingComplete", done),
        );
        await cdp.send("Tracing.end");
        const { stream } = await completion;
        const trace = await open(
          join(output, "evidence", `${name}.trace.json`),
          "w",
        );
        try {
          for (;;) {
            const part = await cdp.send("IO.read", { handle: stream });
            await trace.write(
              part.base64Encoded ? Buffer.from(part.data, "base64") : part.data,
            );
            if (part.eof) break;
          }
        } finally {
          await trace.close();
          await cdp.send("IO.close", { handle: stream });
        }
        await page.screenshot({
          path: join(output, "evidence", `${name}.png`),
        });
        report.diagnostics.push(sample);
      } else report.scenarios.push(sample);
      if (failure)
        await page.screenshot({
          path: join(output, "evidence", `${name}-failure.png`),
        });
      await save();
      console.log(
        JSON.stringify({
          name,
          index,
          diagnostic,
          inputToReadyMs: sample.inputToReadyMs,
          rafP95: sample.raf.p95,
          longTasks: sample.longTasks.length,
          failure,
        }),
      );
      return sample;
    }
    let context = await newPage();
    for (let i = 0; i < iterations; i++) {
      if (i) {
        await context.close();
        context = await newPage();
      }
      await page
        .locator(`[data-open-page="${document.pageId}"]`)
        .filter({ visible: true })
        .first()
        .waitFor();
      const sample = await measure(
        "open",
        async () => {
          await clickPage(document);
          return {
            targetPage: document.pageId,
            contentReady: true,
            cache: "fresh-browser-context/warm-backend",
          };
        },
        i,
      );
      assert.ok(!sample.failure, "Opening failed; see the recorded sample");
    }
    await context.close();
    context = await newPage();
    await measure(
      "open",
      async () => {
        await clickPage(document);
        return { targetPage: document.pageId, contentReady: true };
      },
      0,
      true,
    );
    const pageTurn = async () => {
      const selector = surface(document);
      const before = await page
        .locator(selector)
        .filter({ visible: true })
        .first()
        .evaluate((el) => ({
          top: el.scrollTop,
          height: el.clientHeight,
          total: el.scrollHeight,
        }));
      assert.ok(
        before.total > before.height * 1.5,
        "The selected document is not long enough to turn a page",
      );
      await page.keyboard.press("PageDown");
      await page.waitForFunction(
        ({ selector, top }) =>
          [...document.querySelectorAll(selector)].some(
            (el) => el.getClientRects().length && el.scrollTop > top + 100,
          ),
        { selector, top: before.top },
      );
      let previous = -1,
        stable = 0,
        current;
      for (let tries = 0; tries < 80 && stable < 3; tries++) {
        current = await page
          .locator(selector)
          .filter({ visible: true })
          .first()
          .evaluate((el) => el.scrollTop);
        stable = Math.abs(current - previous) < 0.5 ? stable + 1 : 0;
        previous = current;
        await delay(20);
      }
      assert.ok(stable >= 3, "PageDown did not settle");
      await ready(document);
      return {
        key: "PageDown",
        before: before.top,
        after: current,
        distance: current - before.top,
        settlementSamplingMs: 20,
      };
    };
    async function prepareTurn() {
      const scroll = page
        .locator(surface(document))
        .filter({ visible: true })
        .first();
      await scroll.evaluate((el) => {
        el.scrollTop = 0;
      });
      const box = await scroll.boundingBox();
      await page.mouse.click(box.x + box.width - 20, box.y + 100);
      await delay(200);
    }
    for (let i = 0; i < iterations; i++) {
      await prepareTurn();
      await measure("page-turn", pageTurn, i);
    }
    await prepareTurn();
    await measure("page-turn", pageTurn, 0, true);
    await clickPage(board, ["ControlOrMeta"]);
    let boardTab = await page
      .locator('button[id^="workspace-tab-"][aria-selected="true"]')
      .getAttribute("id");
    const boardRoot = page
      .locator(surface(board))
      .filter({ visible: true })
      .first();
    const candidatesForDrag = await boardRoot
      .locator(".surface-world > [data-surface-id]")
      .evaluateAll((elements) =>
        elements
          .filter(
            (el) =>
              el.getClientRects().length && !el.classList.contains("is-locked"),
          )
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              id: el.dataset.surfaceId,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
            };
          })
          .filter(
            (r) =>
              r.width > 30 &&
              r.height > 30 &&
              r.x > 250 &&
              r.y > 100 &&
              r.x + r.width < innerWidth - 130 &&
              r.y < innerHeight - 150,
          ),
      );
    assert.ok(
      candidatesForDrag.length,
      "No visible movable object fits the drag trajectory; select another real board",
    );
    const objectId = candidatesForDrag[0].id;
    const object = boardRoot.locator(`[data-surface-id="${objectId}"]`).first();
    let dragSign = 1;
    const drag = async () => {
      const start = await object.evaluate((el) => {
        const outline = el.querySelector(".board-object-outline");
        if (outline) {
          const r = outline.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        const path = el.querySelector("svg path");
        if (path instanceof SVGPathElement && path.getTotalLength()) {
          const p = path.getPointAtLength(path.getTotalLength() * 0.4);
          const point = new DOMPoint(p.x, p.y).matrixTransform(
            path.getScreenCTM(),
          );
          return { x: point.x, y: point.y };
        }
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + 8 };
      });
      const initial = await object.evaluate((el) => ({
        left: el.style.left,
        top: el.style.top,
      }));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const began = performance.now();
      const samples = [];
      for (let step = 1; step <= 45; step++) {
        const expectedAt = began + (step * 1000) / 45;
        await delay(Math.max(0, expectedAt - performance.now()));
        await page.mouse.move(
          start.x + (dragSign * 90 * step) / 45,
          start.y + (dragSign * 45 * step) / 45,
        );
        samples.push(performance.now() - expectedAt);
      }
      const during = await object.evaluate((el) => ({
        left: el.style.left,
        top: el.style.top,
        selected: el.classList.contains("is-selected"),
      }));
      await page.mouse.up();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const final = await object.evaluate((el) => ({
        left: el.style.left,
        top: el.style.top,
      }));
      assert.ok(
        final.left !== initial.left || final.top !== initial.top,
        `Dragged object did not move: ${JSON.stringify({ objectId, start, initial, during, final })}`,
      );
      dragSign *= -1;
      return {
        objectId,
        start,
        initial,
        during,
        final,
        trajectoryMs: 1000,
        steps: 45,
        driverScheduleLatenessMs: distribution(samples),
      };
    };
    const verifyDrag = async (assertion) => {
      await page.waitForFunction(
        async ({ projectId, pageId, objectId, final }) => {
          const record = await window.showai.invoke("pages:get", {
            projectId,
            pageId,
          });
          const frame = record.document.layout?.[objectId];
          return (
            frame &&
            Math.abs(frame.x - parseFloat(final.left)) < 0.5 &&
            Math.abs(frame.y - parseFloat(final.top)) < 0.5
          );
        },
        {
          projectId: board.projectId,
          pageId: board.pageId,
          objectId,
          final: assertion.final,
        },
        { timeout: 10000, polling: 200 },
      );
      assertion.persistedInSnapshot = true;
    };
    for (let i = 0; i < iterations; i++)
      await measure("drag", drag, i, false, verifyDrag);
    await measure("drag", drag, 0, true, verifyDrag);
    await clickPage(document, ["ControlOrMeta"]);
    let documentTab = await page
      .locator('button[id^="workspace-tab-"][aria-selected="true"]')
      .getAttribute("id");
    assert.notEqual(
      boardTab,
      documentTab,
      "Switch benchmark needs two different retained tabs",
    );
    let nextTarget = board;
    const switchTab = async () => {
      const target = nextTarget;
      await page
        .locator(`[id="${target === board ? boardTab : documentTab}"]`)
        .click();
      await ready(target);
      nextTarget = target === board ? document : board;
      return { targetPage: target.pageId, retainedTab: true };
    };
    for (let i = 0; i < iterations; i++) {
      const sample = await measure("switch", switchTab, i);
      if (sample.failure) break;
    }
    await context.close();
    context = await newPage();
    await clickPage(board, ["ControlOrMeta"]);
    boardTab = await page
      .locator('button[id^="workspace-tab-"][aria-selected="true"]')
      .getAttribute("id");
    await clickPage(document, ["ControlOrMeta"]);
    documentTab = await page
      .locator('button[id^="workspace-tab-"][aria-selected="true"]')
      .getAttribute("id");
    nextTarget = board;
    await measure("switch", switchTab, 0, true);
    report.summary = Object.fromEntries(
      ["open", "page-turn", "switch", "drag"].map((name) => {
        const all = report.scenarios.filter((s) => s.name === name);
        const samples = all.filter((s) => !s.failure);
        return [
          name,
          {
            attempted: all.length,
            failed: all.length - samples.length,
            inputToContentReadyMs:
              name === "drag"
                ? null
                : distribution(samples.map((s) => s.inputToReadyMs)),
            releaseToReadyMs:
              name === "drag"
                ? distribution(samples.map((s) => s.releaseToReadyMs))
                : null,
            actionDurationMs: distribution(
              samples.map((s) => s.inputToReadyMs),
            ),
            mainThreadScriptMs: distribution(
              samples.map((s) => s.mainThread.ScriptDuration * 1000),
            ),
            layoutMs: distribution(
              samples.map((s) => s.mainThread.LayoutDuration * 1000),
            ),
            rafIntervalMs: distribution(samples.flatMap((s) => s.rafIntervals)),
            longTaskCount: samples.reduce(
              (sum, s) => sum + s.longTasks.length,
              0,
            ),
          },
        ];
      }),
    );
    report.passed =
      report.errors.length === 0 &&
      !report.scenarios.some((s) => s.failure) &&
      !report.diagnostics.some((s) => s.failure);
    await context.close();
  }
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "evidence/failure.png") })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    let timer;
    await Promise.race([
      stopped,
      new Promise((done) => {
        timer = setTimeout(done, 10000);
      }),
    ]);
    clearTimeout(timer);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await stopped;
      report.forcedServerShutdown = true;
    }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, "server.log"), serverLog);
  await save();
  const number = (value) => (value == null ? "—" : value.toFixed(1));
  const rows = Object.entries(report.summary ?? {}).map(([name, summary]) => {
    const timing =
      name === "drag"
        ? summary.releaseToReadyMs
        : summary.inputToContentReadyMs;
    return `| ${name} | ${summary.attempted - summary.failed}/${summary.attempted} | ${number(timing?.p50)} | ${number(timing?.p95)} | ${number(summary.rafIntervalMs.p95)} | ${summary.longTaskCount} |`;
  });
  await writeFile(
    join(output, "report.md"),
    [
      "# ShowAI interaction performance",
      "",
      `Recorded: ${report.startedAt}`,
      "",
      `Result: ${report.passed ? "passed" : report.catalogOnly ? "catalog only" : "failed; inspect failed actions"}`,
      "",
      "| Action | Successful/attempted | Latency p50 (ms) | Latency p95 (ms) | rAF interval p95 (ms) | Long tasks |",
      "|---|---:|---:|---:|---:|---:|",
      ...rows,
      "",
      "Drag latency means pointer release to asserted position. Other latencies mean input to asserted content/settled scroll. rAF is not display FPS. Failed samples and diagnostic repetitions are excluded from distributions.",
      "",
      ...report.limitations.map((line) => `- ${line}`),
      "",
      ...report.scenarios
        .filter((s) => s.failure)
        .map((s) => `- ${s.name} #${s.index}: ${s.failure.split("\n")[0]}`),
      ...(report.failure ? ["", report.failure] : []),
      "",
      "Machine-readable samples: results.json. CPU profiles, traces and screenshots: evidence/. Source snapshot: snapshot.json; writes are confined to library/.",
      "",
    ].join("\n"),
  );
  await lock.close();
  await rm(join(output, "running.lock"));
  await rm(runtime, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  console.log(
    JSON.stringify(
      {
        output,
        passed: report.passed,
        failure: report.failure,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
}
if (!args.list && !report.passed) process.exitCode = 1;
