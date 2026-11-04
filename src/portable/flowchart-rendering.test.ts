import { expect, it } from "vitest";
import { createServer } from "node:http";
import { chromium, type Browser } from "playwright-core";
import { buildPageHtml } from "../agent/exporter";
import { blankDocument } from "../core/catalog";
import { toInlineFragment } from "./inline.mjs";

it("keeps edges and SVG markers visible in standalone and opaque inline hosts", async () => {
  const document = blankDocument();
  document.title = "Arrow rendering";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        kind: "flowchart",
        data: {
          title: "Directed flow",
          height: 420,
          flows: [
            {
              id: "flow",
              label: "Flow",
              direction: "LR",
              nodes: [
                { id: "a", label: "Start", position: { x: 0, y: 0 } },
                { id: "b", label: "Finish", position: { x: 360, y: 0 } },
              ],
              edges: [{ id: "ab", source: "a", target: "b" }],
            },
          ],
        },
      },
    },
  ];
  const html = await buildPageHtml(document);
  const inline = toInlineFragment(html);
  // Percentage-sized SVGs are a real host convention; the frame has an opaque origin.
  const frameDocument = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'"><style>svg{display:block;width:100%}body{margin:0}</style>${inline}`;
  const escaped = frameDocument
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
  const host = `<!doctype html><meta charset="utf-8"><iframe title="Inline" sandbox="allow-scripts" style="border:0;width:760px;height:1000px" srcdoc="${escaped}"></iframe>`;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/inline" ? host : html);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server address.");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    for (const mode of ["standalone", "inline"]) {
      const page = await browser.newPage({
        viewport: { width: 800, height: 1100 },
      });
      await page.goto(`http://127.0.0.1:${address.port}/${mode}`);
      const frame =
        mode === "inline"
          ? page.frames().find((item) => item.parentFrame())!
          : page.mainFrame();
      const path = frame.locator(".react-flow__edge-path").first();
      await path.waitFor({ state: "attached" });
      await expect
        .poll(() =>
          path.evaluate(
            (element) =>
              (
                element as SVGPathElement
              ).ownerSVGElement!.getBoundingClientRect().width,
          ),
        )
        .toBeGreaterThan(100);
      const geometry = await path.evaluate((element) => {
        const svg = (element as SVGPathElement).ownerSVGElement!;
        const viewport = svg.closest(".react-flow__viewport")!;
        const markerId = element
          .getAttribute("marker-end")
          ?.match(/#([^'"\)]+)/)?.[1];
        return {
          svgWidth: svg.getBoundingClientRect().width,
          viewportWidth: viewport.getBoundingClientRect().width,
          pathLength: (element as SVGPathElement).getTotalLength(),
          markerExists:
            !!markerId &&
            element.ownerDocument.getElementById(markerId)?.tagName ===
              "marker",
        };
      });
      expect(geometry.svgWidth).toBeCloseTo(geometry.viewportWidth, 0);
      expect(geometry.pathLength).toBeGreaterThan(40);
      expect(geometry.markerExists).toBe(true);
      await frame
        .getByRole("button", { name: "解锁流程图" })
        .click({ timeout: 3000 });
      await frame
        .getByRole("button", { name: "放大流程图" })
        .click({ timeout: 3000 });
      expect(
        await path.evaluate(
          (element) =>
            (element as SVGPathElement).ownerSVGElement!.getBoundingClientRect()
              .width,
        ),
      ).toBeGreaterThan(100);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}, 30000);

it("opens details only for explained nodes and offers no editing", async () => {
  const document = blankDocument();
  document.title = "Node details";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        kind: "flowchart",
        data: {
          title: "Route choice",
          height: 420,
          flows: [
            {
              id: "flow",
              label: "Flow",
              direction: "LR",
              nodes: [
                { id: "plain", label: "Router", kind: "decision" },
                {
                  id: "explained",
                  label: "Relay",
                  subtitle: "Fallback",
                  kind: "decision",
                  detail: "Forwards encrypted packets.",
                },
              ],
              edges: [{ id: "edge", source: "plain", target: "explained" }],
            },
          ],
        },
      },
    },
  ];
  const html = await buildPageHtml(document);
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
      viewport: { width: 900, height: 900 },
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const block = page.locator(".sf-block");
    await page.locator('.react-flow__node[data-id="plain"]').click();
    await expect.poll(() => block.locator(".sf-detail").count()).toBe(0);
    await page.locator('.react-flow__node[data-id="explained"]').click();
    const detail = block.locator(".sf-detail");
    await detail.waitFor();
    expect(await detail.innerText()).toContain("Forwards encrypted packets.");
    expect(await detail.innerText()).toContain("Fallback");
    expect(await detail.innerText()).not.toMatch(/条件判断|Decision/);
    expect(await block.locator("input, textarea, .sf-editor").count()).toBe(0);
    expect(await block.locator(".sf-node-picker button").count()).toBe(1);
  } finally {
    await browser?.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}, 30000);

it("draws two-way edges, keeps fan-out labels apart and stacks a wide flow in a narrow column", async () => {
  const document = blankDocument();
  document.title = "Edges";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        kind: "flowchart",
        data: {
          height: 420,
          flows: [
            {
              id: "flow",
              label: "Flow",
              direction: "LR",
              nodes: [
                { id: "a", label: "Coordinator" },
                { id: "b", label: "Laptop" },
                { id: "c", label: "Server" },
              ],
              edges: [
                { id: "ab", source: "a", target: "b", label: "keys" },
                { id: "ac", source: "a", target: "c", label: "keys" },
                {
                  id: "bc",
                  source: "b",
                  target: "c",
                  ends: "both",
                  sourceSide: "bottom",
                  targetSide: "bottom",
                },
              ],
            },
          ],
        },
      },
    },
  ];
  const html = await buildPageHtml(document);
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
      viewport: { width: 1000, height: 900 },
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const twoWay = page.locator(
      '.react-flow__edge[data-id="bc"] path.react-flow__edge-path',
    );
    await twoWay.waitFor({ state: "attached" });
    expect(await twoWay.getAttribute("marker-start")).toMatch(/^url\(#/);
    expect(await twoWay.getAttribute("marker-end")).toMatch(/^url\(#/);
    const labels = await page
      .locator(".react-flow__edge-textwrapper")
      .evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        }),
      );
    expect(labels).toHaveLength(2);
    const [[x1, y1, w1, h1], [x2, y2, w2, h2]] = labels;
    expect(
      x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1,
    ).toBe(true);
    const position = (id: string) =>
      page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y };
      });
    expect((await position("b")).x).toBeGreaterThan(
      (await position("a")).x + 100,
    );
    await page.setViewportSize({ width: 520, height: 900 });
    await expect
      .poll(async () => (await position("b")).y - (await position("a")).y)
      .toBeGreaterThan(30);
  } finally {
    await browser?.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}, 30000);
