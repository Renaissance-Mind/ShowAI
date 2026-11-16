import { beforeAll, afterAll, expect, test } from "vitest";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright-core";
import { runtimeComponent } from "../test/runtime-component";
import { FileStore } from "../core/store";
import {
  saveComponent,
  componentWidgetData,
  blankDocument,
  resolveDocumentComponents,
  getComponent,
} from "../core/catalog";
import { createResource } from "../document/containers.mjs";
import { normalizeDocument } from "../core/diff";
import { remapSurfaceIds } from "../document/document.mjs";
import { buildReaderSource } from "../../scripts/build-reader-source.mjs";
import { bundleReader } from "../portable/reader-bundle.mjs";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import { AgentService } from "./service";
import { walk } from "../document/walk.mjs";

let directory: string, origin: string, browser: Browser, server: Server;
const pages = new Map<string, string>();
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-contract-runtime-"));
  const home = join(directory, "library"),
    store = new FileStore(home);
  const project = await store.createProject({ name: "声明驱动组件验收" });
  const source = runtimeComponent();
  const component = await saveComponent(home, source, project.id);
  const packageBytes = component.html;
  const reloaded = await getComponent(
    home,
    component.id,
    component.version,
    project.id,
  );
  expect(reloaded.html).toBe(packageBytes);
  const node = (id: string) => ({
    type: "widget",
    attrs: { id, kind: "custom", data: componentWidgetData(component) },
  });
  const document = createResource(blankDocument());
  document.title = "声明驱动组合";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        id: "levels",
        kind: "multi-level-view",
        data: {
          title: "新组件的通用联动",
          root: "root",
          levels: [
            {
              id: "root",
              parentId: null,
              label: "实验入口",
              content: {
                type: "doc",
                content: [node("first"), node("second")],
              },
              bindings: [
                {
                  blockId: "first",
                  event: "inspect",
                  source: {
                    type: "experiment",
                    scope: "experiments",
                    id: "open",
                  },
                  to: "first-detail",
                },
                {
                  blockId: "second",
                  event: "inspect",
                  source: {
                    type: "experiment",
                    scope: "experiments",
                    id: "open",
                  },
                  to: "second-detail",
                },
              ],
            },
            ...["first", "second"].map((id) => ({
              id: id + "-detail",
              parentId: "root",
              label: id + "结果",
              bindings: [],
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: id + "对象的详情" }],
                  },
                ],
              },
            })),
          ],
        },
      },
    },
  ];
  document.surfaceViews[document.content.attrs!.id].readingOrder = ["levels"];
  const normalized = normalizeDocument(document);
  const copied = remapSurfaceIds(normalized);
  const components = await resolveDocumentComponents(home, copied, project.id);
  expect(components).toHaveLength(1);
  expect(JSON.stringify(copied)).toContain("opaque-business-id");
  const reader = join(directory, "reader");
  await mkdir(join(reader, "assets"), { recursive: true });
  await symlink(
    resolve("node_modules"),
    join(reader, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const archive = join(reader, "assets/reader-source.json");
  await buildReaderSource(resolve("."), archive);
  const html = injectArtifactIntoHtml(
    await bundleReader(archive, [copied]),
    copied,
    components,
  );
  pages.set("/sandbox", html);
  pages.set(
    "/inline",
    `<!doctype html><meta charset="utf-8">${toInlineFragment(html)}`,
  );
  const fieldSource = runtimeComponent();
  fieldSource.manifest.version = "9.0.0";
  fieldSource.manifest.contract!.requires!.databaseField = 1;
  const fieldOnly = await saveComponent(home, fieldSource, project.id);
  const misplaced = createResource(blankDocument());
  misplaced.content.content = [
    {
      type: "widget",
      attrs: {
        id: "field-only",
        kind: "custom",
        data: componentWidgetData(fieldOnly),
      },
    },
  ];
  misplaced.surfaceViews[misplaced.content.attrs!.id].readingOrder = [
    "field-only",
  ];
  const missingHost = injectArtifactIntoHtml(
    await bundleReader(archive, [misplaced]),
    misplaced,
    [fieldOnly],
  );
  pages.set("/missing-sandbox", missingHost);
  pages.set(
    "/missing-inline",
    `<!doctype html><meta charset="utf-8">${toInlineFragment(missingHost)}`,
  );
  const agent = new AgentService({ root: home });
  const described = (await agent.catalogDescribe(component.id, {
    projectId: project.id,
    scope: "project",
    version: component.version,
    integrity: component.integrity,
    view: "contract",
  })) as any;
  expect(described.status).toBe("declared");
  expect(described.objects).toHaveLength(2);
  expect(described.contract.events[0].name).toBe("inspect");
  const saved = await store.createPage(project.id, { document: normalized });
  const instance = (await agent.catalogDescribe(component.id, {
    projectId: project.id,
    scope: "project",
    version: component.version,
    integrity: component.integrity,
    view: "contract",
    instance: { pageId: saved.document.id, blockId: "second" },
    objectLimit: 1,
  })) as any;
  expect(instance.objectsFrom).toBe("instance");
  expect(instance.objectTotal).toBe(2);
  expect(instance.nextObjectOffset).toBe(1);
  expect(instance.instance.pageHash).toBe(saved.hash);
  const changed = structuredClone(source);
  changed.manifest.version = "1.0.1";
  changed.manifest.contract!.events![0].name = "inspect-new";
  changed.source = changed.source.replace(
    ".emit('inspect'",
    ".emit('inspect-new'",
  );
  const newer = await saveComponent(home, changed, project.id);
  await expect(
    agent.applyPage(project.id, saved.document.id, {
      baseHash: saved.hash,
      operations: [
        {
          type: "component.ref.set",
          blockId: "second",
          version: newer.version,
          integrity: newer.integrity,
        },
      ],
    }),
  ).rejects.toThrow(/event|contract|declared/);
  expect((await store.readPage(project.id, saved.document.id)).hash).toBe(
    saved.hash,
  );
  expect(
    (await getComponent(home, component.id, component.version, project.id))
      .html,
  ).toBe(packageBytes);
  const migrated = structuredClone(saved.document);
  walk(
    migrated.content,
    (node) => {
      if (node.attrs?.id === "second")
        Object.assign(node.attrs.data, {
          version: newer.version,
          integrity: newer.integrity,
        });
      if (node.attrs?.kind === "multi-level-view")
        node.attrs.data.levels[0].bindings[1].event = "inspect-new";
    },
    { scope: "content" },
  );
  await agent.savePage(project.id, saved.document.id, migrated, saved.hash);
  const raw = {
    componentId: component.id,
    version: component.version,
    integrity: component.integrity,
    props: structuredClone(component.defaultData),
  };
  const created = await agent.createPage(project.id, {
    blocks: [
      { kind: "custom", data: raw },
      { kind: "custom", data: raw },
    ],
  });
  const opaque: string[] = [];
  walk(
    created.document.content,
    (node) => {
      if (node.attrs?.kind === "custom")
        opaque.push(node.attrs.data.props.business.content[0].attrs.id);
    },
    { scope: "content" },
  );
  expect(opaque).toEqual(["opaque-business-id", "opaque-business-id"]);
  const inserted = await agent.applyPage(project.id, created.document.id, {
    baseHash: created.hash,
    operations: [{ type: "component.insert", kind: "custom", data: raw }],
  });
  let instances = 0;
  walk(
    inserted.document.content,
    (node) => {
      if (node.attrs?.kind === "custom") {
        expect(node.attrs.data.contract.version).toBe(1);
        expect(node.attrs.data.props.business.content[0].attrs.id).toBe(
          "opaque-business-id",
        );
        instances++;
      }
    },
    { scope: "content" },
  );
  expect(instances).toBe(3);
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(pages.get(request.url!) ?? "");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
test.each(["sandbox", "inline"])(
  "new component works through declared contracts in %s",
  async (mode) => {
    const page = await browser.newPage({
      viewport: { width: 1050, height: 850 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin + "/" + mode);
      const first =
        mode === "sandbox"
          ? page.frameLocator("iframe").first()
          : page.locator(".portable-widget[data-widget-kind=custom]").first();
      await first
        .getByRole("button", { name: "普通对象", exact: true })
        .click();
      await first.getByText("普通反馈 unhandled", { exact: true }).waitFor();
      await first
        .getByRole("button", { name: "局部动作", exact: true })
        .click();
      await first.getByText("局部动作已执行", { exact: true }).waitFor();
      await first
        .getByRole("button", { name: "修改内容", exact: true })
        .click();
      await first.getByText(/^保存结果 unavailable/).waitFor();
      await first.locator(".sb-chart svg[role=img]").waitFor();
      const second =
        mode === "sandbox"
          ? page.frameLocator("iframe").nth(1)
          : page.locator(".portable-widget[data-widget-kind=custom]").nth(1);
      await second
        .getByRole("button", { name: "绑定对象", exact: true })
        .click();
      await page
        .getByRole("region", { name: "second结果", exact: true })
        .waitFor();
      expect(
        await page.getByText("first对象的详情", { exact: true }).count(),
      ).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  60000,
);
test.each(["sandbox", "inline"])(
  "missing required slot capability is visible in %s",
  async (mode) => {
    const page = await browser.newPage({ locale: "zh-CN" });
    try {
      await page.goto(origin + "/missing-" + mode);
      await page.getByText(/databaseField/).waitFor();
    } finally {
      await page.close();
    }
  },
  30000,
);
