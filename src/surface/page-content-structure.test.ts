import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSchema, type JSONContent } from "@tiptap/core";
import { AllSelection, EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { blankDocument } from "../core/catalog";
import { FileStore } from "../core/store";
import {
  createBlockIdPlugin,
  createExtensions,
} from "../components/rich-text/extensions";
import { editorNodeJSON } from "../editor/node-json";
import { validateDocument } from "../portable/validation.mjs";
import { createResource, createSurface } from "./containers.mjs";
import {
  findSurfaceNode,
  isReconciledSurface,
  reconcileSurface,
} from "./document.mjs";
import { editNode, replaceChildren } from "./editing";
import { pageEditorNodes } from "./PageEditorNodes";
import { fromPageEditorDraft, toPageEditor } from "./page-content";
import { ownSourceValue } from "./source-runtime";
import type { ContainerDocument } from "../types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const paragraph = (id: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});
function fixture() {
  const page = createResource(blankDocument());
  page.content = {
    type: "surface",
    attrs: { id: "continuous-root", name: "Page", kind: "page" },
    content: [
      paragraph("continuous-a", "连续第一段"),
      {
        type: "region",
        attrs: { id: "continuous-region", name: "内容区域" },
        content: [paragraph("continuous-b", "连续第二段")],
      },
      {
        type: "richText",
        attrs: { id: "continuous-text", name: "文本" },
        content: [paragraph("continuous-c", "连续第三段")],
      },
      createSurface("board", "Embedded", "embedded"),
    ],
  };
  page.surfaceViews = {};
  const ready = reconcileSurface(page);
  ready.surfaceViews!["continuous-root"] = {
    initial: "focus",
    saved: [
      {
        id: "focus",
        name: "Region",
        targets: ["continuous-region", "embedded"],
      },
    ],
    readingOrder: ready.content.content!.map((node) => node.attrs!.id),
  };
  return ownSourceValue({
    ...ready,
    customRoot: { "e\u0301": [null, "preserved"] },
  });
}
const schema = getSchema([...createExtensions(), ...pageEditorNodes]);
function editor(source: ContainerDocument) {
  const content = { type: "doc", content: source.content.content };
  return EditorState.create({
    schema,
    doc: schema.nodeFromJSON(toPageEditor(content, source)),
    plugins: [history(), createBlockIdPlugin(() => true)],
  });
}
function publish(source: ContainerDocument, state: EditorState) {
  const converted = fromPageEditorDraft(editorNodeJSON(state.doc), source);
  return replaceChildren(
    converted.document,
    source.content.attrs!.id,
    source.content.content!.map((node) => node.attrs!.id),
    converted.content.content ?? [],
    { normalize: false },
  ) as ContainerDocument;
}

describe("continuous Page structural draft reconciliation", () => {
  it("saves a real full-selection replacement after typing and undo without stale region or embedded surface metadata", async () => {
    const source = fixture(),
      original = JSON.stringify(source);
    let state = editor(source);
    state = state.applyTransaction(state.tr.insertText("!", 3)).state;
    const typed = publish(source, state);
    expect(typed.layout).toBe(source.layout);
    expect(typed.surfaceViews).toBe(source.surfaceViews);
    undo(state, (transaction) => {
      state = state.applyTransaction(transaction).state;
    });
    const undone = publish(typed, state);
    expect(undone.layout).toBe(source.layout);
    expect(undone.surfaceViews).toBe(source.surfaceViews);
    expect(state.doc.textContent).toBe("连续第一段连续第二段连续第三段");
    state = state.applyTransaction(
      state.tr
        .setSelection(new AllSelection(state.doc))
        .insertText("文章按顺序阅读，局部白板可以展开编辑。"),
    ).state;
    const next = publish(undone, state);
    expect(findSurfaceNode(next, "continuous-region")).toBeUndefined();
    expect(next.layout!["continuous-region"]).toBeUndefined();
    expect(next.layout!.embedded).toBeUndefined();
    expect(next.surfaceViews!.embedded).toBeUndefined();
    expect(next.surfaceViews!["continuous-root"]).toMatchObject({
      initial: null,
      saved: [],
    });
    expect(next.surfaceViews!["continuous-root"].readingOrder).toEqual(
      next.content.content!.map((node) => node.attrs!.id),
    );
    expect(isReconciledSurface(next)).toBe(true);
    expect(() => validateDocument(next)).not.toThrow();
    expect(JSON.stringify(source)).toBe(original);
    const home = await mkdtemp(join(tmpdir(), "showai-page-structure-"));
    directories.push(home);
    const store = new FileStore(home),
      project = await store.createProject({ name: "Structural editing" });
    const created = await store.createPage(project.id, { document: source });
    const saved = await store.savePage(
      project.id,
      created.document.id,
      next,
      created.hash,
    );
    const reopened = await store.readPage(project.id, created.document.id);
    expect(reopened.hash).toBe(saved.hash);
    expect((reopened.document as typeof source).customRoot).toEqual(
      source.customRoot,
    );
    expect(JSON.stringify(reopened.document.content)).toContain(
      "文章按顺序阅读",
    );
    expect(reopened.document.layout!["continuous-region"]).toBeUndefined();
    // The next ordinary keypress retains both already-sanitized metadata maps.
    state = state.applyTransaction(state.tr.insertText("继续", 2)).state;
    const captured = ownSourceValue(next);
    const again = publish(captured, state);
    expect(again.layout).toBe(captured.layout);
    expect(again.surfaceViews).toBe(captured.surfaceViews);
  });

  it("keeps module-copy layouts through a real PM paste and removes them through its later delete", () => {
    const source = fixture(),
      original = JSON.stringify(source);
    let state = editor(source);
    const module = state.doc.lastChild!;
    expect(module.type.name).toBe("pageModule");
    const copy = schema.nodes.pageModule.create({
      ...module.attrs,
      id: "embedded-copy",
    });
    state = state.applyTransaction(
      state.tr.insert(state.doc.content.size, copy),
    ).state;
    const pasted = publish(source, state);
    expect(pasted.layout!["embedded-copy"]).toEqual(source.layout!.embedded);
    expect(pasted.surfaceViews!["embedded-copy"]).toEqual(
      source.surfaceViews!.embedded,
    );
    expect(() => validateDocument(pasted)).not.toThrow();
    let position = -1,
      size = 0;
    state.doc.descendants((node, at) => {
      if (
        node.type.name === "pageModule" &&
        node.attrs.id === "embedded-copy"
      ) {
        position = at;
        size = node.nodeSize;
      }
    });
    expect(position).toBeGreaterThanOrEqual(0);
    state = state.applyTransaction(
      state.tr.delete(position, position + size),
    ).state;
    const removed = publish(ownSourceValue(pasted), state);
    expect(removed.layout!["embedded-copy"]).toBeUndefined();
    expect(removed.surfaceViews!["embedded-copy"]).toBeUndefined();
    expect(removed.layout!.embedded).toBe(source.layout!.embedded);
    expect(removed.surfaceViews!["continuous-root"].saved[0].targets).toEqual([
      "continuous-region",
      "embedded",
    ]);
    expect(() => validateDocument(removed)).not.toThrow();
    expect(JSON.stringify(source)).toBe(original);
  });

  it("sanitizes nested child removal and node-kind changes but leaves text marks on the fast path", () => {
    const source = fixture(),
      state = editor(source);
    const marked = state.applyTransaction(
      state.tr.addMark(1, 3, schema.marks.bold.create()),
    ).state;
    const formatted = publish(source, marked);
    expect(formatted.layout).toBe(source.layout);
    expect(formatted.surfaceViews).toBe(source.surfaceViews);
    const retyped = editNode(
      source,
      "continuous-region",
      (node) => {
        node.type = "paragraph";
        node.content = [{ type: "text", text: "Now ordinary text" }];
      },
      { normalize: false },
    );
    expect(retyped.layout!["continuous-region"].mode).toBeUndefined();
    expect(retyped.layout!["continuous-region"].columns).toBeUndefined();
    expect(() => validateDocument(retyped)).not.toThrow();
    const nested = ownSourceValue(
      editNode(source, "continuous-region", (node) => {
        node.content = [createSurface("board", "Nested", "nested")];
      }),
    );
    expect(nested.surfaceViews!.nested).toBeDefined();
    const removed = replaceChildren(
      nested,
      "continuous-region",
      ["nested"],
      [paragraph("replacement", "New")],
      { normalize: false },
    );
    expect(removed.layout!.nested).toBeUndefined();
    expect(removed.surfaceViews!.nested).toBeUndefined();
    expect((removed as typeof source).customRoot).toBe(
      (nested as typeof source).customRoot,
    );
    expect(() => validateDocument(removed)).not.toThrow();
  });
});
