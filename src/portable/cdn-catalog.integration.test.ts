import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Frame, type Page } from "playwright-core";
import { blankDocument } from "../core/catalog";
import { createResource } from "../surface/containers.mjs";
import { buildPageHtml } from "../agent/exporter";
import { buildCdnReader } from "../../scripts/build-cdn-reader.mjs";
import { toCdnFragment } from "./cdn-fragment.mjs";
import { startCdnHost } from "./cdn-test-host";
import primitives from "../../resources/catalog/primitives.json";
import components from "../../resources/catalog/components.json";
import g2 from "../../resources/catalog/g2.json";
import diagrams from "../../resources/catalog/diagrams.json";

type Item = {
  kind: string;
  replacedBy?: string;
  defaultData: unknown;
  examples?: { data?: unknown }[];
};
type Result = { id: string; state: string };

/** Every built-in's default data and catalog examples, one widget each. */
function catalogPage(items: Item[]) {
  const doc = createResource(blankDocument());
  doc.content.content = items
    .filter((item) => !item.replacedBy)
    .flatMap((item) => [
      { id: `${item.kind}--default`, data: item.defaultData },
      ...(item.examples ?? [])
        .filter((example) => example.data)
        .map((example, index) => ({
          id: `${item.kind}--example-${index}`,
          data: example.data,
        })),
    ])
    .map(({ id, data }) => ({
      type: "widget",
      attrs: { id, kind: id.split("--")[0], data },
    }));
  doc.surfaceViews[doc.content.attrs!.id].readingOrder = (
    doc.content.content ?? []
  ).map((node) => node.attrs!.id as string);
  return doc;
}

/** Scrolls through every widget, then reports whether it rendered. */
async function inspect(frame: Frame, ids: string[]): Promise<Result[]> {
  await frame.waitForSelector(`[data-block-id="${ids[0]}"]`, {
    timeout: 120_000,
  });
  const results: Result[] = [];
  for (const id of ids) {
    const widget = frame.locator(`[data-block-id="${id}"]`);
    if (!(await widget.count())) {
      results.push({ id, state: "missing" });
      continue;
    }
    await widget.scrollIntoViewIfNeeded();
    const deadline = Date.now() + 30_000;
    let state = "";
    while (Date.now() < deadline) {
      state = await widget.evaluate((element) => {
        const unavailable = element.querySelector(".sb-unavailable");
        if (unavailable)
          return `unavailable: ${unavailable.textContent?.replace(/\s+/g, " ").slice(0, 160)}`;
        if (
          element.querySelector(
            '[data-preview-pending="true"],[aria-busy="true"]',
          )
        )
          return "pending";
        const box = element.getBoundingClientRect();
        return box.height < 12 ? `blank (${Math.round(box.height)}px)` : "ok";
      });
      if (state !== "pending") break;
      await frame.page().waitForTimeout(200);
    }
    results.push({ id, state });
  }
  return results;
}

const groups: [string, Item[]][] = [
  ["primitives", primitives as Item[]],
  ["components", components as Item[]],
  ["g2", g2 as Item[]],
  ["diagrams", diagrams as Item[]],
];

describe("CDN reader across the built-in catalog", () => {
  let outdir: string, browser: Browser;
  let host: Awaited<ReturnType<typeof startCdnHost>>;
  let entry = "";
  beforeAll(async () => {
    outdir = await mkdtemp(join(tmpdir(), "showai-cdn-catalog-"));
    entry = (await buildCdnReader(outdir)).manifest.entry;
    host = await startCdnHost(outdir);
    browser = await chromium.launch();
  }, 300_000);
  afterAll(async () => {
    await browser?.close();
    await host?.close();
    await rm(outdir, { recursive: true, force: true });
  });

  it.each(groups)(
    "renders every %s example as the bundled reader does",
    async (group, items) => {
      const doc = catalogPage(items);
      const ids = (doc.content.content ?? []).map(
        (node) => node.attrs!.id as string,
      );
      const html = await buildPageHtml(doc);
      const open = async (url: string) => {
        const page: Page = await browser.newPage({
          viewport: { width: 1100, height: 1000 },
        });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url);
        return { page, errors };
      };
      const cdn = await open(
        host.host(
          `/cdn-${group}`,
          toCdnFragment(html, { readerUrl: `${host.origin}/${entry}` }),
          960,
        ),
      );
      const cdnResults = await inspect(
        cdn.page.frames().find((frame) => frame !== cdn.page.mainFrame())!,
        ids,
      );
      const bundled = await open(host.page(`/bundled-${group}`, html));
      const bundledResults = await inspect(bundled.page.mainFrame(), ids);
      if (process.env.SHOWAI_CDN_REPORT)
        appendFileSync(
          process.env.SHOWAI_CDN_REPORT,
          JSON.stringify({
            group,
            ids: ids.length,
            cdn: cdnResults,
            bundled: bundledResults,
          }) + "\n",
        );
      const report = cdnResults
        .map((result, index) => ({
          ...result,
          bundled: bundledResults[index].state,
        }))
        .filter((result) => result.state !== "ok" || result.bundled !== "ok");
      if (report.length || cdn.errors.length || bundled.errors.length)
        console.log(
          JSON.stringify(
            {
              group,
              widgets: ids.length,
              report,
              cdnErrors: cdn.errors,
              bundledErrors: bundled.errors,
            },
            null,
            2,
          ),
        );
      await cdn.page.close();
      await bundled.page.close();
      // The CDN reader must render whatever the bundled reader renders.
      expect(
        report.filter((result) => result.state !== result.bundled),
      ).toEqual([]);
      expect(cdn.errors).toEqual(bundled.errors);
    },
    600_000,
  );
});
