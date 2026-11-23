import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  ...desktopTestEnvironment(),
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
  const makePage = async (title, parentId, kind = "page") =>
    (
      await invoke("pages:create", {
        projectId: source.id,
        title,
        parentId,
        kind,
      })
    ).document.id;
  const first = await makePage("A", folder.id);
  await makePage("B", folder.id);
  await makePage("C", folder.id);
  const board = await makePage("Z", null, "board");
  await invoke("directory:sort", {
    projectId: source.id,
    parentId: folder.id,
    sortBy: "name",
  });
  await row(source.id).locator(".studio-tree-main").click();
  await page.getByRole("button", { name: "视图", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "缩略图（中）" }).click();
  const grid = page.locator(
    '.studio-library .studio-page-list[data-view="medium"]',
  );
  const card = (id) => grid.locator(`[data-library-id="${id}"]`);
  const receiver = card(folder.id);
  await receiver.locator(`[data-cover-page="${first}"]`).waitFor();
  assert.equal(await receiver.locator(".studio-page-thumbnail").count(), 1);
  assert.equal(await receiver.locator(".studio-folder-sheet").count(), 3);
  const pickup = async () => {
    await card(board).locator(".studio-page-list-open").hover();
    const start = await card(board).boundingBox();
    assert.ok(start);
    await page.mouse.down();
    await page.mouse.move(
      start.x + start.width / 2 + 12,
      start.y + start.height / 2,
    );
    await page
      .locator(".library-card-ghost")
      .getByText("Z", { exact: true })
      .waitFor();
    await receiver.hover();
    await grid
      .locator(`[data-library-id="${folder.id}"][data-folder-drop="over"]`)
      .waitFor();
    assert.equal(
      await page.locator(".library-drag-ghost .studio-page-thumbnail").count(),
      0,
    );
    return start;
  };
  const start = await pickup();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.up();
  await page.locator(".library-drag-ghost").waitFor({ state: "detached" });
  assert.equal(
    await receiver.locator(".studio-folder-count").textContent(),
    "3 项",
  );
  await card(board).waitFor();
  await pickup();
  await page.mouse.up();
  await receiver.locator(`[data-cover-page="${board}"]`).waitFor();
  await page.locator(".library-drag-ghost").waitFor({ state: "detached" });
  assert.equal(
    await receiver.locator(".studio-folder-count").textContent(),
    "4 项",
  );
  const movedBoard = await invoke("pages:get", {
    projectId: source.id,
    pageId: board,
  });
  assert.equal(movedBoard.document.parentId, folder.id);
  assert.equal(await card(board).count(), 0);
  result.checks.push(
    "A three-sheet grid folder mounts one preview, cancels at the source and receives the dropped board as its cover",
  );
  await row(source.id).locator(".studio-tree-main").click();
  await row(id).locator(".studio-tree-main").click();
  const title = page.getByRole("textbox", { name: "页面标题", exact: true });
  await title.waitFor();
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
  const pagePath = (projectId) =>
    join(home, "workspace", "projects", projectId, "pages", `${id}.json`);
  const saved = async (projectId = source.id) =>
    JSON.parse(await readFile(pagePath(projectId), "utf8"));
  const ready = () =>
    page.locator(".studio-toast").filter({ hasText: "已调整位置" }).waitFor();
  const parent = (id) =>
    row(id).evaluate(
      (element) =>
        element.parentElement?.parentElement
          ?.closest("div:has(> .studio-tree-row)")
          ?.querySelector(":scope > .studio-tree-row")?.dataset.libraryId ??
        null,
    );
  const drag = async (from, to) => {
    await row(from).locator(".studio-tree-main").hover();
    const start = await row(from).boundingBox();
    assert.ok(start);
    await page.mouse.move(start.x + 70, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + 82, start.y + start.height / 2);
    await page.locator(".library-drag-ghost").waitFor();
    await row(to).locator(".studio-tree-main").hover();
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
  await row(id).locator(".studio-tree-main").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await waitFor(
    () => saved(),
    (value) => value.document.parentId === folder.id,
  );
  await waitFor(
    () => parent(id),
    (value) => value === folder.id,
  );
  await ready();
  await row(id).locator(".studio-tree-main").press("ControlOrMeta+Shift+z");
  await waitFor(
    () => saved(),
    (value) => value.document.parentId === second.id,
  );
  await ready();
  result.checks.push(
    "Consecutive folder moves, undo and redo persist correctly",
  );

  await drag(id, other.id);
  await waitFor(() => existsSync(pagePath(other.id)), Boolean);
  await waitFor(
    () => saved(other.id),
    (value) => value.document.title === "移动后继续编辑",
  );
  await row(id)
    .locator(
      `.studio-tree-main[data-open-project="${other.id}"][aria-current="page"]`,
    )
    .waitFor();
  await title.and(page.locator('input[value="移动后继续编辑"]:enabled')).waitFor();
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
