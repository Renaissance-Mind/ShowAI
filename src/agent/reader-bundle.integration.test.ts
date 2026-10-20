import { beforeAll, afterAll, test, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import g2 from "../../resources/catalog/g2.json";
import components from "../../resources/catalog/components.json";
import diagrams from "../../resources/catalog/diagrams.json";
import { blankDocument } from "../core/catalog";
import { createResource, createSurface } from "../surface/containers.mjs";
import { addNode } from "../surface/editing";
import { FileStore } from "../core/store";
import { buildPageHtml, buildReaderTemplate, exportPage } from "./exporter";
import { CAPACITY } from "../portable/capacity.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import { readerKinds } from "../portable/reader-bundle.mjs";

let browser: Browser;
let server: Server;
let address: string;
const pages = new Map<string, string>();
beforeAll(async () => {
  server = createServer((request, response) => {
    const html = pages.get(request.url!);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html ?? "");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address();
  if (!port || typeof port === "string")
    throw new Error("Reader test server unavailable");
  address = `http://127.0.0.1:${port.port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
});

test("text documents exclude unused renderers, preserve source and remain readable offline", async () => {
  const doc = createResource(blankDocument());
  doc.title = "Dependency-scoped report";
  doc.content.content = [
    {
      type: "paragraph",
      attrs: { id: "evidence" },
      content: [{ type: "text", text: "A source-backed finding." }],
    },
  ];
  doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["evidence"];
  const full = await readFile(resolve("dist-portable/portable.html"), "utf8");
  const html = await buildPageHtml(doc);
  expect(Buffer.byteLength(html)).toBeLessThan(Buffer.byteLength(full) / 3);
  expect(html).not.toContain("Visual Basic .NET");
  expect(readerKinds([doc])).toEqual([]);
  pages.set("/text", html);
  const page = await browser.newPage();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(address + "/text");
  await page.getByText("A source-backed finding.", { exact: true }).waitFor();
  const source = await page.locator("#showai-data").textContent();
  expect(JSON.parse(source!).document.id).toBe(doc.id);
  expect(requests.every((url) => url.startsWith(address))).toBe(true);
  await page.close();
});

test("code blocks load their syntax grammars in a specialized offline reader", async () => {
  const doc = createResource(blankDocument());
  doc.content.content = [
    {
      type: "codeBlock",
      attrs: { id: "snippet", language: "js" },
      content: [{ type: "text", text: 'const message = "hello";' }],
    },
  ];
  doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["snippet"];
  const html = await buildPageHtml(doc);
  expect(html).toContain("Visual Basic .NET");
  pages.set("/code", html);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(address + "/code");
  await page
    .locator(".code-block .hljs-string", { hasText: '"hello"' })
    .waitFor();
  expect(errors).toEqual([]);
  await page.close();
});

test("readers show navigation only after entering a nested container and omit editing controls", async () => {
  let doc = createResource(blankDocument());
  doc.title = "Nested reading";
  const child = createSurface("page", "Evidence", "evidence-page");
  child.content = [
    {
      type: "paragraph",
      attrs: { id: "evidence-text" },
      content: [{ type: "text", text: "Nested evidence." }],
    },
  ];
  doc = addNode(doc, child, {
    x: 0,
    y: 0,
    width: 760,
    height: 400,
    heightMode: "auto",
  }) as typeof doc;
  pages.set("/navigation", await buildPageHtml(doc));
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.goto(address + "/navigation");
  await page.getByText("Nested evidence.", { exact: true }).waitFor();
  expect(await page.locator(".container-workspace-bar").count()).toBe(0);
  await page
    .getByRole("button", { name: "展开 Evidence", exact: true })
    .click();
  await page.getByRole("button", { name: "返回上层", exact: true }).waitFor();
  expect(await page.locator(".container-workspace-bar").count()).toBe(1);
  expect(
    await page.getByRole("button", { name: "撤销操作", exact: true }).count(),
  ).toBe(0);
  expect(await page.getByLabel("容器操作", { exact: true }).count()).toBe(0);
  await page.getByRole("button", { name: "返回上层", exact: true }).click();
  expect(await page.locator(".container-workspace-bar").count()).toBe(0);
  expect(errors).toEqual([]);
  await page.close();
});

test("every G2 chart retains its actual drawing dependencies in a specialized offline reader", async () => {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  for (const item of g2) {
    const errors: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    page.on("pageerror", onError);
    const doc = createResource(blankDocument());
    doc.content.content = [
      {
        type: "widget",
        attrs: { id: "chart", kind: item.kind, data: item.defaultData },
      },
    ];
    doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["chart"];
    const html = await buildPageHtml(doc);
    pages.set("/" + item.kind, html);
    await page.goto(address + "/" + item.kind);
    await page
      .locator('button[aria-label="下载图表 SVG"]:not([disabled])')
      .waitFor({ timeout: 20000 });
    expect(
      await page.locator("[data-g2-type] svg").count(),
      item.kind,
    ).toBeGreaterThan(0);
    expect(errors, item.kind).toEqual([]);
    if (item.kind === "g2-line" || item.kind === "g2-bar") {
      expect(Buffer.byteLength(toInlineFragment(html)), item.kind).toBeLessThan(
        1_000_000,
      );
      await page
        .getByRole("combobox", { name: "图表主题" })
        .selectOption("dark");
      await page
        .locator('button[aria-label="下载图表 SVG"]:not([disabled])')
        .waitFor();
      expect(await page.locator(".sb-g2-chart.is-dark").count()).toBe(1);
    }
    page.removeListener("pageerror", onError);
  }
  await page.close();
}, 180000);

test("nested regions and multi-page sites share the union of required native components", async () => {
  const one = createResource(blankDocument()),
    two = createResource(blankDocument());
  one.content.content = [
    {
      type: "region",
      attrs: { id: "outer", name: "Evidence" },
      content: [
        {
          type: "widget",
          attrs: {
            id: "metrics",
            kind: "metrics",
            data: { items: [{ label: "Verified", value: "1" }] },
          },
        },
      ],
    },
  ];
  two.content.content = [
    {
      type: "widget",
      attrs: {
        id: "plot",
        kind: "g2-line",
        data: g2.find((item) => item.kind === "g2-line")!.defaultData,
      },
    },
  ];
  const template = await buildReaderTemplate([one, two]);
  expect(readerKinds([one, two])).toEqual(["g2-line", "metrics"]);
  const metadata = template
    .match(/name="showai-reader-kinds" content="([^"]+)"/)![1]
    .replaceAll("&quot;", '"');
  expect(JSON.parse(metadata)).toEqual(["g2-line", "metrics"]);
  expect(template).not.toContain('"g2-sankey"');
});

test("small block selections export inline with only their renderers", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-inline-selection-"));
  try {
    const store = new FileStore(home),
      project = await store.createProject({ name: "Inline selection" });
    const doc = createResource(blankDocument());
    doc.title = "Monitoring";
    const builtin = (kind: string) =>
      components.find((item) => item.kind === kind)!.defaultData;
    doc.content.content = [
      {
        type: "paragraph",
        attrs: { id: "intro" },
        content: [{ type: "text", text: "Training monitor." }],
      },
      {
        type: "widget",
        attrs: {
          id: "mon-metrics",
          kind: "metrics",
          data: { title: "Run", items: [{ label: "Loss", value: "0.42" }] },
        },
      },
      {
        type: "widget",
        attrs: {
          id: "mon-entropy",
          kind: "chart",
          data: {
            title: "Entropy",
            type: "line",
            labels: ["1", "2", "3"],
            series: [{ name: "entropy", values: [3.1, 2.7, 2.2] }],
            unit: "",
          },
        },
      },
      {
        type: "widget",
        attrs: { id: "ov-flow", kind: "flowchart", data: builtin("flowchart") },
      },
      {
        type: "widget",
        attrs: { id: "ov-scene", kind: "scene-3d", data: builtin("scene-3d") },
      },
      // Unselected heavy renderers must not reach the selection's reader.
      ...diagrams.map((item) => ({
        type: "widget",
        attrs: { id: item.kind, kind: item.kind, data: item.defaultData },
      })),
      {
        type: "widget",
        attrs: {
          id: "plot",
          kind: "g2-sankey",
          data: g2.find((item) => item.kind === "g2-sankey")!.defaultData,
        },
      },
    ];
    doc.surfaceViews[doc.content.attrs!.id].readingOrder =
      doc.content.content.map((node) => node.attrs!.id as string);
    const page = await store.createPage(project.id, { document: doc });
    const exportSelection = async (name: string, blockIds: string[]) => {
      const out = join(store.projectPath(project.id), "exports", name);
      await exportPage({
        root: home,
        projectId: project.id,
        pageId: page.document.id,
        blockIds,
        format: "inline",
        components: "bundled",
        out: out + ".html",
      });
      await exportPage({
        root: home,
        projectId: project.id,
        pageId: page.document.id,
        blockIds,
        format: "html",
        out: out + "-full.html",
      });
      return {
        inline: await readFile(out + ".html", "utf8"),
        html: await readFile(out + "-full.html", "utf8"),
      };
    };
    // Three.js alone is about 570 KB minified, so the 3D scene gets a larger full-HTML budget.
    for (const [name, blockIds, budget, htmlBudget] of [
      ["chart", ["mon-metrics", "mon-entropy"], 600_000, 1_500_000],
      ["flowchart", ["ov-flow"], 750_000, 1_500_000],
      ["scene", ["ov-scene"], 750_000, 1_900_000],
    ] as const) {
      const { inline, html } = await exportSelection(name, [...blockIds]);
      expect(Buffer.byteLength(inline), name).toBeLessThan(budget);
      expect(Buffer.byteLength(inline), name).toBeLessThan(CAPACITY.chatBytes);
      expect(Buffer.byteLength(html), name).toBeLessThan(htmlBudget);
      expect(html, name).not.toContain('"g2-sankey"');
      pages.set("/selection-" + name, inline);
    }
    const reader = await browser.newPage();
    const errors: string[] = [];
    reader.on("pageerror", (error) => errors.push(error.message));
    await reader.goto(address + "/selection-chart");
    await reader.getByText("0.42", { exact: true }).waitFor();
    await reader.goto(address + "/selection-flowchart");
    await reader.getByText("明确问题").first().waitFor();
    await reader.goto(address + "/selection-scene");
    await reader.getByRole("slider", { name: "转动" }).waitFor();
    expect(errors).toEqual([]);
    await reader.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
