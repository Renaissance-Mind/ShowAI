import { findSurfaceNode } from "../surface/document.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { applyOperations } from "./diff";
import { previewPageMerge } from "./page-merge";
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
});
