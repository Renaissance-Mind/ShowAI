// Build first, then run: node src/desktop/library-drag-ui-smoke.mjs.
// Real pointer gestures, Electron IPC and isolated versioned storage; no mocked bridge.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/library-drag-"));
const home = join(output, "home");
const env = {
  ...process.env,
  SHOWAI_HOME: home,
  SHOWAI_USER_DATA: join(output, "profile"),
  SHOWAI_LANGUAGE: "zh-CN",
};
delete env.ELECTRON_RUN_AS_NODE;
const result = { passed: false, home, checks: [], dropTimesMs: [] };
const errors = [];
let app, page;
try {
  app = await _electron.launch({
    executablePath: electron,
    args: [root],
    cwd: root,
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const invoke = (action, args) =>
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
  const source = await invoke("projects:create", { name: "拖拽验收" });
  const other = await invoke("projects:create", { name: "接收项目" });
  const folder = await invoke("folders:create", {
    projectId: source.id,
    name: "目标文件夹",
  });
  const second = await invoke("folders:create", {
    projectId: source.id,
    name: "第二个文件夹",
  });
  const record = await invoke("pages:create", {
    projectId: source.id,
    title: "保持打开的页面",
  });
  const id = record.document.id;
  await page.reload();
  const sidebar = page.locator(".studio-sidebar");
  const row = (id) =>
    sidebar.locator(`.studio-tree-row[data-library-id="${id}"]`);
  await row(source.id).locator(".studio-tree-main").click();
  await row(id).locator(".studio-tree-main").click();
  const title = page.getByRole("textbox", { name: "页面标题", exact: true });
  await title.waitFor();
  // Keep the editor DOM identity across a same-project metadata change.
  await page.locator("textarea.studio-page-heading-title").waitFor();
  await page
    .locator("textarea.studio-page-heading-title")
    .evaluate((element) => {
      window.dragEditor = element;
    });
  const waitFor = async (read, accepts) => {
    const deadline = Date.now() + 15000;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (accepts(value)) return value;
      await new Promise((done) => setTimeout(done, 40));
    }
    assert.fail(`Timed out: ${JSON.stringify(value)}`);
  };
  const saved = async (projectId = source.id) =>
    JSON.parse(
      await readFile(
        join(home, "workspace", "projects", projectId, "pages", `${id}.json`),
        "utf8",
      ),
    );
  const ready = () =>
    page.locator(".studio-toast").filter({ hasText: "已调整位置" }).waitFor();
  const parent = (id) =>
    row(id).evaluate(
      (element) =>
        element.parentElement.parentElement
          .closest("div:has(> .studio-tree-row)")
          ?.querySelector(":scope > .studio-tree-row")?.dataset.libraryId ??
        null,
    );
  const drag = async (from, to) => {
    const start = await row(from).boundingBox();
    const end = await row(to).boundingBox();
    assert.ok(start && end);
    await page.mouse.move(start.x + 70, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + 70, end.y + end.height / 2, { steps: 10 });
    await page.locator(".library-drag-ghost").waitFor();
    const released = Date.now();
    await page.mouse.up();
    await waitFor(
      () => parent(from),
      (value) => value === to,
    );
    await page.locator(".library-drag-ghost").waitFor({ state: "hidden" });
    result.dropTimesMs.push(Date.now() - released);
    await ready();
  };
  await drag(id, folder.id);
  await waitFor(
    () => saved(),
    (value) => value.document.parentId === folder.id,
  );
  assert.equal(await page.evaluate(() => window.dragEditor?.isConnected), true);
  assert.equal(await title.inputValue(), "保持打开的页面");
  assert.ok(
    result.dropTimesMs[0] < 600,
    "Drop should land after its short animation, independent of refresh",
  );
  result.checks.push(
    "Folder drop lands promptly and retains the current editor DOM",
  );

  // Editing after the move must preserve its new parent and revision.
  await title.fill("移动后继续编辑");
  await title.press("Meta+s");
  await waitFor(
    () => saved(),
    (value) => value.document.title === "移动后继续编辑",
  );
  assert.equal((await saved()).document.parentId, folder.id);
  result.checks.push(
    "Continued editing saves against the new revision without reverting the folder",
  );

  await drag(id, second.id);
  await waitFor(
    () => saved(),
    (value) => value.document.parentId === second.id,
  );
  // Focus a sidebar button so Cmd+Z is routed to library history.
  await row(id).locator(".studio-tree-main").focus();
  await page.keyboard.press("Meta+z");
  await waitFor(
    () => saved(),
    (value) => value.document.parentId === folder.id,
  );
  await waitFor(
    () => parent(id),
    (value) => value === folder.id,
  );
  await ready();
  await row(id).locator(".studio-tree-main").focus();
  await page.keyboard.press("Meta+Shift+z");
  await waitFor(
    () => saved(),
    (value) => value.document.parentId === second.id,
  );
  await ready();
  result.checks.push(
    "Consecutive folder moves, undo and redo persist correctly",
  );

  await drag(id, other.id);
  await waitFor(
    () => saved(other.id),
    (value) => value.document.title === "移动后继续编辑",
  );
  await title.waitFor();
  await title.fill("跨项目后继续编辑");
  await title.press("Meta+s");
  await waitFor(
    () => saved(other.id),
    (value) => value.document.title === "跨项目后继续编辑",
  );
  assert.equal(
    (await invoke("pages:list", { projectId: source.id })).some(
      (item) => item.id === id,
    ),
    false,
  );
  assert.deepEqual(await page.getByRole("alert").allTextContents(), []);
  assert.deepEqual(errors, []);
  result.checks.push(
    "Cross-project drag reopens in the destination and continued edits save there",
  );
  await page.screenshot({ path: join(output, "completed.png") });
  result.passed = true;
} catch (error) {
  result.error = error.stack ?? String(error);
  if (page)
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ ...result, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...result, output }, null, 2));
}
