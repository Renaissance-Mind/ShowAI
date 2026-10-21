import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright-core";
import components from "../../resources/catalog/components.json";
import g2 from "../../resources/catalog/g2.json";
import primitives from "../../resources/catalog/primitives.json";
import diagrams from "../../resources/catalog/diagrams.json";
import { bundleReader } from "../portable/reader-bundle.mjs";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { readingBrowserExecutable } from "./reading-renderer";
import { inlinePresentation } from "./presentation";
import type { ShowDocument } from "../types";

/**
 * Renders every built-in component example the way show_component does, at
 * three conversation widths, and records errors, horizontal overflow and size.
 * It takes several minutes, so it runs only with SHOWAI_INLINE_READINESS=1;
 * SHOWAI_INLINE_READINESS_OUT names the JSON report.
 */
const enabled = process.env.SHOWAI_INLINE_READINESS === "1";
const WIDTHS = [360, 640, 760];
const entries = [...primitives, ...components, ...g2, ...diagrams] as {
  kind: string;
  examples: { data: Record<string, unknown> }[];
}[];

let browser: Browser | undefined;
let directory: string;
beforeAll(async () => {
  if (!enabled) return;
  const { chromium } = await import("playwright-core");
  browser = await chromium.launch({
    executablePath: await readingBrowserExecutable(),
    headless: true,
  });
  directory = await mkdtemp(join(tmpdir(), "showai-inline-readiness-"));
});
afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test.skipIf(!enabled)(
  "built-in components render as conversation components at chat widths",
  async () => {
    const report: Record<string, unknown>[] = [];
    for (const entry of entries) {
      const source = {
        id: "show",
        title: "",
        icon: "",
        cover: "none",
        parentId: null,
        favorite: false,
        archived: false,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        comments: [],
        content: {
          type: "surface",
          attrs: { id: "root", kind: "page" },
          content: [
            {
              type: "widget",
              attrs: {
                id: "only",
                kind: entry.kind,
                data: entry.examples[0].data,
              },
            },
          ],
        },
      } as ShowDocument;
      const path = join(directory, `${entry.kind}.html`);
      const html = injectArtifactIntoHtml(
        await bundleReader(resolve("dist-portable/reader-source.json"), [
          source,
        ]),
        source,
        [],
        [],
        "reading",
        { blockIds: ["only"], chrome: "none" },
      );
      await writeFile(path, html);
      const preview = await inlinePresentation(html);
      report.push({
        kind: entry.kind,
        inlineBytes: preview.inline ? Buffer.byteLength(preview.inline) : null,
        ...(preview.inlineError ? { inlineError: preview.inlineError } : {}),
      });
      for (const width of WIDTHS) {
        const context = await browser!.newContext({
          viewport: { width, height: 700 },
          reducedMotion: "reduce",
        });
        await context.route(/^https?:/, (route) => route.abort());
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let result: Record<string, unknown>;
        try {
          await page.goto(pathToFileURL(path).href, { waitUntil: "load" });
          await page.locator(".portable-app").waitFor({ timeout: 10000 });
          await page.waitForTimeout(1200);
          result = await page.evaluate(() => {
            const block = document.querySelector('[data-block-id="only"]');
            const rect = block?.getBoundingClientRect();
            const visibleError = Array.from(
              document.querySelectorAll(
                ".portable-error,.sb-unavailable,.custom-error",
              ),
            )
              .map((node) => node.textContent?.trim())
              .filter(Boolean);
            return {
              mounted: !!block && (rect?.height ?? 0) > 8,
              height: Math.round(rect?.height ?? 0),
              overflow:
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
              options: !!document.querySelector(
                ".portable-options:not([hidden])",
              ),
              visibleError,
            };
          });
        } catch (error) {
          result = { mounted: false, failure: String(error) };
        }
        report.push({ kind: entry.kind, width, ...result, errors });
        await context.close();
      }
    }
    const out = process.env.SHOWAI_INLINE_READINESS_OUT;
    if (out) {
      await mkdir(resolve(out, ".."), { recursive: true });
      await writeFile(out, JSON.stringify(report, null, 2));
    }
    expect(report.filter((row) => row.options)).toEqual([]);
  },
  1_800_000,
);
