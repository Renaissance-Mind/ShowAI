import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { tmpdir } from "node:os";
import { AgentService } from "./service";
import type { ShowDocument } from "../types";
import type { BoardReadResult } from "./board-reading";

let home: string, service: AgentService, projectId: string, pageId: string;
let snapshot: BoardReadResult;
const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const pageFields = {
  icon: "",
  cover: "none",
  parentId: null,
  favorite: false,
  archived: false,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
};
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-board-reading-"));
  service = new AgentService({ root: home });
  projectId = (await service.createProject("Board reading acceptance")).id;
  const component = await service.importComponent(
    resolve("resources/catalog/task-gantt"),
    projectId,
  );
  const props = JSON.parse(
    await readFile(resolve("examples/task-gantt/data.json"), "utf8"),
  );
  const record = await service.createPage(projectId, {
    document: {
      ...pageFields,
      id: "acceptance",
      title: "多个 Page 与跨窗笔画",
      comments: [],
      content: {
        type: "surface",
        attrs: { id: "board", kind: "board" },
        content: [
          {
            type: "surface",
            attrs: { id: "page-a", kind: "page", name: "完整长文" },
            content: [
              paragraph("intro", "FIRST PAGE 原始数据"),
              ...Array.from({ length: 25 }, (_, i) =>
                paragraph(
                  `line-${i}`,
                  `第 ${i} 段：超过 Page 可见外框的完整原始正文。`,
                ),
              ),
            ],
          },
          {
            type: "surface",
            attrs: { id: "page-b", kind: "page", name: "第二个 Page" },
            content: [paragraph("second", "SECOND PAGE on the right")],
          },
          {
            type: "drawing",
            attrs: {
              id: "pen",
              tool: "pen",
              color: "#ff0000",
              strokeWidth: 8,
              extent: [2300, 200],
              points: [
                { x: 0, y: 30 },
                { x: 1100, y: 170 },
                { x: 2300, y: 50 },
              ],
            },
          },
          {
            type: "surface",
            attrs: { id: "nested-board", kind: "board", name: "嵌套 Board" },
            content: [
              {
                type: "surface",
                attrs: { id: "nested-page", kind: "page", name: "嵌套 Page" },
                content: [paragraph("nested-text", "NESTED PAGE SOURCE")],
              },
            ],
          },
          {
            type: "widget",
            attrs: {
              id: "gantt",
              kind: "custom",
              data: {
                componentId: component.id,
                version: component.version,
                integrity: component.integrity,
                props,
              },
            },
          },
        ],
      },
      layout: {
        "page-a": { x: -200, y: -100, width: 600, height: 500 },
        "page-b": { x: 1800, y: 1300, width: 600, height: 500 },
        pen: { x: -100, y: 650, width: 2300, height: 200 },
        "nested-board": { x: 800, y: 1200, width: 700, height: 500 },
        "nested-page": { x: 40, y: 30, width: 500, height: 300 },
        gantt: { x: 800, y: 0, width: 900, height: 500 },
      },
    } as ShowDocument,
  });
  pageId = record.document.id;
  snapshot = await service.readBoard(projectId, pageId);
}, 60000);
afterAll(async () => {
  const evidence = process.env.SHOWAI_BOARD_EVIDENCE;
  if (evidence && snapshot) {
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(snapshot, null, 2),
    );
    for (const image of snapshot.images)
      await writeFile(
        join(evidence, `${image.imageKey}.png`),
        await readFile(image.path),
      );
  }
  if (home) await rm(home, { recursive: true, force: true });
});
test("large Board emits overlap tiles, stable identities and all nested Page sources", async () => {
  expect(snapshot.mode).toBe("tiled");
  expect(snapshot.images[0].imageKey).toBe("overview");
  expect(snapshot.images.length).toBeGreaterThan(2);
  expect(snapshot.bounds.x).toBeLessThan(-190);
  expect(snapshot.pageIndex).toHaveLength(3);
  expect(snapshot.warnings).toEqual([]);
  const tiles = snapshot.tiles as {
    tileId: string;
    bounds: { x: number; y: number; width: number };
    elementIndex: { items: { nodeId: string }[] };
  }[];
  const horizontal = tiles.find((t) => t.tileId === "T2")!;
  expect(tiles[0].bounds.x + tiles[0].bounds.width - horizontal.bounds.x).toBe(
    200,
  );
  expect(
    tiles.filter((t) => t.elementIndex.items.some((e) => e.nodeId === "pen"))
      .length,
  ).toBeGreaterThan(1);
  for (const image of snapshot.images)
    expect((await readFile(image.path)).subarray(1, 4).toString()).toBe("PNG");
  const source = await service.readPage(projectId, pageId, {
    snapshotId: snapshot.snapshotId,
    blockIds: ["page-a"],
    rendered: false,
  });
  expect(JSON.stringify(source)).toContain("第 24 段");
  const raw = await service.readBoard(projectId, pageId, {
    snapshotId: snapshot.snapshotId,
    mode: "element",
    nodeId: "pen",
    detail: "source",
  });
  expect(
    (raw.source as { node: { attrs: { points: unknown[] } } }).node.attrs
      .points,
  ).toHaveLength(3);
});
test("pixel region locates an element and detail crop reuses the captured image", async () => {
  const tile = (
    snapshot.tiles as { tileId: string; bounds: { x: number; y: number } }[]
  )[0];
  const region = await service.readBoard(projectId, pageId, {
    snapshotId: snapshot.snapshotId,
    mode: "region",
    tileId: tile.tileId,
    pointPx: { x: 80, y: 80 },
  });
  expect(
    region.candidates?.some(
      (e) => (e as { nodeId: string }).nodeId === "page-a",
    ),
  ).toBe(true);
  const detail = await service.readBoard(projectId, pageId, {
    snapshotId: snapshot.snapshotId,
    mode: "element",
    nodeId: "page-a",
    tileId: tile.tileId,
    imageScope: "tile",
  });
  expect(detail.images).toHaveLength(1);
  expect(JSON.stringify(detail.source)).toContain("第 24 段");
  const repeat = await service.readBoard(projectId, pageId, {
    snapshotId: snapshot.snapshotId,
    mode: "tile",
    tileIds: [tile.tileId],
  });
  expect(await readFile(repeat.images[0].path)).toEqual(
    await readFile(
      snapshot.images.find((i) => i.imageKey === tile.tileId)!.path,
    ),
  );
}, 30000);
test("a changed current Page leaves the snapshot source pinned and rejects foreign selectors", async () => {
  const record = await service.store.readPage(projectId, pageId);
  const changed = structuredClone(record.document);
  changed.title = "CHANGED CURRENT";
  await service.store.savePage(
    projectId,
    pageId,
    changed,
    record.hash,
    record.revision,
  );
  const old = await service.readBoard(projectId, pageId, {
    snapshotId: snapshot.snapshotId,
    mode: "source",
  });
  expect(old.currentSourceChanged).toBe(true);
  expect(old.hash).toBe(snapshot.hash);
  await expect(
    service.readBoard(projectId, pageId, {
      snapshotId: snapshot.snapshotId,
      mode: "element",
      nodeId: "missing",
      detail: "source",
    }),
  ).rejects.toThrow("outside");
  await expect(
    service.readBoard(projectId, pageId, {
      snapshotId: snapshot.snapshotId,
      mode: "tile",
      tileIds: ["T99999"],
    }),
  ).rejects.toThrow();
});
test("MCP delivers every PNG with its key and supports pinned Page source queries", async () => {
  const server = createMcpServer({ root: home, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "board-reading-acceptance", version: "1" });
  await server.connect(right);
  await client.connect(left);
  try {
    expect(
      (await client.listTools()).tools.some((t) => t.name === "board_read"),
    ).toBe(true);
    const read = await client.callTool({
      name: "board_read",
      arguments: {
        projectId,
        pageId,
        snapshotId: snapshot.snapshotId,
        mode: "tile",
        tileIds: ["T1", "T2"],
      },
    });
    expect(read.isError, JSON.stringify(read.content)).not.toBe(true);
    const content = read.content as {
      type: string;
      text?: string;
      data?: string;
    }[];
    expect(content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(JSON.parse(content[1].text!).imageKey).toBe("T1");
    expect(JSON.parse(content[3].text!).imageKey).toBe("T2");
    const page = await client.callTool({
      name: "page_read",
      arguments: {
        projectId,
        pageId,
        snapshotId: snapshot.snapshotId,
        blockIds: ["page-a"],
        rendered: false,
        response: "source",
      },
    });
    expect(page.isError).not.toBe(true);
    expect(JSON.stringify(page.structuredContent)).toContain("第 24 段");
    const component = await service.readBoard(projectId, pageId, {
      snapshotId: snapshot.snapshotId,
      mode: "element",
      nodeId: "gantt",
    });
    expect(component.images).toHaveLength(1);
    expect(JSON.stringify(component.source)).toContain("planning");
  } finally {
    await client.close();
    await server.close();
  }
}, 30000);
test("single-image continuation makes progress and small Boards return the full image", async () => {
  const single = await service.readBoard(projectId, pageId, { maxImages: 1 });
  expect(single.images.map((i) => i.imageKey)).toEqual(["overview"]);
  expect(single.coverage).toMatchObject({ complete: false, nextCursor: 0 });
  const next = await service.readBoard(projectId, pageId, {
    snapshotId: single.snapshotId,
    maxImages: 1,
    cursor: 0,
  });
  expect(next.images[0].imageKey).toBe("T1");
  expect(next.coverage).toMatchObject({ nextCursor: 1 });
  const small = await service.createPage(projectId, {
    document: {
      ...pageFields,
      id: "small",
      title: "Small Board",
      comments: [],
      content: {
        type: "surface",
        attrs: { id: "small-board", kind: "board" },
        content: [
          paragraph("small-text", "A small Board fits into one clear image."),
        ],
      },
      layout: { "small-text": { x: 0, y: 0, width: 400, height: 100 } },
    } as ShowDocument,
  });
  const read = await service.readBoard(projectId, small.document.id);
  expect(read.mode).toBe("full");
  expect(read.images.map((i) => i.imageKey)).toEqual(["full"]);
  expect(read.coverage).toMatchObject({ complete: true, nextCursor: null });
}, 30000);
test("explicit nested cameras and Page scrolling are captured without saving source", async () => {
  const before = await service.store.readPage(projectId, pageId);
  const capture = await service.readBoard(projectId, pageId, {
    maxImages: 1,
    state: {
      cameras: { "nested-board": { x: 70, y: 40, scale: 1.2 } },
      pageScrolls: { "page-a": { x: 0, y: 250 } },
    },
  });
  expect(capture.state.find((s) => s.nodeId === "page-a")?.scrollY).toBe(250);
  expect(
    capture.state.find((s) => s.nodeId === "nested-board")?.camera,
  ).toEqual({ x: 70, y: 40, scale: 1.2 });
  expect((await service.store.readPage(projectId, pageId)).hash).toBe(
    before.hash,
  );
  await expect(
    service.readBoard(projectId, pageId, {
      state: { cameras: { missing: { x: 0, y: 0, scale: 1 } } },
    }),
  ).rejects.toMatchObject({ code: "INVALID_DATA" });
}, 30000);
test("expired or corrupted snapshots require a fresh capture", async () => {
  const sourcePath = join(
    home,
    "local/board-read-cache",
    snapshot.snapshotId,
    "source.json",
  );
  const bytes = await readFile(sourcePath);
  await writeFile(sourcePath, Buffer.concat([bytes, Buffer.from(" ")]));
  await expect(
    service.readBoard(projectId, pageId, {
      snapshotId: snapshot.snapshotId,
      mode: "source",
    }),
  ).rejects.toMatchObject({ code: "INVALID_DATA" });
  await writeFile(sourcePath, bytes);
  const path = join(
    home,
    "local/board-read-cache",
    snapshot.snapshotId,
    "snapshot.json",
  );
  const manifest = JSON.parse(await readFile(path, "utf8"));
  manifest.expiresAt = new Date(0).toISOString();
  await writeFile(path, JSON.stringify(manifest));
  await expect(
    service.readBoard(projectId, pageId, {
      snapshotId: snapshot.snapshotId,
      mode: "source",
    }),
  ).rejects.toMatchObject({ code: "SNAPSHOT_EXPIRED" });
});
