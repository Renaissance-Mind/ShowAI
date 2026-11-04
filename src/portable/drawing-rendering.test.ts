import { expect, it } from "vitest";
import { createServer } from "node:http";
import { chromium, type Browser } from "playwright-core";
import { buildPageHtml } from "../agent/exporter";
import { blankDocument } from "../core/catalog";
import components from "../../resources/catalog/components.json";

const example = (kind: string, index = 0) =>
  structuredClone(
    (components as { kind: string; examples: { data: unknown }[] }[]).find(
      (item) => item.kind === kind,
    )!.examples[index].data,
  ) as Record<string, unknown>;

async function open(
  html: string,
  run: (page: import("playwright-core").Page) => Promise<void>,
) {
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server address.");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1000, height: 1200 },
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await run(page);
  } finally {
    await browser?.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}

it("renders two svg figures with separate ids, themed text and hover notes", async () => {
  const doc = blankDocument();
  doc.title = "Figures";
  const figure = example("svg");
  doc.content.content = [
    { type: "widget", attrs: { kind: "svg", data: figure } },
    { type: "widget", attrs: { kind: "svg", data: figure } },
  ];
  await open(await buildPageHtml(doc), async (page) => {
    const figures = page.locator(".sv-figure");
    await expect.poll(() => figures.count()).toBe(2);
    const markers = await page
      .locator(".sv-figure marker")
      .evaluateAll((items) => items.map((item) => item.id));
    expect(new Set(markers).size).toBe(2);
    const references = await page
      .locator(".sv-figure path[marker-end]")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("marker-end")),
      );
    expect(
      references.every((value) =>
        markers.some((id) => value === `url(#${id})`),
      ),
    ).toBe(true);
    const name = await figures
      .first()
      .evaluate(
        (svg) =>
          svg.ownerDocument.getElementById(svg.getAttribute("aria-labelledby")!)
            ?.textContent,
      );
    expect(name).toContain("笔记本");
    expect(await figures.first().getAttribute("aria-label")).toBeNull();
    const note = page.locator(".sv-figure [data-showai-note]").first();
    await note.hover();
    await expect
      .poll(() =>
        page
          .locator(".showai-note-bubble")
          .evaluateAll((items) =>
            items.map((item) => (item as HTMLElement).innerText).join(" "),
          ),
      )
      .toContain("会话密钥");
    expect(
      await page
        .locator(".showai-icon-tooltip")
        .evaluateAll((items) =>
          items.map((item) => (item as HTMLElement).innerText).join(""),
        ),
    ).toBe("");
    const box = await figures.first().boundingBox();
    expect(box!.width).toBeGreaterThan(500);
  });
}, 60000);

it("steps a mechanism diagram without moving its layout and prints every step", async () => {
  const doc = blankDocument();
  doc.title = "Mechanism";
  doc.content.content = [
    {
      type: "widget",
      attrs: { kind: "mechanism-diagram", data: example("mechanism-diagram") },
    },
  ];
  await open(await buildPageHtml(doc), async (page) => {
    const block = page.locator(".md-block");
    const live = block.locator(".md-live .md-svg");
    await live.waitFor();
    const nodeBox = () =>
      live
        .locator(".md-node rect")
        .first()
        .evaluate((rect) => {
          const box = (rect as SVGRectElement).getBBox();
          return [box.x, box.y, box.width, box.height].join(",");
        });
    const first = await nodeBox();
    expect(await block.locator(".md-live").innerText()).toContain("记下这一对");
    await block.getByRole("button", { name: /主动入站/ }).click();
    expect(await nodeBox()).toBe(first);
    expect(await live.locator(".md-mark").count()).toBe(1);
    expect(await live.textContent()).toContain("发往 203.0.113.7:22");
    expect(await live.textContent()).not.toContain("查表命中");
    await block.getByRole("button", { name: /主动入站/ }).press("Home");
    expect(await live.textContent()).toContain("从 198.51.100.4:62000");
    await page.emulateMedia({ media: "print" });
    expect(await block.locator(".md-print-step").count()).toBe(3);
    expect(await block.locator(".md-print").isVisible()).toBe(true);
    expect(await block.locator(".md-live").isVisible()).toBe(false);
  });
}, 60000);
