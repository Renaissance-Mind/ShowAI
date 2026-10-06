// Real sidebar/menu acceptance. Build first, then node src/desktop/library-ui-smoke.mjs.
// Optional SHOWAI_SMOKE_BINARY points at an already built application executable.
// All writes use an isolated home/profile; evidence and canonical files are retained.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const parent = resolve(
  process.env.SHOWAI_SMOKE_OUTPUT || join(repository, "output/playwright"),
);
await mkdir(parent, { recursive: true });
const output = await mkdtemp(join(parent, "library-ui-"));
const home = join(output, "home"),
  profile = join(output, "profile");
const binary = process.env.SHOWAI_SMOKE_BINARY
  ? resolve(process.env.SHOWAI_SMOKE_BINARY)
  : electron;
const resources =
  process.platform === "darwin"
    ? resolve(dirname(binary), "../Resources")
    : join(dirname(binary), "resources");
const artifacts = process.env.SHOWAI_SMOKE_BINARY
  ? [
      binary,
      join(resources, "app.asar"),
      join(resources, "runtime/scripts/cli.mjs"),
    ]
  : [
      join(repository, "dist-desktop/main.mjs"),
      join(repository, "dist-desktop/index.html"),
      join(repository, "dist-desktop/preload.cjs"),
    ];
const fingerprints = async () =>
  Object.fromEntries(
    await Promise.all(
      artifacts.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
const env = { ...process.env, SHOWAI_HOME: home, SHOWAI_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
async function poll(read, accepts, label) {
  const deadline = Date.now() + 15000;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await new Promise((done) => setTimeout(done, 75));
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
}
let application, page;
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
  child.stdout?.on("data", (chunk) => {
    processOutput += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    processOutput += chunk;
  });
  page = await application.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const info = await page.evaluate(() => window.showai.invoke("app:info"));
  assert.equal(info.home, home);
  result.version = info.version;
  result.packaged = info.packaged;

  const assertNoAlerts = async (phase) => {
    const alerts = await page.getByRole("alert").allTextContents();
    assert.deepEqual(alerts, [], `Unexpected visible error during ${phase}`);
  };

  const projectName = "Library acceptance";
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill(projectName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  const projects = await poll(
    () => page.evaluate(() => window.showai.invoke("projects:list")),
    (items) => items.some((item) => item.name === projectName),
    "UI-created project",
  );
  const project = projects.find((item) => item.name === projectName);
  result.projectId = project.id;
  const projectFile = join(home, "projects", project.id, "project.json");
  const projectData = () => readJson(projectFile);
  const projectPages = async (projectId) =>
    Promise.all(
      (await readdir(join(home, "projects", projectId, "pages")))
        .filter((file) => file.endsWith(".json"))
        .map(
          async (file) =>
            (await readJson(join(home, "projects", projectId, "pages", file)))
              .document,
        ),
    );
  const pageDocuments = () => projectPages(project.id);
  const sidebar = page.locator(".studio-sidebar");
  const row = (id) =>
    sidebar.locator(`.studio-tree-row[data-library-id="${id}"]`);
  const openMenu = async (id) => {
    await row(id).hover();
    await row(id).locator(".studio-row-menu").click();
    await page.getByRole("menu").waitFor();
    return page.getByRole("menu");
  };
  const choose = async (id, label) =>
    (await openMenu(id))
      .getByRole("menuitem", { name: label, exact: true })
      .click();
  const directoryAction = async (label) => {
    await page
      .getByRole("button", { name: "当前目录操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };
  const nameDialog = async (inputLabel, value) => {
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: inputLabel, exact: true })
      .fill(value);
    await dialog.getByRole("button", { name: /^(创建|保存)$/ }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  const expand = async (id) => {
    const toggle = row(id).locator("button.studio-tree-chevron");
    if ((await toggle.getAttribute("aria-expanded")) === "false")
      await toggle.click();
  };
  const createPage = async (title, ownerProjectId = project.id) => {
    await directoryAction("添加新页面");
    await page.getByRole("button", { name: /空白画布/ }).click();
    await page
      .getByRole("textbox", { name: "页面标题", exact: true })
      .fill(title);
    await page
      .getByRole("textbox", { name: "文档内容", exact: true })
      .fill(`${title}: persistent content.`);
    await page.locator(".studio-save-state.saved").waitFor();
    return (
      await poll(
        () => projectPages(ownerProjectId),
        (docs) => docs.some((doc) => doc.title === title),
        "saved nested page",
      )
    ).find((doc) => doc.title === title);
  };
  const remove = async (id) => {
    await choose(id, "删除");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await row(id).waitFor({ state: "detached" });
  };

  assert.equal(
    await sidebar.getByRole("button", { name: /新页面/ }).count(),
    0,
  );
  assert.equal(
    await sidebar.getByText("本地内容库", { exact: true }).count(),
    0,
  );
  assert.equal(
    (await row(project.id).innerText()).trim(),
    projectName,
    "Project rows must not append page counts.",
  );
  await page.getByRole("button", { name: "当前目录操作", exact: true }).focus();
  await page.locator(".studio-section-heading h1").hover();
  await poll(
    () =>
      row(project.id)
        .locator(".studio-row-menu")
        .evaluate((element) => Number(getComputedStyle(element).opacity)),
    (opacity) => opacity === 0,
    "hidden row menu",
  );
  await row(project.id).hover();
  await poll(
    () =>
      row(project.id)
        .locator(".studio-row-menu")
        .evaluate((element) => Number(getComputedStyle(element).opacity)),
    (opacity) => opacity === 1,
    "visible hover menu",
  );
  result.checks.push(
    "Sidebar has no new-page button, appended count or local-library footer; ellipsis appears on hover",
  );

  const firstMenu = await openMenu(project.id);
  const labels = await firstMenu.getByRole("menuitem").allTextContents();
  assert.deepEqual(
    labels.map((label) => label.trim()).sort(),
    ["添加新页面", "新文件夹", "重命名", "删除", "置顶", "移到分组…"].sort(),
  );
  await poll(
    () =>
      firstMenu
        .getByRole("menuitem")
        .first()
        .evaluate((element) => element === document.activeElement),
    Boolean,
    "first menu item focus",
  );
  const menuBounds = await firstMenu.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  assert.ok(
    menuBounds.x >= 0 &&
      menuBounds.y >= 0 &&
      menuBounds.x + menuBounds.width <= viewport.width &&
      menuBounds.y + menuBounds.height <= viewport.height,
  );
  const menuScreenshot = join(output, "sidebar-menu.png");
  await page.screenshot({ path: menuScreenshot, fullPage: true });
  console.log(
    JSON.stringify({
      progress: "sidebar menu ready",
      screenshot: menuScreenshot,
    }),
  );
  await page.keyboard.press("ArrowDown");
  assert.equal(
    await firstMenu
      .getByRole("menuitem")
      .nth(1)
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("End");
  assert.equal(
    await firstMenu
      .getByRole("menuitem")
      .last()
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  await firstMenu.waitFor({ state: "detached" });
  assert.equal(
    await row(project.id)
      .locator(".studio-row-menu")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await openMenu(project.id);
  await page.keyboard.press("Tab");
  await page.getByRole("menu").waitFor({ state: "detached" });
  assert.equal(
    await row(project.id)
      .locator(".studio-row-menu")
      .evaluate((element) => element === document.activeElement),
    false,
  );
  await openMenu(project.id);
  await page.locator(".studio-section-heading h1").click();
  await page.getByRole("menu").waitFor({ state: "detached" });
  result.checks.push(
    "Project menu fits viewport; initial focus, arrows, End, Escape restoration, Tab and outside click work",
  );

  await choose(project.id, "重命名");
  await nameDialog("名称", "Renamed project");
  await choose(project.id, "置顶");
  await poll(
    projectData,
    (data) => data.name === "Renamed project" && data.pinned === true,
    "project rename and pin persistence",
  );
  await choose(project.id, "新文件夹");
  await nameDialog("文件夹名称", "Folder A");
  const folderA = (await projectData()).folders.find(
    (folder) => folder.name === "Folder A",
  );
  assert.equal(folderA.parentId, null);
  await directoryAction("新文件夹");
  await nameDialog("文件夹名称", "Folder B");
  const folderB = (await projectData()).folders.find(
    (folder) => folder.name === "Folder B",
  );
  assert.equal(folderB.parentId, folderA.id);
  const nested = await createPage("Nested page");
  assert.equal(nested.parentId, folderB.id);
  result.folderIds = [folderA.id, folderB.id];
  result.pageId = nested.id;
  await expand(project.id);
  await expand(folderA.id);
  await expand(folderB.id);
  await choose(nested.id, "重命名");
  await nameDialog("名称", "Renamed page");
  await choose(nested.id, "置顶");
  await choose(folderB.id, "重命名");
  await nameDialog("名称", "Renamed folder");
  await choose(folderB.id, "置顶");
  await poll(
    pageDocuments,
    (docs) =>
      docs.some(
        (doc) =>
          doc.id === nested.id && doc.title === "Renamed page" && doc.favorite,
      ),
    "page rename and pin",
  );
  await poll(
    projectData,
    (data) =>
      data.folders.some(
        (folder) =>
          folder.id === folderB.id &&
          folder.name === "Renamed folder" &&
          folder.pinned,
      ),
    "folder rename and pin",
  );
  await assertNoAlerts("nested page and folder editing");
  result.checks.push(
    "Menus create nested folders and pages, rename all target kinds and persist pin state",
  );

  await page.reload();
  await row(project.id).waitFor();
  assert.equal(
    await row(project.id).locator(".studio-tree-title").innerText(),
    "Renamed project",
  );
  assert.equal(await row(project.id).locator(".studio-tree-pin").count(), 1);
  await row(project.id).locator(".studio-tree-main").click();
  await expand(project.id);
  await expand(folderA.id);
  await expand(folderB.id);
  assert.equal(
    await row(folderB.id).locator(".studio-tree-title").innerText(),
    "Renamed folder",
  );
  assert.equal(await row(folderB.id).locator(".studio-tree-pin").count(), 1);
  assert.equal(
    await row(nested.id).locator(".studio-tree-title").innerText(),
    "Renamed page",
  );
  assert.equal(await row(nested.id).locator(".studio-tree-pin").count(), 1);
  await row(folderB.id).locator(".studio-tree-main").click();
  await page.screenshot({
    path: join(output, "nested-persisted.png"),
    fullPage: true,
  });
  result.checks.push(
    "Renderer reload reconstructs nested hierarchy, names and pins from disk",
  );

  const descendant = await createPage("Folder descendant");
  await expand(project.id);
  await expand(folderA.id);
  await expand(folderB.id);
  await remove(nested.id);
  await poll(
    pageDocuments,
    (docs) => docs.some((doc) => doc.id === nested.id && doc.archived),
    "deleted page persistence",
  );
  // Preserve an opened A page, navigate to B, then delete A's ancestor from
  // the sidebar. The deletion must not carry A's parent folder into B.
  const otherName = "Project B context";
  await sidebar
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "项目", exact: true })
    .click();
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill(otherName);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  const allProjects = await poll(
    () => page.evaluate(() => window.showai.invoke("projects:list")),
    (items) => items.some((item) => item.name === otherName),
    "project B creation",
  );
  const otherProject = allProjects.find((item) => item.name === otherName);
  await assertNoAlerts("project B creation");
  await row(project.id).locator(".studio-tree-main").click();
  await expand(project.id);
  await expand(folderA.id);
  await expand(folderB.id);
  await row(descendant.id).locator(".studio-tree-main").click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "页面标题", exact: true })
      .inputValue(),
    "Folder descendant",
  );
  await row(otherProject.id).locator(".studio-tree-main").click();
  assert.equal(
    await page.locator(".studio-section-heading h1").innerText(),
    otherName,
  );
  await remove(folderB.id);
  assert.equal(
    await page.locator(".studio-section-heading h1").innerText(),
    otherName,
    "Deleting A's ancestor must preserve B navigation.",
  );
  const otherPage = await createPage("B root page", otherProject.id);
  assert.equal(
    otherPage.parentId,
    null,
    "A new page in B must not inherit A's parent folder.",
  );
  assert.match(
    await page.locator(".studio-breadcrumb").innerText(),
    /Project B context/,
  );
  result.crossProject = {
    openedPageInA: descendant.id,
    deletedAncestorInA: folderB.id,
    selectedProjectB: otherProject.id,
    newPageInB: otherPage.id,
    newPageParentId: otherPage.parentId,
  };
  await assertNoAlerts("cross-project deletion and B page creation");
  await page.screenshot({
    path: join(output, "cross-project-root.png"),
    fullPage: true,
  });
  result.checks.push(
    "Deleting A's ancestor while viewing B preserves B navigation; B's new page is saved at its root",
  );
  await poll(
    projectData,
    (data) =>
      data.folders.some(
        (folder) => folder.id === folderB.id && folder.archived,
      ),
    "deleted folder persistence",
  );
  const activePages = await page.evaluate(
    (projectId) => window.showai.invoke("pages:list", { projectId }),
    project.id,
  );
  assert.equal(
    activePages.some((item) => item.id === descendant.id),
    false,
  );
  await row(descendant.id).waitFor({ state: "detached" });
  await remove(folderA.id);
  await remove(project.id);
  assert.equal((await projectData()).archived, true);
  await assertNoAlerts("deleting folders and project A");
  await page.reload();
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  assert.equal(await row(project.id).count(), 0);
  assert.equal(
    await sidebar.getByText("本地内容库", { exact: true }).count(),
    0,
  );
  await page.screenshot({
    path: join(output, "deleted-persisted.png"),
    fullPage: true,
  });
  result.checks.push(
    "Page/folder/project delete actions persist, including hiding a deleted folder's live descendant after reload",
  );
  await assertNoAlerts("final reload");
  result.checks.push(
    "No visible error alerts throughout authoring, cross-project navigation and deletion",
  );
  assert.deepEqual(rendererErrors, []);
  assert.deepEqual(
    await fingerprints(),
    result.runtimeHashes,
    "The build changed during UI acceptance.",
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
  if (application && application.process().exitCode === null)
    await application
      .close()
      .catch(() => application.process().kill("SIGTERM"));
  result.rendererErrors = rendererErrors;
  await writeFile(join(output, "electron.log"), processOutput);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
