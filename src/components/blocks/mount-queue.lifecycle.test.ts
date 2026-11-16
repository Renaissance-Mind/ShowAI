import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright-core";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it.each([1, 0.75])(
  "mounts visible and nested content before paint, preserving real geometry and Activity at scale %s",
  async (scale) => {
    const directory = await mkdtemp(join(tmpdir(), "showai-queued-mount-"));
    let browser: Browser | undefined;
    const server = createServer(async (request, response) => {
      const name = request.url === "/fixture.js" ? "fixture.js" : "index.html";
      response.setHeader(
        "Content-Type",
        name.endsWith(".js") ? "text/javascript" : "text/html",
      );
      response.end(await readFile(join(directory, name)));
    });
    try {
      await build({
        entryPoints: [
          resolve("src/components/blocks/fixtures/queued-mount.tsx"),
        ],
        bundle: true,
        platform: "browser",
        format: "esm",
        jsx: "automatic",
        outfile: join(directory, "fixture.js"),
        define: { "process.env.NODE_ENV": '"development"' },
      });
      await writeFile(
        join(directory, "index.html"),
        '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
      );
      await new Promise<void>((accept) =>
        server.listen(0, "127.0.0.1", accept),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Expected loopback listener");
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({
        viewport: { width: 1000, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/?scale=${scale}`);
      await expect.poll(() => page.locator("[data-mounted]").count()).toBe(9);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as typeof window & {
                  queuedMountReport: { firstFrame: string[] };
                }
              ).queuedMountReport.firstFrame.length,
          ),
        )
        .toBeGreaterThan(0);
      const report = await page.evaluate(() => {
        const report = (
          window as typeof window & {
            queuedMountReport: {
              anchor: number;
              expected: string[];
              firstFrame: string[];
            };
          }
        ).queuedMountReport;
        return {
          ...report,
          actualAnchor: document
            .querySelector('[data-anchor="6"]')!
            .getBoundingClientRect().top,
        };
      });
      expect(report.firstFrame).toEqual(
        expect.arrayContaining(report.expected),
      );
      expect(report.firstFrame).toContain("nested");
      expect(Math.abs(report.actualAnchor - report.anchor)).toBeLessThan(1);
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const text = localStorage.getItem(
              "showai.reader-state.v1:queued-page",
            );
            return text
              ? Object.values(JSON.parse(text))
                  .map(
                    (value) =>
                      (value as Record<string, number>)["layout.height"],
                  )
                  .sort((a, b) => a - b)
              : [];
          }),
        )
        .toEqual([80, ...Array(8).fill(400)]);
      await page
        .getByRole("button", { name: "Component 6", exact: true })
        .click();
      const retained = await page.locator('[data-mounted="6"]').elementHandle();
      for (let index = 0; index < 3; index++) {
        await page
          .getByRole("button", { name: "Toggle page", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Toggle page", exact: true })
          .click();
        await page.locator('[data-mounted="6"]').waitFor();
        const top = await page
          .locator('[data-anchor="6"]')
          .evaluate((element) => element.getBoundingClientRect().top);
        expect(Math.abs(top - report.anchor)).toBeLessThan(1);
      }
      expect(await retained!.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      expect(
        await page.locator('[data-mounted="6"] > button').innerText(),
      ).toBe("Kept");
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      if (server.listening)
        await new Promise<void>((accept, reject) =>
          server.close((error) => (error ? reject(error) : accept())),
        );
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
