import { expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { chromium, type Page } from "playwright-core";
import { createMcpServer } from "./mcp";
import { AgentService } from "./service";
import { readingBrowserExecutable } from "./reading-renderer";
import { syncManager } from "../sync/manager";
import { statusTagComponent } from "../test/page-reference-components";
import { renderHtmlVisuals } from "./presentation";

const oneOff =
  '<button id="read">Read status</button><output></output><script>document.querySelector("button").onclick=()=>{document.querySelector("output").textContent="Ready"}</script>';
const parameterized = oneOff.replace('"Ready"', "window.showaiData.label");

async function readStatus(page: Page, index: number, expected: string) {
  const visual = page
    .locator("showai-html-visual")
    .nth(index)
    .frameLocator("iframe");
  await visual
    .getByRole("button", { name: "Read status" })
    .click({ timeout: 15_000 });
  expect(await visual.locator("output").textContent()).toBe(expected);
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

    const app = await call("show_component", {
      html: parameterized,
      data: alternate,
      delivery: "mcp-app",
    });
    const resource = await client.readResource({
      uri: "ui://showai/component-v2.html",
    });
    const appPath = join(root, "mcp-app.html");
    const reader = resource.contents[0];
    if (!("text" in reader)) throw new Error("Expected an HTML resource.");
    await writeFile(appPath, reader.text);
    await page.goto(pathToFileURL(appPath).href);
    await page.evaluate(
      (meta) =>
        window.postMessage(
          {
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: { _meta: meta },
          },
          "*",
        ),
      app._meta,
    );
    await readStatus(page, 0, alternate.label);
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
