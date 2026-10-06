import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  blankDocument,
  instantiateTemplate,
  saveTemplate,
  instantiateTemplateRecord,
} from "../core/catalog";
import { FileStore } from "../core/store";
import { applyOperations, documentHash } from "../core/diff";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import { addNode, moveNode, removeNode, editNode } from "./editing";
import {
  createResource,
  createSurface,
  upgradeResource,
  wrapSurface,
  surfaceViews,
  insertResourceTemplate,
} from "./containers.mjs";
import {
  findSurfaceNode,
  remapSurfaceIds,
  upgradeDocument,
  visitNodes,
} from "./document.mjs";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const fixture = () => {
  let doc = createResource(blankDocument());
  doc.title = "Research";
  const board = createSurface("board", "Map", "board");
  doc = addNode(doc, board, {
    x: 0,
    y: 0,
    width: 800,
    height: 420,
    heightMode: "fixed",
  }) as typeof doc;
  const page = createSurface("page", "Evidence", "evidence");
  doc = addNode(
    doc,
    page,
    { x: 30, y: 40, width: 600, height: 380, heightMode: "fixed" },
    "board",
  ) as typeof doc;
  doc = addNode(
    doc,
    createSurface("board", "Sketch", "sketch"),
    { x: 0, y: 0, width: 560, height: 320, heightMode: "fixed" },
    "evidence",
  ) as typeof doc;
  doc = addNode(
    doc,
    {
      type: "drawing",
      attrs: {
        id: "stroke",
        tool: "pen",
        name: "Stroke",
        color: "#252629",
        strokeWidth: 2.5,
        extent: [100, 80],
        points: [
          { x: 4, y: 4 },
          { x: 96, y: 76 },
        ],
      },
    },
    { x: -20, y: 10, width: 100, height: 80 },
    "sketch",
  ) as typeof doc;
  return doc;
};
describe("recursive Page and Board containers", () => {
  it("keeps previous container views and layouts immutable while editing one branch", () => {
    const document = fixture(),
      before = structuredClone(document);
    const next = editNode(document, "sketch", (node) => {
      node.content = [];
    });
    expect(document).toEqual(before);
    expect(next.layout!.stroke).toBeUndefined();
    expect(next.surfaceViews!.sketch.readingOrder).toEqual([]);
  });
  it("round-trips a Page → Board → Page → Board tree with independent views and local drawing geometry", () => {
    const document = fixture();
    document.surfaceViews.board = {
      initial: "detail",
      saved: [{ id: "detail", name: "Detail", targets: ["evidence"] }],
      readingOrder: ["evidence"],
    };
    const result = parseArtifact(serializeArtifact(document));
    expect(result.version).toBe(3);
    expect(result.document).toEqual(document);
    expect(findSurfaceNode(result.document, "sketch")!.parent!.attrs!.id).toBe(
      "evidence",
    );
    expect(result.document.layout!.stroke).toEqual({
      x: -20,
      y: 10,
      width: 100,
      height: 80,
    });
    expect(
      surfaceViews(
        result.document,
        findSurfaceNode(result.document, "sketch")!.node,
      ).saved,
    ).toEqual([]);
  });
  it("wraps an auto-height Page in a bounded Board without invalidating the parent frame", () => {
    const source = fixture();
    const page = createSurface("page", "Auto", "auto-page");
    const doc = addNode(source, page, {
      x: 0,
      y: 0,
      width: 600,
      heightMode: "auto",
    });
    const wrapped = wrapSurface(doc, "auto-page", "board");
    const wrapper = findSurfaceNode(wrapped, "auto-page")!.parent!;
    expect(wrapper.attrs!.kind).toBe("board");
    expect(wrapped.layout[wrapper.attrs!.id].heightMode).toBe("fixed");
    expect(() => validateDocument(wrapped)).not.toThrow();
  });
  it("keeps a legacy document title in metadata without adding a duplicate body heading", () => {
    const source = blankDocument();
    source.title = "Original report";
    source.content.content = [
      {
        type: "paragraph",
        attrs: { id: "paragraph" },
        content: [{ type: "text", text: "Original content" }],
      },
    ];
    const upgraded = upgradeResource(source);
    expect(upgraded.content.content).toEqual(source.content.content);
    expect(upgraded.title).toBe(source.title);
    expect(upgraded.content.attrs!.name).toBe(source.title);
    expect(
      upgradeResource(source, { includeTitle: false }).content.attrs!.name,
    ).toBe("Page");
  });
  it("wraps either kind without copying or discarding the original surface", () => {
    const original = fixture(),
      id = original.content.attrs!.id;
    const board = wrapSurface(original, id, "board");
    expect(board.content.attrs!.kind).toBe("board");
    expect(board.content.content![0].attrs!.id).toBe(id);
    const page = wrapSurface(board, board.content.attrs!.id, "page");
    expect(findSurfaceNode(page, "stroke")!.node).toEqual(
      findSurfaceNode(original, "stroke")!.node,
    );
    expect(page.layout.stroke).toEqual(original.layout.stroke);
    expect(() => validateDocument(page)).not.toThrow();
  });
  it("moves whole surfaces atomically, preserving descendants and rejecting ownership cycles", () => {
    const doc = fixture();
    const moved = moveNode(doc, "evidence", doc.content.attrs!.id, {
      x: 0,
      y: 0,
      width: 760,
      height: 480,
      heightMode: "auto",
    });
    expect(findSurfaceNode(moved, "board")!.node.content).toHaveLength(0);
    expect(findSurfaceNode(moved, "evidence")!.parent).toBe(moved.content);
    expect(findSurfaceNode(moved, "stroke")!.node).toEqual(
      findSurfaceNode(doc, "stroke")!.node,
    );
    expect(() => moveNode(doc, "board", "sketch")).toThrow(/自身/);
    expect(() =>
      validateDocument(moveNode(doc, "stroke", doc.content.attrs!.id)),
    ).toThrow(/Board/);
  });
  it("keeps templates, partial exports and view references local to their container", () => {
    const doc = fixture();
    doc.surfaceViews.sketch = {
      initial: "focus",
      saved: [{ id: "focus", name: "Stroke", targets: ["stroke"] }],
      readingOrder: ["stroke"],
    };
    const copy = instantiateTemplate(doc);
    expect(copy.content.attrs!.id).not.toBe(doc.content.attrs!.id);
    const ids = new Set<string>();
    visitNodes(copy.content, (node) => {
      if (node.attrs?.id) ids.add(node.attrs.id);
    });
    for (const [id, views] of Object.entries(copy.surfaceViews!)) {
      expect(ids.has(id)).toBe(true);
      for (const view of views.saved)
        for (const target of view.targets) expect(ids.has(target)).toBe(true);
    }
    const before = documentHash(doc);
    const partial = selectDocumentBlocks(doc, ["sketch"]);
    expect(
      parseArtifact(
        serializeArtifact(partial, undefined, undefined, undefined, {
          blockIds: ["sketch"],
        }),
      ).version,
    ).toBe(3);
    expect(documentHash(doc)).toBe(before);
    expect(findSurfaceNode(partial, "stroke")).toBeDefined();
    const inserted = insertResourceTemplate(doc, doc, "board");
    expect(findSurfaceNode(inserted, "board")!.node.content).toHaveLength(2);
    expect(() => validateDocument(inserted)).not.toThrow();
  });
  it("validates nested coordinates, leaf drawings, distinct views and stable ids", () => {
    const doc = fixture();
    const invalid = structuredClone(doc);
    invalid.layout.sketch.heightMode = "auto";
    expect(() => validateDocument(invalid)).toThrow(/fixed viewport/);
    const cross = structuredClone(doc);
    cross.surfaceViews.sketch.saved = [
      { id: "bad", name: "bad", targets: ["board"] },
    ];
    expect(() => validateDocument(cross)).toThrow(/existing nodes/);
    const duplicate = structuredClone(doc);
    findSurfaceNode(duplicate, "sketch")!.node.attrs!.id = "board";
    expect(() => validateDocument(duplicate)).toThrow(/unique/);
    const remapped = remapSurfaceIds(doc);
    expect(() => validateDocument(remapped)).not.toThrow();
    const removed = removeNode(doc, "evidence");
    expect(removed.surfaceViews.sketch).toBeUndefined();
    expect(removed.layout.stroke).toBeUndefined();
  });
  it("exposes creation, wrapping and nested views through Agent operations", () => {
    const doc = createResource(blankDocument());
    let changed = applyOperations(doc, [
      { type: "surface.create", kind: "board", nodeId: "b" },
      { type: "surface.create", kind: "page", nodeId: "p", parentId: "b" },
      {
        type: "surface.view.save",
        surfaceId: "b",
        view: { id: "v", name: "Page", targets: ["p"] },
        initial: true,
      },
    ]);
    expect(changed.surfaceViews!.b.initial).toBe("v");
    changed = applyOperations(changed, [
      { type: "surface.wrap", kind: "board" },
    ]);
    expect(changed.content.attrs!.kind).toBe("board");
    expect(() => validateDocument(changed)).not.toThrow();
  });
  it("adapts v1 as Page, keeps v2 as Board and backs up exact v2 bytes on first save", async () => {
    const path = await mkdtemp(join(tmpdir(), "showai-containers-"));
    directories.push(path);
    const store = new FileStore(path),
      project = await store.createProject({ name: "Migration" });
    const old = blankDocument();
    old.title = "Old title";
    old.content.content = [
      {
        type: "paragraph",
        attrs: { id: "original" },
        content: [{ type: "text", text: "Original text" }],
      },
    ];
    expect(upgradeResource(old).content.attrs!.kind).toBe("page");
    const v2 = upgradeDocument(old);
    const created = await store.createPage(project.id, { document: v2 });
    const raw =
      JSON.stringify(
        { format: "showai", version: 2, document: created.document },
        null,
        4,
      ) + "\n";
    await writeFile(created.path, raw);
    const loaded = await store.readPage(project.id, created.document.id);
    const next = upgradeResource(loaded.document);
    expect(next.content.attrs!.kind).toBe("board");
    expect(next.layout).toEqual(v2.layout);
    const saved = await store.savePage(
      project.id,
      created.document.id,
      next,
      loaded.hash,
    );
    expect(
      await readFile(
        join(
          dirname(dirname(saved.path)),
          "migrations",
          saved.document.id,
          "original-v2.json",
        ),
        "utf8",
      ),
    ).toBe(raw);
    expect(JSON.parse(await readFile(saved.path, "utf8")).version).toBe(3);
    await expect(
      store.savePage(
        project.id,
        saved.document.id,
        loaded.document,
        saved.hash,
      ),
    ).rejects.toThrow(/legacy/);
    const template = await saveTemplate(
      path,
      {
        name: "Nested",
        description: "Recursive",
        document: fixture(),
        composition: [
          {
            type: "content",
            content: next.content,
            layout: next.layout,
            surfaceViews: next.surfaceViews,
          },
        ],
      },
      project.id,
    );
    expect(() => validateDocument(template.document)).not.toThrow();
    expect(
      (await instantiateTemplateRecord(path, template, project.id)).content
        .attrs!.kind,
    ).toBe("page");
  });
});
