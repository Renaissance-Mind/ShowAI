import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { gunzipSync } from "node:zlib";
import { FileStore } from "../core/store";
import {
  blankDocument,
  importComponent,
  componentWidgetData,
} from "../core/catalog";
import { createResource } from "../surface/containers.mjs";
import { buildPageHtml, findInlineViewerTemplate } from "../agent/exporter";
import { toInlineFragment } from "./inline.mjs";
it("renders a packed reader with an actual compiled component inside an opaque offline host", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-inline-packed-"));
  const store = new FileStore(home),
    project = await store.createProject({ name: "Inline" });
  const component = await importComponent(
    home,
    resolve("resources/catalog/value-slider"),
    project.id,
  );
  const doc = createResource(blankDocument());
  doc.content.content = [
    {
      type: "widget",
      attrs: {
        id: "slider",
        kind: "custom",
        data: componentWidgetData(component),
      },
    },
  ];
  doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["slider"];
  const html = await buildPageHtml(doc, await findInlineViewerTemplate(doc), [
    component,
  ]);
  const fragment = toInlineFragment(html);
  expect(Buffer.byteLength(fragment)).toBeLessThanOrEqual(1_000_000);
  expect(fragment).toContain('data-showai-packed-reader="gzip"');
  const packed = JSON.parse(
    fragment.match(
      /<script type="application\/json"[^>]*data-showai-packed-data="gzip"[^>]*>([\s\S]*?)<\/script>/,
    )![1],
  );
  const transport = JSON.parse(
    gunzipSync(Buffer.from(packed.data, "base64")).toString(),
  );
  const data = JSON.parse(transport.artifact);
  expect(data.version).toBe(3);
  expect(data.document.content.attrs.kind).toBe("page");
  expect(data.components[0].html).toBe(component.html);
  const source =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'">${fragment}`
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<iframe title="Host" sandbox="allow-scripts" style="width:900px;height:800px" srcdoc="${source}"></iframe>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    const frame = page.frameLocator('iframe[title="Host"]');
    const slider = frame.getByRole("slider");
    await slider.waitFor();
    await slider.focus();
    await slider.press("ArrowRight");
    const restored = await frame
      .locator('script[type="application/json"]')
      .first()
      .textContent();
    expect(JSON.parse(restored!).components[0]).toEqual(data.components[0]);
    expect(await frame.locator("iframe").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
