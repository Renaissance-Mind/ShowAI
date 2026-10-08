import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankDocument } from "../core/catalog";
import { FileStore } from "../core/store";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import { SurfaceReader } from "../portable/SurfaceReader";
import { PageContent } from "../portable/PageContent";
import { ContainerRuntime } from "./ContainerRuntime";
import { createResource, createSurface } from "./containers.mjs";
import { addNode, editNode } from "./editing";
import { findSurfaceNode } from "./document.mjs";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Page width preferences", () => {
  it("preserves independent root and nested preferences through storage and artifact round trips", async () => {
    const path = await mkdtemp(join(tmpdir(), "showai-page-width-"));
    directories.push(path);
    const store = new FileStore(path);
    const project = await store.createProject({ name: "Page widths" });
    let document = createResource(blankDocument());
    document = addNode(document, createSurface("page", "Nested", "nested"), {
      x: 0,
      y: 0,
      width: 760,
    }) as typeof document;
    const created = await store.createPage(project.id, { document });
    const rootId = created.document.content.attrs!.id;
    let changed = editNode(created.document, rootId, (node) => {
      node.attrs = { ...node.attrs, widthMode: "wide" };
    });
    changed = editNode(changed, "nested", (node) => {
      node.attrs = { ...node.attrs, widthMode: "full" };
    });
    await store.savePage(
      project.id,
      created.document.id,
      changed,
      created.hash,
    );
    const loaded = await store.readPage(project.id, created.document.id);
    const restored = parseArtifact(serializeArtifact(loaded.document)).document;
    expect(restored.content.attrs!.widthMode).toBe("wide");
    expect(findSurfaceNode(restored, "nested")!.node.attrs!.widthMode).toBe(
      "full",
    );
    expect(restored.layout!.nested.width).toBe(760);
  });

  it("accepts existing Pages without a preference and rejects unsupported modes and Board preferences", () => {
    const document = createResource(blankDocument());
    expect(validateDocument(document).content.attrs!.widthMode).toBeUndefined();
    for (const mode of ["standard", "wide", "full"])
      expect(
        validateDocument({
          ...document,
          content: {
            ...document.content,
            attrs: { ...document.content.attrs, widthMode: mode },
          },
        }).content.attrs!.widthMode,
      ).toBe(mode);
    for (const mode of ["narrow", null, 1500])
      expect(() =>
        validateDocument({
          ...document,
          content: {
            ...document.content,
            attrs: { ...document.content.attrs, widthMode: mode },
          },
        }),
      ).toThrow(/width mode/);
    const board = createResource(blankDocument(), "board");
    board.content.attrs!.widthMode = "wide";
    expect(() => validateDocument(board)).toThrow(/width mode/);
    document.content.content![0].attrs!.widthMode = "wide";
    expect(() => validateDocument(document)).toThrow(/Unsupported attribute/);
  });

  it("applies preferences only in the app while exported readers retain standard layout", () => {
    const document = createResource(blankDocument());
    for (const widthMode of ["standard", "wide", "full"]) {
      document.content.attrs!.widthMode = widthMode;
      const app = renderToStaticMarkup(
        createElement(ContainerRuntime, {
          document,
          pageWidthModes: true,
          renderContent: ({ content }) =>
            createElement(PageContent, { content }),
        }),
      );
      expect(app).toContain(`data-width-mode="${widthMode}"`);
      const reader = renderToStaticMarkup(
        createElement(SurfaceReader, { document, heading: null }),
      );
      expect(reader).not.toContain("data-width-mode");
      expect(reader).not.toContain("页面宽度");
    }
  });
});
