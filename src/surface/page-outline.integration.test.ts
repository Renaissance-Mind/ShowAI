import { existsSync } from "node:fs";
import { startCdnHost } from "../portable/cdn-test-host";
import { toCdnFragment } from "../portable/cdn-fragment.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { openLibrary } from "../core/open-library";
import { FileStore } from "../core/store";
import {
  blankDocument,
  importComponent,
  resolveDocumentComponents,
} from "../core/catalog";
import { createResource } from "./containers.mjs";
import { defaultPageOutline } from "./page-outline.mjs";
import { startBrowserServer } from "../browser/server";
import { buildPageHtml } from "../agent/exporter";
import type { ContainerDocument } from "../types";
import type { CompiledComponent } from "../components/custom/types";

let directory: string,
  home: string,
  store: FileStore,
  projectId: string,
  pageId: string;
let browser: Browser, server: Awaited<ReturnType<typeof startBrowserServer>>;
const compiled: CompiledComponent[] = [];
let cdnHost: Awaited<ReturnType<typeof startCdnHost>>;
function makeDocument(): ContainerDocument {
  const doc = createResource(blankDocument());
  doc.title = "Outline acceptance Page";
  doc.surfaceViews = {};
  doc.content.content = ["Background", "Methods", "Results"].flatMap(
    (title, index) => [
      {
        type: "heading",
        attrs: { id: `chapter-${index}`, level: 1 },
        content: [{ type: "text", text: title }],
      },
      {
        type: "heading",
        attrs: { id: `section-${index}`, level: 2 },
        content: [{ type: "text", text: `Details ${index + 1}` }],
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        type: "paragraph",
        attrs: { id: `p-${index}-${i}` },
        content: [
          {
            type: "text",
            text: "This report explains content structure, navigation and visual presentation. ".repeat(
              3,
            ),
          },
        ],
      })),
    ],
  );
  return doc;
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-outline-ui-"));
  home = join(directory, "library");
  await openLibrary(home);
  store = new FileStore(home);
  projectId = (await store.createProject({ name: "Outline acceptance" })).id;
  for (const name of ["page-outline-index", "page-outline-path"])
    compiled.push(
      await importComponent(home, resolve("examples", name), projectId),
    );
  pageId = (await store.createPage(projectId, { document: makeDocument() }))
    .document.id;
  server = await startBrowserServer({
    home,
    webRoot: resolve("dist-runtime/web"),
    cliEntry: resolve("dist-runtime/scripts/cli.mjs"),
    settingsPath: join(directory, "settings.json"),
    registerAgentRuntime: false,
  });
  cdnHost = await startCdnHost(resolve("dist-cdn"));
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.SHOWAI_BROWSER_EXECUTABLE ||
      (process.platform === "darwin" &&
      existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
}, 60000);
afterAll(async () => {
  await browser?.close();
  await server?.close();
  await cdnHost?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("Page outline in the real workbench and standalone reader", () => {
  it("enables and disables through native settings, saves and undoes without changing content order", async () => {
    const page = await browser.newPage({
        viewport: { width: 2100, height: 1000 },
      }),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.url + `?project=${projectId}&page=${pageId}`);
    page.setDefaultTimeout(10000);
    if (
      !(await page
        .getByRole("button", { name: "页面操作", exact: true })
        .count())
    ) {
      const expand = page.getByRole("button", {
        name: "展开Outline acceptance",
        exact: true,
      });
      if (await expand.count()) await expand.click();
      await page
        .getByText("Outline acceptance Page", { exact: true })
        .first()
        .click();
    }
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "目录设置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "目录设置" });
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    const panel = page.locator(".page-outline-panel");
    await panel.waitFor();
    await expect
      .poll(
        async () =>
          (await store.readPage(projectId, pageId)).document.content.attrs
            ?.outline?.enabled,
      )
      .toBe(true);
    expect(await panel.getAttribute("data-placement")).toBe("margin");
    await panel.getByRole("button", { name: "Methods", exact: true }).click();
    await expect
      .poll(() =>
        page.locator(".container-page.is-root").evaluate((el) => el.scrollTop),
      )
      .toBeGreaterThan(200);
    const before = (await store.readPage(projectId, pageId)).hash;
    await panel.getByRole("button", { name: "收起目录", exact: true }).click();
    await page.getByRole("button", { name: "展开目录", exact: true }).click();
    await panel.getByRole("button", { name: "固定目录", exact: true }).click();
    await expect
      .poll(() => panel.getAttribute("data-placement"))
      .toBe("docked");
    await page.setViewportSize({ width: 500, height: 900 });
    await expect
      .poll(() => panel.getAttribute("data-placement"))
      .toBe("drawer");
    await panel.getByRole("button", { name: "Results", exact: true }).click();
    await expect.poll(() => panel.isVisible()).toBe(false);
    expect((await store.readPage(projectId, pageId)).hash).toBe(before);
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.getByRole("button", { name: "展开目录", exact: true }).click();
    await panel.getByRole("button", { name: "目录设置", exact: true }).click();
    await dialog
      .getByLabel("目录组件", { exact: true })
      .selectOption({ label: "阅读索引 · 1.0.0" });
    await dialog
      .getByLabel("组件参数（JSON）", { exact: true })
      .fill('{"numbering":true,"indent":2}');
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect
      .poll(() => dialog.getByRole("alert").textContent())
      .toContain("must be >= 8");
    await dialog
      .getByLabel("组件参数（JSON）", { exact: true })
      .fill('{"numbering":true,"indent":16}');
    await dialog.getByLabel("目录内容", { exact: true }).selectOption("manual");
    await dialog
      .getByRole("textbox", { name: "显示名称", exact: true })
      .first()
      .fill("Start here");
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await panel
      .frameLocator("iframe")
      .locator(".index-link")
      .filter({ hasText: "Start here" })
      .waitFor();
    await expect
      .poll(
        async () =>
          (await store.readPage(projectId, pageId)).document.content.attrs
            ?.outline?.renderer?.componentId,
      )
      .toBe("page-outline-index");
    expect(
      (await store.readPage(projectId, pageId)).document.content.content![0]
        .content![0].text,
    ).toBe("Background");
    await panel.getByRole("button", { name: "目录设置", exact: true }).click();
    await dialog.getByLabel("启用本页目录").uncheck();
    await dialog.getByRole("button", { name: "应用", exact: true }).click();
    await expect
      .poll(() => page.locator(".page-outline-panel").count())
      .toBe(0);
    expect(await page.locator(".page-outline-rail").count()).toBe(0);
    await expect
      .poll(
        async () =>
          (await store.readPage(projectId, pageId)).document.content.attrs
            ?.outline?.enabled,
      )
      .toBe(false);
    await page.getByRole("button", { name: "撤销操作", exact: true }).click();
    await expect
      .poll(() => page.locator(".page-outline-panel").count())
      .toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  }, 60000);
  for (const componentIndex of [0, 1])
    it(`runs custom directory protocol ${componentIndex + 1} inside the exported sandbox and responds to live state`, async () => {
      const doc = makeDocument(),
        component = compiled[componentIndex];
      doc.content.attrs!.outline = {
        ...defaultPageOutline(),
        initialState: "expanded",
        renderer: {
          componentId: component.id,
          version: component.version,
          integrity: component.integrity,
          props: component.defaultData,
        },
      };
      const components = await resolveDocumentComponents(home, doc, projectId);
      const path = join(directory, `reader-${componentIndex}.html`);
      await writeFile(
        path,
        await buildPageHtml(
          doc,
          resolve("dist-portable/portable.html"),
          components,
        ),
      );
      const page = await browser.newPage({
          viewport: { width: 1700, height: 950 },
        }),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("file://" + path);
      const panel = page.locator(".page-outline-panel");
      await panel.waitFor();
      const frame = panel.frameLocator("iframe");
      await frame
        .locator(componentIndex === 0 ? ".index-link" : ".path-link")
        .filter({ hasText: "Methods" })
        .click();
      await expect
        .poll(() =>
          page
            .locator(".container-page.is-root")
            .evaluate((el) => el.scrollTop),
        )
        .toBeGreaterThan(200);
      await expect
        .poll(() => frame.locator('[aria-current="location"]').textContent())
        .toContain("Methods");
      const branch = frame.getByRole("button", {
        name: "收起Background",
        exact: true,
      });
      await branch.click();
      await expect
        .poll(() => frame.getByRole("button", { name: /Details 1/ }).count())
        .toBe(0);
      await frame
        .getByRole("button", { name: "展开Background", exact: true })
        .click();
      await frame.getByRole("button", { name: /Details 1/ }).waitFor();
      const old = await page.locator("script#showai-data").textContent();
      await frame
        .locator(componentIndex === 0 ? ".index-link" : ".path-link")
        .first()
        .press("Escape");
      await expect.poll(() => panel.isVisible()).toBe(false);
      await page.getByRole("button", { name: "展开目录", exact: true }).click();
      await panel
        .getByRole("button", { name: "收起目录", exact: true })
        .click();
      await page.getByRole("button", { name: "展开目录", exact: true }).click();
      expect(await page.locator("script#showai-data").textContent()).toBe(old);
      await page.setViewportSize({ width: 360, height: 800 });
      await expect
        .poll(() => panel.getAttribute("data-placement"))
        .toBe("drawer");
      await frame
        .locator(componentIndex === 0 ? ".index-link" : ".path-link")
        .filter({ hasText: "Results" })
        .click();
      await expect.poll(() => panel.isVisible()).toBe(false);
      expect(errors).toEqual([]);
      await page.close();
    }, 45000);
  it("adapts standard/wide/full layouts without covering the standard column, preserves custom component failures", async () => {
    const doc = makeDocument();
    doc.content.attrs!.outline = {
      ...defaultPageOutline(),
      initialState: "expanded",
    };
    for (const mode of ["standard", "wide", "full"]) {
      doc.content.attrs!.widthMode = mode;
      const path = join(directory, `width-${mode}.html`);
      await writeFile(
        path,
        await buildPageHtml(doc, resolve("dist-portable/portable.html")),
      );
      const page = await browser.newPage({
        viewport: { width: 1800, height: 1000 },
      });
      await page.goto("file://" + path);
      page.setDefaultTimeout(5000);
      const panel = page.locator(".page-outline-panel");
      await panel.waitFor();
      await expect
        .poll(() => panel.getAttribute("data-placement"))
        .toBe(mode === "standard" ? "margin" : "floating");
      if (mode === "standard") {
        const bounds = await page.evaluate(() => ({
          column: document
            .querySelector(".container-page-column")!
            .getBoundingClientRect().right,
          panel: document
            .querySelector(".page-outline-panel")!
            .getBoundingClientRect().left,
        }));
        expect(bounds.panel).toBeGreaterThanOrEqual(bounds.column);
      }
      await page.close();
    }
    doc.content.attrs!.outline.renderer = {
      componentId: "missing-outline",
      version: "1.0.0",
      integrity: "sha256-" + "1".repeat(64),
      props: {},
    };
    const path = join(directory, "fallback.html");
    await writeFile(
      path,
      await buildPageHtml(doc, resolve("dist-portable/portable.html")),
    );
    const page = await browser.newPage();
    await page.goto("file://" + path);
    await page.getByText("自定义目录组件未能加载，已使用默认目录").waitFor();
    await page.getByRole("button", { name: "Methods", exact: true }).waitFor();
    await page.close();
    const component = compiled[0];
    doc.content.attrs!.outline.renderer = {
      componentId: component.id,
      version: component.version,
      integrity: component.integrity,
      props: component.defaultData,
    };
    const broken = { ...component, html: "<p>Broken bootstrap</p>" };
    const brokenPath = join(directory, "broken-renderer.html");
    await writeFile(
      brokenPath,
      await buildPageHtml(doc, resolve("dist-portable/portable.html"), [
        broken,
      ]),
    );
    const recovery = await browser.newPage();
    await recovery.goto("file://" + brokenPath);
    await recovery
      .getByText("自定义目录组件未能加载，已使用默认目录", { exact: false })
      .waitFor();
    await recovery
      .getByRole("button", { name: "Methods", exact: true })
      .waitFor();
    await recovery
      .getByRole("button", { name: "收起目录", exact: true })
      .click();
    expect(await recovery.locator(".page-outline-panel").isVisible()).toBe(
      false,
    );
    await recovery.close();
  }, 45000);
  it("runs the directory component in a conversation CDN reader without nested iframes", async () => {
    const doc = makeDocument(),
      component = compiled[0];
    doc.content.attrs!.outline = {
      ...defaultPageOutline(),
      initialState: "expanded",
      renderer: {
        componentId: component.id,
        version: component.version,
        integrity: component.integrity,
        props: component.defaultData,
      },
    };
    const html = await buildPageHtml(
      doc,
      resolve("dist-portable/portable.html"),
      [component],
    );
    const manifest = JSON.parse(
      await readFile(resolve("dist-cdn/manifest.json"), "utf8"),
    );
    const page = await browser.newPage({
      viewport: { width: 1200, height: 1000 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      cdnHost.host(
        "/outline",
        toCdnFragment(html, {
          readerUrl: `${cdnHost.origin}/${manifest.entry}`,
        }),
      ),
    );
    const frame = page.frameLocator("iframe"),
      panel = frame.locator(".page-outline-panel");
    await panel.locator(".reading-index").waitFor();
    expect(await panel.locator("iframe").count()).toBe(0);
    await panel.locator(".index-link").filter({ hasText: "Methods" }).click();
    await expect
      .poll(() =>
        frame.locator(".container-page.is-root").evaluate((el) => el.scrollTop),
      )
      .toBeGreaterThan(200);
    await expect
      .poll(() => panel.locator('[aria-current="location"]').textContent())
      .toContain("Methods");
    await panel.getByRole("button", { name: "收起目录", exact: true }).click();
    await frame.getByRole("button", { name: "展开目录", exact: true }).click();
    expect(errors).toEqual([]);
    await page.close();
  }, 45000);
});
