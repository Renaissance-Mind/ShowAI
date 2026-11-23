import { desktopTestEnvironment } from "../../scripts/desktop-test-env.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

process.env.SHOWAI_LANGUAGE ??= "zh-CN";

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
const env = { ...desktopTestEnvironment(), SHOWAI_HOME: home, SHOWAI_USER_DATA: profile };
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
  const projectsRoot = join(home, "workspace", "projects");
  const projectFile = join(projectsRoot, project.id, "project.json");
  const projectData = () => readJson(projectFile);
  const projectPages = async (projectId) =>
    Promise.all(
      (await readdir(join(projectsRoot, projectId, "pages")))
        .filter((file) => file.endsWith(".json"))
        .map(
          async (file) =>
            (await readJson(join(projectsRoot, projectId, "pages", file)))
              .document,
        ),
    );
  const pageDocuments = () => projectPages(project.id);
  const sidebar = page.locator(".studio-sidebar");
  const row = (id) =>
    sidebar.locator(`.studio-tree-row[data-library-id="${id}"]`);
  const rootTone = (target) =>
    target.evaluate((element) => {
      const root = element.closest("[data-root-tone]");
      if (!root || getComputedStyle(root).backgroundColor === "rgba(0, 0, 0, 0)")
        throw new Error("Expected a painted root folder");
      return root.dataset.rootTone;
    });
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
  const addContent = async (label) => {
    await page
      .getByRole("button", { name: "新建页面、白板、文件夹或项目", exact: true })
      .click();
    const menu = page.getByRole("menu", { name: "新建", exact: true });
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), [
      "文件夹",
      "页面",
      "白板",
      "新页面并交给 Agent…",
      "从模板新建…",
      "导入文件…",
      "新建项目",
    ]);
    await menu.getByRole("menuitem", { name: label, exact: true }).click();
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
    const toggle = row(id).locator("button.studio-tree-folder-toggle");
    if ((await toggle.getAttribute("aria-expanded")) === "false")
      await toggle.click();
  };
  const createPage = async (title, ownerProjectId = project.id) => {
    await addContent("页面");
    await page
      .getByRole("textbox", { name: "页面标题", exact: true })
      .fill(title);
    await page
      .getByRole("textbox", { name: "文档内容", exact: true })
      .fill(`${title}: persistent content.`);
    await page.locator(".studio-save-state.is-saved:not(.is-faded)").waitFor();
    return (
      await poll(
        () => projectPages(ownerProjectId),
        (docs) => docs.some((doc) => doc.title === title),
        "saved nested page",
      )
    ).find((doc) => doc.title === title);
  };
  const breadcrumbProject = () =>
    page.locator(".studio-breadcrumb > button").first().innerText();
  const emptyProjectHeading = page
    .locator(".studio-main")
    .getByRole("heading", { name: "项目为空", exact: true });
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
  await emptyProjectHeading.hover();
  const projectRow = row(project.id);
  const menuOpacity = () =>
    projectRow
      .locator(".studio-row-menu")
      .evaluate((button) => Number(getComputedStyle(button).opacity));
  await poll(menuOpacity, (value) => value === 0, "hidden row menu");
  await projectRow.hover();
  await poll(menuOpacity, (value) => value === 1, "visible hover menu");
  result.checks.push(
    "Sidebar has no new-page button, appended count or local-library footer; ellipsis appears on hover",
  );

  const fullSize = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const docsToggle = sidebar.getByRole("button", {
    name: "文档",
    exact: true,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await docsToggle.locator("svg").click();
  const docsPanel = sidebar.getByRole("region", { name: "ShowAI 文档" });
  await docsPanel
    .getByRole("button", { name: "文档首页", exact: true })
    .waitFor({ state: "attached" });
  assert.equal(
    await docsPanel.getByText("ShowAI 文档", { exact: true }).count(),
    0,
  );
  assert.equal(await sidebar.locator(".studio-tree-chevron").count(), 0);
  const folderName = "使用工作台";
  const docsFolder = docsPanel.getByRole("button", {
    name: folderName,
    exact: true,
  });
  const children = docsPanel.getByRole("group", {
    name: folderName,
    exact: true,
  });
  const folderIcon = docsFolder.locator("svg");
  const closedIcon = await folderIcon.innerHTML();
  await docsFolder.press("Enter");
  await children.waitFor();
  assert.equal(await docsFolder.getAttribute("aria-expanded"), "true");
  assert.equal(
    await rootTone(children.locator(".studio-tree-row").first()),
    await rootTone(docsFolder),
  );
  assert.notEqual(await folderIcon.innerHTML(), closedIcon);
  const guide = await children.evaluate((group) => {
    const first = group.firstElementChild;
    const lastRow = group.lastElementChild.querySelector(".studio-tree-row");
    return {
      width: getComputedStyle(first, "::before").width,
      color: getComputedStyle(first, "::before").backgroundColor,
      lastColor: getComputedStyle(lastRow, "::before").backgroundColor,
      start: parseFloat(getComputedStyle(first, "::before").top),
      end: parseFloat(getComputedStyle(lastRow, "::before").height),
      rowHeight: lastRow.getBoundingClientRect().height,
    };
  });
  assert.equal(guide.start, 0);
  assert.equal(guide.width, "2px");
  assert.equal(guide.color, guide.lastColor);
  assert.ok(Math.abs(guide.end - guide.rowHeight * 0.75) < 0.1);
  await docsFolder.click();
  await children.waitFor({ state: "detached" });
  assert.equal(await docsFolder.getAttribute("aria-expanded"), "false");
  assert.equal(await folderIcon.innerHTML(), closedIcon);

  await page.setViewportSize({ width: fullSize.width, height: 260 });
  const docsBox = await docsPanel.boundingBox();
  const toggleBox = await docsToggle.boundingBox();
  const searchBox = await sidebar
    .locator(".studio-sidebar-search")
    .boundingBox();
  assert.equal(toggleBox.y + toggleBox.height, docsBox.y);
  assert.equal(searchBox.y, toggleBox.y);
  assert.ok(searchBox.x + searchBox.width <= toggleBox.x);
  assert.equal(toggleBox.x + toggleBox.width, docsBox.x + docsBox.width);
  await projectRow.hover();
  await poll(menuOpacity, (value) => value === 1, "hover before scrolling");
  const tree = sidebar.locator(".studio-sidebar-projects");
  const start = await tree.evaluate((list) => list.scrollTop);
  assert.ok(start >= 4);
  await page.mouse.wheel(0, -4);
  await poll(
    () => tree.evaluate((list) => list.scrollTop),
    (top) => top < start,
    "sidebar wheel",
  );
  await page.waitForFunction((id) => {
    const row = document.querySelector(
      `.studio-tree-row[data-library-id="${id}"]:hover`,
    );
    const menu = row?.querySelector(".studio-row-menu");
    return menu && Number(getComputedStyle(menu).opacity) < 0.9;
  }, project.id);
  await poll(menuOpacity, (value) => value === 1, "restored hover menu");
  await Promise.all([
    page.waitForFunction(() => {
      const panel = document.querySelector(
        '.studio-docs[data-presence="exiting"]',
      );
      if (!panel || panel.clientHeight < 1) return false;
      const button = document.querySelector(".studio-docs-toggle");
      const paint = getComputedStyle(button, "::before");
      const surface = getComputedStyle(panel);
      return (
        paint.bottom === "0px" &&
        paint.backgroundColor === surface.backgroundColor &&
        surface.opacity === "1" &&
        button.getBoundingClientRect().bottom === panel.getBoundingClientRect().top
      );
    }),
    docsToggle.press("Space"),
  ]);
  await page.setViewportSize(fullSize);
  result.checks.push(
    "Scrolling suspends row hover and restores the menu under a stationary pointer",
  );

  const firstMenu = await openMenu(project.id);
  const labels = await firstMenu
    .locator('button[role="menuitem"] > span:not([class])')
    .allTextContents();
  assert.deepEqual(
    labels.map((label) => label.trim()).sort(),
    [
      "在新标签页打开",
      "在新窗口打开",
      "重命名",
      "删除",
      "置顶",
      "移到分组…",
      "项目上移",
      "项目下移",
      "在本设备隐藏",
      "同步到服务器…",
      "共享给成员…",
    ].sort(),
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
  await emptyProjectHeading.click();
  await page.getByRole("menu").waitFor({ state: "detached" });
  result.checks.push(
    "Project menu fits viewport; initial focus, arrows, End, Escape restoration, Tab and outside click work",
  );

  await choose(project.id, "重命名");
  await nameDialog("项目名称", "Renamed project");
  const checkSectionHeading = async (sectionId) => {
    const section = sidebar.locator(`[data-project-section="${sectionId}"]`);
    await poll(
      () =>
        section.evaluate((node) => {
          const title = document.createRange();
          title.selectNodeContents(node.querySelector(".studio-section-title"));
          const header = node
            .querySelector(".studio-sidebar-label")
            .getBoundingClientRect();
          const row = node.querySelector(".studio-tree-row");
          const icon = row
            .querySelector(".studio-project-icon")
            .getBoundingClientRect();
          return {
            offset: title.getBoundingClientRect().left - icon.left,
            height: header.height,
            gap: row.getBoundingClientRect().top - header.bottom,
          };
        }),
      ({ offset, height, gap }) => offset === 0 && height === 24 && gap === 0,
      `${sectionId} heading layout after the row settles`,
    );
  };
  await checkSectionHeading("projects");
  const projectTone = await rootTone(row(project.id));
  await choose(project.id, "置顶");
  await poll(
    projectData,
    (data) => data.name === "Renamed project" && data.pinned === true,
    "project rename and pin persistence",
  );
  await checkSectionHeading("pinned");
  await addContent("文件夹");
  await nameDialog("文件夹名称", "Folder A");
  const folderA = (await projectData()).folders.find(
    (folder) => folder.name === "Folder A",
  );
  assert.equal(folderA.parentId, null);
  await addContent("文件夹");
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
  const folderToggle = row(folderB.id).locator(".studio-tree-folder-toggle");
  const openFolderIcon = await folderToggle.locator("svg").innerHTML();
  await folderToggle.click();
  await row(nested.id).waitFor({ state: "detached" });
  assert.notEqual(await folderToggle.locator("svg").innerHTML(), openFolderIcon);
  await folderToggle.press("Enter");
  await row(nested.id).waitFor();
  assert.equal(await rootTone(row(nested.id)), projectTone);
  assert.equal(await folderToggle.locator("svg").innerHTML(), openFolderIcon);
  await choose(nested.id, "重命名");
  await nameDialog("名称", "Renamed page");
  await choose(nested.id, "置顶");
  await choose(folderB.id, "重命名");
  await nameDialog("文件夹名称", "Renamed folder");
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
  assert.equal(await rootTone(row(project.id)), projectTone);
  assert.equal(
    await row(project.id).locator(".studio-tree-title").innerText(),
    "Renamed project",
  );
  assert.equal(await row(project.id).getAttribute("data-pinned"), "true");
  await row(project.id).locator(".studio-tree-main").click();
  await expand(project.id);
  await expand(folderA.id);
  await expand(folderB.id);
  assert.equal(
    await row(folderB.id).locator(".studio-tree-title").innerText(),
    "Renamed folder",
  );
  assert.equal(await row(folderB.id).getAttribute("data-pinned"), "true");
  assert.equal(
    await row(nested.id).locator(".studio-tree-title").innerText(),
    "Renamed page",
  );
  assert.equal(await row(nested.id).getAttribute("data-pinned"), "true");
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
  await choose(nested.id, "删除");
  await row(nested.id).waitFor({ state: "detached" });
  await poll(
    pageDocuments,
    (docs) => docs.some((doc) => doc.id === nested.id && doc.archived),
    "deleted page persistence",
  );
  const otherName = "Project B context";
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
  assert.equal(await breadcrumbProject(), otherName);
  await remove(folderB.id);
  assert.equal(
    await breadcrumbProject(),
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
  await poll(
    projectData,
    (data) => data.archived === true,
    "deleted project persistence",
  );
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
  await sidebar.getByRole("button", { name: "设置", exact: true }).click();
  await sidebar.getByRole("button", { name: "通用", exact: true }).click();
  const language = page.getByRole("combobox", { name: "语言", exact: true });
  await language.click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await sidebar.getByRole("button", { name: "外观", exact: true }).click();
  assert.equal(await language.count(), 0);
  const picker = page.getByRole("radiogroup", { name: "侧栏文件夹配色" });
  const preview = page.getByRole("group", { name: "侧栏预览" });
  const painted = preview.locator("[data-root-tone]");
  const backgrounds = () =>
    painted.evaluateAll((roots) =>
      roots.map((root) => getComputedStyle(root).backgroundColor),
    );
  assert.equal(await picker.getByRole("radio").count(), 6);
  const schemes = new Set();
  for (const name of ["原始", "莫兰迪", "海岸", "林间", "暖陶", "纯色"]) {
    await picker.getByRole("radio", { name, exact: true }).check();
    const fills = await backgrounds();
    assert.equal(fills.length, name === "原始" ? 0 : 3);
    assert.equal(
      new Set(fills).size,
      name === "原始" ? 0 : name === "纯色" ? 1 : 3,
    );
    schemes.add(fills.join(","));
  }
  assert.equal(schemes.size, 6);
  await page.getByRole("radio", { name: "深色", exact: true }).check();
  const morandi = picker.getByRole("radio", { name: "莫兰迪", exact: true });
  await morandi.check();
  await morandi.press("ArrowRight");
  assert.ok(
    await picker.getByRole("radio", { name: "海岸", exact: true }).isChecked(),
  );
  assert.ok(!schemes.has((await backgrounds()).join(",")));
  await page.setViewportSize({ width: 680, height: 760 });
  assert.ok(
    await picker.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  );
  await page.screenshot({
    path: join(output, "folder-colors-dark-narrow.png"),
  });
  await page.setViewportSize(fullSize);
  await page.getByRole("radio", { name: "浅色", exact: true }).check();
  await picker.getByRole("radio", { name: "纯色", exact: true }).check();
  await page.getByLabel("统一颜色").fill("#527a82");
  const solid = (await backgrounds())[0];
  await preview.getByRole("button", { name: "收起设计项目" }).click();
  assert.equal(
    await preview
      .getByRole("button", { name: "方案评审", exact: true })
      .count(),
    0,
  );
  await preview.getByRole("button", { name: "展开设计项目" }).click();
  await preview.getByRole("button", { name: "方案评审", exact: true }).click();
  const rootLayout = await painted.first().evaluate((root) => {
    const row = root.querySelector(".studio-tree-row.active");
    const style = getComputedStyle(root);
    return [
      style.paddingTop,
      style.paddingBottom,
      style.paddingLeft,
      style.paddingRight,
      Math.round(
        root.getBoundingClientRect().bottom -
          row.getBoundingClientRect().bottom,
      ),
    ];
  });
  assert.deepEqual(rootLayout, ["4px", "6px", "4px", "4px", 6]);
  await page.screenshot({ path: join(output, "folder-color-settings.png") });
  await page.reload();
  await sidebar.getByRole("button", { name: "通用", exact: true }).waitFor();
  await sidebar.getByRole("button", { name: "最近", exact: true }).click();
  const actualRoot = sidebar
    .locator(".studio-tree-entry[data-root-tone]")
    .first();
  await actualRoot.waitFor();
  assert.equal(
    await actualRoot.evaluate((node) => getComputedStyle(node).backgroundColor),
    solid,
  );
  result.checks.push(
    "General language switching, six visual palettes, editable solid color, nested preview, root padding and real sidebar colors after reload",
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
