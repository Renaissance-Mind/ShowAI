// Real Electron + filesystem lifecycle check. No mocked bridge, storage or clock.
// Build first: npm run build
// Run: node src/desktop/ui-smoke.mjs
// Packaged: SHOWAI_SMOKE_BINARY=/path/ShowAI.app/Contents/MacOS/ShowAI node src/desktop/ui-smoke.mjs
// SHOWAI_SMOKE_OUTPUT optionally selects the parent directory for retained evidence.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import electron from "electron";
import { _electron } from "playwright";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputParent = resolve(
  process.env.SHOWAI_SMOKE_OUTPUT || join(repository, "output/playwright"),
);
await mkdir(outputParent, { recursive: true });
const output = await mkdtemp(join(outputParent, "desktop-ui-"));
const home = join(output, "home"),
  profile = join(output, "profile");
const binary = process.env.SHOWAI_SMOKE_BINARY
  ? resolve(process.env.SHOWAI_SMOKE_BINARY)
  : electron;
const resources =
  process.platform === "darwin"
    ? resolve(dirname(binary), "../Resources")
    : join(dirname(binary), "resources");
const fingerprintFiles = process.env.SHOWAI_SMOKE_BINARY
  ? [
      binary,
      join(resources, "app.asar"),
      join(resources, "plugin/scripts/cli.mjs"),
    ]
  : [
      join(repository, "dist-desktop/main.mjs"),
      join(repository, "dist-desktop/index.html"),
      join(repository, "dist-desktop/preload.cjs"),
      join(repository, "plugins/showai/scripts/cli.mjs"),
    ];
const fingerprints = async () =>
  Object.fromEntries(
    await Promise.all(
      fingerprintFiles.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
const env = { ...process.env, SHOWAI_HOME: home, SHOWAI_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const runFile = promisify(execFile);
const delay = (milliseconds) =>
  new Promise((done) => setTimeout(done, milliseconds));
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const contentText = (node) =>
  [node.text || "", ...(node.content || []).map(contentText)]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
async function poll(read, condition, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (condition(value)) return value;
    await delay(75);
  }
  throw new Error(
    `Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`,
  );
}

let application;
let page;
let closed = false;
let processOutput = "";
const rendererErrors = [];
const result = { passed: false, binary, output, home, profile, checks: [] };

try {
  result.runtimeHashes = await fingerprints();
  application = await _electron.launch({
    executablePath: binary,
    args: process.env.SHOWAI_SMOKE_BINARY ? [] : [repository],
    cwd: repository,
    env,
    timeout: 30000,
  });
  const child = application.process();
  child.stderr?.on("data", (chunk) => {
    processOutput += chunk;
  });
  child.stdout?.on("data", (chunk) => {
    processOutput += chunk;
  });
  page = await application.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  // Read-only discovery uses the real installed bridge so packaged CLI testing
  // executes that package's binary and bundled script, not a repository substitute.
  const info = await page.evaluate(() => window.showai.invoke("app:info"));
  assert.equal(info.home, home);
  result.runtime = {
    version: info.version,
    packaged: info.packaged,
    pid: child.pid,
    cli: info.cli,
  };
  const cli = async (...args) => {
    const response = await runFile(
      info.cli.command,
      [...info.cli.args, ...args, "--json"],
      {
        env: { ...env, ...info.cli.env, SHOWAI_HOME: home },
        cwd: repository,
        timeout: 20000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const parsed = JSON.parse(response.stdout);
    assert.equal(parsed.ok, true, response.stdout);
    return parsed.data;
  };

  const projectName = "UI lifecycle verification";
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill(projectName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .getByRole("button", { name: "新页面", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /空白画布/ }).click();
  const title = page.getByRole("textbox", { name: "页面标题", exact: true });
  const editor = page.getByRole("textbox", { name: "文档内容", exact: true });
  await title.fill("Concurrent edits");
  await editor.fill("Shared baseline before either writer edits.");
  await page.locator(".studio-save-state.saved").waitFor();

  const projects = await cli("projects", "list");
  const project = projects.find((entry) => entry.name === projectName);
  assert.ok(project, "UI-created project was not persisted.");
  const pages = await cli("pages", "list", "--project", project.id);
  assert.equal(pages.length, 1);
  const baseline = await cli(
    "pages",
    "read",
    pages[0].id,
    "--project",
    project.id,
  );
  assert.ok(baseline.path.startsWith(home));
  assert.match(contentText(baseline.document.content), /Shared baseline/);
  result.projectId = project.id;
  result.originalPageId = baseline.document.id;
  result.baselineHash = baseline.hash;
  result.checks.push("UI-created project and page persist to canonical files");

  const draftText = "Desktop draft must survive the concurrent file update.";
  const externalText = "External file revision must stay in the original page.";
  const external = structuredClone(baseline.document);
  external.content.content = [
    {
      ...external.content.content[0],
      type: "paragraph",
      content: [{ type: "text", text: externalText }],
    },
  ];
  external.updatedAt = new Date().toISOString();
  // Both writes are real. The editor's normal 450 ms auto-save races an atomic
  // external file replacement; no UI state or timer is patched by this test.
  await editor.fill(draftText);
  const pendingPath = `${baseline.path}.external-write`;
  await writeFile(
    pendingPath,
    JSON.stringify(
      { format: "showai", version: 1, document: external },
      null,
      2,
    ) + "\n",
  );
  await rename(pendingPath, baseline.path);
  await page.getByText("这个文件有新的修改", { exact: true }).waitFor();
  assert.equal((await editor.innerText()).trim(), draftText);
  assert.equal(
    contentText((await readJson(baseline.path)).document.content),
    externalText,
  );
  await page.screenshot({ path: join(output, "conflict.png"), fullPage: true });
  result.checks.push(
    "Real external file write produces the conflict panel without replacing the typed draft",
  );

  await page.getByRole("button", { name: "保留为副本", exact: true }).click();
  await page.getByText("草稿已保留为副本", { exact: true }).waitFor();
  assert.equal(await title.inputValue(), "Concurrent edits 副本");
  const copies = await poll(
    async () => {
      const directory = dirname(baseline.path);
      return Promise.all(
        (await readdir(directory))
          .filter((name) => name.endsWith(".json"))
          .map((name) => readJson(join(directory, name))),
      );
    },
    (items) => items.length === 2,
    "two saved page files",
  );
  const original = copies.find(
    (item) => item.document.id === baseline.document.id,
  );
  const copy = copies.find((item) => item.document.id !== baseline.document.id);
  assert.equal(contentText(original.document.content), externalText);
  assert.equal(contentText(copy.document.content), draftText);
  result.copyPageId = copy.document.id;
  result.checks.push(
    "Keep copy writes two distinct pages with both writers' complete content",
  );

  // Capture a CLI checkpoint while open, then type once more and immediately
  // close the actual app; its normal close/flush handshake must preserve it.
  const copyBaseline = await cli(
    "pages",
    "read",
    copy.document.id,
    "--project",
    project.id,
  );
  await page.screenshot({
    path: join(output, "saved-copy.png"),
    fullPage: true,
  });
  const closingText = `${draftText} Final keystrokes are flushed when the app quits.`;
  await editor.fill(closingText);
  const pendingStatus = await page.locator(".studio-save-state").innerText();
  const pendingDiskText = contentText(
    (await readJson(copyBaseline.path)).document.content,
  );
  assert.equal(
    pendingStatus.trim(),
    "待保存",
    "The app must be closed while the last edit is still pending.",
  );
  assert.equal(
    pendingDiskText,
    draftText,
    "The pending edit must not already be present on disk.",
  );
  result.beforeClose = {
    status: pendingStatus.trim(),
    pendingDiskText,
    visibleDraft: closingText,
  };
  await application.close();
  closed = true;
  assert.ok(
    child.exitCode !== null || child.signalCode !== null,
    "The UI process must exit before CLI verification.",
  );
  result.checks.push("Native application quit completes with pending edits");

  const originalDiff = await cli(
    "pages",
    "diff",
    baseline.document.id,
    "--project",
    project.id,
    "--since",
    baseline.hash,
  );
  const copyDiff = await cli(
    "pages",
    "diff",
    copy.document.id,
    "--project",
    project.id,
    "--since",
    copyBaseline.hash,
  );
  const finalOriginal = await cli(
    "pages",
    "read",
    baseline.document.id,
    "--project",
    project.id,
  );
  const finalCopy = await cli(
    "pages",
    "read",
    copy.document.id,
    "--project",
    project.id,
  );
  assert.equal(originalDiff.changed, true);
  assert.equal(copyDiff.changed, true);
  assert.match(JSON.stringify(originalDiff.changes), /External file revision/);
  assert.match(JSON.stringify(copyDiff.changes), /Final keystrokes/);
  assert.equal(contentText(finalOriginal.document.content), externalText);
  assert.equal(contentText(finalCopy.document.content), closingText);
  assert.equal(finalOriginal.document.title, "Concurrent edits");
  assert.equal(finalCopy.document.title, "Concurrent edits 副本");
  assert.deepEqual(rendererErrors, []);
  await writeFile(
    join(output, "original-diff.json"),
    JSON.stringify(originalDiff, null, 2) + "\n",
  );
  await writeFile(
    join(output, "copy-diff.json"),
    JSON.stringify(copyDiff, null, 2) + "\n",
  );
  result.checks.push(
    "Bundled CLI reads both pages and their checkpoint diffs after the UI process has exited",
  );
  assert.deepEqual(
    await fingerprints(),
    result.runtimeHashes,
    "The tested build changed during UI verification.",
  );
  result.checks.push(
    "Executable artifacts stayed unchanged for the entire UI and CLI verification",
  );
  result.passed = true;
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  if (page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  if (application && !closed && application.process().exitCode === null) {
    // Only this script's isolated child is terminated on a failed run. Its files
    // remain available for inspection, including any unflushed conflict evidence.
    application.process().kill("SIGTERM");
  }
  result.rendererErrors = rendererErrors;
  await writeFile(join(output, "electron.log"), processOutput);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
