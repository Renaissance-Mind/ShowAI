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
  const cardFigure = {
    alt: "分组注释下划线与打印测试",
    source:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 140">' +
      '<g id="card-note" data-note="整卡悬停注释"><rect class="paper stroke-blue" x="16" y="16" width="180" height="72" rx="10"/><text id="card-title" class="ink-blue" x="106" y="46" text-anchor="middle" font-size="16" font-weight="600">主标题</text><text id="card-sub" class="ink-muted" x="106" y="70" text-anchor="middle" font-size="13">次要说明不加下划线</text></g>' +
      '<g id="nested-note" data-note="嵌套分组注释"><g><text id="nested-a" x="250" y="44" font-size="14">分支 A</text></g><g><text id="nested-b" x="250" y="70" font-size="14">分支 B</text></g></g>' +
      '<text id="direct-note" x="250" y="110" font-size="14" data-note="直接文字注释">独立术语</text>' +
      "</svg>",
  };
  doc.content.content = [
    { type: "widget", attrs: { kind: "svg", data: figure } },
    { type: "widget", attrs: { kind: "svg", data: figure } },
    { type: "widget", attrs: { kind: "svg", data: cardFigure } },
  ];
  await open(await buildPageHtml(doc), async (page) => {
    const figures = page.locator(".sv-figure");
    await expect.poll(() => figures.count()).toBe(3);
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

    const decorationLine = (suffix: string) =>
      figures
        .nth(2)
        .locator(`[id$="-${suffix}"]`)
        .evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(await decorationLine("card-note")).toBe("none");
    expect(await decorationLine("card-title")).toBe("underline");
    expect(await decorationLine("card-sub")).toBe("none");
    expect(await decorationLine("nested-note")).toBe("none");
    expect(await decorationLine("nested-a")).toBe("none");
    expect(await decorationLine("nested-b")).toBe("none");
    expect(await decorationLine("direct-note")).toBe("underline");

    await page.emulateMedia({ media: "print" });
    expect(await decorationLine("card-title")).toBe("none");
    expect(await decorationLine("direct-note")).toBe("none");
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
