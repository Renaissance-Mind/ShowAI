import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("reopens real input and history scopes before child effects resume, and retires them on hide and removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-scope-lifecycle-"));
  await build({
    entryPoints: [resolve("src/surface/fixtures/scope-lifecycle.tsx")],
    outfile: join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  await writeFile(
    join(directory, "index.html"),
    '<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>',
  );
  const server = createServer(async (request, response) => {
    const file = request.url === "/fixture.js" ? "fixture.js" : "index.html";
    response.setHeader(
      "Content-Type",
      file.endsWith("js") ? "text/javascript" : "text/html",
    );
    response.end(await readFile(join(directory, file)));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback listener");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(
      () => Number(document.querySelector("[data-ready]")?.textContent) > 0,
    );
    for (let i = 0; i < 4; i++) {
      const count = Number(await page.locator("[data-ready]").textContent());
      await page.getByRole("button", { name: "Toggle page" }).click();
      await page.waitForFunction(() => (window as any).retired());
      await page.getByRole("button", { name: "Toggle page" }).click();
      await page.waitForFunction(
        (before) =>
          Number(document.querySelector("[data-ready]")?.textContent) > before,
        count,
      );
      expect(errors).toEqual([]);
    }
    await page.getByRole("button", { name: "Close page" }).click();
    await page.waitForFunction(() => (window as any).retired());
    expect(await page.evaluate(() => (window as any).historyStopped())).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
