import { test, expect } from "vitest";
import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import fixture from "./fixtures/legacy-component-v0.json";
import { FileStore } from "../core/store";
import {
  importCompiledComponents,
  getComponent,
  blankDocument,
  componentWidgetData,
} from "../core/catalog";
import { AgentService } from "./service";
import { createResource } from "../document/containers.mjs";
import { buildReaderSource } from "../../scripts/build-reader-source.mjs";
import { bundleReader } from "../portable/reader-bundle.mjs";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import type { CompiledComponent } from "../contract/types";
import type { ShowDocument } from "../types";

test("pre-contract compiled package and page preserve bytes and work in both execution modes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-legacy-abi-"));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const home = join(directory, "library"),
      store = new FileStore(home);
    const project = await store.createProject({ name: "历史 ABI 验证" });
    const legacy = fixture.component as CompiledComponent;
    expect(legacy.contract).toBeUndefined();
    expect(legacy.inline!.protocol).toBeUndefined();
    await importCompiledComponents(home, [legacy], project.id);
    const imported = await getComponent(
      home,
      legacy.id,
      legacy.version,
      project.id,
      { integrity: legacy.integrity },
    );
    expect(imported.html).toBe(legacy.html);
    expect(imported.inline).toEqual(legacy.inline);
    const agent = new AgentService({ root: home });
    const saved = await agent.createPage(project.id, {
      document: fixture.document as ShowDocument,
    });
    expect(saved.document.content).toEqual(fixture.document.content);
    const contract = (await agent.catalogDescribe(legacy.id, {
      projectId: project.id,
      scope: "project",
      version: legacy.version,
      integrity: legacy.integrity,
      view: "contract",
    })) as any;
    expect(contract.status).toBe("legacy");
    expect(contract.execution.inlineProtocol).toBe("legacy");
    const linked = createResource(blankDocument());
    linked.content.content = [
      {
        type: "widget",
        attrs: {
          id: "navigator",
          kind: "multi-level-view",
          data: {
            title: "旧版组件联动",
            root: "root",
            levels: [
              {
                id: "root",
                parentId: null,
                label: "历史入口",
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "widget",
                      attrs: {
                        id: "legacy",
                        kind: "custom",
                        data: componentWidgetData(imported),
                      },
                    },
                  ],
                },
                bindings: [
                  {
                    blockId: "legacy",
                    source: { type: "item", scope: "items", id: "open" },
                    to: "detail",
                  },
                ],
              },
              {
                id: "detail",
                parentId: "root",
                label: "历史子层",
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "旧版事件成功" }],
                    },
                  ],
                },
                bindings: [],
              },
            ],
          },
        },
      },
    ];
    linked.surfaceViews[linked.content.attrs!.id].readingOrder = ["navigator"];
    const runtime = join(directory, "runtime");
    await mkdir(join(runtime, "assets"), { recursive: true });
    await symlink(
      resolve("node_modules"),
      join(runtime, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const archive = join(runtime, "assets/reader-source.json");
    await buildReaderSource(resolve("."), archive);
    const pages = new Map<string, string>();
    for (const [name, document] of [
      ["plain", saved.document],
      ["linked", linked],
    ] as const) {
      const html = injectArtifactIntoHtml(
        await bundleReader(archive, [document]),
        document,
        [imported],
      );
      pages.set("/" + name, html);
      pages.set(
        "/" + name + "-inline",
        `<!doctype html><meta charset="utf-8">${toInlineFragment(html)}`,
      );
    }
    server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(pages.get(request.url!) ?? "");
    });
    await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    browser = await chromium.launch({ headless: true });
    for (const mode of ["", "-inline"]) {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}/plain${mode}`);
      const component = mode ? page : page.frameLocator("iframe");
      await component
        .getByRole("button", { name: "旧组件入口", exact: true })
        .click();
      await component.getByText("旧组件本地反馈", { exact: true }).waitFor();
      await page.goto(`http://127.0.0.1:${address.port}/linked${mode}`);
      await (mode ? page : page.frameLocator("iframe"))
        .getByRole("button", { name: "旧组件入口", exact: true })
        .click();
      await page
        .getByRole("region", { name: "历史子层", exact: true })
        .waitFor();
      expect(errors).toEqual([]);
      await page.close();
    }
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
