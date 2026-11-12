import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import {
  blankDocument,
  componentWidgetData,
  importComponent,
} from "../core/catalog";
import { createResource } from "../document/containers.mjs";
import { FileStore } from "../core/store";
import { AgentService } from "./service";
import { LibraryOperations } from "../core/library-operations";
import { openLibrary } from "../core/open-library";
import { exportPage } from "./exporter";
import { assertInlineArtifact } from "../portable/inline.mjs";
import { parseArtifact } from "../portable/validation.mjs";
import type { ShowDocument } from "../types";

let browser: Browser;
let server: Server;
let address: string;
let home: string;
const pages = new Map<string, string>();
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-nested-custom-"));
  await openLibrary(home);
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(pages.get(request.url!) ?? "");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address();
  if (!port || typeof port === "string")
    throw new Error("Test server unavailable");
  address = `http://127.0.0.1:${port.port}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  await rm(home, { recursive: true, force: true });
});

/** A text block and a stepper step that each hold a library component. */
function nestedPage(data: Record<string, unknown>) {
  const doc = createResource(blankDocument());
  doc.title = "Nested custom components";
  const custom = (id: string, label: string) => ({
    type: "widget",
    attrs: {
      id,
      kind: "custom",
      data: { ...data, props: { ...(data.props as object), label } },
    },
  });
  doc.content.content = [
    {
      type: "widget",
      attrs: {
        id: "note",
        kind: "text",
        data: {
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Adjust the threshold." }],
              },
              custom("in-text", "Threshold in text"),
            ],
          },
        },
      },
    },
    {
      type: "widget",
      attrs: {
        id: "steps",
        kind: "stepper",
        data: {
          steps: [
            {
              title: "Step one",
              content: {
                type: "doc",
                content: [custom("in-step", "Threshold in step")],
              },
            },
          ],
        },
      },
    },
  ] as ShowDocument["content"]["content"];
  doc.surfaceViews[doc.content.attrs!.id].readingOrder = ["note", "steps"];
  return doc;
}

function nestedCustom(document: ShowDocument) {
  const text = document.content.content!.find(
    (node) => node.attrs?.id === "note",
  )!;
  return (text.attrs!.data as any).content.content[1].attrs.data;
}

test("library components inside rich text are locked, bundled and rendered offline", async () => {
  const store = new FileStore(home),
    project = await store.createProject({ name: "Nested" });
  const slider = await importComponent(
    home,
    resolve("resources/catalog/value-slider"),
    project.id,
  );
  const { integrity, ...unpinned } = componentWidgetData(slider);
  expect(integrity).toBeTruthy();
  const record = await new AgentService({ root: home }).createPage(
    project.id,
    { document: nestedPage(unpinned) },
  );
  // Saving pins the nested reference like a top-level one.
  expect(nestedCustom(record.document)).toMatchObject({
    componentId: slider.id,
    version: slider.version,
    integrity: slider.integrity,
  });
  // "Where is this component used" counts the nested blocks.
  const used = await new LibraryOperations(home, project.id).references(
    "component",
    slider.id,
  );
  expect(used.map((edge) => edge.blockId).sort()).toEqual([
    "in-step",
    "in-text",
  ]);
  const exported = await exportPage({
    root: home,
    projectId: project.id,
    pageId: record.document.id,
    format: "html",
    out: join(home, "exports", "nested.html"),
  });
  const html = await readFile(exported.path, "utf8");
  const source = parseArtifact(
    JSON.parse(await readFile(exported.sourcePaths[0], "utf8")),
  );
  expect(source.components?.map((item) => item.id)).toEqual([slider.id]);
  // A conversation preview requires the nested component's inline runtime.
  expect(() => assertInlineArtifact({ ...source, components: [] })).toThrow(
    /value-slider@1\.2\.0/,
  );
  pages.set("/nested", html);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(address + "/nested");
  await page.getByText("Adjust the threshold.", { exact: true }).waitFor();
  // Standalone pages run library components in sandboxed frames.
  for (const label of ["Threshold in text", "Threshold in step"])
    await expect
      .poll(
        async () => {
          for (const frame of page.frames())
            if (await frame.getByText(label, { exact: true }).count())
              return frame.getByRole("slider").count();
          return 0;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
  await expect(
    page.locator("[data-showai-placeholder]").count(),
  ).resolves.toBe(0);
  expect(await page.locator("body").innerText()).not.toContain("暂时无法显示");
  expect(errors).toEqual([]);
  await page.close();
}, 180_000);
