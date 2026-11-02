import { execFileSync, spawnSync } from "node:child_process";
// Exercises the real desktop catalog across two real project directories. The
// App's component and template views are read-only: revisions are written the
// way an Agent writes them, and the UI previews, inserts and applies them.
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { _electron } from "playwright-core";

// The smoke checks select controls by their Chinese labels.
process.env.SHOWAI_LANGUAGE ??= "zh-CN";
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
  const clickEmbeddedControl = async (selector, name) => {
    const host = page.locator(selector);
    await host.scrollIntoViewIfNeeded();
    let lastBounds = "",
      stableSince = Date.now();
    await poll(
      async () => {
        const next = JSON.stringify(await host.boundingBox());
        if (next !== lastBounds) {
          lastBounds = next;
          stableSince = Date.now();
        }
        return Date.now() - stableSince;
      },
      (elapsed) => elapsed > 250,
      "component geometry settled",
    );
    // Convert the local control rectangle through the actual parent transform.
    // The iframe locator's automatic click omits this ancestor scale in Electron.
    const outer = await host.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        sx: rect.width / element.offsetWidth,
        sy: rect.height / element.offsetHeight,
      };
    });
    const inner = await page
      .frameLocator(selector)
      .getByRole("button", { name, exact: true })
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
    await page.mouse.click(
      outer.x + inner.x * outer.sx,
      outer.y + inner.y * outer.sy,
    );
  };
  const a = await api("projects:create", { name: "Catalog project A" }),
    b = await api("projects:create", { name: "Catalog project B" });
  result.projectIds = [a.id, b.id];
  const original = await api("components:createExample", { projectId: a.id });
  // An exact revision as an Agent copies it from a catalog result.
  const exactRef = (item, owner, kind = "component") => ({
    kind,
    id: item.id,
    version: item.version,
    integrity: item.integrity,
    scope: item.scope,
    ...(item.scope === "project" ? { projectId: owner } : {}),
  });
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
  const componentCard = (name, scope) =>
    page
      .locator(".studio-component-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .filter({
        has: page
          .locator(".component-card-metadata")
          .getByText(scope, { exact: true }),
      });
  const closeDialog = () =>
    page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await invoke("组件");
  await componentCard("数据图表", "内置").click();
  let dialog = page.getByRole("dialog", { name: "数据图表", exact: true });
  await dialog
    .getByRole("region", { name: "组件示例预览", exact: true })
    .waitFor();
  await dialog
    .getByRole("heading", { name: "适用场景", exact: true })
    .waitFor();
  await dialog.getByRole("heading", { name: "可调整", exact: true }).waitFor();
  // The App catalog only inserts into an open page; with none open the action
  // stays visible, disabled, and says why.
  const insert = dialog.getByRole("button", {
    name: "插入到页面",
    exact: true,
  });
  assert.equal(await insert.isEnabled(), false);
  await dialog.getByText("先打开一个页面", { exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "chart-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("tab", { name: "使用说明", exact: true }).click();
  await dialog.locator(".catalog-component-guide").waitFor();
  assert.ok(
    (await dialog.locator(".catalog-component-guide h3").count()) >= 2,
    "builtin chart documentation lists its sections",
  );
  await closeDialog();
  await componentCard("富文本", "内置").click();
  dialog = page.getByRole("dialog", { name: "富文本", exact: true });
  await dialog
    .getByRole("heading", { name: "让内容更容易理解", exact: true })
    .waitFor();
  await page.screenshot({
    path: join(output, "text-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByLabel("组件示例", { exact: true }).selectOption("2");
  await dialog
    .locator(".sb-text p")
    .filter({ hasText: "记录一个想法。" })
    .waitFor();
  await page.setViewportSize({ width: 700, height: 850 });
  const previewBox = await dialog
      .locator(".catalog-live-example")
      .boundingBox(),
    infoBox = await dialog.locator(".catalog-info-panel").boundingBox();
  assert.ok(
    infoBox.x >= previewBox.x + previewBox.width - 1 &&
      infoBox.x + infoBox.width <= 700,
    "narrow overview keeps the preview and its explanation side by side within the window",
  );
  await page.screenshot({
    path: join(output, "text-overview-narrow.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1280, height: 960 });
  await closeDialog();
  result.checks.push(
    "builtin chart and text details share one responsive preview with scenarios and documentation; insertion stays disabled until a page is open",
  );

  // Components are written by Agents; the App catalog reads what they saved.
  const text = await api("components:get", { id: "text", scope: "builtin" });
  const customText = await api("components:save", {
    projectId: a.id,
    manifest: {
      id: "my-text",
      name: "定制文本框",
      version: "1.0.0",
      description: "A native text variant with a fixed color",
      entry: "index.tsx",
      scenarios: ["Highlighted notes"],
      defaultData: text.examples[1].data,
      examples: [],
    },
    schema: text.propsSchema,
    source:
      'import {Text} from "showai:components";export default function MyText({data,onChange,readOnly}){return <Text data={{...data,color:"#194a2a"}} onChange={onChange} readOnly={readOnly}/>}',
  });
  assert.equal(customText.scope, "project");
  await page.getByLabel("目录项目", { exact: true }).selectOption(a.id);
  await componentCard("定制文本框", "项目").click();
  dialog = page.getByRole("dialog", { name: "定制文本框", exact: true });
  await dialog
    .frameLocator('iframe[title="定制文本框"]')
    .getByRole("heading", { name: "让内容更容易理解", exact: true })
    .waitFor();
  await closeDialog();
  result.checks.push(
    "a native text variant saved for project A appears in A's catalog and previews through the real compiler",
  );

  const global = await api("catalog:promote", {
    projectId: a.id,
    ref: exactRef(original, a.id),
  });
  assert.equal(global.scope, "global");
  assert.equal(global.integrity, original.integrity);
  const globalCompiled = join(
    home,
    "workspace/packages/components",
    global.id,
    global.version,
    "compiled.json",
  );
  const globalBefore = await readFile(globalCompiled, "utf8");
  const fork = await api("catalog:fork", {
    projectId: b.id,
    ref: exactRef(global),
    version: "1.0.1",
    name: "Project B counter",
  });
  assert.equal(fork.scope, "project");
  assert.notEqual(fork.integrity, global.integrity);
  assert.equal(fork.parents[0].integrity, global.integrity);
  assert.equal(await readFile(globalCompiled, "utf8"), globalBefore);
  await page.getByLabel("目录项目", { exact: true }).selectOption(b.id);
  await componentCard("计数器", "全局").click();
  dialog = page.getByRole("dialog", { name: "计数器", exact: true });
  await dialog
    .frameLocator('iframe[title="计数器"]')
    .getByRole("status")
    .waitFor();
  await page.screenshot({
    path: join(output, "global-immutable.png"),
    fullPage: true,
    animations: "disabled",
  });
  await closeDialog();
  await componentCard("Project B counter", "项目").click();
  dialog = page.getByRole("dialog", { name: "Project B counter", exact: true });
  await dialog
    .frameLocator('iframe[title="Project B counter"]')
    .getByRole("status")
    .waitFor();
  await noAlerts();
  await page.screenshot({
    path: join(output, "project-fork.png"),
    fullPage: true,
    animations: "disabled",
  });
  await closeDialog();
  result.checks.push(
    "explicit promotion freezes a global revision that B's catalog lists; B's fork is a separate project child and the global files stay unchanged",
  );
  const sourcePage = await api("pages:create", {
    projectId: b.id,
    title: "Composition source",
  });
  const {
    layout: legacyLayout,
    views: legacyViews,
    surfaceViews: legacySurfaceViews,
    ...legacyMetadata
  } = sourcePage.document;
  const document = {
    ...legacyMetadata,
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
  const composed = await api("templates:save", {
    projectId: b.id,
    name: "Combined report",
    description: "An introduction followed by a reusable section",
    scenarios: ["Combine an introduction and a reusable section."],
    composition: [
      {
        type: "content",
        content: {
          type: "paragraph",
          content: [{ type: "text", text: "Introduction." }],
        },
      },
      {
        type: "template",
        ref: exactRef(child, b.id, "template"),
        title: "Nested evidence",
      },
    ],
  });
  const parent = (
    await api("templates:list", { projectId: b.id, scope: "project" })
  ).find((item) => item.name === "Combined report");
  assert.equal(parent.integrity, composed.integrity);
  result.parentTemplate = {
    id: parent.id,
    version: parent.version,
    integrity: parent.integrity,
  };
  await invoke("模板");
  await page.getByLabel("目录项目", { exact: true }).selectOption(b.id);
  await page.getByLabel("目录范围", { exact: true }).selectOption("project");
  const templateCard = page.getByRole("button", {
    name: /^查看模板 Combined report /,
  });
  await templateCard.click();
  dialog = page.getByRole("dialog", { name: "Combined report", exact: true });
  await dialog
    .getByRole("region", { name: "模板示例预览", exact: true })
    .waitFor();
  await dialog
    .frameLocator('iframe[title="Project B counter"]')
    .getByRole("status")
    .filter({ hasText: "7" })
    .waitFor();
  await page.screenshot({
    path: join(output, "template-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await closeDialog();
  await api("catalog:promote", {
    projectId: b.id,
    ref: exactRef(parent, b.id, "template"),
  });
  await rename(
    join(home, "workspace", "projects", b.id),
    join(output, "removed-source-project"),
  );
  // The workspace drops the removed project, including its open catalog view.
  await page
    .locator(`.studio-sidebar .studio-tree-row[data-library-id="${b.id}"]`)
    .waitFor({ state: "detached" });
  await invoke("模板");
  await page.getByLabel("目录项目", { exact: true }).selectOption(a.id);
  await page.getByLabel("目录范围", { exact: true }).selectOption("global");
  await poll(
    () => templateCard.count(),
    (count) => count === 1,
    "global catalog filter settled",
  );
  await templateCard.click();
  dialog = page.getByRole("dialog", { name: "Combined report", exact: true });
  const pagesBefore = new Set(
    (await api("pages:list", { projectId: a.id })).map((item) => item.id),
  );
  await dialog
    .getByRole("button", { name: "用此模板新建页面", exact: true })
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
  await clickEmbeddedControl('iframe[title="Project B counter"]', "增加");
  await poll(
    () => frame.getByRole("status").innerText(),
    (value) => value === "8",
    "nested component interaction",
  );
  await page.locator(".studio-save-state.is-saved:not(.is-faded)").waitFor();
  await noAlerts();
  await page.screenshot({
    path: join(output, "expanded-template.png"),
    fullPage: true,
    animations: "disabled",
  });
  const created = (await api("pages:list", { projectId: a.id })).filter(
    (item) => !pagesBefore.has(item.id),
  );
  assert.equal(created.length, 1);
  const [{ id: createdId }] = created;
  const expanded = await api("pages:get", {
    projectId: a.id,
    pageId: createdId,
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
    "the template view previews a nested composition; global promotion preserves its custom dependency closure; A creates a page from it after B's source directory is removed, with locked identity and working props",
  );

  const childRef = {
    kind: "component",
    id: original.id,
    version: original.version,
    integrity: original.integrity,
  };
  const nestedSchema = {
    type: "object",
    properties: { counter: original.schema },
    required: ["counter"],
    additionalProperties: false,
  };
  const panel = await api("components:save", {
    projectId: a.id,
    manifest: {
      id: "nested-panel",
      name: "嵌套面板",
      version: "1.0.0",
      description: "Text and a nested counter",
      entry: "index.tsx",
      scenarios: ["Composition"],
      dependencies: [childRef],
      defaultData: { counter: original.defaultData },
      examples: [],
    },
    schema: nestedSchema,
    source: `import Counter from "showai:component/${original.id}";import {Text} from "showai:components";export default function Panel({data,onChange,readOnly}){return <section><Text data={{content:"## 组合中的文本"}} readOnly/><Counter data={data.counter} readOnly={readOnly} onChange={counter=>onChange?.({...data,counter})}/></section>}`,
  });
  const latest = await api("pages:get", {
    projectId: a.id,
    pageId: createdId,
  });
  await api("pages:save", {
    projectId: a.id,
    pageId: createdId,
    baseHash: latest.hash,
    baseRevision: latest.revision,
    document: {
      ...latest.document,
      content: {
        ...latest.document.content,
        content: [
          ...latest.document.content.content,
          {
            type: "widget",
            attrs: {
              kind: "custom",
              data: {
                componentId: panel.id,
                version: panel.version,
                integrity: panel.integrity,
                props: panel.defaultData,
              },
            },
          },
        ],
      },
    },
  });
  // The open editor keeps its own draft; reloading reopens the saved page.
  await page.reload();
  const panelFrame = page.frameLocator('iframe[title="嵌套面板"]');
  await panelFrame
    .getByRole("heading", { name: "组合中的文本", exact: true })
    .waitFor();
  assert.equal(await panelFrame.locator("iframe").count(), 0);
  await clickEmbeddedControl('iframe[title="嵌套面板"]', "增加");
  await poll(
    () => panelFrame.getByRole("status").innerText(),
    (value) => value === "1",
    "composed child update",
  );
  await page.locator(".studio-save-state.is-saved:not(.is-faded)").waitFor();
  await poll(
    async () => {
      const edited = await api("pages:get", {
        projectId: a.id,
        pageId: createdId,
      });
      return edited.document.content.content.find(
        (node) => node.attrs?.data?.componentId === panel.id,
      )?.attrs.data.props.counter.value;
    },
    (value) => value === 1,
    "composed data persisted to disk",
  );
  const exported = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(root, "dist-agent/cli.mjs"),
        "export",
        "--project",
        a.id,
        "--page",
        createdId,
        "--format",
        "html",
        "--out",
        join(output, "nested.html"),
        "--json",
      ],
      { env, encoding: "utf8" },
    ),
  ).data;
  result.nestedExport = exported;
  const offlineOpened = application.waitForEvent("window");
  await application.evaluate(async ({ BrowserWindow }, path) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    await window.loadFile(path);
  }, exported.path);
  const offlinePage = await offlineOpened;
  await offlinePage
    .frameLocator('iframe[title="嵌套面板"]')
    .getByRole("heading", { name: "组合中的文本", exact: true })
    .waitFor();
  assert.equal(
    await offlinePage
      .frameLocator('iframe[title="嵌套面板"]')
      .getByRole("status")
      .innerText(),
    "1",
  );
  const compact = await api("pages:create", {
    projectId: a.id,
    document: {
      id: "nested-inline",
      title: "组件嵌套示例",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              kind: "custom",
              data: {
                componentId: panel.id,
                version: panel.version,
                integrity: panel.integrity,
                props: { counter: { ...original.defaultData, value: 1 } },
              },
            },
          },
        ],
      },
    },
  });
  const inlineResult = spawnSync(
    process.execPath,
    [
      join(root, "dist-agent/cli.mjs"),
      "export",
      "--project",
      a.id,
      "--page",
      compact.document.id,
      "--format",
      "inline",
      "--out",
      join(output, "nested-inline.html"),
      "--json",
    ],
    { env, encoding: "utf8" },
  );
  const inlineResponse = JSON.parse(inlineResult.stdout);
  if (inlineResult.status !== 0) {
    assert.equal(inlineResponse.ok, false);
    assert.match(inlineResponse.error.message, /chat preview is .*; limit is/);
    await assert.rejects(access(join(output, "nested-inline.html")), {
      code: "ENOENT",
    });
    result.checks.push(
      "oversize inline delivery rejects before writing output and points to the verified standalone HTML",
    );
  } else {
    const inlineExport = inlineResponse.data;
    const inlineOpened = application.waitForEvent("window");
    await application.evaluate(async ({ BrowserWindow }, path) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, sandbox: true },
      });
      await window.loadFile(path);
    }, inlineExport.path);
    const inlinePage = await inlineOpened;
    await inlinePage
      .getByRole("heading", { name: "组合中的文本", exact: true })
      .waitFor();
    assert.equal(await inlinePage.locator("iframe").count(), 0);
    result.inlineExportBytes = inlineExport.bytes;
  }

  await page.screenshot({
    path: join(output, "nested-component.png"),
    fullPage: true,
    animations: "disabled",
  });
  result.checks.push(
    "code composition renders builtin text and an exact custom child in one sandbox; child edits save to parent props and offline HTML export succeeds",
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
