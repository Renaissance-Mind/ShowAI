import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { ContentLibrary as GitLibrary } from "./content-library";
import { LibraryIndex } from "./library-index";
import { applyOperations } from "./diff";
import type { ChangeContext } from "./history-model";
import { DatabaseSync } from "node:sqlite";

const actor: ChangeContext = {
  actor: { kind: "agent", harness: "codex", sessionId: "search-session" },
  channel: "cli",
  message: "更新论文图表证据",
};
describe("rebuildable current content index", () => {
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
    paragraph = page.document.content.content![0].content![0].attrs!.id;
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
  it("reindexes only changed page content and deletes removed indexed paths", async () => {
    const second = JSON.parse(source.toString());
    second.document.id = crypto.randomUUID();
    second.document.title = "Unchanged page";
    const otherPath = `projects/${projectId}/pages/${second.document.id}.json`;
    await library.writeFiles(
      new Map([[otherPath, Buffer.from(JSON.stringify(second))]]),
      actor,
    );
    await index.synchronize();
    const changed = applyOperations(JSON.parse(source.toString()).document, [
      {
        type: "block.text.set",
        blockId: paragraph,
        text: "changed isolated phrase",
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
      actor,
    );
    expect(
      (await index.search({ query: "isolated" })).items.some(
        (item) => item.blockId === paragraph,
      ),
    ).toBe(true);
    const db = new DatabaseSync(index.path);
    try {
      expect(
        db
          .prepare("SELECT value FROM metadata WHERE key='last_path_count'")
          .get()!.value,
      ).toBe("1");
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM resources WHERE path=?")
          .get(otherPath)!.n,
      ).toBeGreaterThan(0);
    } finally {
      db.close();
    }
    await library.writeFiles(new Map([[otherPath, null]]), actor);
    await index.synchronize();
    const checked = new DatabaseSync(index.path);
    try {
      expect(
        checked
          .prepare("SELECT COUNT(*) AS n FROM resources WHERE path=?")
          .get(otherPath)!.n,
      ).toBe(0);
    } finally {
      checked.close();
    }
  });

  it("updates current body searches and rebuilds identical results", async () => {
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
    expect(history.items).toEqual([]);
    expect((await index.history({ query: "图表" })).items).toEqual([]);
  });

  it("indexes only reader-visible text of text components and names them by heading", async () => {
    const document = JSON.parse(source.toString()).document;
    const changed = applyOperations(document, [
      {
        type: "block.insert",
        node: {
          type: "heading",
          attrs: { id: "section-heading", level: 2 },
          content: [{ type: "text", text: "背景" }],
        },
      },
      {
        type: "block.insert",
        afterId: "section-heading",
        node: {
          type: "paragraph",
          attrs: { id: "section-paragraph" },
          content: [{ type: "text", text: "Native sentinel paragraph" }],
        },
      },
      {
        type: "block.insert",
        afterId: "section-paragraph",
        node: {
          type: "widget",
          attrs: {
            id: "section-table",
            kind: "table",
            data: { columns: ["做法"], rows: [["Unnamed tablecell"]] },
          },
        },
      },
      {
        type: "block.insert",
        node: {
          type: "widget",
          attrs: {
            id: "styled-note",
            kind: "text",
            data: {
              content:
                "## 对我们的启发\n\n- **检索**时把重要性算进来，见 [原文](https://example.com)。",
              format: "markdown",
              fontSize: 14,
              color: "#3F4B44",
              backgroundColor: "#EEF4F0",
            },
          },
        },
      },
      {
        type: "block.insert",
        node: {
          type: "widget",
          attrs: {
            id: "rich-note",
            kind: "text",
            data: {
              format: "richtext",
              content: {
                type: "doc",
                content: [
                  {
                    type: "heading",
                    attrs: { id: "heading-node", level: 2 },
                    content: [{ type: "text", text: "记忆怎么做" }],
                  },
                  {
                    type: "paragraph",
                    attrs: { id: "paragraph-node" },
                    content: [
                      { type: "text", text: "新近度、" },
                      { type: "text", text: "重要性与相关性" },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        type: "block.insert",
        node: {
          type: "widget",
          attrs: {
            id: "trailing-table",
            kind: "table",
            data: { columns: ["做法"], rows: [["Trailing tablecell"]] },
          },
        },
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
      { ...actor, message: "添加文字组件" },
    );
    const section = (await index.search({ query: "sentinel" })).items[0];
    expect(section.title).toBe("背景");
    expect(section.location).not.toContain("paragraph");
    const table = (await index.search({ query: "tablecell" })).items[0];
    expect(table).toMatchObject({ blockId: "section-table", title: "背景" });
    expect((await index.search({ query: "trailing" })).items[0].title).toBe(
      "记忆怎么做",
    );
    const metrics = (await index.search({ query: "准确率" })).items[0];
    expect(metrics.title).toBe("准确率");
    const markdown = (await index.search({ query: "重要性算进来" })).items[0];
    expect(markdown.title).toBe("对我们的启发");
    expect(markdown.snippet).toContain("检索");
    expect(markdown.snippet).not.toMatch(
      /#3F4B44|#EEF4F0|markdown|\*\*|##|example\.com/,
    );
    const rich = (await index.search({ query: "新近度" })).items[0];
    expect(rich.title).toBe("记忆怎么做");
    expect(rich.snippet).toContain("新近度、重要性与相关性");
    expect(rich.snippet).not.toMatch(/doc|paragraph|heading-node|richtext/);
  });

  it("rebuilds an index written by an earlier extraction version", async () => {
    await index.synchronize();
    const db = new DatabaseSync(index.path);
    db.exec(
      "UPDATE metadata SET value='1' WHERE key='signature_version'; UPDATE search SET body='stale-body-text'",
    );
    db.close();
    expect(
      (await index.search({ query: "图表" })).items.length,
    ).toBeGreaterThan(0);
    expect((await index.search({ query: "stale" })).items).toEqual([]);
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
    expect((await index.history()).items).toEqual([]);
  });
});
