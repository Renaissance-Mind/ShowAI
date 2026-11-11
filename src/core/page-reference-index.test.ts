import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "../agent/service";
import { LibraryIndex } from "./library-index";
import { pageReferenceEdges } from "./page-reference-index";
import {
  relatedPagesComponent,
  statusTagComponent,
} from "../test/page-reference-components";
import { exportPage } from "../agent/exporter";
import { readFile } from "node:fs/promises";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const link = (projectId: string, pageId: string) =>
  `showai://project/${projectId}/page/${pageId}`;

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "showai-page-refs-"));
  roots.push(home);
  const service = new AgentService({ root: home });
  const project = await service.createProject("References");
  const target = await service.createPage(project.id, { title: "Target" });
  return { home, service, projectId: project.id, target: target.document.id };
}

test("text, step, database and declared component fields enter the index", async () => {
  const { home, service, projectId, target } = await setup();
  const component = await service.saveComponent(
    projectId,
    relatedPagesComponent(),
  );
  const source = await service.createPage(projectId, {
    title: "Source",
    blocks: [
      {
        kind: "text",
        data: {
          format: "markdown",
          content: `Before the link, see [the target](${link(projectId, target)}) for details.`,
        },
      },
      {
        kind: "database",
        data: {
          title: "Reading list",
          columns: [
            { id: "name", name: "Name", type: "text" },
            { id: "page", name: "Page", type: "page" },
          ],
          rows: [{ id: "r1", name: "First record", page: link(projectId, target) }],
        },
      },
      {
        kind: "custom",
        data: {
          componentId: component.id,
          version: component.version,
          integrity: component.integrity,
          props: {
            title: "Related",
            items: [
              { id: "a", page: link(projectId, target), note: "Background" },
              { id: "b", page: "", note: "Empty" },
            ],
          },
        },
      },
    ],
  });
  const index = new LibraryIndex(home);
  const references = await index.pageReferences(projectId, target);
  expect(references.to.map((item) => [item.kind, item.title])).toEqual([
    ["link", "Source"],
    ["database", "Source"],
    ["component", "Source"],
  ]);
  const [text, database, declared] = references.to;
  expect(text.snippet).toBe("Before the link, see the target for details.");
  expect(database.snippet).toBe("Reading list · First record");
  expect(declared.snippet).toBe("Background");
  const blocks = source.document.content.content!.map((node) => node.attrs!.id);
  // The paragraph inside the text block holds the link.
  const paragraph = source.document.content.content![0].content![0].attrs!.id;
  expect(references.to.map((item) => item.blockId)).toEqual([
    paragraph,
    blocks[1],
    blocks[2],
  ]);
  const outgoing = await index.pageReferences(projectId, source.document.id, {
    direction: "from",
  });
  expect(outgoing.from.map((item) => [item.pageId, item.title])).toEqual([
    [target, "Target"],
    [target, "Target"],
    [target, "Target"],
  ]);
  // Invalid declared values never reach a page.
  await expect(
    service.applyPage(projectId, source.document.id, {
      baseHash: (await service.store.readPage(projectId, source.document.id))
        .hash,
      operations: [
        {
          type: "component.props.set",
          blockId: blocks[2],
          props: {
            title: "Related",
            items: [{ id: "x", page: "https://example.com", note: "" }],
          },
        },
      ],
    } as never),
  ).rejects.toThrow();
});

test("backlinks follow rename, delete, restore and duplicate", async () => {
  const { home, service, projectId, target } = await setup();
  const source = await service.createPage(projectId, {
    title: "Source",
    blocks: [
      {
        kind: "text",
        data: {
          format: "markdown",
          content: `[Target](${link(projectId, target)})`,
        },
      },
    ],
  });
  const index = new LibraryIndex(home);
  const titles = async () =>
    (await index.pageReferences(projectId, target)).to.map(
      (item) => item.title,
    );
  expect(await titles()).toEqual(["Source"]);
  const current = await service.store.readPage(projectId, source.document.id);
  await service.savePage(
    projectId,
    source.document.id,
    { ...current.document, title: "Renamed" },
    current.hash,
    undefined,
    undefined,
    current.revision,
  );
  expect(await titles()).toEqual(["Renamed"]);
  await service.updatePage(projectId, source.document.id, { archived: true });
  expect(await titles()).toEqual([]);
  await service.updatePage(projectId, source.document.id, { archived: false });
  expect(await titles()).toEqual(["Renamed"]);
  await service.duplicatePage(projectId, source.document.id, "Copy");
  expect((await titles()).sort()).toEqual(["Copy", "Renamed"]);
  // A deleted target stays listed from the source, marked missing.
  await service.updatePage(projectId, target, { archived: true });
  const from = await index.pageReferences(projectId, source.document.id);
  expect(from.from).toEqual([
    expect.objectContaining({ pageId: target, missing: true }),
  ]);
  // A rebuild produces the same rows as the incremental updates.
  await index.synchronize(true);
  expect((await titles()).sort()).toEqual(["Copy", "Renamed"]);
});

test("references in nested rich text resolve to the component holding them", () => {
  const edges = pageReferenceEdges(
    {
      id: "page",
      content: {
        type: "surface",
        content: [
          {
            type: "widget",
            attrs: {
              id: "callout",
              kind: "toggle",
              data: {
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      attrs: { id: "inner" },
                      content: [
                        {
                          type: "text",
                          text: "Step two",
                          marks: [
                            {
                              type: "link",
                              attrs: {
                                href: "showai://project/p/page/other?blocks=b1",
                              },
                            },
                          ],
                        },
                        {
                          type: "text",
                          text: "self",
                          marks: [
                            {
                              type: "link",
                              attrs: { href: "showai://project/p/page/page" },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
    "p",
  );
  expect(edges).toEqual([
    {
      blockId: "callout",
      projectId: "p",
      pageId: "other",
      blockIds: ["b1"],
      kind: "link",
      snippet: "Step two self",
    },
  ]);
});

test("a mentionable component sits inside a line and exports carry the references its readers need", async () => {
  const { home, service, projectId, target } = await setup();
  const tag = await service.saveComponent(projectId, statusTagComponent());
  const related = await service.saveComponent(projectId, relatedPagesComponent());
  const inline = JSON.stringify({
    componentId: tag.id,
    version: tag.version,
    integrity: tag.integrity,
    props: { label: "blocked" },
  });
  await service.createPage(projectId, {
    title: "Source",
    blocks: [
      {
        kind: "text",
        data: {
          format: "markdown",
          content: `Waiting @[custom]${inline} on [Target](${link(projectId, target)}) from @[date]{"date":"2026-11-20"}`,
        },
      },
    ],
  });
  const read = await service.readPage(projectId, (await service.store.listPages(projectId)).find((page) => page.title === "Source")!.id, {
    format: "markdown",
  });
  const markdown = JSON.stringify(read);
  expect(markdown).toContain('@[date]{\\"date\\":\\"2026-11-20\\"}');
  expect(markdown).toContain(tag.id);
  // The target page shows its backlinks through a custom component that reads them.
  const current = await service.store.readPage(projectId, target);
  await service.applyPage(projectId, target, {
    baseHash: current.hash,
    baseRevision: current.revision,
    operations: [
      {
        type: "component.insert",
        kind: "custom",
        data: {
          componentId: related.id,
          version: related.version,
          integrity: related.integrity,
          props: { title: "Related", items: [] },
        },
      },
    ],
  } as never);
  const out = join(home, "..", `${projectId}-export.html`);
  roots.push(out, out.replace(/\.html$/, ".showai.json"));
  await exportPage({
    root: home,
    projectId,
    pageId: target,
    format: "html",
    out,
  });
  const artifact = JSON.parse(
    await readFile(out.replace(/\.html$/, ".showai.json"), "utf8"),
  );
  expect(artifact.references.page).toEqual({ projectId, pageId: target });
  expect(artifact.references.to.map((item: { title: string }) => item.title))
    .toEqual(["Source"]);
  // A page without a component reading references exports none.
  const plain = join(home, "..", `${projectId}-plain.html`);
  roots.push(plain, plain.replace(/\.html$/, ".showai.json"));
  const source = (await service.store.listPages(projectId)).find((page) => page.title === "Source")!;
  await exportPage({ root: home, projectId, pageId: source.id, format: "html", out: plain });
  expect(
    JSON.parse(await readFile(plain.replace(/\.html$/, ".showai.json"), "utf8"))
      .references,
  ).toBeUndefined();
});
