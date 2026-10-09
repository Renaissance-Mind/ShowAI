import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { ContentLibrary as GitLibrary } from "./content-library";
import { LibraryIndex } from "./library-index";
import { applyOperations } from "./diff";
import type { ChangeContext } from "./history-model";

const actor: ChangeContext = {
  actor: { kind: "agent", harness: "codex", sessionId: "search-session" },
  channel: "cli",
  message: "更新论文图表证据",
};
describe("rebuildable content and history index", () => {
  let root: string;
  let library: GitLibrary;
  let index: LibraryIndex;
  let projectId: string;
  let path: string;
  let paragraph: string;
  let source: Buffer;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-index-"));
    const store = new FileStore(join(root, "source"));
    const project = await store.createProject({ name: "论文研究" });
    projectId = project.id;
    const page = await store.createPage(project.id, { title: "实验报告" });
    paragraph = page.document.content.content![0].attrs!.id;
    const document = applyOperations(page.document, [
      {
        type: "block.text.set",
        blockId: paragraph,
        text: "论文图表展示检索结果，包含中文短词和English evidence。",
      },
      {
        type: "surface.create",
        kind: "board",
        nodeId: "analysis-board",
        name: "误差分析",
      },
      {
        type: "block.insert",
        parentId: "analysis-board",
        node: {
          type: "paragraph",
          attrs: { id: "nested-evidence" },
          content: [{ type: "text", text: "Nested experimental evidence" }],
        },
      },
      {
        type: "component.insert",
        kind: "metrics",
        data: {
          title: "准确率",
          items: [{ label: "模型", value: 80, unit: "%" }],
        },
      },
    ]);
    source = Buffer.from(
      JSON.stringify({ format: "showai", version: 3, document }),
    );
    path = `projects/${project.id}/pages/${page.document.id}.json`;
    library = new GitLibrary(join(root, "library"));
    await library.initialize();
    await library.writeFiles(
      new Map([
        [path, source],
        [
          `projects/${project.id}/project.json`,
          await readFile(join(store.projectPath(project.id), "project.json")),
        ],
      ]),
      actor,
    );
    index = new LibraryIndex(library.root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds Chinese short terms, body text, nested containers and component props with scoped locations", async () => {
    expect(
      (await index.search({ query: "图表", projectId })).items.some(
        (item) => item.blockId === paragraph,
      ),
    ).toBe(true);
    expect(
      (await index.search({ query: "图", projectId })).items.some(
        (item) => item.blockId === paragraph,
      ),
    ).toBe(true);
    const nested = await index.search({ query: "experimental", projectId });
    expect(nested.items[0]).toMatchObject({
      blockId: "nested-evidence",
      path,
      projectId,
    });
    expect(nested.items[0].location).toContain("误差分析");
    expect(
      (await index.search({ query: "准确率" })).items.length,
    ).toBeGreaterThan(0);
    expect(
      (await index.search({ query: "evidence", projectId: "another-project" }))
        .items,
    ).toEqual([]);
    expect(
      await index.references("component", "metrics", { projectId }),
    ).toHaveLength(1);
  });

  it("incrementally updates body searches and rebuilds identical results from Git", async () => {
    await index.synchronize();
    const document = JSON.parse(source.toString()).document;
    const changed = applyOperations(document, [
      {
        type: "block.text.set",
        blockId: paragraph,
        text: "新的检索结论：banana",
      },
    ]);
    await library.writeFiles(
      new Map([
        [
          path,
          Buffer.from(
            JSON.stringify({ format: "showai", version: 3, document: changed }),
          ),
        ],
      ]),
      { ...actor, message: "更新检索结论" },
    );
    expect((await index.search({ query: "图表" })).items).toEqual([]);
    const before = await index.search({ query: "banana" });
    expect(before.items[0].blockId).toBe(paragraph);
    await rm(index.path);
    expect(await index.search({ query: "banana" })).toEqual(before);
    const history = await index.history({
      harness: "codex",
      sessionId: "search-session",
      projectId,
    });
    expect(history.items).toHaveLength(2);
    expect(history.items[0].message).toBe("更新检索结论");
    expect((await index.history({ query: "图表" })).items).toHaveLength(1);
  });

  it("rejects stale search cursors and updates reference edges after deleting a component instance", async () => {
    const first = await index.search({ query: "evidence", limit: 1 });
    expect(first.nextCursor).toBeTruthy();
    const next = await index.search({
      query: "evidence",
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(next.items[0].id).not.toBe(first.items[0].id);
    const document = JSON.parse(source.toString()).document;
    const widget = document.content.content.find(
      (node: { type: string }) => node.type === "widget",
    );
    const changed = applyOperations(document, [
      { type: "block.remove", blockId: widget.attrs.id },
    ]);
    await library.writeFiles(
      new Map([
        [
          path,
          Buffer.from(
            JSON.stringify({ format: "showai", version: 3, document: changed }),
          ),
        ],
      ]),
      actor,
    );
    await expect(
      index.search({ query: "evidence", limit: 1, cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await index.references("component", "metrics", { projectId }),
    ).toEqual([]);
    const one = await index.history({ limit: 1 });
    expect(
      (await index.history({ before: one.nextCursor! })).items,
    ).toHaveLength(1);
  });
});
