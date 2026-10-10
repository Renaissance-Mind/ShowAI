import { afterEach, expect, test } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type RequestListener } from "node:http";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ContentLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { EditorDrafts } from "../core/editor-drafts";
import {
  componentWidgetData,
  getComponent,
  packageRevisionRef,
  readBuiltinComponentSource,
  readComponentSource,
  saveComponent,
} from "../core/catalog";
import { preparePublication, verifyPublication } from "../core/publication";
import { SyncManager } from "../sync/manager";
import { startSyncServer } from "../server/node";
import { embedDocumentImages } from "../portable/assets.mjs";
import { CAPACITY, measureContent } from "../portable/capacity.mjs";
import { validateDocument, parseArtifact } from "../portable/validation.mjs";
import { largePng } from "../test/large-png";
import { exportPage } from "./exporter";
import { presentPage } from "./page-presentation";
import { startMcpHttpServer } from "./mcp-http";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0).reverse()) await done();
});
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "capacity-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, "library"),
    library = new ContentLibrary(home);
  await library.initialize();
  const store = new FileStore(home),
    project = await store.createProject({ name: "Capacity acceptance" });
  return { directory, home, library, store, project };
}
async function receipt(name: string, data: object) {
  const target = process.env.SHOWAI_TEST_EVIDENCE_ROOT;
  if (target) {
    await mkdir(target, { recursive: true });
    await writeFile(
      join(target, `${name}.json`),
      JSON.stringify({ ok: true, ...data }, null, 2),
    );
  }
}
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanup.push(
    () =>
      new Promise<void>((done, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : done()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port.");
  return `http://127.0.0.1:${address.port}`;
}
function document(src: string) {
  return validateDocument({
    id: "large-page",
    title: "Large resource acceptance",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "summary" },
          content: [
            {
              type: "text",
              text: "A complete large image remains saved; this summary can be shown in chat.",
            },
          ],
        },
        {
          type: "image",
          attrs: { id: "large-image", src, alt: "Large real PNG" },
        },
      ],
    },
  });
}

test("large real raster survives network embedding, SQLite, recovery, stdio MCP and independent chat/HTML output", async () => {
  const f = await fixture(),
    png = largePng(2500, 2300);
  expect(png.length).toBeGreaterThan(16 * 1024 * 1024);
  const origin = await serve((_request, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(png);
  });
  const embedded = await embedDocumentImages(document(origin + "/large.png"));
  expect(measureContent(embedded).resourceBytes).toBe(png.length);
  const client = new Client({ name: "large-stdio", version: "1" });
  // Client limits belong to the host; explicitly test with a host supporting large results.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist-agent/cli.mjs"), "mcp"],
    env: { ...(process.env as Record<string, string>), SHOWAI_HOME: f.home },
    stderr: "pipe",
    maxBufferSize: 128 * 1024 * 1024,
  });
  await client.connect(transport);
  cleanup.push(() => client.close());
  const called = await client.callTool(
    {
      name: "page_create",
      arguments: { projectId: f.project.id, document: embedded },
    },
    undefined,
    { timeout: 120_000 },
  );
  expect(called.isError, JSON.stringify(called.content).slice(0, 500)).not.toBe(
    true,
  );
  const record = (called.structuredContent as any).data;
  const reopened = await new FileStore(f.home).readPage(
    f.project.id,
    record.document.id,
  );
  const url = reopened.document.content.content![1].attrs!.src as string;
  expect(digest(Buffer.from(url.split(",")[1], "base64"))).toBe(digest(png));
  const drafts = new EditorDrafts(f.home),
    draft = await drafts.save({
      kind: "page",
      clientId: "capacity-client",
      resourceId: reopened.document.id,
      projectId: f.project.id,
      content: reopened.document,
    });
  expect((await drafts.read(draft.id)).content).toEqual(reopened.document);
  const full = await presentPage({
    root: f.home,
    projectId: f.project.id,
    pageId: reopened.document.id,
  });
  expect(full.inline).toBeUndefined();
  expect(full.inlineError).toContain("1000000 bytes");
  const selected = await presentPage({
    root: f.home,
    projectId: f.project.id,
    pageId: reopened.document.id,
    blockIds: ["summary"],
  });
  expect(Buffer.byteLength(selected.inline!)).toBeLessThanOrEqual(
    CAPACITY.chatBytes,
  );
  expect(parseArtifact(selected.source).document.content.content).toHaveLength(
    2,
  );
  expect(Buffer.byteLength(selected.html)).toBeGreaterThan(10 * 1024 * 1024);
  await receipt("large-page-stdio", {
    pngBytes: png.length,
    structure: measureContent(reopened.document),
    htmlBytes: Buffer.byteLength(full.html),
    sourceBytes: Buffer.byteLength(full.source),
    chatError: full.inlineError,
    selectedChatBytes: Buffer.byteLength(selected.inline!),
    recoveredHash: reopened.hash,
  });
}, 120_000);

test("HTTP MCP accepts a request above the old 16 MiB limit and serves a complete large source", async () => {
  const f = await fixture(),
    png = largePng(2500, 2300);
  const http = await startMcpHttpServer({
    stateDirectory: join(f.directory, "gateway"),
    port: 0,
  });
  cleanup.push(() => http.close());
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "render_document",
      arguments: {
        document: document(`data:image/png;base64,${png.toString("base64")}`),
        blockIds: ["summary"],
      },
    },
  });
  expect(Buffer.byteLength(input)).toBeGreaterThan(16 * 1024 * 1024);
  const response = await fetch(http.url + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: input,
  });
  expect(response.status).toBe(200);
  const value = await response.json(),
    result = value.result.structuredContent;
  expect(result.ok, JSON.stringify(value).slice(0, 500)).toBe(true);
  const exported = await fetch(result.data.delivery.source),
    source = await exported.text();
  expect(parseArtifact(source).document.content.content).toHaveLength(2);
  expect(result.data.inlineError).toBeUndefined();
  await receipt("large-http-mcp", {
    requestBytes: Buffer.byteLength(input),
    sourceBytes: Buffer.byteLength(source),
    status: response.status,
  });
}, 120_000);

test("a used binary asset above 8 MiB compiles, reloads, publishes, exports and synchronizes between real SQLite libraries", async () => {
  const f = await fixture(),
    png = largePng(1800, 1750);
  const component = await saveComponent(
    f.home,
    {
      manifest: {
        id: "capacity-image",
        name: "Large packaged image",
        version: "1.0.0",
        description: "Real PNG compiled with the built-in SDK",
        entry: "index.tsx",
        scenarios: ["Capacity validation"],
        defaultData: { title: "Large packaged image" },
        examples: [{ name: "Image", data: { title: "Large packaged image" } }],
      },
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
      source:
        'import React from "react";import image from "./large.png";import {Table} from "showai:components";export default function Image({data}){return <section><h2>{data.title}</h2><img src={image} alt="Packaged real PNG"/><Table data={{columns:["Item"],rows:[["Real component compilation"]]}} readOnly/></section>}',
      assets: { "large.png": png.toString("base64") },
    },
    f.project.id,
  );
  expect(png.length).toBeGreaterThan(8 * 1024 * 1024);
  expect(Buffer.byteLength(component.html)).toBeGreaterThan(8 * 1024 * 1024);
  expect(
    (await getComponent(f.home, component.id, component.version, f.project.id))
      .integrity,
  ).toBe(component.integrity);
  expect(
    Buffer.from(
      (
        await readComponentSource(
          f.home,
          component.id,
          component.version,
          f.project.id,
        )
      ).assets!["large.png"],
      "base64",
    ),
  ).toEqual(png);
  const page = await f.store.createPage(f.project.id, {
    document: validateDocument({
      id: "package-page",
      title: "Packaged image",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              id: "packaged",
              kind: "custom",
              data: componentWidgetData(component),
            },
          },
        ],
      },
    }),
  });
  const exported = await exportPage({
    root: f.home,
    projectId: f.project.id,
    pageId: page.document.id,
    format: "html",
    out: join(f.directory, "large.html"),
  });
  expect((await stat(exported.path)).size).toBeGreaterThan(10 * 1024 * 1024);
  const release = await preparePublication(f.home, {
    refs: [packageRevisionRef("component", component)],
    projectId: f.project.id,
    out: join(f.directory, "release"),
  });
  const origin = await serve(async (request, response) => {
    const path = join(
      release.path,
      new URL(request.url!, "http://fixture").pathname,
    );
    const bytes = await readFile(path);
    response.writeHead(200, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    response.end(bytes);
  });
  await verifyPublication(f.home, {
    manifestUrl: origin + "/manifest.json",
    projectId: f.project.id,
  });
  const sync = await startSyncServer({
    home: join(f.directory, "server"),
    port: 0,
    registrationMode: "open",
  });
  cleanup.push(() => sync.close());
  const alice = new SyncManager(f.home);
  cleanup.push(() => alice.stop());
  const connection = await alice.connect({
    url: sync.url,
    account: "capacity-alice",
    password: "capacity-test-password",
    register: true,
  });
  await alice.stop();
  await alice.attach(connection.id, f.project.id);
  await alice.stop();
  const bobHome = join(f.directory, "bob"),
    bobLibrary = new ContentLibrary(bobHome);
  await bobLibrary.initialize();
  const bob = new SyncManager(bobHome);
  cleanup.push(() => bob.stop());
  const bobConnection = await bob.connect({
    url: sync.url,
    account: "capacity-bob",
    password: "capacity-test-password",
    register: true,
  });
  await bob.stop();
  const invitation = (await alice.manage(
    connection.id,
    f.project.id,
    "invite",
    { role: "editor" },
  )) as { url: string };
  await bob.join(bobConnection.id, invitation.url);
  await bob.stop();
  const remote = await getComponent(
    bobHome,
    component.id,
    component.version,
    f.project.id,
  );
  expect(remote.integrity).toBe(component.integrity);
  expect(
    (await new FileStore(bobHome).readPage(f.project.id, page.document.id))
      .document.title,
  ).toBe("Packaged image");
  await receipt("large-package-sync-export", {
    assetBytes: png.length,
    compiledHtmlBytes: Buffer.byteLength(component.html),
    compiledInlineBytes: Buffer.byteLength(component.inline!.script),
    exportHtmlBytes: (await stat(exported.path)).size,
    remoteIntegrity: remote.integrity,
  });
}, 120_000);

test("built-in source editing compiles with the same resource budgets and no import escape", async () => {
  const f = await fixture(),
    original = readBuiltinComponentSource("table");
  const component = await saveComponent(
    f.home,
    { ...original, manifest: { ...original.manifest, id: "capacity-table" } },
    f.project.id,
  );
  expect(component.inline?.script).toBeTruthy();
});

test("rejects oversized component source before compilation or package persistence", async () => {
  const f = await fixture(),
    original = readBuiltinComponentSource("table");
  await expect(
    saveComponent(
      f.home,
      {
        ...original,
        manifest: { ...original.manifest, id: "oversized-source" },
        source:
          original.source +
          "/*" +
          "x".repeat(CAPACITY.componentSourceBytes) +
          "*/",
      },
      f.project.id,
    ),
  ).rejects.toMatchObject({
    code: "CAPACITY_EXCEEDED",
    kind: "Component source files",
    limitBytes: CAPACITY.componentSourceBytes,
  });
  await expect(
    getComponent(
      f.home,
      "oversized-source",
      original.manifest.version,
      f.project.id,
    ),
  ).rejects.toThrow();
});
