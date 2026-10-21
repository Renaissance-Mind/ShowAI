import { insertComponent } from "./component-insertion";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  blankDocument,
  importComponent,
  resolveDocumentComponents,
} from "../core/catalog";
import { FileStore } from "../core/store";
import { createResource, createSurface } from "./containers.mjs";
import { remapSurfaceIds, findSurfaceNode } from "./document.mjs";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { selectDocumentBlocks } from "../portable/selection.mjs";
import { collectCustomComponentRefs } from "../components/custom/contract";
import { mergePageContent } from "../core/page-merge-model";
import {
  buildPageOutline,
  defaultPageOutline,
  flattenOutline,
  outlinePlacement,
} from "./page-outline.mjs";
import type { ContainerDocument } from "../types";
const paths: string[] = [];
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
export function outlineDocument(): ContainerDocument {
  const doc = createResource(blankDocument());
  doc.content.attrs!.outline = defaultPageOutline();
  const heading = (id: string, level: number, title: string) => ({
    type: "heading",
    attrs: { id, level },
    content: [{ type: "text", text: title }],
  });
  const nested = createSurface("page", "Nested", "nested");
  nested.content = [heading("nested-heading", 1, "Nested heading")];
  doc.content.content = [
    heading("intro", 1, "Same title"),
    heading("sub", 3, "Subsection"),
    heading("next", 2, "Same title"),
    nested,
  ];
  doc.surfaceViews = {};
  return validateDocument(doc) as ContainerDocument;
}
describe("native Page outline contract", () => {
  it("derives stable IDs and true heading ancestry while excluding nested Page content", () => {
    const doc = outlineDocument(),
      tree = buildPageOutline(doc.content);
    expect(flattenOutline(tree.items).map((i) => i.title)).toEqual([
      "Same title",
      "Subsection",
      "Same title",
    ]);
    expect(tree.items[0].children.map((i) => i.id)).toEqual([
      "heading:sub",
      "heading:next",
    ]);
    doc.content.content![0].content![0].text = "Renamed";
    expect(buildPageOutline(doc.content).items[0]).toMatchObject({
      id: "heading:intro",
      title: "Renamed",
    });
    doc.content.attrs!.outline.source.overrides = {
      sub: { hidden: true },
      next: { title: "Alias" },
    };
    expect(
      flattenOutline(buildPageOutline(doc.content).items).map((i) => i.title),
    ).toEqual(["Renamed", "Alias"]);
  });
  it("promotes visible descendants without attaching them to a different hidden chapter", () => {
    const doc = outlineDocument();
    doc.content.attrs!.outline.source.overrides = { intro: { hidden: true } };
    const tree = buildPageOutline(doc.content);
    expect(tree.items.map((item) => item.id)).toEqual([
      "heading:sub",
      "heading:next",
    ]);
    expect(tree.targets.has("heading:intro")).toBe(false);
  });
  it("keeps independently navigated stepper content outside the Page outline", () => {
    const inserted = insertComponent(outlineDocument(), null, "stepper", {
      steps: [{ title: "Step", content: "## Inside the step" }],
    });
    const page = validateDocument(inserted.document).content;
    expect(
      flattenOutline(buildPageOutline(page).items).map((item) => item.title),
    ).toEqual(["Same title", "Subsection", "Same title"]);
    page.attrs!.outline.source = {
      mode: "manual",
      entries: [{ id: "stepper-link", nodeId: inserted.nodeId }],
    };
    expect(buildPageOutline(page).targets.get("stepper-link")).toBe(
      inserted.nodeId,
    );
  });
  it("preserves disabled configuration and rejects Board/native attribute misuse and malformed trees", () => {
    const doc = outlineDocument();
    doc.content.attrs!.outline.enabled = false;
    expect(
      parseArtifact(serializeArtifact(doc)).document.content.attrs!.outline
        .enabled,
    ).toBe(false);
    const board = structuredClone(doc);
    board.content.attrs!.kind = "board";
    expect(() => validateDocument(board)).toThrow(/only Page/);
    for (const source of [
      { mode: "headings", maxLevel: 7 },
      {
        mode: "manual",
        entries: [
          { id: "a", title: "A" },
          { id: "a", title: "B" },
        ],
      },
      { mode: "manual", entries: [{ id: "a" }] },
    ]) {
      const invalid = structuredClone(doc);
      invalid.content.attrs!.outline.source = source;
      expect(() => validateDocument(invalid)).toThrow(/Page outline/);
    }
  });
  it("retains broken manual references for repair while restricting navigation to its Page", () => {
    const doc = outlineDocument();
    doc.content.attrs!.outline.source = {
      mode: "manual",
      entries: [
        {
          id: "group",
          title: "Group",
          children: [
            { id: "valid", nodeId: "intro" },
            { id: "outside", nodeId: "nested-heading" },
            { id: "deleted", nodeId: "gone" },
          ],
        },
      ],
    };
    const tree = buildPageOutline(validateDocument(doc).content);
    expect([...tree.targets]).toEqual([["valid", "intro"]]);
    expect(tree.missing).toEqual(["outside", "deleted"]);
    expect(tree.items[0].children.map((i) => i.id)).toEqual(["valid"]);
  });
  it("remaps manual targets, entry identities and heading overrides with template content", () => {
    const doc = outlineDocument();
    doc.content.attrs!.outline.source = {
      mode: "manual",
      entries: [{ id: "entry", nodeId: "intro" }],
    };
    let i = 0;
    const copy = remapSurfaceIds(doc, () => `copy-${++i}`);
    const source = copy.content.attrs!.outline.source;
    expect(source.entries[0].id).not.toBe("entry");
    expect(findSurfaceNode(copy, source.entries[0].nodeId)).toBeTruthy();
    expect(buildPageOutline(copy.content).items).toHaveLength(1);
  });
  it("projects selected content without dangling manual targets or renderer loss", () => {
    const doc = outlineDocument();
    doc.content.attrs!.outline.source = {
      mode: "manual",
      entries: [
        { id: "a", nodeId: "intro" },
        { id: "b", nodeId: "next" },
      ],
    };
    const selected = selectDocumentBlocks(doc, ["intro"]);
    expect(selected.content.attrs!.outline.source.entries).toEqual([
      { id: "a", nodeId: "intro" },
    ]);
  });
  it("merges outline settings independently from text edits and exposes conflicting manual structure", () => {
    const base = outlineDocument(),
      ours = structuredClone(base),
      theirs = structuredClone(base);
    ours.content.attrs!.outline.width = 280;
    theirs.content.content![0].content![0].text = "Updated";
    const merged = mergePageContent(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.content.attrs!.outline.width).toBe(280);
    expect(merged.document.content.content![0].content![0].text).toBe(
      "Updated",
    );
    ours.content.attrs!.outline.source = {
      mode: "manual",
      entries: [{ id: "a", nodeId: "intro" }],
    };
    theirs.content.attrs!.outline.source = {
      mode: "manual",
      entries: [{ id: "b", nodeId: "next" }],
    };
    expect(
      mergePageContent(base, ours, theirs).conflicts.length,
    ).toBeGreaterThan(0);
  });
  it.each([
    [
      { width: 1600, gutter: 300, panelWidth: 220, widthMode: "standard" },
      "margin",
    ],
    [
      { width: 1600, gutter: 300, panelWidth: 220, widthMode: "full" },
      "floating",
    ],
    [
      { width: 1000, gutter: 50, panelWidth: 220, widthMode: "wide" },
      "floating",
    ],
    [
      {
        width: 1000,
        gutter: 50,
        panelWidth: 220,
        widthMode: "full",
        pinned: true,
      },
      "docked",
    ],
    [
      {
        width: 700,
        gutter: 100,
        panelWidth: 220,
        widthMode: "standard",
        pinned: true,
      },
      "drawer",
    ],
    [{ width: 360, gutter: 0, panelWidth: 220, widthMode: "full" }, "drawer"],
    [
      {
        width: 1600,
        gutter: 240,
        panelWidth: 220,
        widthMode: "standard",
        previous: "margin",
      },
      "margin",
    ],
    [
      { width: 1600, gutter: 240, panelWidth: 220, widthMode: "standard" },
      "floating",
    ],
  ] as const)(
    "places the outline using actual available space: %j",
    (input, expected) => {
      expect(outlinePlacement(input)).toBe(expected);
    },
  );
  it("stores exact dedicated component revisions and resolves their portable dependencies", async () => {
    const home = await mkdtemp(join(tmpdir(), "showai-outline-"));
    paths.push(home);
    const store = new FileStore(home),
      project = await store.createProject({ name: "Outlines" });
    const compiled = await importComponent(
      home,
      resolve("examples/page-outline-index"),
      project.id,
    );
    expect(compiled).toMatchObject({
      role: "page-outline",
      pageOutlineProtocol: 1,
    });
    const doc = outlineDocument();
    doc.content.attrs!.outline.renderer = {
      componentId: compiled.id,
      version: compiled.version,
      integrity: compiled.integrity,
      props: compiled.defaultData,
    };
    const created = await store.createPage(project.id, { document: doc });
    const loaded = await store.readPage(project.id, created.document.id);
    const components = await resolveDocumentComponents(
      home,
      loaded.document,
      project.id,
    );
    expect(components.map((c) => c.id)).toEqual([compiled.id]);
    expect(collectCustomComponentRefs(loaded.document)).toHaveLength(1);
    const artifact = parseArtifact(
      serializeArtifact(loaded.document, components),
    );
    expect(artifact.document.content.attrs!.outline.renderer.integrity).toBe(
      compiled.integrity,
    );
    expect(artifact.components![0].role).toBe("page-outline");
  });
});
