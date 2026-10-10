import { findSurfaceNode } from "./document.mjs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "../core/store";
import { applyOperations } from "../core/diff";
import { mergePageContent } from "../core/page-merge-model";
import { rebaseHistoryText, mergeText } from "../core/catalog-merge";
import type { ShowDocument } from "../types";
let root: string, initial: ShowDocument, paragraph: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-undo-rebase-"));
  const store = new FileStore(root),
    project = await store.createProject({ name: "Undo integration" }),
    page = await store.createPage(project.id);
  initial = page.document;
  paragraph = initial.content.content![0].content![0].attrs!.id;
});
afterAll(async () => rm(root, { recursive: true }));
const text = (document: ShowDocument, value: string) =>
  applyOperations(document, [
    { type: "block.text.set", blockId: paragraph, text: value },
  ]);
const value = (document: ShowDocument) =>
  findSurfaceNode(document, paragraph)!
    .node.content?.map((node) => node.text ?? "")
    .join("") ?? "";

test("undo snapshots retain a remote prefix, suffix and insertion inside the owned text span", () => {
  const owned = text(initial, "管理员内容"),
    incoming = text(owned, "编辑端：管理员新内容。");
  const snapshot = mergePageContent(
    owned,
    incoming,
    initial,
    "history",
  ).document;
  expect(value(snapshot)).toBe("编辑端：新。");
  expect(rebaseHistoryText("aXYz", "az", "aX远端Yz")).toBe("a远端z");
  expect(rebaseHistoryText("😀中文", "", "前😀中插文后")).toBe("前插后");
});
test("redo snapshots retain remote edits while restoring local edits", () => {
  const owned = text(initial, "本机文字"),
    undone = text(initial, "远端前缀");
  expect(
    value(mergePageContent(initial, undone, owned, "history").document),
  ).toBe("远端前缀本机文字");
});
test("remote component fields survive undo of an independent local field", () => {
  const base = applyOperations(initial, [
    {
      type: "block.insert",
      node: {
        type: "widget",
        attrs: {
          id: "shared-widget",
          kind: "metrics",
          data: { title: "Original", value: 1 },
        },
      },
    },
  ]);
  const own = applyOperations(base, [
    {
      type: "block.attrs.set",
      blockId: "shared-widget",
      attrs: { data: { title: "Local title", value: 1 } },
    },
  ]);
  const remote = applyOperations(own, [
    {
      type: "block.attrs.set",
      blockId: "shared-widget",
      attrs: { data: { title: "Local title", value: 2 } },
    },
  ]);
  const result = mergePageContent(own, remote, base, "history");
  expect(result.document.content.content![1].attrs!.data).toEqual({
    title: "Original",
    value: 2,
  });
});
test("overlapping remote field replacements retain the remote value", () => {
  const base = { ...initial, icon: "File" },
    own = { ...base, icon: "Star" },
    remote = { ...own, icon: "BookOpen" };
  expect(mergePageContent(own, remote, base, "history").document.icon).toEqual(
    remote.icon,
  );
});
test("ordinary sync still reports same-position concurrent insertions and accepts disjoint boundaries", () => {
  expect(mergeText("base", "onebase", "twobase", "characters")).toBeUndefined();
  expect(mergeText("mine", "", "remote:mine", "characters")).toBe("remote:");
  expect(mergeText("mine", "", "mine:remote", "characters")).toBe(":remote");
});
