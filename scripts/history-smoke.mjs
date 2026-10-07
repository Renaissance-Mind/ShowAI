// Real versioned library, browser/Electron workbench, retained drafts and Git commits.
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
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
const root = resolve(import.meta.dirname, ".."),
  mode = process.argv.includes("--desktop") ? "desktop" : "browser";
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/history-")),
  fixture = join(output, "checkout"),
  home = join(output, "library");
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
const bootstrap = join(output, "bootstrap.mjs");
await build({
  stdin: {
    contents: process.argv.includes("--legacy-import")
      ? 'import {FileStore} from "./src/core/store.ts"; await new FileStore(process.argv[2]).createProject({name:"Legacy import seed"});'
      : 'import {GitLibrary} from "./src/core/git-library.ts"; await new GitLibrary(process.argv[2]).initialize();',
    resolveDir: root,
  },
  outfile: bootstrap,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  plugins: [rawSourcePlugin],
});
await promisify(execFile)(process.execPath, [bootstrap, home]);
async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const port = await freePort(),
  debugPort = await freePort();
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
    env: { ...process.env, SHOWAI_DEV_DEBUG_PORT: String(debugPort) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "",
  browser,
  page;
const errors = [],
  checks = [];
child.stdout.on("data", (data) => {
  logs += data;
});
child.stderr.on("data", (data) => {
  logs += data;
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function poll(read, accepts, label, timeout = 40000) {
  let value;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await delay(100);
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
const sessionFile = join(
  fixture,
  ".showai-dev",
  `${mode}-${port}`,
  "session.json",
);
const result = { passed: false, mode, output, home, checks, errors };
try {
  const session = await poll(
    () =>
      readFile(sessionFile, "utf8").then(JSON.parse, (error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }),
    Boolean,
    "development startup",
  );
  browser =
    mode === "desktop"
      ? await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
      : await chromium.launch();
  page =
    mode === "desktop"
      ? browser.contexts()[0].pages()[0]
      : await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 960 });
  if (mode === "browser") await page.goto(session.url);
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "锁定项目栏", exact: true }).click();
  const api = (action, args = {}) =>
    page.evaluate(
      async ({ action, args }) => {
        try {
          return await window.showai.invoke(action, args);
        } catch (error) {
          throw new Error(JSON.stringify(error));
        }
      },
      { action, args },
    );
  if (process.argv.includes("--legacy-import")) {
    assert.equal((await api("app:info")).libraryVersion, 1);
    const oldProject = await api("projects:create", { name: "旧库迁移验收" });
    const old = await api("pages:create", {
      projectId: oldProject.id,
      title: "待迁移的旧页面",
    });
    const changed = structuredClone(old.document);
    changed.title = "迁移前的新标题";
    const changedRecord = await api("pages:save", {
      projectId: oldProject.id,
      pageId: old.document.id,
      document: changed,
      baseHash: old.hash,
    });
    const original = await readFile(changedRecord.path);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("button", { name: "启用版本历史", exact: true })
      .click();
    let migration = page.getByRole("dialog");
    await migration
      .getByText("内容与组件引用已核对", { exact: true })
      .waitFor();
    if (process.argv.includes("--external-activation")) {
      const imports = await api("library:imports");
      await migration
        .getByRole("button", { name: "关闭弹窗", exact: true })
        .click();
      await promisify(execFile)(
        process.execPath,
        [
          join(
            fixture,
            ".showai-dev",
            `${mode}-${port}`,
            "runtime/scripts/cli.mjs",
          ),
          "library",
          "activate",
          imports[0].id,
          "--home",
          home,
          "--json",
        ],
        { env: process.env },
      );
      checks.push(
        "CLI activation updates the already open workbench without reloading",
      );
    } else {
      await migration
        .getByRole("button", { name: "启用版本历史", exact: true })
        .click();
    }
    await migration.waitFor({ state: "hidden" });
    assert.equal((await api("app:info")).libraryVersion, 2);
    assert.equal((await api("app:info")).home, home);
    assert.deepEqual(await readFile(changedRecord.path), original);
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await page
      .locator(`[data-library-id="${oldProject.id}"] .studio-tree-main`)
      .click();
    await page
      .getByRole("button", { name: new RegExp(changed.title) })
      .filter({ has: page.locator("strong") })
      .first()
      .click();
    await page.getByRole("button", { name: "页面历史", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "旧快照", exact: true })
      .click();
    const archive = page.getByRole("dialog");
    await archive
      .getByRole("button", { name: /^旧快照/ })
      .first()
      .click();
    await archive
      .getByRole("button", { name: "恢复为新版本", exact: true })
      .click();
    await archive
      .getByRole("button", { name: "确认恢复", exact: true })
      .click();
    await archive.waitFor({ state: "hidden" });
    const events = await api("history:list", {
      projectId: oldProject.id,
      pageId: old.document.id,
    });
    assert.ok(events.items[0].restoredSnapshot);
    assert.equal(events.items[0].actor.kind, "human");
    assert.deepEqual(await readFile(changedRecord.path), original);
    checks.push(
      "legacy workbench prepares and activates in place, retains original bytes and restores separately labeled old checkpoints as attributed new changes",
    );
  }
  const info = await api("app:info");
  assert.equal(info.libraryVersion, 2);
  assert.equal(info.home, home);
  const project = await api("projects:create", { name: "版本历史验收项目" });
  const created = await api("pages:create", {
      projectId: project.id,
      title: "版本历史验收",
    }),
    pageId = created.document.id;
  const read = () => api("pages:get", { projectId: project.id, pageId });
  const save = (record, document, message, actor) =>
    api("pages:save", {
      projectId: project.id,
      pageId,
      document,
      baseHash: record.hash,
      baseRevision: record.revision,
      historyContext: { message, ...(actor ? { actor } : {}) },
    });
  const modified = structuredClone(created.document);
  modified.title = "更新后历史验收";
  modified.content.content[0].content = [
    { type: "text", text: "历史检索正文验收" },
  ];
  const saved = await save(created, modified, "修改标题与正文", {
    kind: "agent",
    harness: "codex",
    sessionId: "history-ui-test",
  });
  const open = async () => {
    await page
      .locator(`[data-library-id="${project.id}"] .studio-tree-main`)
      .click();
    await page
      .getByRole("button", { name: new RegExp((await read()).document.title) })
      .filter({ has: page.locator("strong") })
      .first()
      .click();
    await page.getByRole("button", { name: "页面历史", exact: true }).waitFor();
  };
  await open();
  const refreshShortcut =
    process.platform === "darwin" ? "Meta+r" : "Control+r";
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const workbench = await page.locator(".studio").elementHandle();
  const title = page.getByRole("textbox", { name: "页面标题", exact: true });
  for (const refreshedTitle of ["快捷键刷新后保留的标题", modified.title]) {
    const surface = await page.locator(".surface-editor-shell").elementHandle();
    await title.fill(refreshedTitle);
    await page.keyboard.press(refreshShortcut);
    await poll(
      read,
      (record) => record.document.title === refreshedTitle,
      "refresh saves pending edits",
    );
    await poll(
      () => surface.evaluate((element) => element.isConnected),
      (connected) => !connected,
      "only the current page remounts",
    );
    assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
    assert.equal(
      await workbench.evaluate((element) => element.isConnected),
      true,
    );
    assert.equal(await title.inputValue(), refreshedTitle);
    await page.locator(".surface-editor-shell").waitFor();
    await surface.dispose();
  }
  const cleanSurface = await page
    .locator(".surface-editor-shell")
    .elementHandle();
  await page.keyboard.press(refreshShortcut);
  await poll(
    () => cleanSurface.evaluate((element) => element.isConnected),
    (connected) => !connected,
    "unchanged page components remount on refresh",
  );
  assert.equal(await page.evaluate(() => performance.timeOrigin), timeOrigin);
  await cleanSurface.dispose();
  await workbench.dispose();
  checks.push(
    "page refresh saves pending edits and remounts the current page, including unchanged content, without reloading the workbench",
  );
  await page.getByRole("button", { name: "页面历史", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /修改标题与正文/ }).click();
  await dialog
    .getByText("codex · history-ui-test", { exact: true })
    .last()
    .waitFor();
  await dialog.getByText("修改前", { exact: true }).first().waitFor();
  await dialog.getByRole("button", { name: "完整页面", exact: true }).click();
  await dialog
    .frameLocator('iframe[title="历史页面预览"]')
    .getByText("历史检索正文验收", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "history.png") });
  await dialog.getByRole("button", { name: /创建页面/ }).click();
  await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await dialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const restored = await poll(
    read,
    (record) => record.document.title === created.document.title,
    "restored version",
  );
  assert.notEqual(restored.revision, saved.revision);
  assert.equal(
    (await api("history:list", { projectId: project.id, pageId })).items[0]
      .restoredFrom,
    created.revision,
  );
  checks.push(
    "history shows full timestamps, Agent session, structured changes, complete page and restore as a new commit",
  );
  // The restored revision is the shared base; the retained local draft and formal
  // update each modify an independent field and must both survive the merge UI.
  const local = structuredClone(restored.document);
  local.title = "合并后的本机标题";
  await api("drafts:save", {
    input: {
      kind: "page",
      clientId: "retained-ui-fixture",
      projectId: project.id,
      resourceId: pageId,
      baseRevision: restored.revision,
      content: local,
      sequence: 12,
    },
  });
  const remote = structuredClone(restored.document);
  remote.content.content[0].content = [
    { type: "text", text: "历史检索正文验收" },
  ];
  await save(restored, remote, "另一个会话修改正文");
  await page.reload();
  await open();
  await page
    .getByRole("button", { name: /^恢复草稿/ })
    .first()
    .click();
  await page.getByRole("button", { name: "比较并合并", exact: true }).waitFor();
  const conflictedSurface = await page
    .locator(".surface-editor-shell")
    .elementHandle();
  const conflictedOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.keyboard.press(refreshShortcut);
  await delay(350);
  assert.equal(await title.inputValue(), local.title);
  assert.equal((await read()).document.title, remote.title);
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    conflictedOrigin,
  );
  assert.equal(
    await conflictedSurface.evaluate((element) => element.isConnected),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "比较并合并", exact: true })
      .isVisible(),
    true,
  );
  await conflictedSurface.dispose();
  checks.push(
    "page refresh leaves a conflicted draft and its resolution controls intact",
  );
  await page.reload();
  await open();
  await page.getByRole("button", { name: "比较并合并", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByText("修改可以自动合并，请检查结果后保存。").waitFor();
  await dialog
    .getByRole("button", { name: "保存合并版本", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  const merged = await read();
  assert.equal(merged.document.title, local.title);
  assert.match(JSON.stringify(merged.document.content), /历史检索正文验收/);
  assert.equal(
    (
      await api("drafts:list", {
        projectId: project.id,
        kind: "page",
        resourceId: pageId,
      })
    ).length,
    0,
  );
  checks.push(
    "recovered local draft is merged against its actual base without losing independent formal changes",
  );
  await page.getByRole("button", { name: "搜索内容库", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "搜索内容库", exact: true })
    .fill("检索正文");
  await page.locator(".history-search-result").first().click();
  await page.locator(".history-search-results").waitFor({ state: "hidden" });
  checks.push("Chinese full-text search opens the matching page and block");
  const external = {
    format: "showai",
    version: 3,
    document: { ...merged.document, title: "外部修改标题" },
  };
  await writeFile(merged.path, JSON.stringify(external));
  const attempt = structuredClone(merged.document);
  attempt.icon = "📝";
  await assert.rejects(
    save(merged, attempt, "detect external change"),
    /CONFLICT.*conflictId/,
  );
  await page.reload();
  await open();
  await page.getByRole("button", { name: "处理外部修改", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "导入外部修改", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await read()).document.title, external.document.title);
  checks.push(
    "external filesystem edits are retained and explicitly imported through the workbench",
  );
  // Real compilation, then leave an invalid JSON form and reopen it via search.
  const manifest = JSON.parse(
    await readFile(
      join(root, "resources/catalog/value-slider/manifest.json"),
      "utf8",
    ),
  );
  const source = await readFile(
    join(root, "resources/catalog/value-slider/index.tsx"),
    "utf8",
  );
  const schema = JSON.parse(
    await readFile(
      join(root, "resources/catalog/value-slider/props.schema.json"),
      "utf8",
    ),
  );
  const component = await api("components:save", {
    projectId: project.id,
    manifest: {
      ...manifest,
      id: "history-draft-component",
      name: "草稿恢复组件验收",
    },
    source,
    schema,
  });
  const searchOpen = async (query) => {
    await page.getByRole("button", { name: "搜索内容库", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "搜索内容库", exact: true })
      .fill(query);
    await page.locator(".history-search-result").first().click();
  };
  await searchOpen(component.name);
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "数据结构", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "组件参数规则", exact: true })
    .fill('{"unfinished":');
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await searchOpen(component.name);
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /^恢复草稿/ })
    .first()
    .click();
  await dialog.getByRole("button", { name: "数据结构", exact: true }).click();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "组件参数规则", exact: true })
      .inputValue(),
    '{"unfinished":',
  );
  // Focus must stay on the edited field as the draft notice updates.
  await dialog
    .getByRole("textbox", { name: "组件参数规则", exact: true })
    .fill('{"type":"object"}');
  await delay(350);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "组件参数规则",
  );
  await dialog
    .getByRole("button", { name: "保存项目新版本", exact: true })
    .click();
  await poll(
    () =>
      api("drafts:list", {
        projectId: project.id,
        kind: "component",
        resourceId: component.id,
      }),
    (items) => items.length === 0,
    "published component draft cleared",
  );
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const drafts = await api("drafts:list", {
    projectId: project.id,
    kind: "component",
    resourceId: component.id,
  });
  assert.equal(drafts.length, 0);
  checks.push(
    "component forms preserve incomplete JSON, restore chosen drafts, keep input focus and clear only committed generations",
  );
  const versions = await api("components:list", {
      projectId: project.id,
      scope: "project",
    }),
    latest = versions
      .filter((item) => item.id === component.id)
      .sort((a, b) => b.version.localeCompare(a.version))[0];
  const packageDir = join(
      home,
      "workspace",
      "projects",
      project.id,
      "packages",
      "components",
      latest.id,
      latest.version,
    ),
    originalSource = await readFile(join(packageDir, "index.tsx"), "utf8"),
    originalManifest = await readFile(
      join(packageDir, "manifest.json"),
      "utf8",
    );
  await writeFile(
    join(packageDir, "index.tsx"),
    originalSource + "\n// external workbench recovery\n",
  );
  await writeFile(join(packageDir, "props.schema.json"), '{"unfinished":');
  await writeFile(join(packageDir, "manifest.json"), "{unfinished manifest");
  await page
    .getByRole("button", { name: "查看外部文件修改", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /index\.tsx/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保留为编辑草稿", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /^恢复草稿/ })
    .first()
    .click();
  await dialog.getByRole("button", { name: "数据结构", exact: true }).click();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "组件参数规则", exact: true })
      .inputValue(),
    '{"unfinished":',
  );
  await dialog
    .getByRole("textbox", { name: "组件参数规则", exact: true })
    .fill('{"type":"object"}');
  await dialog
    .getByText("外部组件定义（可修复未完成的 JSON）", { exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "恢复的组件定义 JSON", exact: true })
    .fill(originalManifest);
  await dialog
    .getByRole("button", { name: "保存项目新版本", exact: true })
    .click();
  await poll(
    () => api("components:list", { projectId: project.id, scope: "project" }),
    (items) =>
      items.some(
        (item) =>
          item.id === latest.id &&
          item.version !== latest.version &&
          item.version !== component.version,
      ),
    "external package published as a new version",
  );
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    await readFile(join(packageDir, "index.tsx"), "utf8"),
    originalSource,
  );
  checks.push(
    "external package source and incomplete JSON recover through the actual workbench and publish a new immutable version",
  );
  const template = await api("templates:save", {
    projectId: project.id,
    id: "history-draft-template",
    version: "1.0.0",
    name: "草稿恢复模板验收",
    description: "版本化模板草稿验收",
    document: (await read()).document,
  });
  await searchOpen(template.name);
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "定制说明", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "模板简述", exact: true })
    .fill("未发布的模板说明");
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await searchOpen(template.name);
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /^恢复草稿/ })
    .first()
    .click();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: "模板简述", exact: true })
      .inputValue(),
    "未发布的模板说明",
  );
  await dialog
    .getByRole("button", { name: "保存项目新版本", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  checks.push(
    "template descriptions and layout forms recover and publish a new version through the actual catalog",
  );
  assert.deepEqual(errors, []);
  const revisionBeforeMaintenance = (
    await api("history:list", { projectId: project.id, pageId })
  ).items[0].revision;
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "立即压缩", exact: true }).click();
  await page.getByText(/压缩完成：/).waitFor();
  await page
    .getByRole("button", { name: "检查可清理文件", exact: true })
    .click();
  await page.getByText(/可清理 \d+ 个文件/).waitFor();
  const clean = page.getByRole("button", { name: "清理这些文件", exact: true });
  if (await clean.isEnabled()) {
    await clean.click();
    await page
      .getByText("清理完成，正式内容和完整历史已保留。", { exact: true })
      .waitFor();
  }
  const archive = join(output, "complete.showai-archive");
  await page
    .getByRole("textbox", { name: "归档保存位置", exact: true })
    .fill(archive);
  await page.getByRole("button", { name: "保存完整归档", exact: true }).click();
  await page.getByText(/^完整归档已保存并验证：/).waitFor();
  assert.equal(
    (await api("library:verifyArchive", { path: archive })).verified,
    true,
  );
  assert.equal(
    (await api("history:list", { projectId: project.id, pageId })).items[0]
      .revision,
    revisionBeforeMaintenance,
  );
  checks.push(
    "space controls compact without changing history, review cache cleanup and create a verified complete library archive",
  );
  await page.screenshot({ path: join(output, "complete.png") });
  result.passed = true;
} catch (error) {
  result.failure = error.stack;
  throw error;
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  await writeFile(join(output, "service.log"), logs);
  if (!result.passed && page && !page.isClosed())
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  await browser?.close();
  child.kill("SIGTERM");
  if (child.exitCode === null) await once(child, "exit");
  console.log(JSON.stringify(result, null, 2));
}
