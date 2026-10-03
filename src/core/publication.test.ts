import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";
import { FileStore } from "./store";
import {
  blankDocument,
  componentWidgetData,
  saveComponent,
  saveTemplate,
  readComponentSource,
} from "./catalog";
import {
  listPublishedComponents,
  listPublications,
  loadRemoteComponents,
  preparePublication,
  verifyPublication,
} from "./publication";
import { assertExportDestination, exportPage } from "../agent/exporter";
import { parseArtifact } from "../portable/validation.mjs";
import { publicationUrl } from "../portable/remote.mjs";
import type { PackageRevisionRef } from "../components/custom/types";

const roots: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((done, reject) =>
            server.close((error) => (error ? reject(error) : done())),
          ),
      ),
  );
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-publication-"));
  roots.push(root);
  const home = join(root, "home"),
    store = new FileStore(home);
  const project = await store.createProject({ name: "Publication checks" });
  const component = await saveComponent(
    home,
    {
      manifest: {
        id: "published-counter",
        name: "Published counter",
        version: "1.0.0",
        description: "A local interactive counter",
        scenarios: ["Interaction"],
        effects: ["Clicking increments the displayed value"],
        entry: "index.tsx",
        defaultData: { label: "Count", value: 0 },
        examples: [{ name: "Start", data: { label: "Count", value: 0 } }],
      },
      schema: {
        type: "object",
        properties: { label: { type: "string" }, value: { type: "number" } },
        required: ["label", "value"],
        additionalProperties: false,
      },
      source:
        'import {useState} from "react";export default function Counter({data}){const[value,setValue]=useState(data.value);return <button aria-label="Increase count" onClick={()=>setValue(value+1)}>{data.label}: <output>{value}</output></button>}',
    },
    project.id,
  );
  const document = blankDocument();
  document.title = "Publication verification";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        kind: "custom",
        data: componentWidgetData(component, { label: "Count", value: 7 }),
      },
    },
  ];
  const page = await store.createPage(project.id, { document });
  const ref: PackageRevisionRef = {
    kind: "component",
    id: component.id,
    version: component.version,
    integrity: component.integrity,
    scope: "project",
    projectId: project.id,
  };
  return { root, home, store, project, component, page, ref };
}

async function serve(directory: string) {
  const state = {
    cors: true,
    requests: [] as { path: string; cookie?: string; authorization?: string }[],
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://127.0.0.1").pathname;
    state.requests.push({
      path,
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    });
    const target = resolve(directory, "." + decodeURIComponent(path));
    if (!target.startsWith(resolve(directory) + "/")) {
      response.writeHead(403).end();
      return;
    }
    const content = await readFile(target).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (!content) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(state.cors ? { "Access-Control-Allow-Origin": "*" } : {}),
    });
    response.end(content);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server has no port.");
  return { ...state, state, origin: `http://127.0.0.1:${address.port}` };
}

describe("publication and component delivery", () => {
  it("prepares without publishing, verifies real HTTP bytes, and exports locked remote or bundled artifacts", async () => {
    const f = await fixture();
    const prepared = await preparePublication(f.home, {
      refs: [f.ref],
      projectId: f.project.id,
      out: join(f.root, "release"),
    });
    expect(prepared.status).toBe("prepared");
    const metadata = JSON.parse(
      await readFile(join(prepared.path, "metadata.json"), "utf8"),
    );
    expect(metadata.packages[0]).toMatchObject({
      name: "Published counter",
      scenarios: ["Interaction"],
      effects: ["Clicking increments the displayed value"],
    });
    expect(await listPublishedComponents(f.home)).toEqual([]);
    const options = {
      root: f.home,
      projectId: f.project.id,
      pageId: f.page.document.id,
      format: "html" as const,
      out: join(f.root, "remote.html"),
      components: "remote" as const,
    };
    await expect(exportPage(options)).rejects.toThrow(
      "Unpublished dependencies",
    );
    const server = await serve(prepared.path);
    const verified = await verifyPublication(f.home, {
      manifestUrl: server.origin + "/manifest.json",
      projectId: f.project.id,
    });
    expect(verified.status).toBe("published");
    expect(verified.components).toHaveLength(1);
    expect(verified.components[0].ref.integrity).toBe(f.component.integrity);
    expect((await loadRemoteComponents(verified.components))[0].html).toBe(
      f.component.html,
    );
    const requests = server.state.requests.length;
    const remote = await exportPage(options);
    const artifact = parseArtifact(
      await readFile(remote.sourcePaths[0], "utf8"),
    );
    expect(artifact.components).toBeUndefined();
    expect(artifact.remoteComponents?.[0].ref.integrity).toBe(
      f.component.integrity,
    );
    expect(artifact.document.content.content?.[0].attrs?.data.integrity).toBe(
      f.component.integrity,
    );
    expect(remote.requiresNetwork).toBe(true);
    const bundled = await exportPage({
      ...options,
      components: "bundled",
      out: join(f.root, "offline.html"),
    });
    const offline = parseArtifact(
      await readFile(bundled.sourcePaths[0], "utf8"),
    );
    expect(offline.components?.[0].integrity).toBe(f.component.integrity);
    expect(offline.remoteComponents).toBeUndefined();
    expect(bundled.requiresNetwork).toBe(false);
    expect(server.state.requests.length).toBe(requests);
    await expect(
      exportPage({
        ...options,
        format: "inline",
        out: join(f.root, "inline.html"),
      }),
    ).rejects.toThrow("must bundle");
    const missing = {
      ...verified.components[0],
      ref: { ...verified.components[0].ref, version: "9.9.9" },
    };
    await expect(loadRemoteComponents([missing])).rejects.toThrow(
      "exact component revision",
    );
  });

  it("publishes a template closure while exported pages include only their used components", async () => {
    const f = await fixture();
    const template = await saveTemplate(
      f.home,
      {
        id: "published-page",
        name: "Published page",
        version: "1.0.0",
        description: "A reusable page",
        document: f.page.document,
      },
      f.project.id,
    );
    const prepared = await preparePublication(f.home, {
      refs: [
        {
          kind: "template",
          id: template.id,
          version: template.version,
          integrity: template.integrity,
          scope: "project",
          projectId: f.project.id,
        },
      ],
      projectId: f.project.id,
      out: join(f.root, "template-release"),
    });
    const server = await serve(prepared.path);
    const verified = await verifyPublication(f.home, {
      manifestUrl: server.origin + "/manifest.json",
    });
    expect(verified.components[0].bundleRef.kind).toBe("template");
    expect((await loadRemoteComponents(verified.components))[0].integrity).toBe(
      f.component.integrity,
    );
    const site = await exportPage({
      root: f.home,
      projectId: f.project.id,
      format: "site",
      components: "remote",
      out: join(f.root, "site"),
    });
    const source = parseArtifact(await readFile(site.sourcePaths[0], "utf8"));
    expect(source.remoteComponents).toHaveLength(1);
    expect(source).not.toHaveProperty("templates");
    const textTemplate = await saveTemplate(
      f.home,
      {
        id: "text-only",
        name: "Text only",
        version: "1.0.0",
        description: "No custom dependencies",
        document: blankDocument(),
      },
      f.project.id,
    );
    const plainRelease = await preparePublication(f.home, {
      refs: [
        {
          kind: "template",
          id: textTemplate.id,
          version: textTemplate.version,
          integrity: textTemplate.integrity,
        },
      ],
      projectId: f.project.id,
      out: join(f.root, "plain-release"),
    });
    const plainServer = await serve(plainRelease.path);
    const plainVerified = await verifyPublication(f.home, {
      manifestUrl: plainServer.origin + "/manifest.json",
    });
    expect(plainVerified.components).toEqual([]);
    const receipts = await listPublications(f.home);
    expect(receipts).toHaveLength(2);
    expect(
      receipts.some(
        (receipt) =>
          receipt.releaseId === plainVerified.releaseId &&
          receipt.components.length === 0,
      ),
    ).toBe(true);
  });

  it("lists every unpublished dependency instead of silently substituting another revision", async () => {
    const f = await fixture();
    const source = await readComponentSource(
      f.home,
      f.component.id,
      f.component.version,
      f.project.id,
    );
    const second = await saveComponent(
      f.home,
      {
        ...source,
        manifest: {
          ...source.manifest,
          id: "second-counter",
          name: "Second counter",
        },
      },
      f.project.id,
    );
    const document = structuredClone(f.page.document);
    document.content.content!.push({
      type: "widget",
      attrs: { kind: "custom", data: componentWidgetData(second) },
    });
    await f.store.savePage(f.project.id, document.id, document, f.page.hash);
    const options = {
      root: f.home,
      projectId: f.project.id,
      pageId: document.id,
      format: "html" as const,
      components: "remote" as const,
      out: join(f.root, "missing.html"),
    };
    const error = await exportPage(options).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("published-counter@1.0.0");
    expect((error as Error).message).toContain("second-counter@1.0.0");
    expect((error as Error).message).toContain(second.integrity);
  });

  it("never registers failed verification and protects authoring catalogs from output aliases", async () => {
    const f = await fixture();
    const prepared = await preparePublication(f.home, {
      refs: [f.ref],
      projectId: f.project.id,
      out: join(f.root, "release"),
    });
    const server = await serve(prepared.path);
    server.state.cors = false;
    await expect(
      verifyPublication(f.home, {
        manifestUrl: server.origin + "/manifest.json",
      }),
    ).rejects.toThrow("Access-Control-Allow-Origin");
    expect(await listPublishedComponents(f.home)).toEqual([]);
    server.state.cors = true;
    const file = join(prepared.path, prepared.manifest.packages[0].file),
      bytes = await readFile(file);
    bytes[bytes.length - 3] ^= 1;
    await writeFile(file, bytes);
    await expect(
      verifyPublication(f.home, {
        manifestUrl: server.origin + "/manifest.json",
      }),
    ).rejects.toThrow("SHA-256");
    expect(await listPublishedComponents(f.home)).toEqual([]);
    expect(() => publicationUrl("http://example.com/package.json")).toThrow(
      "HTTPS",
    );
    expect(() => publicationUrl("file:///tmp/package.json")).toThrow(
      "forbidden",
    );
    expect(() =>
      publicationUrl("https://name:password@example.com/package.json"),
    ).toThrow("Credentials");
    await expect(
      assertExportDestination(
        f.home,
        f.project.id,
        join(f.home, "packages/global/something.json"),
      ),
    ).rejects.toThrow("catalog");
    await mkdir(join(f.home, "publications/verified"), { recursive: true });
    await symlink(join(f.home, "publications"), join(f.root, "alias"));
    await expect(
      assertExportDestination(
        f.home,
        f.project.id,
        join(f.root, "alias/verified/receipt.json"),
      ),
    ).rejects.toThrow("protected");
  });

  it("loads a remote HTML in a real browser, remains sandboxed, and shows integrity/CORS/offline errors", async () => {
    const f = await fixture();
    const prepared = await preparePublication(f.home, {
      refs: [f.ref],
      projectId: f.project.id,
      out: join(f.root, "release"),
    });
    const server = await serve(prepared.path);
    await verifyPublication(f.home, {
      manifestUrl: server.origin + "/manifest.json",
    });
    const remote = await exportPage({
      root: f.home,
      projectId: f.project.id,
      pageId: f.page.document.id,
      format: "html",
      components: "remote",
      out: join(f.root, "remote.html"),
    });
    const bundled = await exportPage({
      root: f.home,
      projectId: f.project.id,
      pageId: f.page.document.id,
      format: "html",
      out: join(f.root, "bundled.html"),
    });
    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
    });
    try {
      const context = await browser.newContext();
      await context.addCookies([
        {
          name: "publication-session",
          value: "must-not-be-sent",
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
      const page = await context.newPage();
      await page.goto(pathToFileURL(remote.path).href);
      const button = page
        .frameLocator('iframe[title="Published counter"]')
        .getByRole("button", { name: "Increase count" });
      await button.waitFor();
      expect(await button.innerText()).toContain("7");
      await button.click();
      expect(await button.innerText()).toContain("8");
      expect(await page.locator("iframe").getAttribute("sandbox")).toBe(
        "allow-scripts",
      );
      expect(
        await page.locator(".portable-network-note").innerText(),
      ).toContain("需要联网");
      expect(
        server.state.requests.every(
          (request) => !request.cookie && !request.authorization,
        ),
      ).toBe(true);
      const output = resolve("output/playwright/publication");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: join(output, "remote-interaction.png"),
        fullPage: true,
      });
      const file = join(prepared.path, prepared.manifest.packages[0].file),
        original = await readFile(file),
        corrupt = Buffer.from(original);
      corrupt[corrupt.length - 3] ^= 1;
      await writeFile(file, corrupt);
      await page.reload();
      await page.getByRole("alert").filter({ hasText: "校验失败" }).waitFor();
      expect(await page.locator("iframe").count()).toBe(0);
      await page.screenshot({
        path: join(output, "integrity-error.png"),
        fullPage: true,
      });
      await writeFile(file, original);
      server.state.cors = false;
      await page.reload();
      await page.getByRole("alert").filter({ hasText: "CORS" }).waitFor();
      expect(await page.locator("iframe").count()).toBe(0);
      server.state.cors = true;
      await context.setOffline(true);
      await page.reload();
      await page
        .getByRole("alert")
        .filter({ hasText: "无法加载组件" })
        .waitFor();
      await page.goto(pathToFileURL(bundled.path).href);
      const offlineButton = page
        .frameLocator('iframe[title="Published counter"]')
        .getByRole("button", { name: "Increase count" });
      await offlineButton.waitFor();
      await offlineButton.click();
      expect(await offlineButton.innerText()).toContain("8");
      expect(await page.getByRole("alert").count()).toBe(0);
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60000);

  it("materializes a thin page in the actual web canvas and preserves its old page when verification fails", async () => {
    const f = await fixture();
    const prepared = await preparePublication(f.home, {
      refs: [f.ref],
      projectId: f.project.id,
      out: join(f.root, "release"),
    });
    const server = await serve(prepared.path);
    await verifyPublication(f.home, {
      manifestUrl: server.origin + "/manifest.json",
    });
    const thin = await exportPage({
      root: f.home,
      projectId: f.project.id,
      pageId: f.page.document.id,
      format: "html",
      components: "remote",
      out: join(f.root, "remote.html"),
    });
    const vite = await createViteServer({
      root: resolve("."),
      cacheDir: join(f.root, "vite-cache"),
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      logLevel: "silent",
    });
    await vite.listen();
    const address = vite.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("Canvas server has no address.");
    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page
        .getByRole("textbox", { name: "页面标题", exact: true })
        .fill("Retained local page");
      await page
        .getByRole("textbox", { name: "文档内容", exact: true })
        .fill("Keep this content after a failed import.");
      await page.waitForFunction(() =>
        localStorage.getItem("showai.canvas.v1")?.includes("Keep this content"),
      );
      const previous = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("showai.canvas.v1")!),
      );
      const file = join(prepared.path, prepared.manifest.packages[0].file),
        original = await readFile(file),
        corrupt = Buffer.from(original);
      corrupt[corrupt.length - 3] ^= 1;
      await writeFile(file, corrupt);
      const open = async () => {
        await page
          .getByRole("button", { name: "页面选项", exact: true })
          .click();
        const chooser = page.waitForEvent("filechooser");
        await page
          .getByRole("menuitem", { name: "打开页面…", exact: true })
          .click();
        await (await chooser).setFiles(thin.sourcePaths[0]);
      };
      await open();
      await page.getByRole("alert").filter({ hasText: "打开失败" }).waitFor();
      expect(
        await page
          .getByRole("textbox", { name: "页面标题", exact: true })
          .inputValue(),
      ).toBe("Retained local page");
      expect(
        await page
          .getByRole("textbox", { name: "文档内容", exact: true })
          .innerText(),
      ).toContain("Keep this content");
      expect(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("showai.canvas.v1")!),
        ),
      ).toEqual(previous);
      const output = resolve("output/playwright/publication");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: join(output, "canvas-failed-import.png"),
        fullPage: true,
      });
      await writeFile(file, original);
      await open();
      const button = page
        .frameLocator('iframe[title="Published counter"]')
        .getByRole("button", { name: "Increase count" });
      await button.waitFor();
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("showai.canvas.v1")!),
      );
      expect(stored.components).toHaveLength(1);
      expect(stored.remoteComponents).toBeUndefined();
      expect(stored.components[0].integrity).toBe(f.component.integrity);
      const requests = server.state.requests.length;
      server.state.cors = false;
      await page.reload();
      await button.waitFor();
      await button.click();
      expect(await button.innerText()).toContain("8");
      expect(server.state.requests.length).toBe(requests);
      await context.close();
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 60000);
});
