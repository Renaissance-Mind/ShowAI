import { expect, it } from "vitest";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("moves a real retained Editor between hosts, preserves undo/selection and Activity, and isolates independent view scopes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-retained-host-"));
  await build({
    entryPoints: [resolve("src/editor/fixtures/retained-editor-host.tsx")],
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
  const server = createServer(async (request, response) => {
    const name = request.url === "/fixture.js" ? "fixture.js" : "index.html";
    response.setHeader(
      "Content-Type",
      name.endsWith(".js") ? "text/javascript" : "text/html",
    );
    response.end(await readFile(join(directory, name)));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected loopback listener");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const a = page.locator('[data-scope="A"]'),
      b = page.locator('[data-scope="B"]');
    const text = a.locator(".tiptap");
    await text.waitFor();
    await b.locator(".tiptap").waitFor();
    const independentView = await b.locator(".tiptap").elementHandle();
    await b
      .getByRole("button", { name: "Node view count 0", exact: true })
      .click();
    expect(await text.innerText()).toContain("Saved A Page content");
    await text.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("!");
    const edited = await text.innerText();
    expect(edited).toContain("!");
    await a
      .getByRole("button", { name: "Inspect Editor A", exact: true })
      .click();
    const before = JSON.parse(
      await a.locator("[data-editor-report]").innerText(),
    );
    for (let index = 0; index < 4; index++) {
      await a
        .getByRole("button", { name: "Switch Page host A", exact: true })
        .click();
      await text.waitFor();
      expect(await text.innerText()).toBe(edited);
      await a
        .getByRole("button", { name: "Inspect Editor A", exact: true })
        .click();
      expect(
        JSON.parse(await a.locator("[data-editor-report]").innerText()),
      ).toEqual(before);
      expect(await b.locator(".tiptap").innerText()).toContain(
        "Saved B Page content",
      );
      expect(
        await independentView!.evaluate((element) => element.isConnected),
      ).toBe(true);
      expect(
        await b
          .getByRole("button", { name: "Node view count 1", exact: true })
          .count(),
      ).toBe(1);
    }
    await text.locator("p").first().click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    expect(await text.innerText()).not.toContain("!");
    await a
      .getByRole("button", { name: "Switch Page host A", exact: true })
      .click();
    // Move away from the previous paragraph click so PM interprets this as a
    // new single click rather than its retained double/triple-click sequence.
    await text
      .locator("p")
      .first()
      .click({ position: { x: 4, y: 4 } });
    expect(await a.locator("[data-interaction-host]").innerText()).toBe(
      "click:expanded",
    );
    await page.keyboard.press("F8");
    expect(await a.locator("[data-interaction-host]").innerText()).toBe(
      "key:expanded",
    );
    await page.keyboard.insertText("new host edit");
    expect(await a.locator("[data-publication-host]").innerText()).toBe(
      "expanded",
    );
    // Activity must preserve connected node views, including their own component
    // state and an iframe draft, rather than recreating the editor's view.
    await a
      .getByRole("button", { name: "Node view count 0", exact: true })
      .click();
    const frame = a.frameLocator('iframe[title="Retained frame"]');
    await frame.getByLabel("Frame draft").fill("unsaved iframe state");
    const iframe = await a
      .locator('iframe[title="Retained frame"]')
      .elementHandle();
    await a
      .getByRole("button", { name: "Toggle Activity A", exact: true })
      .click();
    expect(await text.isVisible()).toBe(false);
    await a
      .getByRole("button", { name: "Toggle Activity A", exact: true })
      .click();
    await text.waitFor();
    expect(
      await a
        .getByRole("button", { name: "Node view count 1", exact: true })
        .count(),
    ).toBe(1);
    expect(await frame.getByLabel("Frame draft").inputValue()).toBe(
      "unsaved iframe state",
    );
    expect(await iframe!.evaluate((element) => element.isConnected)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await new Promise<void>((accept, reject) =>
      server.close((error) => (error ? reject(error) : accept())),
    );
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
