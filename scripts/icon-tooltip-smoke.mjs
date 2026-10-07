// Real desktop development renderer, isolated filesystem and portable exports.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  cp,
  symlink,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import electron from "electron";
import { _electron, chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const status = JSON.parse(
  (
    await promisify(execFile)(
      process.execPath,
      ["scripts/dev-open.mjs", "--status"],
      { cwd: root },
    )
  ).stdout,
);
assert.equal(status.ready, true);
assert.equal(status.mode, "desktop");
assert.equal(status.root, root);
assert.equal(status.branch, "main");
assert.equal(status.url, "http://127.0.0.1:5173/");
const session = JSON.parse(
  await readFile(join(root, ".showai-dev/desktop-5173/session.json"), "utf8"),
);
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/icon-tooltip-"));
const env = {
  ...process.env,
  SHOWAI_HOME: join(output, "home"),
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_DEV_URL: status.url,
  SHOWAI_DEV_RUNTIME: session.runtime,
};
delete env.ELECTRON_RUN_AS_NODE;
const poll = async (read, test, label) => {
  const deadline = Date.now() + 20000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (test(value)) return value;
    await new Promise((done) => setTimeout(done, 80));
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
};
const portServer = createServer().listen(0, "127.0.0.1");
await once(portServer, "listening");
const port = portServer.address().port;
await new Promise((done) => portServer.close(done));
const fixture = join(output, "source");
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
await symlink(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
await promisify(execFile)("git", ["init", "--initial-branch=main", fixture]);
await promisify(execFile)("git", ["-C", fixture, "add", "package.json"]);
await promisify(execFile)("git", [
  "-C",
  fixture,
  "-c",
  "user.name=Tooltip Smoke",
  "-c",
  "user.email=smoke@localhost",
  "commit",
  "-m",
  "test: initialize isolated tooltip fixture",
]);
const exportCliArgs = [
  join(fixture, `.showai-dev/browser-${port}/runtime/scripts/cli.mjs`),
];
const service = spawn(
  process.execPath,
  [
    join(fixture, "scripts/dev.mjs"),
    "browser",
    "--port",
    String(port),
    "--home",
    env.SHOWAI_HOME,
    "--no-open",
  ],
  { cwd: root, env, stdio: "ignore" },
);
await poll(
  () =>
    readFile(
      join(fixture, `.showai-dev/browser-${port}/session.json`),
      "utf8",
    ).then(JSON.parse, (error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  Boolean,
  "isolated browser workbench ready",
);

const application = await _electron.launch({
  executablePath: electron,
  args: [join(root, ".showai-dev/desktop-5173/desktop")],
  cwd: root,
  env: {
    ...env,
    SHOWAI_HOME: join(output, "desktop-home"),
    SHOWAI_DEV_URL: `http://127.0.0.1:${port}`,
  },
});
let page = await application.firstWindow();
let desktopClosed = false;
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const result = { passed: false, output, checks: [], errors };
const tooltip = (scope = page) =>
  scope.locator(".showai-icon-tooltip:popover-open");
const hoverLabel = async (control, label, scope = page) => {
  const owner = control.page();
  await owner.bringToFront();
  await control.scrollIntoViewIfNeeded();
  await owner.waitForTimeout(200);
  await owner.mouse.move(10, 10);
  await control.hover();
  await poll(
    () =>
      tooltip(scope)
        .allTextContents()
        .then((values) => values.join("")),
    (value) => value === label,
    `tooltip ${label}`,
  );
  const bounds = await tooltip(scope).boundingBox();
  assert.ok(bounds);
  assert.equal(
    await tooltip(scope).evaluate((el) => getComputedStyle(el).borderRadius),
    "8px",
  );
};
let browser;
try {
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(
      async ({ action, args }) => {
        try {
          return await window.showai.invoke(action, args);
        } catch (error) {
          throw new Error(JSON.stringify(error));
        }
      },
      {
        action,
        args,
      },
    );
  const search = page.getByRole("button", {
    name: "查看外部文件修改",
    exact: true,
  });
  await search.focus();
  await poll(
    () =>
      tooltip()
        .allTextContents()
        .then((values) => values.join("")),
    (value) => value === "查看外部文件修改",
    "desktop keyboard tooltip",
  );
  assert.equal(await search.getAttribute("title"), null);
  await page.screenshot({ path: join(output, "desktop-focus.png") });
  await page.keyboard.press("Escape");
  assert.equal(await tooltip().count(), 0);
  assert.equal(await search.getAttribute("title"), "查看外部文件修改");
  await search.evaluate((el) => el.blur());
  await search.focus();
  await poll(
    () => tooltip().count(),
    (count) => count === 1,
    "keyboard tooltip",
  );
  assert.ok(
    (await search.getAttribute("aria-describedby")).startsWith(
      "showai-icon-tooltip-",
    ),
  );
  await page.keyboard.press("Escape");
  await search.click();
  await page
    .getByRole("dialog", { name: "外部文件修改", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("tooltip", { name: "查看外部文件修改", exact: true })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  result.checks.push(
    "Real Electron keyboard focus shows rounded text; Escape/click dismiss without blocking the existing dialog; native title is restored",
  );

  await application.close();
  desktopClosed = true;
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setViewportSize({ width: 1320, height: 880 });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  await hoverLabel(
    page.getByRole("button", { name: "查看外部文件修改", exact: true }),
    "查看外部文件修改",
  );
  const project = await api("projects:create", { name: "图标提示验收" });
  const component = await api("components:createExample", {
    projectId: project.id,
  });
  const created = await api("pages:create", {
    projectId: project.id,
    title: "图标提示验收页面",
  });
  const document = created.document;
  document.content.content = [
    {
      type: "paragraph",
      attrs: { id: crypto.randomUUID() },
      content: [{ type: "text", text: "选中文字，检查格式图标提示。" }],
    },
    {
      type: "widget",
      attrs: {
        id: crypto.randomUUID(),
        kind: "chart",
        data: {
          title: "趋势",
          type: "line",
          labels: ["一月", "二月"],
          series: [{ name: "访问", values: [10, 20] }],
        },
      },
    },
    {
      type: "widget",
      attrs: {
        id: crypto.randomUUID(),
        kind: "custom",
        data: {
          componentId: component.id,
          version: component.version,
          integrity: component.integrity,
          props: component.defaultData,
        },
      },
    },
  ];
  document.surfaceViews[document.content.attrs.id].readingOrder =
    document.content.content.map((node) => node.attrs.id);
  await api("pages:save", {
    projectId: project.id,
    pageId: document.id,
    document,
    baseHash: created.hash,
    baseRevision: created.revision,
  });
  await page
    .getByRole("button", { name: project.name, exact: true })
    .first()
    .click();
  await page
    .locator(`[data-library-id="${document.id}"] .studio-tree-main`)
    .click();
  await page.mouse.move(700, 450);
  await page.waitForTimeout(900);
  const download = page.getByRole("button", {
    name: "导出图表数据",
    exact: true,
  });
  await hoverLabel(download, "导出 CSV");
  await page.mouse.move(700, 400);
  await poll(
    () => tooltip().count(),
    (count) => count === 0,
    "pointer leave closes tooltip",
  );
  const text = page
    .locator(".tiptap p")
    .filter({ hasText: "选中文字" })
    .first();
  await text.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    el.closest("[contenteditable]").focus();
    document.dispatchEvent(new Event("selectionchange"));
  });
  const bold = page.getByRole("button", { name: "粗体 ⌘B", exact: true });
  await bold.waitFor();
  const selected = await page.evaluate(() => window.getSelection().toString());
  await hoverLabel(bold, "粗体 ⌘B");
  assert.equal(
    await page.evaluate(() => window.getSelection().toString()),
    selected,
  );
  await page.keyboard.press("Escape");
  result.checks.push(
    "Page chart action and selected-text toolbar show labels while preserving selection",
  );

  const frame = page.frameLocator('iframe[title="计数器"]');
  await hoverLabel(
    frame.getByRole("button", { name: "增加", exact: true }),
    "增加",
    frame,
  );
  await page.screenshot({ path: join(output, "component-hover.png") });
  await frame.getByRole("button", { name: "增加", exact: true }).click();
  assert.equal(await frame.locator("output").textContent(), "1");
  assert.equal(await tooltip(frame).count(), 0);
  await page.setViewportSize({ width: 420, height: 700 });
  const options = page.getByRole("button", { name: "页面操作", exact: true });
  await hoverLabel(options, "页面操作");
  const box = await tooltip().boundingBox();
  assert.ok(
    box.x >= 0 && box.x + box.width <= 420 && box.y + box.height <= 700,
  );
  await page.mouse.wheel(0, 250);
  await poll(
    () => tooltip().count(),
    (count) => count === 0,
    "scroll dismisses tooltip",
  );
  result.checks.push(
    "Existing sandboxed component receives the tooltip without recompilation; click still updates data; narrow viewport and scrolling work",
  );

  await page.setViewportSize({ width: 1200, height: 900 });
  await poll(
    () => page.locator(".studio-save-state").textContent(),
    (value) => value.includes("已保存"),
    "saved before export",
  );
  const reader = await browser.newPage();
  reader.on("pageerror", (error) => errors.push(error.message));
  for (const format of ["html", "inline"]) {
    const path = join(output, `${format}.html`);
    await promisify(execFile)(
      status.cli.command,
      [
        ...exportCliArgs,
        "export",
        "--project",
        project.id,
        "--page",
        document.id,
        "--format",
        format,
        "--out",
        path,
        "--json",
      ],
      {
        env: {
          ...process.env,
          ...status.cli.env,
          SHOWAI_HOME: env.SHOWAI_HOME,
        },
      },
    );
    await reader.goto(pathToFileURL(path).href);
    if (format === "html")
      await hoverLabel(
        reader.getByRole("button", { name: "页面选项", exact: true }),
        "页面选项",
        reader,
      );
    const scope =
      format === "html"
        ? reader.frameLocator('iframe[title="计数器"]')
        : reader;
    await scope.getByRole("button", { name: "增加", exact: true }).waitFor();
    await scope.getByRole("button", { name: "增加", exact: true }).hover();
    if (format === "html")
      await poll(
        () =>
          tooltip(scope)
            .allTextContents()
            .then((values) => values.join("")),
        (value) => value === "增加",
        "reader sandbox tooltip",
      );
    else
      await poll(
        () => reader.getByRole("tooltip", { name: "增加" }).count(),
        (count) => count === 1,
        "inline shadow tooltip",
      );
    assert.equal(
      await reader
        .locator(".editor-bubble, .studio-topbar, .custom-props-trigger")
        .count(),
      0,
    );
    await reader.screenshot({ path: join(output, `${format}-hover.png`) });
  }
  result.checks.push(
    "HTML and inline exports show reader and component tooltips without editor controls, including Shadow DOM",
  );
  assert.deepEqual(errors, []);
  result.passed = true;
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") });
  console.log(
    await page.evaluate(() => ({
      tips: [...document.querySelectorAll(".showai-icon-tooltip")].map(
        (el) => el.outerHTML,
      ),
      hovered: [...document.querySelectorAll(":hover")].map((el) => ({
        tag: el.tagName,
        label: el.getAttribute("aria-label"),
      })),
    })),
  );
  throw error;
} finally {
  await browser?.close();
  if (!desktopClosed) await application.close();
  service?.kill("SIGTERM");
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
