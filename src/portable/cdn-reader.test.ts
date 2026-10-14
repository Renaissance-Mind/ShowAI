import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { toCdnFragment, toCdnPage } from "./cdn-fragment.mjs";
import { exportPage } from "../agent/exporter";
import { presentPage } from "../agent/page-presentation";
import { readFile, writeFile } from "node:fs/promises";
import { startCdnHost } from "./cdn-test-host";
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
      'for(const url of ["https://cdn.example.com/showai/reader-ABC.js"])',
    );
    expect(fragment).toContain("reader.mount(root,{artifact})");
    expect(fragment).toContain(
      '<section id="showai-test" data-showai-inline-root lang="en">',
    );
    // The page title cannot close the loader script.
    expect(fragment.match(/<\/script>/g)).toHaveLength(1);
    const data = fragment.match(/const artifact=(\{.*?\});let failure/s)![1];
    expect(JSON.parse(data)).toEqual(artifact);
  });

  it("tries each reader source in order", () => {
    const fragment = toCdnFragment(page(JSON.stringify(artifact)), {
      readerUrls: [
        "https://cdn.jsdelivr.net/npm/showai-reader@1.0.0/reader-A.js",
        "https://unpkg.com/showai-reader@1.0.0/reader-A.js",
      ],
    });
    expect(fragment).toContain(
      'for(const url of ["https://cdn.jsdelivr.net/npm/showai-reader@1.0.0/reader-A.js","https://unpkg.com/showai-reader@1.0.0/reader-A.js"])',
    );
  });

  it("writes a complete online page that mounts as a standalone reader", () => {
    const html = toCdnPage(
      page(JSON.stringify(artifact)).replace(
        "<body>",
        "<head><title>Note &lt;1&gt;</title></head><body>",
      ),
      { readerUrl: "https://cdn.example.com/reader-A.js", id: "showai-page" },
    );
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>Note &lt;1&gt;</title>");
    expect(html).toContain('<div id="showai-page">');
    expect(html).toContain("reader.mount(root,{artifact,standalone:true})");
    expect(html).not.toContain("data-showai-inline-root");
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
  let outdir: string, home: string, browser: Browser;
  let host: Awaited<ReturnType<typeof startCdnHost>>;
  let entry = "";
  beforeAll(async () => {
    outdir = await mkdtemp(join(tmpdir(), "showai-cdn-reader-"));
    home = await mkdtemp(join(tmpdir(), "showai-cdn-home-"));
    entry = (await buildCdnReader(outdir)).manifest.entry;
    host = await startCdnHost(outdir);
    browser = await chromium.launch();
  }, 300_000);
  afterAll(async () => {
    await browser?.close();
    await host?.close();
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
    const fragment = toCdnFragment(
      await buildPageHtml(doc, undefined, [slider]),
      { readerUrl: `${host.origin}/${entry}` },
    );
    // The page data dominates; the reader itself is not embedded.
    expect(Buffer.byteLength(fragment)).toBeLessThan(
      Buffer.byteLength(JSON.stringify(slider)) + 20_000,
    );
    const url = host.host("/host", fragment);
    const tab = await browser.newPage();
    const errors: string[] = [];
    const requested: string[] = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("request", (request) => requested.push(request.url()));
    await tab.goto(url);
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

  it("exports online pages and conversation previews through the configured CDN", async () => {
    const saved = { ...process.env };
    await writeFile(
      join(outdir, "manifest-for-runtime.json"),
      await readFile(join(outdir, "manifest.json")),
    );
    process.env.SHOWAI_CDN_MANIFEST = join(outdir, "manifest-for-runtime.json");
    process.env.SHOWAI_READER_CDN = host.origin;
    try {
      const store = new FileStore(home),
        project = await store.createProject({ name: "Online" });
      const doc = createResource(blankDocument());
      doc.title = "Online page";
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
      ];
      doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["scene"];
      const record = await store.createPage(project.id, { document: doc });
      const pageId = record.document.id;
      const online = await exportPage({
        root: home,
        projectId: project.id,
        pageId,
        format: "html",
        reader: "cdn",
        out: join(home, "exports", "online.html"),
      });
      expect(online).toMatchObject({ reader: "cdn", requiresNetwork: true });
      expect(online.bytes).toBeLessThan(20_000);
      const offline = await exportPage({
        root: home,
        projectId: project.id,
        pageId,
        format: "html",
        out: join(home, "exports", "offline.html"),
      });
      expect(offline).toMatchObject({
        reader: "bundled",
        requiresNetwork: false,
      });
      const inline = await exportPage({
        root: home,
        projectId: project.id,
        pageId,
        format: "inline",
        out: join(home, "exports", "inline.html"),
      });
      expect(inline.reader).toBe("cdn");
      expect(await readFile(inline.path, "utf8")).toContain(`import(url)`);
      // page_present keeps the offline file and adds the CDN preview and online page.
      const presented = await presentPage({
        root: home,
        projectId: project.id,
        pageId,
      });
      expect(presented.inline).toContain("data-showai-inline-root");
      expect(presented.inline).toContain(host.origin);
      expect(presented.online).toContain("standalone:true");
      expect(presented.html).not.toContain(host.origin);

      // The online page is an ordinary standalone reader with its page menu.
      const tab = await browser.newPage();
      const errors: string[] = [];
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.goto(host.page("/online", await readFile(online.path, "utf8")));
      await tab.getByRole("slider", { name: "转动" }).waitFor();
      await tab.locator("canvas.s3-canvas").waitFor();
      await expect(
        tab.getByRole("button", { name: "页面选项" }).isVisible(),
      ).resolves.toBe(true);
      await expect(
        tab.evaluate(() => document.documentElement.dataset.theme),
      ).resolves.toMatch(/light|dark/);
      expect(errors).toEqual([]);
      await tab.close();
    } finally {
      process.env = saved;
    }
  }, 300_000);
});
