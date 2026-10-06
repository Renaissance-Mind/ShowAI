import { beforeAll, afterAll, test, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import g2 from "../../resources/catalog/g2.json";
import { blankDocument } from "../core/catalog";
import { createResource } from "../surface/containers.mjs";
import { buildPageHtml, buildReaderTemplate } from "./exporter";
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
