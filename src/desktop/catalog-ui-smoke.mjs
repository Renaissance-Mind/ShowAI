// Exercises the real desktop catalog across two real project directories.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(join(root, "output/playwright"), { recursive: true });
const output = await mkdtemp(join(root, "output/playwright/catalog-ui-"));
const home = join(output, "home"),
  env = {
    ...process.env,
    SHOWAI_HOME: home,
    SHOWAI_USER_DATA: join(output, "profile"),
  };
delete env.ELECTRON_RUN_AS_NODE;
const binary = process.env.SHOWAI_SMOKE_BINARY || electron;
const packaged = !!process.env.SHOWAI_SMOKE_BINARY;
const runtime = packaged
  ? join(dirname(binary), "../Resources/app.asar")
  : join(root, "dist-desktop/main.mjs");
const digest = async () =>
  createHash("sha256")
    .update(await readFile(runtime))
    .digest("hex");
const result = {
  passed: false,
  output,
  packaged,
  checks: [],
  runtimeHash: await digest(),
  rendererErrors: [],
};
let application, page;
const poll = async (read, predicate, label) => {
  for (let i = 0; i < 120; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error(`Timed out: ${label}`);
};
try {
  application = await _electron.launch({
    executablePath: binary,
    args: packaged ? [] : [root],
    cwd: root,
    env,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => result.rendererErrors.push(error.message));
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .waitFor();
  const api = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.showai.invoke(action, args), {
      action,
      args,
    });
  const a = await api("projects:create", { name: "Catalog project A" }),
    b = await api("projects:create", { name: "Catalog project B" });
  result.projectIds = [a.id, b.id];
  const original = await api("components:createExample", { projectId: a.id });
  const invoke = async (name) => {
    await page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name, exact: true })
      .click();
  };
  const noAlerts = async () =>
    assert.equal(
      await page.getByRole("alert").count(),
      0,
      await page.getByRole("alert").allTextContents(),
    );
  await invoke("组件");
  assert.equal(
    await page
      .getByRole("button", { name: "新建组件", exact: true })
      .isEnabled(),
    false,
  );
  await page.getByLabel("目录项目", { exact: true }).selectOption(a.id);
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: "数据图表 内置", exact: true }),
    })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", { name: "使用场景", exact: true })
    .waitFor();
  await dialog
    .getByRole("heading", { name: "可视化效果", exact: true })
    .waitFor();
  assert.ok((await dialog.locator(".catalog-documentation li").count()) >= 4);
  await dialog.getByRole("button", { name: "示例预览", exact: true }).click();
  await dialog.getByRole("region", { name: "y = x", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: "计数器 项目", exact: true }),
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "注册到全局", exact: true }).click();
  await poll(
    () => dialog.locator(".catalog-lineage").innerText(),
    (text) => text.includes("全局"),
    "global promotion visible",
  );
  const global = await api("components:get", {
    id: original.id,
    version: original.version,
    scope: "global",
    integrity: original.integrity,
    projectId: a.id,
  });
  assert.equal(global.integrity, original.integrity);
  const globalBefore = await readFile(
    join(
      home,
      "packages/components",
      global.id,
      global.version,
      "compiled.json",
    ),
    "utf8",
  );
  await page.screenshot({
    path: join(output, "global-immutable.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByLabel("目录项目", { exact: true }).selectOption(b.id);
  await page
    .locator(".studio-component-card")
    .filter({
      has: page.getByRole("heading", { name: "计数器 全局", exact: true }),
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "定制组件", exact: true }).click();
  await dialog
    .getByLabel("组件名称", { exact: true })
    .fill("Project B counter");
  await dialog
    .getByLabel("组件效果", { exact: true })
    .fill("展示项目B自己的计数。\n保留对全局版本的派生关系。");
  await dialog
    .getByRole("button", { name: "保存项目新版本", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Project B counter", exact: true })
    .waitFor();
  const fork = await api("components:get", {
    id: original.id,
    version: "1.0.1",
    scope: "project",
    projectId: b.id,
  });
  assert.notEqual(fork.integrity, global.integrity);
  assert.equal(fork.parents[0].integrity, global.integrity);
  assert.equal(
    await readFile(
      join(
        home,
        "packages/components",
        global.id,
        global.version,
        "compiled.json",
      ),
      "utf8",
    ),
    globalBefore,
  );
  await noAlerts();
  await page.screenshot({
    path: join(output, "project-fork.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  result.checks.push(
    "Project is required for creation; metadata has bullet scenarios/effects/examples; explicit promotion freezes a global revision and B edits a separate project child",
  );
  const sourcePage = await api("pages:create", {
    projectId: b.id,
    title: "Composition source",
  });
  const document = {
    ...sourcePage.document,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A reusable nested section." }],
        },
        {
          type: "widget",
          attrs: {
            kind: "custom",
            data: {
              componentId: fork.id,
              version: fork.version,
              integrity: fork.integrity,
              props: { label: "Nested counter", value: 7 },
            },
          },
        },
      ],
    },
  };
  const child = await api("templates:save", {
    projectId: b.id,
    name: "Reusable section",
    description: "A child template with a project component",
    document,
    scenarios: ["Explain a nested result"],
    contentGuide: [
      {
        title: "Evidence",
        instructions: ["Keep the provided value and explain its meaning"],
      },
    ],
    related: [
      {
        kind: "component",
        id: fork.id,
        version: fork.version,
        purpose: "Present the supplied value",
      },
    ],
    examples: [],
  });
  result.childTemplate = {
    id: child.id,
    version: child.version,
    integrity: child.integrity,
  };
  await invoke("模板");
  await page.getByLabel("目录范围", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("模板名称", { exact: true }).fill("Combined report");
  await dialog
    .getByLabel("模板使用场景", { exact: true })
    .fill("Combine an introduction and a reusable section.");
  await dialog.getByRole("button", { name: "组合模板", exact: true }).click();
  await dialog
    .getByLabel("选择子模板", { exact: true })
    .selectOption({ label: `Reusable section · 项目 · ${child.version}` });
  await dialog.getByRole("button", { name: "添加部分", exact: true }).click();
  await dialog
    .getByLabel("组合部分 2 标题", { exact: true })
    .fill("Nested evidence");
  await page.screenshot({
    path: join(output, "template-composition.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "保存项目新版本", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const list = await api("templates:list", {
    projectId: b.id,
    scope: "project",
  });
  const parent = list.find((item) => item.name === "Combined report");
  assert.ok(parent);
  result.parentTemplate = {
    id: parent.id,
    version: parent.version,
    integrity: parent.integrity,
  };
  const card = page
    .locator(".studio-template-card")
    .filter({
      has: page.getByRole("heading", { name: "Combined report", exact: true }),
    });
  await card.getByRole("button", { name: /查看模板/ }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", { name: "内容处理方式", exact: true })
    .waitFor();
  await dialog
    .getByRole("heading", { name: "相关模板与组件", exact: true })
    .waitFor();
  await dialog.getByRole("button", { name: "注册到全局", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByLabel("目录项目", { exact: true }).selectOption(a.id);
  await page.getByLabel("目录范围", { exact: true }).selectOption("global");
  await poll(
    () =>
      page
        .locator(".studio-template-card")
        .filter({
          has: page.getByRole("heading", {
            name: "Combined report",
            exact: true,
          }),
        })
        .count(),
    (count) => count === 1,
    "global catalog filter settled",
  );
  await page
    .locator(".studio-template-card")
    .filter({
      has: page.getByRole("heading", { name: "Combined report", exact: true }),
    })
    .waitFor();
  await rename(
    join(home, "projects", b.id),
    join(output, "removed-source-project"),
  );
  await page
    .locator(".studio-template-card")
    .filter({
      has: page.getByRole("heading", { name: "Combined report", exact: true }),
    })
    .getByRole("button", { name: "使用模板", exact: true })
    .click();
  await page.getByRole("textbox", { name: "文档内容", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Nested evidence", exact: true })
    .waitFor();
  const frame = page.frameLocator('iframe[title="Project B counter"]');
  await poll(
    () => frame.getByRole("status").innerText(),
    (value) => value === "7",
    "nested exact component initial props",
  );
  await frame.getByRole("button", { name: "增加", exact: true }).click();
  await poll(
    () => frame.getByRole("status").innerText(),
    (value) => value === "8",
    "nested component interaction",
  );
  await page.locator(".studio-save-state.saved").waitFor();
  await noAlerts();
  await page.screenshot({
    path: join(output, "expanded-template.png"),
    fullPage: true,
    animations: "disabled",
  });
  const pages = await api("pages:list", { projectId: a.id });
  const created = pages.find((item) => item.title === "Combined report");
  assert.ok(created);
  const expanded = await api("pages:get", {
    projectId: a.id,
    pageId: created.id,
  });
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    node.content?.forEach(walk);
  };
  walk(expanded.document.content);
  const widget = nodes.find((node) => node.type === "widget");
  assert.equal(widget.attrs.data.integrity, fork.integrity);
  assert.equal(widget.attrs.data.props.value, 8);
  assert.ok(nodes.every((node) => node.type !== "template"));
  const ids = nodes
    .filter((node) => node.attrs?.id)
    .map((node) => node.attrs.id);
  assert.equal(new Set(ids).size, ids.length);
  result.checks.push(
    "UI composes a nested template; global promotion preserves its custom dependency closure; A applies it after B's source directory is removed, with locked identity and working props",
  );
  assert.deepEqual(result.rendererErrors, []);
  assert.equal(await digest(), result.runtimeHash);
  result.passed = true;
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  result.error = String(error?.stack || error);
  if (page)
    await page
      .screenshot({
        path: join(output, "failure.png"),
        fullPage: true,
        animations: "disabled",
      })
      .catch(() => {});
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.error(result.error);
  process.exitCode = 1;
} finally {
  if (application) await application.close();
}
