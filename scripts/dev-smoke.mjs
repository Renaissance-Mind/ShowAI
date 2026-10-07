// Real source edits in an isolated checkout copy, real browser/Electron and files.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const parent = join(root, "output/playwright");
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "development-"));
const fixture = join(output, "checkout");
await mkdir(fixture);
for (const path of [
  "src",
  "resources",
  "scripts",
  "public",
  "index.html",
  "portable.html",
  "package.json",
  "vite.config.ts",
  "vite.portable.config.ts",
  "tsconfig.json",
])
  await cp(join(root, path), join(fixture, path), { recursive: true });
await symlink(
  join(root, "node_modules"),
  join(fixture, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
const execute = promisify(execFile);
await execute("git", ["init", "--initial-branch=main", fixture]);
await execute("git", ["-C", fixture, "add", "package.json"]);
const commit = async (message) => {
  await execute("git", [
    "-C",
    fixture,
    "-c",
    "user.name=Development Smoke",
    "-c",
    "user.email=smoke@localhost",
    "commit",
    "--allow-empty",
    "-m",
    message,
  ]);
  return (
    await execute("git", ["-C", fixture, "rev-parse", "HEAD"])
  ).stdout.trim();
};
await commit("test: initialize isolated development fixture");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(read, condition, label, timeout = 40000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (condition(value)) return value;
    await delay(100);
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const checks = [];
function record(...messages) {
  checks.push(...messages);
  if (process.env.SHOWAI_SMOKE_PROGRESS)
    for (const message of messages) console.log(message);
}
const mode = process.argv[2] ?? "browser";
assert.ok(["browser", "desktop"].includes(mode));
const port = await freePort();
const debugPort = await freePort();
const home = join(output, "library");
let logs = "";
function startDevelopment() {
  const process = spawn(
    globalThis.process.execPath,
    [
      join(fixture, "scripts/dev.mjs"),
      mode,
      "--port",
      String(port),
      "--home",
      home,
      "--no-open",
    ],
    {
      cwd: fixture,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...globalThis.process.env,
        SHOWAI_DEV_DEBUG_PORT: String(debugPort),
      },
    },
  );
  process.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  process.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  return process;
}
let child = startDevelopment();
const receiptPath = join(
  fixture,
  ".showai-dev",
  `${mode}-${port}`,
  "session.json",
);
const receipt = () =>
  readFile(receiptPath, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
let browser, observer, debugPage;
try {
  const original = await poll(
    receipt,
    (value) => !!value?.startup && !!value?.backendPid,
    "development launch with completed timing receipt",
  );
  browser =
    mode === "desktop"
      ? await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
      : await chromium.launch({ headless: true });
  let page =
    mode === "desktop"
      ? browser.contexts()[0].pages()[0]
      : await browser.newPage();
  debugPage = page;
  page.on("pageerror", (error) => {
    logs += `\nRenderer error: ${error.message}\n`;
  });
  if (mode === "browser") await page.goto(original.url);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  await page.locator("[data-showai-development]").waitFor();
  const info = await page.evaluate(() => window.showai.invoke("app:info"));
  assert.equal(info.home, home);
  assert.equal(info.packaged, false);
  const shared = await fetch(original.url + "__showai-dev/status").then(
    (response) => response.json(),
  );
  assert.equal(shared.protocol, "showai-development-v1");
  assert.equal(shared.backendPid, original.backendPid);
  assert.equal(shared.home, home);
  assert.equal(
    (
      await fetch(original.url + "__showai-dev/focus", {
        method: "POST",
        headers: { Origin: "https://example.com" },
      })
    ).status,
    403,
  );
  const reuse = () =>
    promisify(execFile)(
      process.execPath,
      [
        join(fixture, "scripts/dev-open.mjs"),
        mode,
        "--port",
        String(port),
        "--home",
        home,
        "--no-focus",
      ],
      { cwd: fixture },
    ).then((response) => JSON.parse(response.stdout));
  const [first, second] = await Promise.all([reuse(), reuse()]);
  assert.equal(first.backendPid, original.backendPid);
  assert.equal(second.backendPid, original.backendPid);
  record(
    "concurrent launch requests reuse one backend and reject foreign origins",
  );
  assert.equal(
    await page.evaluate(() => typeof window.showai.prepareReload),
    "function",
  );
  await page.locator('[data-navigation-state="current"]').waitFor();
  assert.ok(
    await page.evaluate(
      (home) => !!localStorage.getItem(`showai:navigation:v1:${home}`),
      home,
    ),
  );
  record("complete development workbench and guarded reload bridge load");
  const revision = await commit("test: update development identity");
  await page
    .locator("[data-showai-development]")
    .filter({ hasText: revision.slice(0, 7) })
    .waitFor();
  assert.equal((await receipt()).backendPid, original.backendPid);
  assert.equal(
    (
      await fetch(original.url + "__showai-dev/status").then((response) =>
        response.json(),
      )
    ).sourceCommit,
    revision,
  );
  record(
    "commits update the source badge and session without reloading the workbench or backend",
  );
  if (mode === "desktop") {
    const navigated = page.waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: 15000,
    });
    await page.evaluate(() => location.reload());
    await navigated;
    await page
      .getByRole("button", { name: "新建项目", exact: true })
      .first()
      .waitFor();
    assert.equal(page.url(), original.url);
    assert.equal((await receipt()).backendPid, original.backendPid);
    record("JavaScript reload stays inside the same desktop window");
    const closed = page.waitForEvent("close");
    await page.evaluate(() => window.close());
    await closed;
    const context = browser.contexts()[0];
    const reopened = context.waitForEvent("page");
    await fetch(original.url + "__showai-dev/focus", {
      method: "POST",
      headers: { Origin: new URL(original.url).origin },
    });
    page = await reopened;
    debugPage = page;
    await page
      .getByRole("button", { name: "新建项目", exact: true })
      .first()
      .waitFor();
    assert.equal((await receipt()).backendPid, original.backendPid);
    record(
      "reopening after closing every desktop window reuses the running backend",
    );
  }
  if (mode === "desktop") {
    observer = await chromium.launch({ headless: true });
    const tab = await observer.newPage();
    await tab.goto(original.url);
    await tab.locator("[data-showai-development]").waitFor();
    assert.equal(await tab.evaluate(() => typeof window.showai), "undefined");
    await tab
      .locator("[data-showai-development]")
      .filter({ hasText: "请打开 Applications/ShowAI.app" })
      .waitFor();
    record("a browser tab at the desktop URL cannot block desktop updates");
  }

  const style = join(fixture, "src/design/desktop.css");
  await writeFile(
    style,
    (await readFile(style, "utf8")) +
      "\nbody { --showai-development-smoke: live; }\n",
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.body)
        .getPropertyValue("--showai-development-smoke")
        .trim() === "live",
  );
  assert.equal((await receipt()).backendPid, original.backendPid);
  record("CSS updates through HMR without restarting the backend");

  const studio = join(fixture, "src/studio/Studio.tsx");
  await writeFile(
    studio,
    (await readFile(studio, "utf8")).replaceAll("新建项目", "新建项目热更新"),
  );
  await page
    .getByRole("button", { name: "新建项目热更新", exact: true })
    .first()
    .waitFor();
  assert.equal((await receipt()).backendPid, original.backendPid);
  record("React source updates through HMR without restarting the backend");
  const portable = join(fixture, "src/portable/main.tsx");
  await writeFile(
    portable,
    (await readFile(portable, "utf8")) +
      "\n// Reader-only development refresh\n",
  );
  await poll(
    () => logs,
    (value) =>
      value.includes("阅读器已更新") || value.includes("read-only reader"),
    "reader-only refresh",
    40000,
  );
  assert.equal((await receipt()).backendPid, original.backendPid);
  record("reader-only updates preserve the backend, live editor and window");

  const cli = async (...args) => {
    const response = await promisify(execFile)(
      info.cli.command,
      [...info.cli.args, ...args, "--json"],
      {
        env: { ...process.env, ...info.cli.env, SHOWAI_HOME: home },
        cwd: fixture,
      },
    );
    const result = JSON.parse(response.stdout);
    assert.equal(result.ok, true, response.stdout);
    return result.data;
  };
  const project = await cli(
    "projects",
    "create",
    "--name",
    "Development smoke",
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "组件", exact: true })
    .click();
  await page.getByLabel("目录项目", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("目录项目", { exact: true }).inputValue(),
    "all",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "新建组件", exact: true })
      .isEnabled(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "导入组件", exact: true })
      .isEnabled(),
    false,
  );
  if (mode === "desktop") {
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '.component-category[aria-label="文本组件"] .component-card-preview img',
        ).length === 3,
      undefined,
      { timeout: 60000 },
    );
    assert.equal(await page.locator(".component-preview-error").count(), 0);
    record("desktop component thumbnails render without a packaged index.html");
  }
  await page.getByLabel("目录项目", { exact: true }).selectOption(project.id);
  await page.getByRole("button", { name: "新建组件", exact: true }).click();
  const componentDialog = page.getByRole("dialog", {
    name: "计数器",
    exact: true,
  });
  const counter = componentDialog.frameLocator("iframe");
  await counter.getByRole("button", { name: "增加", exact: true }).click();
  assert.equal(await counter.locator("output").innerText(), "1");
  await componentDialog
    .getByRole("button", { name: "关闭弹窗", exact: true })
    .click();
  const packages = await page.evaluate(
    (projectId) =>
      window.showai.invoke("components:list", { projectId, scope: "project" }),
    project.id,
  );
  assert.equal(packages.length, 1);
  record(
    "project selection enables component creation and the new component preview works",
  );
  if (mode === "browser") {
    const componentSource = await page.evaluate(
      ({ projectId, id }) =>
        window.showai.invoke("components:source", {
          projectId,
          id,
          scope: "project",
        }),
      { projectId: project.id, id: packages[0].id },
    );
    const importedDirectory = join(output, "import-source");
    await mkdir(importedDirectory);
    await writeFile(
      join(importedDirectory, "manifest.json"),
      JSON.stringify({
        ...componentSource.manifest,
        id: "imported-development-counter",
        name: "导入计数器",
      }),
    );
    await writeFile(
      join(importedDirectory, "props.schema.json"),
      JSON.stringify(componentSource.schema),
    );
    await writeFile(
      join(importedDirectory, componentSource.manifest.entry),
      componentSource.source,
    );
    await page.getByRole("button", { name: "导入组件", exact: true }).click();
    const fileDialog = page.getByRole("dialog", {
      name: "选择组件源码目录",
      exact: true,
    });
    await fileDialog.getByLabel("本地目录路径").fill(importedDirectory);
    await fileDialog.getByRole("button", { name: "前往", exact: true }).click();
    await poll(
      () => fileDialog.locator(".local-file-footer span").innerText(),
      (value) => value === importedDirectory,
      "file selector navigates to the component package",
    );
    await fileDialog
      .getByRole("button", { name: "选择目录", exact: true })
      .click();
    await page.getByText("组件已安装", { exact: true }).waitFor();
    assert.equal(
      (
        await page.evaluate(
          (projectId) =>
            window.showai.invoke("components:list", {
              projectId,
              scope: "project",
            }),
          project.id,
        )
      ).length,
      2,
    );
    record(
      "component import works through the real file selector and compiler",
    );
  }
  const created = await page.evaluate(
    (projectId) =>
      window.showai.invoke("pages:create", {
        projectId,
        title: "Preserved page",
      }),
    project.id,
  );
  await page.goto(
    `${original.url}?project=${project.id}&page=${created.document.id}&focus=1`,
  );
  const editor = page.getByRole("textbox", { name: "文档内容", exact: true });
  await editor.waitFor();
  await editor.fill("Draft survives a backend update.");
  await page.locator(".studio-save-state.saved").waitFor();
  const searchAt = performance.now();
  const search = await page.evaluate(
    (projectId) =>
      window.showai.invoke("library:search", { query: "Draft", projectId }),
    project.id,
  );
  assert.ok(search.items.length > 0);
  record(
    `search runs through the real index worker and IPC (${Math.round(performance.now() - searchAt)} ms)`,
  );

  // A real syntax error must leave the last working backend running.
  const backend = join(
    fixture,
    mode === "browser" ? "src/browser/server.ts" : "src/desktop/main.ts",
  );
  const source = await readFile(backend, "utf8");
  await writeFile(backend, source + "\nconst = broken;\n");
  await poll(
    () => logs,
    (value) => value.includes("开发更新失败"),
    "visible compiler failure",
  );
  assert.equal((await receipt()).backendPid, original.backendPid);
  assert.equal(
    (await cli("pages", "read", created.document.id, "--project", project.id))
      .document.id,
    created.document.id,
  );
  record("compilation failure preserves the last working backend and CLI");

  // Race the real autosave with an independent atomic file write.
  const baseline = await cli(
    "pages",
    "read",
    created.document.id,
    "--project",
    project.id,
  );
  await editor.fill("Local draft retained during conflict.");
  const external = structuredClone(baseline.document);
  external.title = "External revision";
  external.updatedAt = new Date().toISOString();
  const temporary = baseline.path + ".external-write";
  await writeFile(
    temporary,
    JSON.stringify({
      format: "showai",
      version: external.content?.attrs?.kind ? 3 : 2,
      document: external,
    }),
  );
  await rename(temporary, baseline.path);
  await page.getByText("这个文件有新的修改", { exact: true }).waitFor();
  await writeFile(backend, source + "\n// successful backend revision\n");
  await page
    .locator("[data-showai-development]")
    .filter({ hasText: "更新已暂停" })
    .waitFor({ timeout: 40000 });
  assert.equal((await receipt()).backendPid, original.backendPid);
  assert.equal(
    await page.locator("#root").evaluate((element) => element.inert),
    false,
  );
  assert.match(await editor.innerText(), /Local draft retained/);
  record(
    "a real file conflict blocks automatic restart and keeps the draft editable",
  );
  if (mode === "desktop") {
    child.kill("SIGTERM");
    await poll(
      () => logs,
      (value) => value.includes("开发服务继续运行"),
      "save-aware desktop shutdown",
    );
    assert.equal(child.exitCode, null);
    assert.equal((await receipt()).backendPid, original.backendPid);
    record(
      "desktop shutdown with a conflict keeps the app and development service running",
    );
  }
  await page.getByRole("button", { name: "保留为副本", exact: true }).click();
  // A versioned home preserves external files separately from its formal head.
  // Explicitly import the retained original after the local draft was copied.
  if (info.libraryVersion === 2) {
    const conflicts = await page.evaluate(() =>
      window.showai.invoke("history:conflicts"),
    );
    const retained = conflicts.find((item) =>
      item.path.endsWith(`/pages/${created.document.id}.json`),
    );
    assert.ok(
      retained,
      "The external original must remain retained after copying the draft",
    );
    await page.evaluate(
      (id) =>
        window.showai.invoke("history:resolve", { id, resolution: "import" }),
      retained.id,
    );
  }
  await page.locator(".studio-save-state.saved").waitFor();
  const saved = await cli("pages", "list", "--project", project.id);
  assert.equal(saved.length, 2);
  await page.locator("[data-showai-development]").click();
  const updated = await poll(
    receipt,
    (value) => value?.backendPid !== original.backendPid,
    "successful guarded restart",
  );
  if (mode === "desktop") {
    // Electron creates a new window after its ordinary save-aware quit.
    await browser.close();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  }
  const updatedPage =
    mode === "desktop" ? browser.contexts()[0].pages()[0] : page;
  await updatedPage.waitForFunction(() => !!window.showai);
  await poll(
    () => updatedPage.evaluate(() => window.showai.invoke("projects:list")),
    (value) => value.some((item) => item.id === project.id),
    "API reconnect",
  );
  assert.equal(updated.home, home);
  const copies = await cli("pages", "list", "--project", project.id);
  assert.equal(copies.length, 2);
  const originalAfter = await cli(
    "pages",
    "read",
    created.document.id,
    "--project",
    project.id,
  );
  assert.equal(originalAfter.document.title, "External revision");
  const exported = join(output, "page.html");
  await cli(
    "export",
    "--project",
    project.id,
    "--page",
    created.document.id,
    "--format",
    "html",
    "--out",
    exported,
  );
  assert.match(await readFile(exported, "utf8"), /showai-data/);
  record(
    "the rebuilt CLI exports using the development reader without production build artifacts",
  );
  record(
    "retry restarts the backend, reconnects the workbench and preserves both revisions",
  );
  if (mode === "browser") {
    const latestPid = (await receipt()).backendPid;
    await writeFile(
      backend,
      source + '\nthrow new Error("development runtime failure");\n',
    );
    await page
      .locator("[data-showai-development]")
      .filter({ hasText: "更新失败" })
      .waitFor({ timeout: 40000 });
    assert.equal(child.exitCode, null);
    await writeFile(backend, source + "\n// recovered runtime\n");
    await poll(
      receipt,
      (value) => value?.backendPid !== latestPid,
      "automatic recovery after runtime failure",
    );
    await poll(
      // A successful recovery navigates the page before its bridge is ready.
      async () => {
        try {
          return await page.evaluate(
            () => window.showai?.invoke("projects:list") ?? [],
          );
        } catch (error) {
          if (
            /Execution context was destroyed|Cannot find context with specified id/.test(
              error.message,
            )
          )
            return [];
          throw error;
        }
      },
      (value) => value.some((item) => item.id === project.id),
      "recovered API",
    );
    record(
      "runtime startup failure keeps the frontend running and recovers after the source is fixed",
    );
  }
  await updatedPage.screenshot({
    path: join(output, `${mode}-updated.png`),
    fullPage: true,
  });
  await updatedPage.reload();
  await updatedPage.locator('[data-navigation-state="current"]').waitFor();
  const startupMarks = await updatedPage.evaluate(() => ({
    cached: performance.getEntriesByName("showai:navigation-cached").at(-1)
      ?.startTime,
    current: performance.getEntriesByName("showai:navigation-current").at(-1)
      ?.startTime,
  }));
  assert.equal(typeof startupMarks.cached, "number");
  assert.ok(startupMarks.current >= startupMarks.cached);
  record(
    `startup restores cached navigation before current verification (${Math.round(startupMarks.cached)} → ${Math.round(startupMarks.current)} ms)`,
  );

  const verifiedName = "Verified current navigation";
  await updatedPage.evaluate(
    ({ projectId, name }) =>
      window.showai.invoke("projects:rename", { projectId, name }),
    { projectId: project.id, name: verifiedName },
  );
  await updatedPage.reload();
  await updatedPage.locator('[data-navigation-state="current"]').waitFor();
  await updatedPage.getByText(verifiedName, { exact: true }).first().waitFor();
  record(
    "cached navigation reconciles a real project rename with the current library",
  );
  await updatedPage.evaluate(
    (home) =>
      localStorage.setItem(
        `showai:navigation:v1:${home}`,
        JSON.stringify({
          version: 1,
          home,
          projects: [{ id: "corrupt", name: "Corrupt cache", pageCount: 0 }],
          organization: { groups: [], projectGroups: {} },
        }),
      ),
    home,
  );
  await updatedPage.reload();
  await updatedPage.locator('[data-navigation-state="current"]').waitFor();
  assert.equal(
    await updatedPage.getByText("Corrupt cache", { exact: true }).count(),
    0,
  );
  assert.equal(
    await updatedPage.evaluate(
      () => performance.getEntriesByName("showai:navigation-cached").length,
    ),
    0,
  );
  await updatedPage.getByText(verifiedName, { exact: true }).first().waitFor();
  record(
    "malformed cached rows are discarded and replaced by verified navigation",
  );
  for (const field of ["projectOrder", "entryOrder"]) {
    await updatedPage.evaluate(
      ({ home, field }) => {
        const key = `showai:navigation:v1:${home}`;
        const cached = JSON.parse(localStorage.getItem(key));
        cached.organization[field] = "invalid ordering";
        localStorage.setItem(key, JSON.stringify(cached));
      },
      { home, field },
    );
    await updatedPage.reload();
    await updatedPage.locator('[data-navigation-state="current"]').waitFor();
    assert.equal(
      await updatedPage.evaluate(
        () => performance.getEntriesByName("showai:navigation-cached").length,
      ),
      0,
    );
    await updatedPage
      .getByText(verifiedName, { exact: true })
      .first()
      .waitFor();
  }
  record(
    "malformed manual ordering is discarded before cached navigation renders",
  );

  // A full quit/relaunch must reuse validated artifacts and still load real APIs.
  const beforeRelaunch = await receipt();
  await observer?.close();
  observer = undefined;
  if (mode === "desktop") await browser.close();
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
  child = startDevelopment();
  const warm = await poll(
    receipt,
    (value) => value?.pid !== beforeRelaunch.pid && !!value?.startup,
    "warm relaunch",
  );
  assert.equal(warm.startup.cacheHit, true);
  if (mode === "desktop")
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const warmPage =
    mode === "desktop"
      ? browser.contexts()[0].pages()[0]
      : await browser.newPage();
  debugPage = warmPage;
  if (mode === "browser") await warmPage.goto(warm.url);
  await warmPage.waitForFunction(() => !!window.showai);
  await poll(
    () => warmPage.evaluate(() => window.showai.invoke("projects:list")),
    (value) => value.some((item) => item.id === project.id),
    "warm relaunch API",
  );
  record(
    `validated warm relaunch uses cache: cold ${original.startup.totalMs} ms, warm ${warm.startup.totalMs} ms (preparation ${original.startup.preparationMs} → ${warm.startup.preparationMs} ms)`,
  );
  console.log(
    JSON.stringify(
      {
        mode,
        output,
        checks,
        startup: { cold: original.startup, warm: warm.startup },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (debugPage && !debugPage.isClosed()) {
    await debugPage.screenshot({
      path: join(output, "failure.png"),
      fullPage: true,
    });
    console.error(
      JSON.stringify({
        alerts: await debugPage.getByRole("alert").allTextContents(),
        dialogs: await debugPage.getByRole("dialog").allTextContents(),
      }).slice(0, 3000),
    );
  }
  console.error(logs);
  throw error;
} finally {
  await observer?.close();
  if (mode === "browser") await browser?.close();
  const exited =
    child.exitCode === null ? once(child, "exit") : Promise.resolve();
  child.kill("SIGTERM");
  await exited;
  await writeFile(join(output, "development.log"), logs);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ mode, checks }, null, 2),
  );
}
