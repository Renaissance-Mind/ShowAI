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
const mode = process.argv[2] ?? "browser";
assert.ok(["browser", "desktop"].includes(mode));
const port = await freePort();
const debugPort = await freePort();
const home = join(output, "library");
const child = spawn(
  process.execPath,
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
    env: { ...process.env, SHOWAI_DEV_DEBUG_PORT: String(debugPort) },
  },
);
let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});
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
let browser;
try {
  const original = await poll(receipt, Boolean, "development launch");
  browser =
    mode === "desktop"
      ? await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
      : await chromium.launch({ headless: true });
  const page =
    mode === "desktop"
      ? browser.contexts()[0].pages()[0]
      : await browser.newPage();
  if (mode === "browser") await page.goto(original.url);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  await page.locator("[data-showai-development]").waitFor();
  const info = await page.evaluate(() => window.showai.invoke("app:info"));
  assert.equal(info.home, home);
  assert.equal(info.packaged, false);
  assert.equal(
    await page.evaluate(() => typeof window.showai.prepareReload),
    "function",
  );
  checks.push("complete development workbench and guarded reload bridge load");

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
  checks.push("CSS updates through HMR without restarting the backend");

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
  checks.push(
    "React source updates through HMR without restarting the backend",
  );

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
  checks.push("compilation failure preserves the last working backend and CLI");

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
  checks.push(
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
    checks.push(
      "desktop shutdown with a conflict keeps the app and development service running",
    );
  }
  await page.getByRole("button", { name: "保留为副本", exact: true }).click();
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
  checks.push(
    "the rebuilt CLI exports using the development reader without production build artifacts",
  );
  checks.push(
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
      () => page.evaluate(() => window.showai?.invoke("projects:list") ?? []),
      (value) => value.some((item) => item.id === project.id),
      "recovered API",
    );
    checks.push(
      "runtime startup failure keeps the frontend running and recovers after the source is fixed",
    );
  }
  await updatedPage.screenshot({
    path: join(output, `${mode}-updated.png`),
    fullPage: true,
  });
  console.log(JSON.stringify({ mode, output, checks }, null, 2));
} catch (error) {
  console.error(logs);
  throw error;
} finally {
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
