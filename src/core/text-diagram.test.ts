import { afterEach, describe, expect, it } from "vitest";
import Ajv from "ajv";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  inspect,
  renderDiagram,
  type DiagramData,
} from "../../resources/catalog/text-diagram/engine.js";
import manifest from "../../resources/catalog/text-diagram/manifest.json";
import schema from "../../resources/catalog/text-diagram/props.schema.json";
import { importComponent, resolveDocumentComponents } from "./catalog";
import { FileStore } from "./store";
import { ContentLibrary } from "./content-library";
import { EditorDrafts } from "./editor-drafts";
import { validateComponentDocumentation } from "../components/custom/documentation";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TextDiagram, {
  readData,
} from "../../resources/catalog/text-diagram/index";
const directory = resolve(
  process.env.SHOWAI_DIAGRAM_TEST_ROOT ??
    join(tmpdir(), "showai-text-diagram-tests"),
);
const temporary: string[] = [];
afterEach(async () => {
  if (process.env.SHOWAI_KEEP_TEST_FIXTURES !== "1")
    await Promise.all(
      temporary
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
});
const data = (
  source: string,
  extra: Partial<DiagramData> = {},
): DiagramData => ({ type: "flow", source, ...extra });
describe("text diagram extraction", () => {
  it("renders the readonly component without edit controls and reads the same model", () => {
    const value = manifest.defaultData as DiagramData;
    const html = renderToStaticMarkup(
      createElement(TextDiagram, { data: value, readOnly: true }),
    );
    expect(html).toContain("结构关系图");
    expect(html).not.toContain("编辑图形");
    expect(readData(value)).toEqual(inspect(value));
  });
  it("validates documented examples and exposes the same relations as the drawing", () => {
    const check = new Ajv().compile(schema);
    validateComponentDocumentation(
      manifest.documentation,
      manifest.examples.length,
    );
    for (const value of [
      manifest.defaultData,
      ...manifest.examples.map((example) => example.data),
    ]) {
      expect(check(value), JSON.stringify(check.errors)).toBe(true);
      const rendered = renderDiagram(value as DiagramData, "example");
      expect(rendered.html).toContain("<svg");
      expect(rendered.model).toEqual(inspect(value as DiagramData));
      expect(rendered.html).not.toContain("am-view-changes");
    }
  });
  it("preserves shapes, branching, Chinese labels and stable node identity in every direction", () => {
    for (const direction of ["TB", "LR", "BT", "RL"] as const) {
      const value = data(
        "(开始) -> {检查？}\n{检查？} -> *处理 & [(数据库)]: 是\ngroup 后端: 处理, 数据库",
        { direction },
      );
      const model = inspect(value);
      expect(model.nodes).toMatchObject([
        { id: "开始", shape: "round" },
        { id: "检查？", shape: "diamond" },
        { id: "处理", hi: true },
        { id: "数据库", shape: "db" },
      ]);
      expect(model.edges).toHaveLength(3);
      const html = renderDiagram(value, "direction").html;
      expect(html).not.toMatch(/NaN|undefined/);
      expect(html).toContain("后端");
    }
    expect(
      renderDiagram(data("A -> B\nB -> A\nA -> A"), "loops").html,
    ).not.toMatch(/NaN|undefined/);
  });
  it("reports malformed brackets and invalid groups without silently discarding source", () => {
    expect(() => inspect(data("[未闭合 -> B"))).toThrow("unclosed");
    expect(() => inspect(data("A -> B\ngroup X: missing"))).toThrow(
      "do not exist",
    );
    expect(() => inspect(data("A -> B\ngroup X: A\ngroup Y: A"))).toThrow(
      "只能属于一个分组",
    );
    expect(() =>
      inspect(data("A -> B", { direction: "bad" as DiagramData["direction"] })),
    ).toThrow("方向");
    expect(() => inspect(data("x".repeat(12001)))).toThrow("12000");
    expect(inspect(data(""))).toMatchObject({
      empty: true,
      nodes: [],
      edges: [],
    });
  });
  it("escapes node and edge text, while preserving change state and self messages", () => {
    const html = renderDiagram(
      data("[<script>alert(1)</script>] -> [B & C]: <img onerror=x>"),
      "escaped",
    ).html;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    const model = inspect(manifest.examples[2].data as DiagramData);
    expect(model.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "缓存", state: "added" }),
        expect.objectContaining({ id: "服务", state: "changed" }),
      ]),
    );
    const seq = inspect(
      data("A -> A: 自调用\nA --> B: 返回\n== 下一阶段 ==\nnote A, B: 说明", {
        type: "sequence",
      }),
    );
    expect(seq.participants).toEqual(["A", "B"]);
    expect(seq.steps).toHaveLength(4);
  });
  it("compiles an actual offline package and saves a page with exact pinned references", async () => {
    await mkdir(join(directory, "tests"), { recursive: true });
    const home = await mkdtemp(join(directory, "tests", "run-"));
    temporary.push(home);
    await new ContentLibrary(home).initialize();
    const store = new FileStore(home);
    const project = await store.createProject({ name: "文本关系图交互验收" });
    const component = await importComponent(
      home,
      resolve("resources/catalog/text-diagram"),
      project.id,
    );
    expect(component.id).toBe("text-diagram");
    expect(component.integrity).toMatch(/^sha256-[a-f0-9]{64}$/);
    let page = await store.createPage(project.id, {
      title: "文本关系图交互验收",
    });
    for (const [index, example] of manifest.examples.entries())
      page = await store.applyPage(project.id, page.document.id, {
        baseHash: page.hash,
        baseRevision: page.revision,
        operations: [
          {
            type: "block.insert",
            parentId: page.document.content.attrs!.id,
            node: {
              type: "widget",
              attrs: {
                id: `diagram-${index}`,
                kind: "custom",
                data: {
                  componentId: component.id,
                  version: component.version,
                  integrity: component.integrity,
                  scope: "project",
                  props: example.data,
                },
              },
            },
          },
        ],
      });
    const resolved = await resolveDocumentComponents(
      home,
      page.document,
      project.id,
    );
    expect(resolved).toHaveLength(1);
    const drafts = new EditorDrafts(home);
    const draftDocument = structuredClone(page.document);
    const widget = draftDocument.content.content!.find(
      (node) => node.type === "widget",
    )!;
    widget.attrs!.data.scope = "project";
    const input = {
      kind: "page" as const,
      clientId: "diagram-editor",
      resourceId: page.document.id,
      projectId: project.id,
      baseRevision: page.revision,
      content: draftDocument,
    };
    const draft = await drafts.save(input);
    expect(
      await drafts.completePage(draft.id, draft.generation, page.revision!),
    ).toBe(true);
    widget.attrs!.data.props.title = "A different unsaved title";
    const changed = await drafts.save(input);
    await expect(
      drafts.completePage(changed.id, changed.generation, page.revision!),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await drafts.read(changed.id)).content).toEqual(draftDocument);
    await writeFile(
      join(directory, "fixture.json"),
      JSON.stringify(
        {
          home,
          projectId: project.id,
          pageId: page.document.id,
          componentId: component.id,
          integrity: component.integrity,
        },
        null,
        2,
      ),
    );
  }, 30000);
});
