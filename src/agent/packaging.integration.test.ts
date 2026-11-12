import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { AgentService } from "./service";
import { dataServer } from "../test/data-server";
import { xlsxWorkbook } from "../test/xlsx";
import { localFileRef } from "../portable/local-files.mjs";
import { parseArtifact } from "../portable/validation.mjs";
import { walk } from "../document/walk.mjs";
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
function widget(document: ShowDocument, kind: string) {
  let found: any;
  walk(document.content, (node) => {
    if (!found && node.type === "widget" && node.attrs?.kind === kind)
      found = node;
  }, { scope: "tree" });
  return found;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-packaging-"));
  outside = await mkdtemp(join(tmpdir(), "showai-packaging-files-"));
  await openLibrary(root);
  projectId = (await new AgentService({ root }).createProject("打包")).id;
  server = await dataServer((request, response) => {
    if (request.url === "/online.png") {
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": String(png.length),
      });
      response.end(request.method === "HEAD" ? undefined : png);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  mcp = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "packaging-test", version: "1" });
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

test("an export lists every item with its size and carries what the person chose", async () => {
  const csv = join(outside, "schedule.csv");
  await writeFile(csv, "id,title\nm1,体检\nm2,复盘周会\n");
  const book = join(outside, "金额.xlsx");
  await writeFile(
    book,
    xlsxWorkbook([
      {
        name: "Sheet1",
        rows: [
          ["月份", "金额"],
          ["1月", 120],
          ["2月", 340],
        ],
      },
    ]),
  );
  const schedule = (
    await ok("dataset_write", { action: "link", name: "日程", path: csv })
  ).dataset.id;
  const amounts = (
    await ok("dataset_write", { action: "link", name: "金额表", path: book })
  ).dataset.id;
  const chartData = (
    await ok("dataset_write", {
      action: "transform",
      name: "月度金额",
      inputs: { book: amounts },
      script: `function transform({ book }, h) {
        const rows = h.table(h.sheet(book, 0), { header: 0 });
        return { labels: rows.map((row) => row["月份"]), series: [{ name: "金额", values: rows.map((row) => row["金额"]) }] };
      }`,
    })
  ).record.dataset.id;
  const image = join(outside, "图.png");
  await writeFile(image, png);
  const online = `${server.origin}/online.png`;
  const page = await ok("page_create", {
    title: "打包清单",
    blocks: [
      {
        kind: "database",
        data: {
          title: "日程",
          columns: [{ id: "title", name: "事项", type: "text" }],
          rows: [],
          view: "table",
        },
      },
      {
        kind: "chart",
        data: { title: "金额", type: "bar", labels: [], series: [], unit: "元" },
      },
      { kind: "image", data: { src: localFileRef(image), alt: "本机" } },
      { kind: "image", data: { src: online, alt: "在线" } },
    ],
  });
  const pageId = page.document.id as string;
  const read = await ok("page_read", { pageId, rendered: false });
  await ok("page_apply", {
    pageId,
    baseHash: read.hash,
    baseRevision: read.revision,
    operations: [
      {
        type: "component.binding.set",
        blockId: widget(read.document, "database").attrs.id,
        binding: {
          dataset: schedule,
          collections: [
            { key: "row", into: "rows", from: "rows[*]", fields: { title: "title" } },
          ],
        },
      },
      {
        type: "component.binding.set",
        blockId: widget(read.document, "chart").attrs.id,
        binding: {
          dataset: chartData,
          props: { local: ["title", "type", "unit"] },
        },
      },
    ],
  });

  // Nothing is written before the person sees the items.
  const out = join(outside, "exports", "清单.html");
  const unconfirmed = await call("page_export", { pageId, format: "html", out });
  expect(unconfirmed.error.code).toBe("CONFIRMATION_REQUIRED");
  const plan = unconfirmed.error.details.packaging;
  const items = Object.fromEntries(
    (plan.items as any[]).map((item) => [item.name, item]),
  );
  expect(items["日程"]).toMatchObject({
    id: `dataset:${projectId}/${schedule}`,
    kind: "file-dataset",
    path: csv,
    local: true,
    available: true,
    choices: ["bundle", "skip"],
    defaultChoice: "bundle",
  });
  expect(items["日程"].bytes).toBeGreaterThan(0);
  // A transform over a spreadsheet counts as data from a file of this device.
  expect(items["月度金额"]).toMatchObject({
    kind: "transform-output",
    local: true,
    choices: ["result", "inputs", "both", "skip"],
    choice: "result",
    inputs: [{ name: "book", datasetId: amounts, kind: "file", available: true }],
  });
  expect(items["月度金额"].inputBytes).toBeGreaterThan(0);
  expect(items["图.png"]).toMatchObject({
    kind: "file-resource",
    bytes: png.length,
    choice: "embed",
  });
  expect(items["online.png"]).toMatchObject({
    kind: "url-resource",
    url: online,
    bytes: png.length,
    estimated: true,
    choice: "keep-url",
    local: false,
  });
  expect(plan.limits).toEqual({
    itemBytes: 64 * 1024 * 1024,
    totalBytes: 256 * 1024 * 1024,
  });
  expect(plan.remainingBytes).toBe(plan.limits.totalBytes - plan.bytes);
  await expect(readdir(join(outside, "exports"))).rejects.toThrow();

  // A choice that does not apply to an item is refused.
  const wrong = await call("page_export", {
    pageId,
    format: "html",
    out,
    packaging: { [items["日程"].id]: "embed" },
  });
  expect(wrong.error.code).toBe("INVALID_DATA");

  const exported = await ok("page_export", {
    pageId,
    format: "html",
    out,
    packaging: {
      [items["日程"].id]: "skip",
      [items["月度金额"].id]: "both",
      [items["图.png"].id]: "embed",
      [items["online.png"].id]: "embed",
    },
  });
  expect(
    Object.fromEntries(
      (exported.packaging.items as any[]).map((item) => [item.name, item.choice]),
    ),
  ).toEqual({
    日程: "skip",
    月度金额: "both",
    "图.png": "embed",
    "online.png": "embed",
  });
  // Files leaving the device carry no paths of it.
  const html = await readFile(out, "utf8");
  const sourceText = await readFile(out.replace(/\.html$/, ".showai.json"), "utf8");
  for (const text of [html, sourceText]) {
    expect(text).not.toContain(outside);
    expect(text).not.toContain(root);
    expect(text).not.toContain("体检");
  }
  const source = parseArtifact(sourceText).document;
  // The data left out shows its name and file name only.
  expect(widget(source, "database").attrs.data.$dataState).toEqual({
    status: "empty",
    omitted: true,
    dataset: "日程",
    file: "schedule.csv",
  });
  expect(widget(source, "chart").attrs.data.labels).toEqual(["1月", "2月"]);
  const images: string[] = [];
  walk(source.content, (node) => {
    if (node.type === "image") images.push(node.attrs!.src as string);
    if (node.type === "widget" && node.attrs?.kind === "image")
      images.push(node.attrs.data.src);
  }, { scope: "tree" });
  expect(images).toEqual([
    `data:image/png;base64,${png.toString("base64")}`,
    `data:image/png;base64,${png.toString("base64")}`,
  ]);
  // "both" writes the transform's inputs beside the page.
  expect(exported.inputFiles).toEqual([
    join(outside, "exports", "清单.inputs", `${amounts}.json`),
  ]);
  const input = JSON.parse(await readFile(exported.inputFiles[0], "utf8"));
  expect(input).toMatchObject({
    format: "showai-dataset-snapshot",
    name: "金额表",
    value: { sheets: [{ name: "Sheet1" }] },
  });
  expect(JSON.stringify(input)).not.toContain(outside);

  // The next export starts from the person's last choices.
  const again = await call("page_export", {
    pageId,
    format: "html",
    out: join(outside, "exports", "again.html"),
  });
  const remembered = Object.fromEntries(
    (again.error.details.packaging.items as any[]).map((item) => [
      item.name,
      item.choice,
    ]),
  );
  expect(remembered).toMatchObject({ 日程: "skip", 月度金额: "both" });

  // externalData "embed" still carries everything that fits.
  const all = await ok("page_export", {
    pageId,
    format: "html",
    out: join(outside, "exports", "all.html"),
    externalData: "embed",
  });
  expect(await readFile(all.path, "utf8")).toContain("体检");
  expect(all.inputFiles).toBeUndefined();
  expect(all.externalSnapshots.datasets.map((item: any) => item.name)).toEqual([
    "日程",
  ]);

  // Inline fragments have no files beside them: a transform gives its result or nothing.
  const inline = await call("page_export", {
    pageId,
    format: "inline",
    out: join(outside, "exports", "inline.html"),
  });
  expect(
    (inline.error.details.packaging.items as any[]).find(
      (item) => item.name === "月度金额",
    ).choices,
  ).toEqual(["result", "skip"]);
}, 240_000);

test("online data alone needs no confirmation", async () => {
  const local = await dataServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/csv" });
    response.end("id,rate\nr1,1.5\n");
  });
  try {
    const rates = (
      await ok("dataset_write", {
        action: "link",
        name: "汇率",
        url: `${local.origin}/rates.csv`,
      })
    ).dataset.id;
    const page = await ok("page_create", {
      title: "在线数据",
      blocks: [
        {
          kind: "database",
          data: {
            title: "汇率",
            columns: [{ id: "rate", name: "汇率", type: "text" }],
            rows: [],
            view: "table",
          },
        },
      ],
    });
    const read = await ok("page_read", {
      pageId: page.document.id,
      rendered: false,
    });
    await ok("page_apply", {
      pageId: page.document.id,
      baseHash: read.hash,
      baseRevision: read.revision,
      operations: [
        {
          type: "component.binding.set",
          blockId: widget(read.document, "database").attrs.id,
          binding: {
            dataset: rates,
            collections: [
              { key: "r", into: "rows", from: "rows[*]", fields: { rate: "rate" } },
            ],
          },
        },
      ],
    });
    const exported = await ok("page_export", {
      pageId: page.document.id,
      format: "html",
      out: join(outside, "exports", "online.html"),
    });
    expect(exported.packaging.items).toEqual([
      expect.objectContaining({
        kind: "url-dataset",
        choice: "bundle",
        local: false,
      }),
    ]);
    expect(await readFile(exported.path, "utf8")).toContain("1.5");
  } finally {
    await local.close();
  }
}, 120_000);
