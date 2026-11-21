import { expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chromium, type Page, type FrameLocator } from "playwright-core";
import { createMcpServer } from "./mcp";
import { AgentService } from "./service";
import { readingBrowserExecutable } from "./reading-renderer";
import { syncManager } from "../sync/manager";
import { statusTagComponent } from "../test/page-reference-components";
import { renderHtmlVisuals } from "./presentation";
import { componentResourceUri } from "./mcp-ui";

const oneOff =
  '<button id="read">Read status</button><output></output><script>document.querySelector("button").onclick=()=>{document.querySelector("output").textContent="Ready"}</script>';
const parameterized = oneOff.replace('"Ready"', "window.showaiData.label");

async function readStatus(
  page: Page | FrameLocator,
  index: number,
  expected: string,
) {
  const visual = page
    .locator("showai-html-visual")
    .nth(index)
    .frameLocator("iframe");
  await visual
    .locator("html[data-showai-html-ready]")
    .waitFor({ state: "attached" });
  await visual
    .getByRole("button", { name: "Read status" })
    .click({ timeout: 15_000 });
  await expect
    .poll(() => visual.locator("output").textContent())
    .toBe(expected);
}

test("direct HTML stays selectable, isolated and interactive, then registers and renders with different data", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-html-visual-"));
  const service = new AgentService({ root });
  const project = await service.createProject("HTML visual acceptance");
  const server = createMcpServer({
    root,
    projectId: project.id,
    presentationDirectory: join(root, "previews"),
  });
  const client = new Client({ name: "html-visual-acceptance", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const browser = await chromium.launch({
    executablePath: await readingBrowserExecutable(),
    headless: true,
  });
  try {
    await server.connect(right);
    await client.connect(left);
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      return {
        ...result,
        data: (result.structuredContent as { data: Record<string, unknown> })
          .data,
      };
    };
    const page = await browser.newPage({
      viewport: { width: 480, height: 600 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const shown = await call("show_component", {
      html: ["<p>First visual</p>", oneOff],
      delivery: "fragment-file",
    });
    const receipt = shown.data as {
      delivery: { inline: string };
      source: string;
      persistence: { savedToProject: boolean };
    };
    expect(receipt.persistence.savedToProject).toBe(false);
    const recovered = JSON.parse(await readFile(receipt.source, "utf8")).html[1]
      .html;
    expect(recovered).toBe(oneOff);
    const inline = await readFile(receipt.delivery.inline, "utf8");
    expect(inline).not.toContain('id="showai-data"');
    await page.goto(pathToFileURL(receipt.delivery.inline).href);
    await readStatus(page, 1, "Ready");
    expect(await page.locator("showai-html-visual iframe").count()).toBe(2);
    expect(
      await page
        .locator("showai-html-visual iframe")
        .first()
        .getAttribute("sandbox"),
    ).toBe("allow-scripts");
    expect(await service.listPages(project.id)).toHaveLength(0);

    const source = statusTagComponent("interactive-html-status");
    source.manifest.entry = "visual.html";
    source.manifest.documentation!.development.entryPoints = [
      { path: "visual.html", purpose: "Read the selected status." },
    ];
    source.source = recovered.replace('"Ready"', "window.showaiData.label");
    const original = { label: "Ready" };
    const alternate = { label: "评审中 · O'Reilly <&>" };
    source.manifest.defaultData = original;
    source.manifest.examples = [{ name: "Original", data: original }];
    const rejected = await client.callTool({
      name: "component_save",
      arguments: { source },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain(
      "second example dataset",
    );
    source.manifest.examples = [{ name: "Review", data: alternate }];
    const compared = await call("show_component", {
      html: [original, alternate].map((data) => ({
        html: source.source,
        data,
      })),
      delivery: "fragment-file",
    });
    const comparison = compared.data as { delivery: { inline: string } };
    await page.goto(pathToFileURL(comparison.delivery.inline).href);
    await readStatus(page, 0, original.label);
    await readStatus(page, 1, alternate.label);

    const saved = await call("component_save", { source });
    const savedData = saved.data as {
      id: string;
      version: string;
      integrity: string;
    };
    const blocks = [original, alternate].map((props) => ({
      kind: "custom",
      data: {
        componentId: savedData.id,
        version: savedData.version,
        integrity: savedData.integrity,
        props,
      },
    }));
    const created = await service.createPage(project.id, {
      title: "Statuses",
      blocks,
    });
    const view = await call("page_present", { pageId: created.document.id });
    const viewData = view.data as { delivery: { html: string } };
    await page.goto(pathToFileURL(viewData.delivery.html).href);
    for (const [index, value] of [original, alternate].entries()) {
      const blockId = created.document.content.content![index].attrs!.id;
      const block = page.locator(`[data-block-id="${blockId}"]`).first();
      await block.scrollIntoViewIfNeeded();
      const component = block.frameLocator("iframe").first();
      const visual = component.frameLocator("showai-html-visual iframe");
      await visual
        .getByRole("button", { name: "Read status" })
        .click({ timeout: 15_000 });
      expect(await visual.locator("output").textContent()).toBe(value.label);
    }

    const alternateBlock = created.document.content.content![1].attrs!.id;
    const inspected = await call("page_read", {
      pageId: created.document.id,
      blockIds: [alternateBlock],
      view: "html",
      actions: [
        {
          type: "click",
          blockId: alternateBlock,
          role: "button",
          name: "Read status",
        },
      ],
      out: join(root, "inspected.html"),
    });
    const inspection = JSON.parse(
      await readFile(String(inspected.data.metadataPath), "utf8"),
    );
    expect(inspection.dom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockId: alternateBlock,
          accessibility: expect.stringContaining(alternate.label),
        }),
      ]),
    );

    const app = await call("show_component", {
      html: parameterized,
      data: alternate,
      delivery: "mcp-app",
    });
    const resource = await client.readResource({
      uri: componentResourceUri,
    });
    const appPath = join(root, "mcp-app.html");
    const reader = resource.contents[0];
    if (!("text" in reader)) throw new Error("Expected an HTML resource.");
    await writeFile(appPath, reader.text);
    const hostPath = join(root, "host.html");
    await writeFile(
      hostPath,
      `<script>window.addEventListener("message", event => {
        if(event.data.method === "ui/initialize") document.documentElement.dataset.request = JSON.stringify(event.data.id);
        if(event.data.method === "ui/notifications/initialized") document.documentElement.dataset.connected = "true";
      });</script><iframe title="Tool view" sandbox="allow-scripts" width="460" height="320" src="mcp-app.html"></iframe>`,
    );
    await page.goto(pathToFileURL(hostPath).href);
    const appElement = page.locator('iframe[title="Tool view"]');
    const appFrame = appElement.contentFrame();
    await appFrame.locator("#reader").waitFor({ state: "attached" });
    await appElement.evaluate(
      (node, result) => {
        (node as HTMLIFrameElement).contentWindow!.postMessage(
          {
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: result,
          },
          "*",
        );
      },
      { _meta: app._meta, structuredContent: app.structuredContent },
    );
    await readStatus(appFrame, 0, alternate.label);
    await appElement.evaluate((node) => {
      (node as HTMLIFrameElement).contentWindow!.postMessage(
        {
          jsonrpc: "2.0",
          id: JSON.parse(document.documentElement.dataset.request!),
          result: { hostCapabilities: { updateModelContext: true } },
        },
        "*",
      );
    });
    await page
      .locator('html[data-connected="true"]')
      .waitFor({ state: "attached" });
    expect(
      await appFrame
        .frameLocator("showai-html-visual iframe")
        .locator("output")
        .textContent(),
    ).toBe(alternate.label);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await client.close();
    await server.close();
    await syncManager(root).stop();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);

test("HTML input rejects conflicting catalog or per-visual inputs", () => {
  expect(() => renderHtmlVisuals({ html: oneOff, kind: "custom" })).toThrow(
    "Use kind/blocks",
  );
  expect(() => renderHtmlVisuals({ html: [oneOff], data: {} })).toThrow(
    "corresponding item",
  );
});
