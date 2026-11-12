import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { blankDocument, componentWidgetData, saveComponent } from "../core/catalog";
import { createResource } from "../document/containers.mjs";
import { findNodes } from "../document/update.mjs";
import { parseArtifact } from "../portable/validation.mjs";
import type { ShowDocument } from "../core/model";

/**
 * component.ref.set through MCP on a library component that sits in a
 * callout inside a text block: upgraded in place, read back, exported and
 * rendered offline with the new revision.
 */

let root: string;
let projectId: string;
let client: Client;
let server: ReturnType<typeof createMcpServer>;
let browser: Browser;
let http: Server;
let address: string;
const pages = new Map<string, string>();

async function call(name: string, args: Record<string, unknown> = {}) {
  const value = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
  return value.structuredContent as { ok: boolean; data: any; error?: any };
}
async function ok(name: string, args: Record<string, unknown> = {}) {
  const result = await call(name, args);
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.data;
}
const nested = (document: ShowDocument, id: string) =>
  findNodes(document.content, id, { scope: "content" })[0]?.node;

const revision = (version: string, heading: string) =>
  saveComponent(
    root,
    {
      manifest: {
        id: "nested-badge",
        name: "Nested badge",
        version,
        description: "A labelled badge",
        entry: "index.tsx",
        scenarios: ["Nested revision upgrade test"],
        defaultData: { label: "Badge" },
        examples: [],
      },
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: { label: { type: "string" } },
      } as never,
      source: `import React from "react";export default function Badge({data}){return <strong>${heading}: {data.label}</strong>}`,
    },
    projectId,
  );

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-nested-ref-"));
  await openLibrary(root);
  projectId = (await new AgentService({ root }).createProject("Nested ref")).id;
  server = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "nested-ref-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
  http = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(pages.get(request.url!) ?? "");
  });
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const port = http.address();
  if (!port || typeof port === "string") throw new Error("Test server unavailable");
  address = `http://127.0.0.1:${port.port}`;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done, reject) =>
    http.close((error) => (error ? reject(error) : done())),
  );
  await client?.close();
  await server?.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

test("component.ref.set upgrades a component nested in another component's content", async () => {
  const v1 = await revision("1.0.0", "Old");
  const v2 = await revision("2.0.0", "New");
  const document = createResource(blankDocument());
  document.title = "Nested upgrade";
  document.content.content = [
    {
      type: "widget",
      attrs: {
        id: "note",
        kind: "text",
        data: {
          content: {
            type: "doc",
            content: [
              { type: "paragraph", attrs: { id: "lead" }, content: [{ type: "text", text: "Lead paragraph" }] },
              {
                type: "widget",
                attrs: {
                  id: "box",
                  kind: "callout",
                  data: {
                    tone: "info",
                    content: {
                      type: "doc",
                      content: [
                        {
                          type: "widget",
                          attrs: {
                            id: "badge",
                            kind: "custom",
                            data: componentWidgetData(v1, { label: "Threshold" }),
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  ] as ShowDocument["content"]["content"];
  document.surfaceViews![document.content.attrs!.id].readingOrder = ["note"];
  const page = await ok("page_create", { document });
  expect(nested(page.document, "badge").attrs!.data.version).toBe("1.0.0");

  const upgraded = await ok("page_apply", {
    pageId: page.document.id,
    baseHash: page.hash,
    baseRevision: page.revision,
    operations: [
      {
        type: "component.ref.set",
        blockId: "badge",
        version: v2.version,
        integrity: v2.integrity,
      },
    ],
    response: "source",
  });
  expect(nested(upgraded.document, "badge").attrs!.data).toMatchObject({
    componentId: "nested-badge",
    version: "2.0.0",
    integrity: v2.integrity,
    props: { label: "Threshold" },
  });

  const read = await ok("page_read", { pageId: page.document.id, rendered: false });
  expect(nested(read.document, "badge").attrs!.data.version).toBe("2.0.0");
  expect(nested(read.document, "box").attrs!.data.tone).toBe("info");

  const out = join(root, "exports", "nested-upgrade.html");
  const exported = await ok("page_export", {
    pageId: page.document.id,
    format: "html",
    out,
  });
  const source = parseArtifact(
    JSON.parse(await readFile(exported.sourcePaths[0], "utf8")),
  );
  expect(source.components?.map((item) => `${item.id}@${item.version}`)).toEqual([
    "nested-badge@2.0.0",
  ]);
  pages.set("/nested", await readFile(exported.path, "utf8"));
  const view = await browser.newPage();
  const errors: string[] = [];
  view.on("pageerror", (error) => errors.push(error.message));
  await view.goto(address + "/nested");
  await view.getByText("Lead paragraph", { exact: true }).waitFor();
  await expect
    .poll(
      async () => {
        for (const frame of view.frames())
          if (await frame.getByText("New: Threshold").count()) return true;
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(errors).toEqual([]);
  await view.close();
}, 180_000);
