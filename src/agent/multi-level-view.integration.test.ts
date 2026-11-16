import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import catalog from "../../resources/catalog/components.json";
import { buildReaderSource } from "../../scripts/build-reader-source.mjs";
import { bundleReader } from "../portable/reader-bundle.mjs";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import { createResource } from "../document/containers.mjs";
import {
  blankDocument,
  importComponent,
  componentWidgetData,
  resolveDocumentComponents,
  readBuiltinComponentSource,
  saveComponent,
} from "../core/catalog";
import { FileStore } from "../core/store";

let root: string, origin: string, server: Server, browser: Browser;
let original: string;
const outputs = new Map<string, string>();
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-multilevel-native-"));
  const runtime = join(root, "runtime");
  await mkdir(join(runtime, "assets"), { recursive: true });
  await symlink(
    resolve("node_modules"),
    join(runtime, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const archive = join(runtime, "assets/reader-source.json");
  await buildReaderSource(resolve("."), archive);
  const document = createResource(blankDocument());
  document.title = "多级组件视图";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        id: "levels",
        kind: "multi-level-view",
        data: catalog.find((c) => c.kind === "multi-level-view")!.defaultData,
      },
    },
  ];
  document.surfaceViews[document.content.attrs!.id].readingOrder = ["levels"];
  original = JSON.stringify(document);
  await writeFile(join(root, "source.json"), original);
  const html = injectArtifactIntoHtml(
    await bundleReader(archive, [document]),
    document,
  );
  const inline = toInlineFragment(html);
  expect(Buffer.byteLength(inline)).toBeLessThan(1_000_000);
  outputs.set("/", html);
  outputs.set("/inline", `<!doctype html><meta charset="utf-8">${inline}`);
  if (process.env.SHOWAI_MULTILEVEL_EVIDENCE) {
    await mkdir(process.env.SHOWAI_MULTILEVEL_EVIDENCE, { recursive: true });
    await writeFile(
      join(process.env.SHOWAI_MULTILEVEL_EVIDENCE, "native.html"),
      html,
    );
    await writeFile(
      join(process.env.SHOWAI_MULTILEVEL_EVIDENCE, "native.inline.html"),
      inline,
    );
  }
  const mixed = createResource(blankDocument());
  mixed.content.content = [
    {
      type: "widget",
      attrs: {
        id: "mixed",
        kind: "multi-level-view",
        data: catalog.find((c) => c.kind === "multi-level-view")!.examples[1]
          .data,
      },
    },
  ];
  mixed.surfaceViews[mixed.content.attrs!.id].readingOrder = ["mixed"];
  const mixedHtml = injectArtifactIntoHtml(
    await bundleReader(archive, [mixed]),
    mixed,
  );
  outputs.set("/mixed", mixedHtml);
  outputs.set(
    "/mixed-inline",
    `<!doctype html><meta charset="utf-8">${toInlineFragment(mixedHtml)}`,
  );
  const home = join(root, "library"),
    store = new FileStore(home),
    project = await store.createProject({ name: "Custom activation" });
  const directory = join(root, "custom-source");
  await mkdir(directory);
  const manifest = {
    id: "level-links",
    name: "层级事件测试",
    version: "1.0.0",
    description: "真实编译的组件激活回归材料",
    entry: "index.jsx",
    scenarios: ["验证自定义组件的激活回调"],
    defaultData: {},
    examples: [{ name: "固定入口", data: {} }],
    documentation: {
      version: 2,
      reuse: {
        kind: "content-specific",
        owner: "reading-interaction-integration",
        boundaries: ["回归材料"],
      },
      usage: {
        purpose: "验证真实组件激活回调",
        structure: ["两个可点击的固定对象"],
        inputs: [],
        recipes: [{ title: "进入", steps: ["点击入口"] }],
        interactions: [
          {
            action: "点击对象",
            effect: "调用 onActivate，未绑定时显示本地反馈",
            persistence: "view",
          },
        ],
        constraints: ["无源数据编辑"],
        editing: { data: ["无参数"], implementation: ["维护测试场景"] },
      },
      development: {
        entryPoints: [{ path: "index.jsx", purpose: "真实 React 组件" }],
        architecture: ["使用 onActivate 回调"],
        extensionPoints: ["新增回归对象"],
        invariants: ["不写回数据"],
        verification: ["在实际读者中点击"],
      },
    },
  };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await writeFile(
    join(directory, "props.schema.json"),
    JSON.stringify({
      type: "object",
      additionalProperties: false,
      properties: {},
    }),
  );
  await writeFile(
    join(directory, "index.jsx"),
    `import React,{useState}from'react';export default function Links({onActivate}){const[feedback,setFeedback]=useState('');const activate=id=>{if(!onActivate?.({type:'item',scope:'items',id}))setFeedback('普通反馈已触发');};return <div><button type="button" onClick={()=>activate('open')}>打开详情</button><button type="button" onClick={()=>activate('other')}>普通反馈</button><p>{feedback}</p></div>;}`,
  );
  const component = await importComponent(home, directory, project.id);
  const custom = createResource(blankDocument());
  const content = {
    type: "doc",
    content: [
      {
        type: "widget",
        attrs: {
          id: "chooser-a",
          kind: "custom",
          data: componentWidgetData(component),
        },
      },
      {
        type: "widget",
        attrs: {
          id: "chooser-b",
          kind: "custom",
          data: componentWidgetData(component),
        },
      },
    ],
  };
  const branch = (id: string, text: string) => ({
    id,
    parentId: "root",
    label: text,
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
    bindings: [],
  });
  custom.content.content = [
    {
      type: "widget",
      attrs: {
        id: "custom-levels",
        kind: "multi-level-view",
        data: {
          title: "自定义层级",
          root: "root",
          levels: [
            {
              id: "root",
              parentId: null,
              label: "入口",
              content,
              bindings: [
                {
                  blockId: "chooser-a",
                  source: { type: "item", scope: "items", id: "open" },
                  to: "a",
                },
                {
                  blockId: "chooser-b",
                  source: { type: "item", scope: "items", id: "open" },
                  to: "b",
                },
              ],
            },
            branch("a", "第一个组件的详情"),
            branch("b", "第二个组件的详情"),
          ],
        },
      },
    },
  ];
  custom.surfaceViews[custom.content.attrs!.id].readingOrder = [
    "custom-levels",
  ];
  const components = await resolveDocumentComponents(home, custom, project.id);
  expect(components).toHaveLength(1);
  const customHtml = injectArtifactIntoHtml(
    await bundleReader(archive, [custom]),
    custom,
    components,
  );
  outputs.set("/custom", customHtml);
  outputs.set(
    "/custom-inline",
    `<!doctype html><meta charset="utf-8">${toInlineFragment(customHtml)}`,
  );
  const editableSource = readBuiltinComponentSource("multi-level-view");
  const editable = await saveComponent(
    home,
    {
      ...editableSource,
      manifest: { ...editableSource.manifest, id: "editable-levels" },
    },
    project.id,
  );
  const editablePage = createResource(blankDocument());
  editablePage.content.content = [
    {
      type: "widget",
      attrs: {
        id: "editable-levels",
        kind: "custom",
        data: componentWidgetData(
          editable,
          catalog.find((c) => c.kind === "multi-level-view")!.examples[1].data,
        ),
      },
    },
  ];
  editablePage.surfaceViews[editablePage.content.attrs!.id].readingOrder = [
    "editable-levels",
  ];
  outputs.set(
    "/editable",
    injectArtifactIntoHtml(
      await bundleReader(archive, [editablePage]),
      editablePage,
      [editable],
    ),
  );
  if (process.env.SHOWAI_MULTILEVEL_EVIDENCE) {
    await writeFile(
      join(process.env.SHOWAI_MULTILEVEL_EVIDENCE, "mixed.html"),
      mixedHtml,
    );
    await writeFile(
      join(process.env.SHOWAI_MULTILEVEL_EVIDENCE, "mixed.inline.html"),
      toInlineFragment(mixedHtml),
    );
  }
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(outputs.get(request.url || "/") || outputs.get("/"));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (root) await rm(root, { recursive: true, force: true });
});

test.each(["/", "/inline"])(
  "native reader %s activates nodes, isolates child state and preserves source",
  async (route) => {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 850 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin + route);
      await page.getByRole("button", { name: "业务服务", exact: true }).click();
      await page
        .getByRole("button", { name: "订单服务", exact: true })
        .press("Enter");
      await page
        .getByRole("button", { name: "校验请求", exact: true })
        .press("Enter");
      await page
        .getByRole("region", { name: "请求校验", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "商品与数量", exact: true })
        .click();
      await page
        .locator(".ly-panel")
        .getByText("检查商品是否有效、数量是否合法。", { exact: true })
        .waitFor();
      await page.locator(".mlv-view").press("Escape");
      await page
        .getByRole("region", { name: "下单流程", exact: true })
        .waitFor();
      await page.locator('.react-flow__node[data-id="reserve"]').click();
      await page
        .locator(".sf-detail")
        .getByText("为本次下单暂时保留可售数量。", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "软件系统", exact: true }).click();
      await page.getByRole("button", { name: "用户入口", exact: true }).click();
      expect(await page.locator(".ly-panel:not([data-empty])").count()).toBe(0);
      await page.getByRole("button", { name: "Web 应用", exact: true }).click();
      await page
        .locator(".ly-panel")
        .getByText("浏览、检索与订单操作。", { exact: true })
        .waitFor();
      expect(await readFile(join(root, "source.json"), "utf8")).toBe(original);
      expect(errors).toEqual([]);
      if (process.env.SHOWAI_MULTILEVEL_EVIDENCE)
        await page.screenshot({
          path: join(
            process.env.SHOWAI_MULTILEVEL_EVIDENCE,
            route === "/" ? "native.png" : "native-inline.png",
          ),
          fullPage: true,
        });
    } finally {
      await page.close();
    }
  },
  60000,
);

test("narrow dark reader keeps the level path usable", async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 850 },
    colorScheme: "dark",
  });

  try {
    await page.goto(origin + "/inline");
    await page.getByRole("button", { name: "业务服务", exact: true }).click();
    await page.getByRole("button", { name: "订单服务", exact: true }).click();
    await page.getByRole("button", { name: "校验请求", exact: true }).click();
    await page.getByRole("region", { name: "请求校验", exact: true }).waitFor();
    const bounds = await page.locator(".mlv").evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      viewport: innerWidth,
    }));
    expect(bounds.width).toBeLessThanOrEqual(bounds.viewport);
    if (process.env.SHOWAI_MULTILEVEL_EVIDENCE)
      await page.screenshot({
        path: join(
          process.env.SHOWAI_MULTILEVEL_EVIDENCE,
          "native-narrow-dark.png",
        ),
        fullPage: true,
      });
  } finally {
    await page.close();
  }
}, 60000);

test.each(["/mixed", "/mixed-inline"])(
  "generic content %s routes cards into a table, chart, prose and SVG",
  async (route) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + route);
      await page.getByRole("button", { name: /^表格/ }).click();
      await page.getByRole("table").waitFor();
      await page.getByText("稳定地引用一个对象", { exact: true }).waitFor();
      await page.getByRole("button", { name: "内容入口", exact: true }).click();
      await page.getByRole("button", { name: /^图表/ }).click();
      await page.locator(".sb-chart svg[role=img]").waitFor();
      await page.getByRole("button", { name: "内容入口", exact: true }).click();
      await page.getByRole("button", { name: /^文字/ }).click();
      await page
        .getByText("每层沿用原生内容模型，可以组合文字、图表、表格和组件。", {
          exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "内容入口", exact: true }).click();
      await page.getByRole("button", { name: /^示意图/ }).click();
      await page.locator(".sv-canvas svg").waitFor();
    } finally {
      await page.close();
    }
  },
  60000,
);

test.each(["/custom", "/custom-inline"])(
  "custom events %s preserve unbound feedback and scope identical targets to their widget",
  async (route) => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin + route);
      if (route.endsWith("inline")) {
        await page
          .getByRole("button", { name: "普通反馈", exact: true })
          .first()
          .click();
        await page.getByText("普通反馈已触发", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "打开详情", exact: true })
          .nth(1)
          .click();
      } else {
        await page
          .frameLocator("iframe")
          .first()
          .getByRole("button", { name: "普通反馈", exact: true })
          .click();
        await page
          .frameLocator("iframe")
          .first()
          .getByText("普通反馈已触发", { exact: true })
          .waitFor();
        await page
          .frameLocator("iframe")
          .nth(1)
          .getByRole("button", { name: "打开详情", exact: true })
          .click();
      }
      await page
        .getByRole("region", { name: "第二个组件的详情", exact: true })
        .waitFor();
      expect(
        await page.getByText("第一个组件的详情", { exact: true }).count(),
      ).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);

test("editable built-in source bundles its content renderers", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin + "/editable");
    const component = page.frameLocator("iframe");
    await component.getByRole("button", { name: /^表格/ }).click();
    await component.getByRole("table").waitFor();
    await component
      .getByRole("button", { name: "内容入口", exact: true })
      .click();
    await component.getByRole("button", { name: /^图表/ }).click();
    await component.locator(".sb-chart svg[role=img]").waitFor();
  } finally {
    await page.close();
  }
}, 60000);
