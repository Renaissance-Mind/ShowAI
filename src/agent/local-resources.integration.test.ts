import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { dataServer } from "../test/data-server";
import { localFileRef } from "../portable/local-files.mjs";
import { parseArtifact } from "../portable/validation.mjs";
import { visitNodes } from "../document/document.mjs";
import type { ShowDocument } from "../core/model";

// A real 1×1 PNG, served online and stored as a local file.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
let root: string;
let outside: string;
let projectId: string;
let server: Awaited<ReturnType<typeof dataServer>>;
let mcp: ReturnType<typeof createMcpServer>;
let client: Client;

async function ok(name: string, args: Record<string, unknown> = {}) {
  const value = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 120000,
  });
  const result = value.structuredContent as {
    ok: boolean;
    data: any;
    error?: unknown;
  };
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  return result.data;
}
function widgets(document: ShowDocument, kind: string) {
  const found: any[] = [];
  visitNodes(document.content, (node) => {
    if (node.type === "widget" && node.attrs?.kind === kind) found.push(node);
  });
  return found;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-local-resources-"));
  outside = await mkdtemp(join(tmpdir(), "showai-linked files-"));
  await openLibrary(root);
  projectId = (await new AgentService({ root }).createProject("本机资源"))
    .id;
  server = await dataServer((request, response) => {
    if (request.url === "/online.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(png);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  mcp = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "local-resources-test", version: "1" });
  await mcp.connect(right);
  await client.connect(left);
}, 120_000);
afterAll(async () => {
  await client.close();
  await mcp.close();
  await server.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("pages keep linked local files, report them, and exports embed them next to kept web addresses", async () => {
  const imagePath = join(outside, "图 1#草稿.png");
  const videoPath = join(outside, "clip.mp4");
  await writeFile(imagePath, png);
  await writeFile(videoPath, Buffer.alloc(2048, 7));
  const image = localFileRef(imagePath);
  const video = localFileRef(videoPath);
  const missing = localFileRef(join(outside, "gone.png"));
  const online = `${server.origin}/online.png`;
  const page = await ok("page_create", {
    title: "Linked files",
    blocks: [
      { kind: "image", data: { src: image, alt: "local" } },
      {
        kind: "gallery",
        data: {
          images: [
            { id: "web", src: online, alt: "web", caption: "" },
            { id: "same", src: image, alt: "again", caption: "" },
            { id: "gone", src: missing, alt: "gone", caption: "" },
          ],
        },
      },
      { kind: "video", data: { src: video, poster: image } },
    ],
  });
  const pageId = page.document.id as string;
  // Validation rejects a reference of the wrong kind.
  const wrong = await client.callTool({
    name: "page_create",
    arguments: {
      title: "Wrong kind",
      blocks: [{ kind: "video", data: { src: image } }],
    },
  });
  expect((wrong.structuredContent as { ok: boolean }).ok).toBe(false);

  const read = await ok("page_read", { pageId, rendered: false });
  // The stored page keeps the references as written.
  expect(widgets(read.document, "video")[0].attrs.data.src).toBe(video);
  const resources = Object.fromEntries(
    (read.resources as any[]).map((item) => [item.id, item]),
  );
  expect(resources[image]).toMatchObject({
    source: "file",
    kind: "image",
    name: "图 1#草稿.png",
    path: imagePath,
    bytes: png.length,
    available: true,
  });
  expect(resources[image].uses.map((use: any) => use.field).sort()).toEqual(
    ["images[1].src", "poster", "src"].sort(),
  );
  expect(resources[video]).toMatchObject({
    kind: "video",
    bytes: 2048,
    available: true,
  });
  expect(resources[missing]).toMatchObject({ available: false, name: "gone.png" });
  expect(resources[online]).toMatchObject({ source: "url", kind: "image" });

  const out = join(root, "exports", "linked.html");
  // Local files leave the device only after the person sees the list.
  const unconfirmed = (
    await client.callTool({
      name: "page_export",
      arguments: { pageId, format: "html", out },
    })
  ).structuredContent as any;
  expect(unconfirmed.error.code).toBe("CONFIRMATION_REQUIRED");
  const planned = Object.fromEntries(
    (unconfirmed.error.details.packaging.items as any[]).map((item) => [
      item.name,
      [item.kind, item.choice],
    ]),
  );
  expect(planned).toMatchObject({
    "图 1#草稿.png": ["file-resource", "embed"],
    "clip.mp4": ["file-resource", "embed"],
    "gone.png": ["file-resource", "skip"],
    "online.png": ["url-resource", "keep-url"],
  });
  const exported = await ok("page_export", {
    pageId,
    format: "html",
    out,
    packaging: {},
  });
  expect(exported.onlineResources).toEqual([online]);
  expect(
    Object.fromEntries(
      (exported.localResources as any[]).map((item) => [item.name, item.choice]),
    ),
  ).toEqual({ "图 1#草稿.png": "embed", "clip.mp4": "embed", "gone.png": "skip" });
  const source = parseArtifact(
    await readFile(out.replace(/\.html$/, ".showai.json"), "utf8"),
  ).document;
  const encoded = `data:image/png;base64,${png.toString("base64")}`;
  const images: any[] = [];
  visitNodes(source.content, (node) => {
    if (node.type === "image") images.push(node);
  });
  expect(images[0].attrs.src).toBe(encoded);
  const gallery = widgets(source, "gallery")[0].attrs.data.images;
  expect(gallery.map((item: any) => item.src)).toEqual([
    online,
    encoded,
    // A file that is not available keeps only its name, never the path.
    "file:gone.png",
  ]);
  expect(widgets(source, "video")[0].attrs.data.src).toMatch(
    /^data:video\/mp4;base64,/,
  );
  const html = await readFile(out, "utf8");
  expect(html).toContain(online);
  expect(html).not.toContain(outside);

  // A rendered read loads the online image and embeds the local ones.
  const before = server.requests.filter((r) => r.url === "/online.png").length;
  const rendered = await ok("page_read", { pageId, view: "html" });
  const preview = await readFile(rendered.path, "utf8");
  expect(preview).toContain(encoded);
  expect(preview).not.toContain(outside);
  expect(
    server.requests.filter((r) => r.url === "/online.png").length,
  ).toBeGreaterThan(before);
}, 120_000);
