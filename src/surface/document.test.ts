import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import {
  normalizeDocument,
  applyOperations,
  diffDocuments,
} from "../core/diff";
import { FileStore } from "../core/store";
import { instantiateTemplate } from "../core/catalog";
import { newDocument, toMarkdown } from "../lib/document";
import {
  addNode,
  createRegion,
  moveNode,
  removeNode,
  editNode,
  captureDeletion,
  restoreDeletion,
} from "./editing";
import {
  artifactVersion,
  placeTemplate,
  findSurfaceNode,
  linearContent,
  remapSurfaceIds,
  upgradeDocument,
  visitNodes,
} from "./document.mjs";

const paragraph = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
const legacy = () =>
  normalizeDocument({
    ...newDocument("Original title"),
    content: {
      type: "doc",
      content: [
        paragraph("body", "Original body"),
        {
          type: "callout",
          attrs: {
            id: "side",
            icon: "",
            tone: "neutral",
            canvas: { x: 1100, y: 120, width: 360 },
          },
          content: [paragraph("side-text", "Reference")],
        },
      ],
    },
  });
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("whiteboard page model", () => {
  it("migrates valid legacy ids and long titles deterministically without losing content", () => {
    const before = {
      ...newDocument("T".repeat(500)),
      content: {
        type: "doc",
        content: [
          paragraph("duplicate", "first"),
          paragraph("duplicate", "second"),
          paragraph("__proto__", "third"),
          paragraph("toString", "fourth"),
        ],
      },
    };
    const snapshot = JSON.stringify(before);
    const migrated = upgradeDocument(before);
    expect(upgradeDocument(before)).toEqual(migrated);
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(migrated.content.content![0].attrs!.name).toHaveLength(200);
    expect(JSON.stringify(migrated)).toContain("T".repeat(500));
    expect(findSurfaceNode(migrated, "duplicate")!.node.content![0].text).toBe(
      "first",
    );
    expect(linearContent(migrated).content).toHaveLength(5);
    expect(JSON.stringify(before)).toBe(snapshot);
    const root = {
      ...migrated,
      content: { type: "surface", content: [paragraph("toString", "root")] },
      layout: {},
      views: undefined,
    };
    delete root.views;
    expect(validateDocument(root).layout!.toString).toMatchObject({
      width: 360,
    });
  });
  it("replacing a region clears its region layout while rejecting invalid explicit frame edits", () => {
    const before = upgradeDocument(legacy());
    const next = applyOperations(before, [
      {
        type: "block.replace",
        blockId: "side",
        node: {
          type: "paragraph",
          attrs: { id: "side" },
          content: [{ type: "text", text: "replacement" }],
        },
      },
    ]);
    expect(next.layout!.side).toEqual({ x: 1100, y: 120, width: 360 });
    expect(before.layout!.side.mode).toBe("flow");
    expect(() =>
      applyOperations(next, [
        { type: "surface.layout.set", nodeId: "side", layout: { columns: 3 } },
      ]),
    ).toThrow(/Only regions/);
  });

  it("edits one branch without mutating or replacing other regions", () => {
    const before = upgradeDocument(legacy());
    const side = findSurfaceNode(before, "side")!.node;
    const after = editNode(before, "body", (node) => {
      node.content = [{ type: "text", text: "Edited" }];
    });
    expect(findSurfaceNode(before, "body")!.node.content![0].text).toBe(
      "Original body",
    );
    expect(findSurfaceNode(after, "side")!.node).toBe(side);
    expect(findSurfaceNode(after, "body")!.node.content![0].text).toBe(
      "Edited",
    );
  });
  it("restores deleted content together with its views and reading order", () => {
    const before = upgradeDocument(legacy());
    before.views = {
      initial: "side-view",
      saved: [
        { id: "side-view", name: "Side", targets: ["side", "side-text"] },
      ],
      readingOrder: ["side", before.content.content![0].attrs!.id],
    };
    const deletion = captureDeletion(before, "side")!;
    const after = editNode(removeNode(before, "side"), "body", (node) => {
      node.content = [{ type: "text", text: "Later edit" }];
    });
    const restored = restoreDeletion(after, deletion);
    expect(restored.views).toEqual(before.views);
    expect(restored.layout!.side).toEqual(before.layout!.side);
    expect(findSurfaceNode(restored, "body")!.node.content![0].text).toBe(
      "Later edit",
    );
  });
  it("inserts a template with relative placement, fresh identities and preserved destination data", () => {
    const source = upgradeDocument(legacy());
    source.views = {
      initial: "source-view",
      saved: [{ id: "source-view", name: "Source", targets: ["side"] }],
      readingOrder: ["side", source.content.content![0].attrs!.id],
    };
    const inserted = placeTemplate(source, source);
    expect(inserted.content.content).toHaveLength(4);
    expect(inserted.views!.initial).toBe("source-view");
    const ids: string[] = [];
    visitNodes(inserted.content, (node) => {
      if (node.attrs?.id) ids.push(node.attrs.id);
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateDocument(inserted).views!.saved).toHaveLength(2);
    expect(
      inserted.layout![inserted.content.content![2].attrs!.id].x,
    ).toBeGreaterThan(source.layout!.side.x + source.layout!.side.width);
  });
  it("upgrades legacy content without mutations or privileged nodes", () => {
    const source = legacy(),
      before = structuredClone(source),
      page = upgradeDocument(source);
    expect(source).toEqual(before);
    expect(upgradeDocument(source)).toEqual(page);
    expect(page.content.type).toBe("surface");
    expect(page.content.content?.every((node) => node.type === "region")).toBe(
      true,
    );
    expect(page.layout!.side).toMatchObject({
      x: 1100,
      y: 120,
      width: 360,
      mode: "flow",
    });
    expect(findSurfaceNode(page, "body")?.node).toEqual(
      findSurfaceNode(source, "body")?.node,
    );
    expect(toMarkdown(linearContent(page))).toContain("Original title");
    expect(parseArtifact(serializeArtifact(page))).toMatchObject({
      version: 2,
      document: page,
    });
    expect(parseArtifact(serializeArtifact(source))).toMatchObject({
      version: 1,
      document: source,
    });
  });
  it("deletes the first region, then every region, without an implicit document", () => {
    let page = upgradeDocument(legacy());
    const first = page.content.content![0].attrs!.id;
    page.views = {
      initial: "start",
      saved: [{ id: "start", name: "Start", targets: [first] }],
      readingOrder: [first, "side"],
    };
    page = removeNode(page, first);
    expect(page.content.content?.map((node) => node.attrs?.id)).toEqual([
      "side",
    ]);
    expect(page.views).toEqual({
      initial: null,
      saved: [],
      readingOrder: ["side"],
    });
    page = removeNode(page, "side");
    expect(page.content).toEqual({ type: "surface", content: [] });
    expect(page.layout).toEqual({});
    expect(artifactVersion(validateDocument(page))).toBe(2);
  });
  it("keeps independent images and components valid without any region", () => {
    let page = upgradeDocument({
      ...newDocument(),
      content: { type: "doc", content: [] },
    });
    page = addNode(
      page,
      {
        type: "image",
        attrs: { id: "image", src: "data:image/png;base64,AA==", alt: "Image" },
      },
      { x: -300, y: 400, width: 480 },
    );
    expect(validateDocument(page).content.content).toHaveLength(1);
    expect(page.content.content![0].type).toBe("image");
    expect(page.layout!.image.x).toBe(-300);
  });
  it("supports equal nested regions and rejects containment cycles", () => {
    let page = upgradeDocument(legacy());
    const id = page.content.content![0].attrs!.id;
    page = moveNode(page, "side", id);
    expect(findSurfaceNode(page, "side")!.parent!.attrs!.id).toBe(id);
    expect(() => moveNode(page, id, "side")).toThrow(/自身/);
    page = moveNode(page, "side", null, { ...page.layout!.side, x: -500 });
    expect(findSurfaceNode(page, "side")!.parent!.type).toBe("surface");
    expect(page.layout!.side.x).toBe(-500);
  });
  it("records layout and view operations in the normal page diff", () => {
    const before = upgradeDocument(legacy());
    const after = applyOperations(before, [
      {
        type: "surface.layout.set",
        nodeId: "side",
        layout: { mode: "grid", columns: 3, gap: 18 },
      },
      {
        type: "surface.view.save",
        view: { id: "view", name: "Reference", targets: ["side"] },
        initial: true,
      },
      {
        type: "surface.reading-order.set",
        nodeIds: ["side", before.content.content![0].attrs!.id],
      },
    ]);
    expect(after.layout!.side).toMatchObject({ mode: "grid", columns: 3 });
    expect(after.views!.initial).toBe("view");
    expect(toMarkdown(linearContent(after)).indexOf("Reference")).toBeLessThan(
      toMarkdown(linearContent(after)).indexOf("Original body"),
    );
    expect(JSON.stringify(diffDocuments(before, after))).toContain(
      "layout.side.mode",
    );
    expect(JSON.stringify(diffDocuments(before, after))).toContain(
      "views.initial",
    );
    const free = applyOperations(after, [
      { type: "surface.layout.set", nodeId: "side", layout: { mode: "free" } },
    ]);
    expect(free.layout!["side-text"]).toBeDefined();
  });
  it("remaps template identities, frames and saved-view references together", () => {
    const source = upgradeDocument(legacy());
    source.views = {
      initial: "reference",
      saved: [
        { id: "reference", name: "Reference", targets: ["side", "side-text"] },
      ],
      readingOrder: ["side", source.content.content![0].attrs!.id],
    };
    for (const copy of [remapSurfaceIds(source), instantiateTemplate(source)]) {
      expect(() => validateDocument(copy)).not.toThrow();
      expect(copy.layout!.side).toBeUndefined();
      expect(copy.views!.initial).not.toBe("reference");
      expect(copy.views!.saved[0].targets).not.toContain("side-text");
      const ids = new Set<string>();
      visitNodes(copy.content, (node) => {
        if (node.attrs?.id) ids.add(node.attrs.id);
      });
      expect(copy.views!.saved[0].targets.every((id) => ids.has(id))).toBe(
        true,
      );
      expect(Object.keys(copy.layout!).every((id) => ids.has(id))).toBe(true);
    }
  });
  it("rejects dangling layout/view refs and invalid dimensions instead of discarding them", () => {
    const page = upgradeDocument(legacy());
    expect(() =>
      validateDocument({
        ...page,
        layout: { ...page.layout, missing: { x: 0, y: 0, width: 300 } },
      }),
    ).toThrow(/unknown node/);
    expect(() =>
      validateDocument({
        ...page,
        views: {
          ...page.views,
          saved: [{ id: "bad", name: "Bad", targets: ["missing"] }],
        },
      }),
    ).toThrow(/targets/);
    expect(() =>
      validateDocument({
        ...page,
        layout: { ...page.layout, side: { x: Infinity, y: 0, width: 0 } },
      }),
    ).toThrow();
    expect(() =>
      parseArtifact({ format: "showai", version: 1, document: page }),
    ).toThrow(/version/);
  });
  it("backs up exact legacy bytes on first upgrade and preserves existing checkpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "showai-surface-"));
    directories.push(directory);
    const store = new FileStore(directory),
      project = await store.createProject({ name: "Migration" });
    const original = await store.createPage(project.id, { document: legacy() });
    const raw = await readFile(original.path, "utf8");
    await store.readPage(project.id, original.document.id);
    expect(await readFile(original.path, "utf8")).toBe(raw);
    const upgraded = await store.applyPage(project.id, original.document.id, {
      baseHash: original.hash,
      operations: [{ type: "surface.upgrade" }],
    });
    const backup = join(
      dirname(dirname(original.path)),
      "migrations",
      original.document.id,
      "original-v1.json",
    );
    expect(await readFile(backup, "utf8")).toBe(raw);
    expect(JSON.parse(await readFile(original.path, "utf8")).version).toBe(3);
    expect(
      (await store.diffPage(project.id, original.document.id, original.hash))
        .changed,
    ).toBe(true);
    await expect(
      store.savePage(
        project.id,
        original.document.id,
        original.document,
        original.hash,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await store.savePage(
      project.id,
      original.document.id,
      { ...upgraded.document, title: "Changed" },
      upgraded.hash,
    );
    expect(await readFile(backup, "utf8")).toBe(raw);
    const created = await store.createPage(project.id);
    expect(created.document.content.type).toBe("surface");
    const region = createRegion();
    expect(region.node.type).toBe("region");
  });
});
