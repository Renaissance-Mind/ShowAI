import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright";
import { FileStore } from "../core/store";
import {
  blankDocument,
  componentWidgetData,
  importComponent,
} from "../core/catalog";
import { createResource } from "../surface/containers.mjs";
import { buildPageHtml } from "../agent/exporter";
import { buildCdnReader } from "../../scripts/build-cdn-reader.mjs";
import { toCdnFragment } from "./cdn-fragment.mjs";
import components from "../../resources/catalog/components.json";

// Like injectArtifactIntoHtml, keep the JSON inert inside its script element.
const page = (json: string) =>
  `<!doctype html><html lang="en"><body><script id="showai-data" type="application/json">${json.replace(/</g, "\\u003c")}</script></body></html>`;

describe("CDN fragment", () => {
  const artifact = {
    format: "showai",
    version: 3,
    document: { title: "Note </script><script>alert(1)</script>" },
  };

  it("carries only the page and imports the pinned reader", () => {
    const fragment = toCdnFragment(page(JSON.stringify(artifact)), {
      readerUrl: "https://cdn.example.com/showai/reader-ABC.js",
      id: "showai-test",
    });
    expect(fragment).toContain(
      'import("https://cdn.example.com/showai/reader-ABC.js")',
    );
    expect(fragment).toContain("reader.mount(root,{artifact})");
    expect(fragment).toContain(
      '<section id="showai-test" data-showai-inline-root lang="en">',
    );
    // The page title cannot close the loader script.
    expect(fragment.match(/<\/script>/g)).toHaveLength(1);
    const data = fragment.match(/const artifact=(\{.*?\});import\(/s)![1];
    expect(JSON.parse(data)).toEqual(artifact);
  });

  it.each([
    ["http://cdn.example.com/reader.js", /HTTPS/],
    ["https://cdn.example.com/reader.css", /entry module/],
  ])("rejects reader URL %s", (readerUrl, message) => {
    expect(() =>
      toCdnFragment(page(JSON.stringify(artifact)), { readerUrl }),
    ).toThrow(message);
  });

  it("refuses pages that need remote components", () => {
    expect(() =>
      toCdnFragment(
        page(JSON.stringify({ ...artifact, remoteComponents: [{ url: "x" }] })),
        { readerUrl: "https://cdn.example.com/reader.js" },
      ),
    ).toThrow(/bundle all components/);
  });
});

describe("CDN reader", () => {
  let outdir: string, home: string, server: Server, browser: Browser;
  let entry = "";
  const hosted = new Map<string, string>();
  beforeAll(async () => {
    outdir = await mkdtemp(join(tmpdir(), "showai-cdn-reader-"));
    home = await mkdtemp(join(tmpdir(), "showai-cdn-home-"));
    entry = (await buildCdnReader(outdir)).manifest.entry;
    server = createServer(async (request, response) => {
      const path = new URL(request.url!, "http://host").pathname;
      if (hosted.has(path)) {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        return response.end(hosted.get(path));
      }
      try {
        const file = normalize(join(outdir, path));
        if (!file.startsWith(outdir)) throw new Error("outside");
        response.setHeader("Content-Type", "text/javascript");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.end(await readFile(file));
      } catch {
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    browser = await chromium.launch();
  }, 300_000);
  afterAll(async () => {
    await browser?.close();
    await new Promise((done) => server?.close(done));
    await rm(outdir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("mounts built-in and custom components from a small fragment under a strict host policy", async () => {
    const store = new FileStore(home),
      project = await store.createProject({ name: "CDN" });
    const slider = await importComponent(
      home,
      resolve("resources/catalog/value-slider"),
      project.id,
    );
    const doc = createResource(blankDocument());
    doc.content.content = [
      {
        type: "widget",
        attrs: {
          id: "scene",
          kind: "scene-3d",
          data: components.find((item) => item.kind === "scene-3d")!
            .defaultData,
        },
      },
      {
        type: "widget",
        attrs: {
          id: "slider",
          kind: "custom",
          data: componentWidgetData(slider),
        },
      },
    ];
    doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["scene", "slider"];
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    const origin = `http://127.0.0.1:${address.port}`;
    const fragment = toCdnFragment(
      await buildPageHtml(doc, undefined, [slider]),
      { readerUrl: `${origin}/${entry}` },
    );
    // The page data dominates; the reader itself is not embedded.
    expect(Buffer.byteLength(fragment)).toBeLessThan(
      Buffer.byteLength(JSON.stringify(slider)) + 20_000,
    );
    const source =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'">${fragment}`
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;");
    hosted.set(
      "/host",
      `<iframe title="Host" sandbox="allow-scripts allow-same-origin" style="width:900px;height:900px" srcdoc="${source}"></iframe>`,
    );
    const tab = await browser.newPage();
    const errors: string[] = [];
    const requested: string[] = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("request", (request) => requested.push(request.url()));
    await tab.goto(`${origin}/host`);
    const frame = tab.frameLocator('iframe[title="Host"]');
    await frame.getByRole("slider", { name: "转动" }).waitFor();
    await frame.locator("canvas.s3-canvas").waitFor();
    // The custom component runs through its inline runtime on the shared React.
    const custom = frame.getByRole("slider").last();
    await custom.waitFor();
    await expect(
      frame.locator("[data-showai-placeholder]").count(),
    ).resolves.toBe(0);
    // Blocks load on demand: the 3D chunk arrives, unused heavy blocks do not.
    expect(requested.some((url) => /\/chunks\/Scene3D-/.test(url))).toBe(true);
    expect(
      requested.some((url) => /\/chunks\/(pdf-engine|G2Chart)-/.test(url)),
    ).toBe(false);
    expect(errors).toEqual([]);
  }, 180_000);
});
