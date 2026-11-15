import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { FileStore } from "../core/store";
import { blankDocument } from "../core/catalog";
import { createResource } from "../document/containers.mjs";
import { insertComponent } from "../surface/component-insertion";
import { findSurfaceNode } from "../document/document.mjs";
import { readPageView } from "./page-reading";
import { syncManager } from "../sync/manager";
let home: string,
  store: FileStore,
  project: string,
  page: string,
  region: string,
  children: string[],
  nestedChildren: string[],
  source: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-region-layout-"));
  await openLibrary(home);
  store = new FileStore(home);
  project = (await store.createProject({ name: "Native region verification" }))
    .id;
  const text = (content: string) => ({
    kind: "text",
    data: { content, format: "plain" },
  });
  const inserted = insertComponent(
    createResource(blankDocument()),
    null,
    "region",
    {
      name: "Internal-only group label",
      columns: 2,
      blocks: [
        {
          kind: "region",
          data: {
            columns: 2,
            blocks: [text("Nested one"), text("Nested two")],
          },
        },
        text("Second column"),
        text("Next row"),
      ],
    },
  );
  region = inserted.nodeId;
  const node = findSurfaceNode(inserted.document, region)!.node;
  children = node.content!.map((n) => String(n.attrs!.id));
  nestedChildren = node.content![0].content!.map((n) => String(n.attrs!.id));
  const record = await store.createPage(project, {
    document: inserted.document,
  });
  page = record.document.id;
  source = await readFile(record.path, "utf8");
});
afterAll(async () => {
  await syncManager(home).stop();
  await rm(home, { recursive: true, force: true });
});

test("native regions wrap by their own width, keep order and do not render a title strip", async () => {
  for (const [width, columns] of [
    [1200, 2],
    [600, 1],
    [390, 1],
  ] as const) {
    const result = await readPageView(store, project, page, {
      view: "image",
      capture: "viewport",
      viewport: { width, height: 900 },
      inspect: {
        layout: true,
        blockIds: [region, ...children, ...nestedChildren],
      },
    });
    if (!("layout" in result) || !result.layout)
      throw new Error("Missing real layout measurement");
    const box = (id: string) => {
      const block = result.layout!.blocks.find((b) => b.blockId === id)!;
      if (block.status !== "measured")
        throw new Error("Missing rendered region child");
      return block.rect;
    };
    const a = box(children[0]),
      b = box(children[1]),
      c = box(children[2]);
    expect(a.x).toBeCloseTo(box(region).x, 0); // No container-only inset.
    if (columns === 2) {
      expect(b.x).toBeGreaterThan(a.x);
      expect(b.y).toBeCloseTo(a.y, 0);
    } else {
      expect(b.x).toBeCloseTo(a.x, 0);
      expect(b.y).toBeGreaterThan(a.y);
    }
    expect(c.y).toBeGreaterThan(a.y);
    // Nested region is narrow even when the overall viewport is desktop-wide.
    expect(box(nestedChildren[1]).y).toBeGreaterThan(box(nestedChildren[0]).y);
    expect(result.dom!.map((d) => d.accessibility).join("\n")).not.toContain(
      'button "Internal-only group label',
    );
    expect(result.capture?.expanded).toBe(false);
    expect(
      result.layout.blocks.every(
        (b) => b.status !== "measured" || b.rect.width <= width,
      ),
    ).toBe(true);
  }
  expect(
    await readFile((await store.readPage(project, page)).path, "utf8"),
  ).toBe(source);
}, 30000);

test("editable dark preview keeps region chrome out of the content", async () => {
  const result = await readPageView(store, project, page, {
    view: "html",
    capture: "viewport",
    viewport: { width: 600, height: 900 },
    theme: "dark",
    draft: true,
    inspect: { layout: true, blockIds: children },
  });
  if (!("dom" in result)) throw new Error("Missing rendered preview");
  const tree = result.dom!.map((d) => d.accessibility).join("\n");
  expect(tree).toContain("Second column");
  expect(tree).not.toMatch(/button[^\n]*Internal-only group label/);
  expect(result.layout?.blocks[1]).toMatchObject({ status: "measured" });
}, 20000);
