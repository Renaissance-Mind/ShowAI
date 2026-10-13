import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import catalog from "../../resources/catalog/components.json";
import { bundleReader } from "../portable/reader-bundle.mjs";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { renderReading } from "./reading-renderer";
import { pageReadSchema } from "./page-reading";
import type { ShowDocument } from "../types";
import { FileStore } from "../core/store";
import { saveComponent } from "../core/catalog";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test.each([
  "text",
  "mechanism-steps",
  "evidence-explorer",
  "comparison-matrix",
  "status-tree",
  "experiment-tracker",
])(
  "portable reader mounts %s without requiring unused component metadata",
  async (kind) => {
    const directory = await mkdtemp(
      join(tmpdir(), "showai-presentation-export-"),
    );
    directories.push(directory);
    const data =
      kind === "text"
        ? {
            format: "richtext",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Portable prose remains readable" },
                  ],
                },
              ],
            },
          }
        : catalog.find((c) => c.kind === kind)!.examples[0].data;
    const expected =
      kind === "text"
        ? "Portable prose remains readable"
        : (data as { title: string }).title;
    const document = {
      id: "page",
      title: "Isolated component",
      icon: "",
      cover: "none",
      parentId: null,
      favorite: false,
      archived: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      comments: [],
      content: {
        type: "surface",
        attrs: { id: "root", kind: "page" },
        content: [{ type: "widget", attrs: { id: "only", kind, data } }],
      },
    } as ShowDocument;
    const reader = await bundleReader(
      resolve("dist-portable/reader-source.json"),
      [document],
    );
    const path = join(directory, "reader.html");
    await writeFile(path, injectArtifactIntoHtml(reader, document));
    const captured = await renderReading(
      path,
      pageReadSchema.parse({
        view: "html",
        viewport: { width: 1200, height: 900 },
      }),
    );
    expect(
      captured.dom.map((frame) => frame.accessibility).join("\n"),
    ).toContain(expected);
    expect(captured.png.subarray(1, 4).toString()).toBe("PNG");
  },
  30000,
);

test("embedded evidence opens an in-flow detail region and can return to its overview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-embedded-evidence-"));
  directories.push(directory);
  const project = await new FileStore(directory).createProject({
    name: "Embedded evidence",
  });
  const definition = catalog.find((c) => c.kind === "evidence-explorer")!;
  const data = { ...definition.examples[0].data, layout: "timeline" };
  const component = await saveComponent(
    directory,
    {
      manifest: {
        id: "embedded-evidence",
        name: "Embedded evidence",
        version: "1.0.0",
        description:
          "Exercise actual reader behavior inside a tall component frame",
        scenarios: ["Embedded reading"],
        entry: "index.tsx",
        defaultData: data,
        examples: [{ name: "Geometry", data }],
      },
      schema: definition.propsSchema,
      source:
        'import {EvidenceExplorer} from "showai:components";export default function Component({data,readOnly}){return <div style={{width:900,minHeight:1800}}><EvidenceExplorer data={data} readOnly={readOnly}/></div>}',
    },
    project.id,
  );
  const document = {
    id: "page",
    title: "Embedded reading",
    icon: "",
    cover: "none",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    comments: [],
    content: {
      type: "surface",
      attrs: { id: "root", kind: "page" },
      content: [
        {
          type: "widget",
          attrs: {
            id: "embedded",
            kind: "custom",
            data: {
              componentId: component.id,
              version: component.version,
              integrity: component.integrity,
              props: data,
            },
          },
        },
      ],
    },
  } as ShowDocument;
  const reader = await bundleReader(
    resolve("dist-portable/reader-source.json"),
    [document],
  );
  const path = join(directory, "reader.html");
  await writeFile(path, injectArtifactIntoHtml(reader, document, [component]));
  const open = {
    type: "click",
    role: "button",
    name: "矩形 · 日期未提供",
    blockId: "embedded",
  };
  const result = await renderReading(
    path,
    pageReadSchema.parse({
      view: "html",
      viewport: { width: 1200, height: 900 },
      actions: [open],
    }),
  );
  const body = result.dom.find(
    (frame) => frame.blockId === "embedded",
  )!.accessibility;
  expect(body).toContain('region "证据详情与来源"');
  expect(body).toContain('button "返回总览"');
  expect(body).toContain("相邻边不必相等");
  const returned = await renderReading(
    path,
    pageReadSchema.parse({
      view: "html",
      viewport: { width: 1200, height: 900 },
      actions: [
        open,
        {
          type: "click",
          role: "button",
          name: "返回总览",
          blockId: "embedded",
        },
      ],
    }),
  );
  expect(
    returned.dom.find((frame) => frame.blockId === "embedded")!.accessibility,
  ).toContain('button "矩形 · 日期未提供" [pressed]');
}, 30000);
