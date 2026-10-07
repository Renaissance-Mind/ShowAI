import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium, type Browser, type Frame } from "playwright";
import { blankDocument } from "../core/catalog";
import { createResource, createSurface } from "../surface/containers.mjs";
import { addNode } from "../surface/editing";
import { buildPageHtml } from "../agent/exporter";
import { selectDocumentBlocks } from "./selection.mjs";
import { toInlineFragment } from "./inline.mjs";

const paragraphs = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    type: "paragraph",
    attrs: { id: `${prefix}-${index}` },
    content: [
      {
        type: "text",
        text: `${prefix} ${index}: A complete paragraph should contribute to the conversation preview height, including when its text wraps on a narrow screen.`,
      },
    ],
  }));

const rootPage = ".container-main > .container-page.is-root";
const pages = new Map<string, string>();
let browser: Browser;
let server: Server;
let address: string;

function inlineHost(html: string) {
  const source =
    `<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>${toInlineFragment(html)}`
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{display:block;border:0;width:100%;height:240px}</style><iframe title="Inline" sandbox="allow-scripts" srcdoc="${source}"></iframe>`;
}

async function geometry(frame: Frame) {
  return frame.locator(rootPage).evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflow: getComputedStyle(element).overflowY,
    outerHeight: element
      .closest("[data-showai-inline-root]")!
      .getBoundingClientRect().height,
    viewportHeight: innerHeight,
  }));
}

beforeAll(async () => {
  let document = createResource(blankDocument());
  document.title = "Inline height regression";
  document.content.content = [
    ...paragraphs("Introduction", 8),
    {
      type: "toggle",
      attrs: { id: "details", title: "More evidence", open: false },
      content: paragraphs("Evidence", 12),
    },
  ];
  for (const mode of ["fixed", "auto"] as const) {
    const child = createSurface("page", `${mode} page`, `${mode}-page`);
    child.content = paragraphs(mode, 10);
    document = addNode(document, child, {
      x: 0,
      y: 0,
      width: 640,
      height: 220,
      heightMode: mode,
    }) as typeof document;
  }
  document.surfaceViews[document.content.attrs!.id].readingOrder =
    document.content.content!.map((node) => node.attrs!.id);
  const html = await buildPageHtml(document);
  pages.set("/inline", inlineHost(html));
  pages.set("/standalone", html);
  const selection = { blockIds: ["details"] };
  pages.set(
    "/partial",
    inlineHost(
      await buildPageHtml(
        selectDocumentBlocks(document, selection.blockIds),
        undefined,
        [],
        [],
        "reading",
        selection,
      ),
    ),
  );
  const board = createResource(blankDocument(), "board");
  const child = createSurface("page", "Board notes", "board-notes");
  child.content = paragraphs("Board evidence", 10);
  const nestedBoard = addNode(board, child, {
    x: 0,
    y: 0,
    width: 600,
    height: 220,
    heightMode: "fixed",
  });
  for (const presentation of ["spatial", "reading"] as const)
    pages.set(
      `/board-${presentation}`,
      inlineHost(
        await buildPageHtml(nestedBoard, undefined, [], [], presentation),
      ),
    );
  server = createServer((request, response) => {
    const html = pages.get(request.url!);
    response.writeHead(html ? 200 : 404, {
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(html ?? "Not found");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const listening = server.address();
  if (!listening || typeof listening === "string")
    throw new Error("Inline height test server unavailable");
  address = `http://127.0.0.1:${listening.port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (server)
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
});

test("inline Pages expose their content height and keep explicitly bounded children", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${address}/inline`);
  const frame = page.frames().find((item) => item.parentFrame())!;
  await frame.getByText("Inline height regression", { exact: true }).waitFor();
  const initial = await geometry(frame);
  expect(initial.height).toBeGreaterThan(initial.viewportHeight * 2);
  expect(initial.outerHeight).toBeGreaterThanOrEqual(initial.height);
  expect(initial.scrollHeight - initial.clientHeight).toBeLessThanOrEqual(1);
  expect(initial.overflow).toBe("visible");
  const fixed = await frame
    .locator('[data-container-root="fixed-page"]')
    .evaluate((element) => ({
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
      overflow: getComputedStyle(element).overflowY,
    }));
  expect(fixed.height).toBeLessThan(220);
  expect(fixed.contentHeight).toBeGreaterThan(fixed.height * 2);
  expect(fixed.overflow).toBe("auto");
  expect(
    await frame
      .locator('[data-container-root="auto-page"]')
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThan(220);

  await frame.getByText("More evidence", { exact: true }).click();
  await expect
    .poll(async () => (await geometry(frame)).height)
    .toBeGreaterThan(initial.height + 300);
  await frame.getByText("More evidence", { exact: true }).click();
  await expect
    .poll(async () => (await geometry(frame)).height)
    .toBeCloseTo(initial.height, 0);

  await page.setViewportSize({ width: 390, height: 700 });
  await expect
    .poll(async () => (await geometry(frame)).height)
    .toBeGreaterThan(initial.height);
  const narrow = await geometry(frame);
  expect(narrow.scrollHeight - narrow.clientHeight).toBeLessThanOrEqual(1);
  await page.close();
});

test("partial exports grow and shrink when their displayed content changes", async () => {
  const page = await browser.newPage();
  await page.goto(`${address}/partial`);
  const frame = page.frames().find((item) => item.parentFrame())!;
  await frame.getByText("More evidence", { exact: true }).waitFor();
  await frame.getByText("More evidence", { exact: true }).click();
  const expanded = await geometry(frame);
  expect(expanded.outerHeight).toBeGreaterThan(500);
  expect(expanded.scrollHeight - expanded.clientHeight).toBeLessThanOrEqual(1);
  await frame.getByText("More evidence", { exact: true }).click();
  await expect
    .poll(async () => (await geometry(frame)).outerHeight)
    .toBeLessThan(240);
  await page.close();
});

test("spatial Boards retain their viewport while a reading projection grows", async () => {
  const page = await browser.newPage();
  await page.goto(`${address}/board-spatial`);
  const frame = page.frames().find((item) => item.parentFrame())!;
  await frame.locator(".container-board.is-root").waitFor();
  const height = await frame
    .locator(".portable-app")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBe(240);
  await frame
    .getByRole("button", { name: "展开 Board notes", exact: true })
    .click();
  await expect
    .poll(async () => (await geometry(frame)).outerHeight)
    .toBeGreaterThan(500);
  await frame.getByRole("button", { name: "返回上层", exact: true }).click();
  await frame.locator(".container-board.is-root").waitFor();
  expect(
    await frame
      .locator(".portable-app")
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(240);
  await page.goto(`${address}/board-reading`);
  const readingFrame = page.frames().find((item) => item.parentFrame())!;
  await readingFrame.locator(rootPage).waitFor();
  const reading = await geometry(readingFrame);
  expect(reading.outerHeight).toBeGreaterThan(240);
  expect(reading.scrollHeight - reading.clientHeight).toBeLessThanOrEqual(1);
  await page.close();
});

test("standalone readers keep their viewport and Page scrolling", async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(`${address}/standalone`);
  await page.locator(rootPage).waitFor();
  const geometry = await page.locator(rootPage).evaluate((element) => ({
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflow: getComputedStyle(element).overflowY,
  }));
  expect(geometry.height).toBe(700);
  expect(geometry.scrollHeight).toBeGreaterThan(700);
  expect(geometry.overflow).toBe("auto");
  await page.close();
});
