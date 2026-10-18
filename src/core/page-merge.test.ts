import { findSurfaceNode } from "../surface/document.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { applyOperations } from "./diff";
import { previewPageMerge } from "./page-merge";
import { mergePageContent } from "./page-merge-model";
import type { ShowDocument } from "./model";

describe("structural page merges", () => {
  let root: string;
  let base: ShowDocument;
  let paragraph: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-page-merge-"));
    const store = new FileStore(root);
    const project = await store.createProject({ name: "Merge report" });
    const record = await store.createPage(project.id, { title: "Report" });
    paragraph = record.document.content.content![0].content![0].attrs!.id;
    base = applyOperations(record.document, [
      { type: "block.text.set", blockId: paragraph, text: "alpha beta gamma" },
    ]);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("merges disjoint changes within a paragraph and does not mutate its inputs", () => {
    const ours = applyOperations(base, [
      { type: "block.text.set", blockId: paragraph, text: "ALPHA beta gamma" },
    ]);
    const theirs = applyOperations(base, [
      { type: "block.text.set", blockId: paragraph, text: "alpha beta GAMMA" },
    ]);
    const before = JSON.stringify([base, ours, theirs]);
    const preview = previewPageMerge(base, ours, theirs);
    expect(preview.conflicts).toEqual([]);
    expect(
      findSurfaceNode(preview.document, paragraph)!.node.content![0].text,
    ).toBe("ALPHA beta GAMMA");
    expect(JSON.stringify([base, ours, theirs])).toBe(before);
  });

  it("merges different component data fields without component-specific code", () => {
    const document = applyOperations(base, [
      {
        type: "block.insert",
        node: {
          type: "widget",
          attrs: {
            id: "metrics",
            kind: "metrics",
            data: {
              title: "Income",
              items: [{ label: "Revenue", value: 100 }],
            },
          },
        },
      },
    ]);
    const ours = applyOperations(document, [
      {
        type: "block.attrs.set",
        blockId: "metrics",
        attrs: {
          data: {
            title: "Quarterly income",
            items: [{ label: "Revenue", value: 100 }],
          },
        },
      },
    ]);
    const theirs = applyOperations(document, [
      {
        type: "block.attrs.set",
        blockId: "metrics",
        attrs: {
          data: { title: "Income", items: [{ label: "Revenue", value: 200 }] },
        },
      },
    ]);
    const preview = previewPageMerge(document, ours, theirs);
    expect(preview.conflicts).toEqual([]);
    expect(preview.document.content.content![1].attrs!.data).toEqual({
      title: "Quarterly income",
      items: [{ label: "Revenue", value: 200 }],
    });
  });

  it("preserves independent inserts and reports overlapping text edits", () => {
    const ours = applyOperations(base, [
      {
        type: "block.insert",
        node: {
          type: "paragraph",
          attrs: { id: "human-block" },
          content: [{ type: "text", text: "Human evidence" }],
        },
      },
    ]);
    const theirs = applyOperations(base, [
      {
        type: "block.insert",
        node: {
          type: "paragraph",
          attrs: { id: "agent-block" },
          content: [{ type: "text", text: "Agent evidence" }],
        },
      },
    ]);
    const merged = previewPageMerge(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(
      merged.document.content.content!.map((node) => node.attrs!.id),
    ).toEqual([
      base.content.content![0].attrs!.id,
      "human-block",
      "agent-block",
    ]);
    const left = applyOperations(base, [
      { type: "block.text.set", blockId: paragraph, text: "alpha FIRST gamma" },
    ]);
    const right = applyOperations(base, [
      {
        type: "block.text.set",
        blockId: paragraph,
        text: "alpha SECOND gamma",
      },
    ]);
    expect(
      previewPageMerge(base, left, right).conflicts.length,
    ).toBeGreaterThan(0);
  });

  it("detects conflicting container moves and conservative array edits", () => {
    const document = applyOperations(base, [
      { type: "surface.create", kind: "board", nodeId: "left-board" },
      { type: "surface.create", kind: "board", nodeId: "right-board" },
    ]);
    const ours = applyOperations(document, [
      { type: "block.move", blockId: paragraph, parentId: "left-board" },
    ]);
    const theirs = applyOperations(document, [
      { type: "block.move", blockId: paragraph, parentId: "right-board" },
    ]);
    const preview = previewPageMerge(document, ours, theirs);
    expect(
      preview.conflicts.some((conflict) => conflict.path.endsWith("/parent")),
    ).toBe(true);
    expect(
      preview.document.content.content!.filter(
        (node) => node.attrs!.id === paragraph,
      ),
    ).toHaveLength(0);
    const arrayBase = {
      ...base,
      comments: [
        {
          id: "comment",
          text: "base",
          createdAt: base.createdAt,
          resolved: false,
        },
      ],
    };
    const a = {
      ...arrayBase,
      comments: [{ ...arrayBase.comments[0], text: "human" }],
    };
    const b = {
      ...arrayBase,
      comments: [{ ...arrayBase.comments[0], resolved: true }],
    };
    expect(
      previewPageMerge(arrayBase, a, b).conflicts.some(
        (conflict) => conflict.path === "/page/comments",
      ),
    ).toBe(true);
  });
  it("resolves individual conflicts while retaining independent edits and source formatting", () => {
    const ours = applyOperations(base, [
      { type: "block.text.set", blockId: paragraph, text: "Our conclusion" },
    ]);
    ours.title = "Local title";
    const theirs = applyOperations(base, [
      { type: "block.text.set", blockId: paragraph, text: "Their conclusion" },
    ]);
    theirs.icon = "R";
    const snapshot = JSON.stringify([base, ours, theirs]);
    const preview = mergePageContent(base, ours, theirs);
    const path = preview.conflicts.find((item) =>
      item.path.includes(paragraph),
    )!.path;
    const resolved = mergePageContent(base, ours, theirs, "merge", {
      [path]: "theirs",
    });
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.document.title).toBe("Local title");
    expect(resolved.document.icon).toBe("R");
    expect(findSurfaceNode(resolved.document, paragraph)!.node.content).toEqual(
      findSurfaceNode(theirs, paragraph)!.node.content,
    );
    expect(JSON.stringify([base, ours, theirs])).toBe(snapshot);
    const changedChoice = mergePageContent(base, ours, theirs, "merge", {
      [path]: "ours",
    });
    expect(
      findSurfaceNode(changedChoice.document, paragraph)!.node.content,
    ).toEqual(findSurfaceNode(ours, paragraph)!.node.content);
  });

  it("keeps remaining conflicts explicit until each has a choice", () => {
    const ours = { ...base, title: "Local title", icon: "L" };
    const theirs = { ...base, title: "Remote title", icon: "R" };
    const partial = mergePageContent(base, ours, theirs, "merge", {
      "/page/title": "theirs",
    });
    expect(partial.conflicts.map((item) => item.path)).toEqual(["/page/icon"]);
    expect(partial.document.title).toBe("Remote title");
    const complete = mergePageContent(base, ours, theirs, "merge", {
      "/page/title": "theirs",
      "/page/icon": "ours",
    });
    expect(complete.conflicts).toEqual([]);
    expect(complete.document.icon).toBe("L");
  });

  it("resolves conflicting moves before rebuilding parent ownership", () => {
    const document = applyOperations(base, [
      { type: "surface.create", kind: "board", nodeId: "choose-left" },
      { type: "surface.create", kind: "board", nodeId: "choose-right" },
    ]);
    const ours = applyOperations(document, [
      { type: "block.move", blockId: paragraph, parentId: "choose-left" },
    ]);
    const theirs = applyOperations(document, [
      { type: "block.move", blockId: paragraph, parentId: "choose-right" },
    ]);
    const resolved = mergePageContent(document, ours, theirs, "merge", {
      [`/nodes/${paragraph}/parent`]: "theirs",
    });
    expect(resolved.conflicts).toEqual([]);
    expect(
      findSurfaceNode(resolved.document, "choose-right")!.node.content?.some(
        (node) => node.attrs?.id === paragraph,
      ),
    ).toBe(true);
    expect(
      findSurfaceNode(resolved.document, "choose-left")!.node.content?.some(
        (node) => node.attrs?.id === paragraph,
      ) ?? false,
    ).toBe(false);
  });

  it("resolves ordering without dropping independently inserted nodes", () => {
    const document = applyOperations(base, [
      {
        type: "block.insert",
        node: {
          type: "paragraph",
          attrs: { id: "order-b" },
          content: [{ type: "text", text: "B" }],
        },
      },
      {
        type: "block.insert",
        node: {
          type: "paragraph",
          attrs: { id: "order-c" },
          content: [{ type: "text", text: "C" }],
        },
      },
    ]);
    const ours = structuredClone(document),
      theirs = structuredClone(document);
    const [a, b, c] = document.content.content!;
    ours.content.content = [b, a, c];
    theirs.content.content = [
      a,
      c,
      b,
      {
        type: "paragraph",
        attrs: { id: "remote-addition" },
        content: [{ type: "text", text: "Added remotely" }],
      },
    ];
    const initial = mergePageContent(document, ours, theirs);
    const order = initial.conflicts.find((item) =>
      item.path.endsWith("/order"),
    )!;
    expect(order).toBeDefined();
    const resolved = mergePageContent(document, ours, theirs, "merge", {
      [order.path]: "ours",
    });
    expect(resolved.conflicts).toEqual([]);
    expect(
      resolved.document.content.content!.map((node) => node.attrs!.id),
    ).toEqual([b.attrs!.id, a.attrs!.id, c.attrs!.id, "remote-addition"]);
  });

  it("uses an intact complete page for an explicit whole-page structural choice", () => {
    const theirs = { ...base, title: "Remote page", icon: "R" };
    const ours = { ...base, title: "Local page" };
    const resolved = mergePageContent(base, ours, theirs, "merge", {
      "/structure": "theirs",
    });
    expect(resolved.document).toEqual(theirs);
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.document).not.toBe(theirs);
  });
});
