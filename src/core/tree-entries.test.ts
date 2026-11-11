import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { GitLibrary } from "./git-library";
import { migrateGitContent } from "./content-migration";
import { FileStore } from "./store";
import { nodePrefix } from "./history-codec";
import {
  pageNodePath,
  selectTreeEntries,
  type TreeQuery,
} from "./sqlite-reader";
import { LibraryIndex } from "./library-index";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const context = {
  actor: { kind: "human" as const },
  channel: "desktop" as const,
};
const bytes = (value: string) => Buffer.from(value);

// Neighbours that a naive prefix match would confuse: a/ vs ab/, a.json vs a/.
const files = [
  "projects/p/conflicts/a/record.json",
  "projects/p/conflicts/a/input.json",
  "projects/p/conflicts/ab/record.json",
  "projects/p/conflicts-b/record.json",
  "projects/p/conflicts0",
  "projects/p/pages/a.json.bak",
  "projects/q/conflicts/a/record.json",
];
const queries: TreeQuery[] = [
  { prefixes: ["projects/p/conflicts/"] },
  { prefixes: ["projects/p/conflicts/a/"] },
  { prefixes: ["projects/p/conflicts/a/", "projects/p/conflicts/ab/"] },
  { paths: ["projects/p/conflicts/a/record.json", "projects/p/missing.json"] },
  {
    paths: ["projects/p/conflicts0", "projects/p/conflicts/a/input.json"],
    prefixes: ["projects/p/conflicts/a/"],
  },
  { prefixes: ["projects/"] },
  {},
];
async function expectSameEntries(
  library: Pick<ContentLibrary, "tree" | "treeEntries">,
  revision: string,
  extra: TreeQuery[] = [],
) {
  const all = [...queries, ...extra];
  const identity = (entries: { path: string; oid: string }[]) =>
    entries.map(({ path, oid }) => ({ path, oid }));
  // Queried before the full tree is read, then again once the reader cached it.
  const queried = [];
  for (const query of all)
    queried.push(identity(await library.treeEntries(query, revision)));
  const tree = await library.tree(revision);
  for (const [index, query] of all.entries()) {
    const expected = identity(selectTreeEntries(tree, query));
    expect(queried[index]).toEqual(expected);
    expect(identity(await library.treeEntries(query, revision))).toEqual(
      expected,
    );
  }
}

test("targeted tree entries match the full tree at the current revision, including page nodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-tree-entries-"));
  roots.push(root);
  const library = new ContentLibrary(root);
  await library.initialize();
  const store = new FileStore(root);
  const project = await store.createProject({ name: "Entries" });
  const page = await store.createPage(project.id, { title: "Nodes" });
  await library.writeFiles(
    new Map(files.map((path, index) => [path, bytes(JSON.stringify(index))])),
    context,
  );
  const head = (await library.head())!;
  const pagePath = `projects/${project.id}/pages/${page.document.id}.json`;
  expect(
    (await library.treeEntries({ prefixes: [nodePrefix(pagePath)] }, head))
      .length,
  ).toBeGreaterThan(0);
  await expectSameEntries(library, head, [
    { paths: [pagePath], prefixes: [nodePrefix(pagePath)] },
    { prefixes: [`projects/${project.id}/`] },
  ]);
  // A deletion leaves neither the path nor the prefix entries.
  await library.writeFiles(
    new Map([["projects/p/conflicts/a/record.json", null]]),
    context,
  );
  const after = (await library.head())!;
  expect(
    (
      await library.treeEntries(
        { prefixes: ["projects/p/conflicts/a/"] },
        after,
      )
    ).map((entry) => entry.path),
  ).toEqual(["projects/p/conflicts/a/input.json"]);
  await expectSameEntries(library, after);
  await expect(
    library.treeEntries({ prefixes: ["projects/p/conflicts"] }, after),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  await expect(
    library.treeEntries({ paths: ["../outside.json"] }, after),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
});

test("targeted tree entries match the full tree of retained historical revisions and legacy storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-tree-entries-"));
  roots.push(root);
  const legacy = new GitLibrary(root);
  await legacy.initialize();
  await legacy.writeFiles(
    new Map(files.map((path, index) => [path, bytes(JSON.stringify(index))])),
    context,
  );
  const first = (await legacy.head())!;
  await legacy.writeFiles(
    new Map<string, Buffer | null>([
      ["projects/p/conflicts/a/record.json", null],
      ["projects/p/conflicts/ab/record.json", bytes(JSON.stringify("changed"))],
      ["projects/p/conflicts/abc/record.json", bytes(JSON.stringify("new"))],
    ]),
    context,
  );
  const second = (await legacy.head())!;
  await expectSameEntries(legacy, first);
  await expectSameEntries(legacy, second);
  await migrateGitContent(root);
  const library = new ContentLibrary(root);
  expect((await library.manifest()).storage).toBe("sqlite");
  // The retained archive answers from its change rows; the head from current files.
  await expectSameEntries(library, first);
  await expectSameEntries(library, second);
  expect(
    (
      await library.treeEntries(
        { prefixes: ["projects/p/conflicts/a/"] },
        first,
      )
    ).map((entry) => entry.path),
  ).toEqual([
    "projects/p/conflicts/a/input.json",
    "projects/p/conflicts/a/record.json",
  ]);
});

// Paths shaped like stored page nodes only in part, which treeFiles keeps.
const nodeLike = [
  "projects/p/pages/x/nodes/abc.json",
  "projects/p/pages/x/sub/nodes/abc.json",
  "projects/p/datasets/pages/x/nodes/abc.json",
  "projects/p/pages/x/nodes.json",
  "packages/pages/x/nodes/abc.json",
];
const withoutNodes = (entries: { path: string; oid: string }[]) =>
  entries
    .filter((entry) => !pageNodePath.test(entry.path))
    .map(({ path, oid }) => ({ path, oid }));
const identity = (entries: { path: string; oid: string }[]) =>
  entries.map(({ path, oid }) => ({ path, oid }));

test("the tree without page nodes is the full tree less exactly those rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-tree-entries-"));
  roots.push(root);
  const legacy = new GitLibrary(root);
  await legacy.initialize();
  await legacy.writeFiles(
    new Map(nodeLike.map((path, index) => [path, bytes(JSON.stringify(index))])),
    context,
  );
  const archived = (await legacy.head())!;
  expect(identity(await new ContentLibrary(root).treeFiles(archived))).toEqual(
    withoutNodes(await legacy.tree(archived)),
  );
  await migrateGitContent(root);
  const library = new ContentLibrary(root);
  // A stored page, split into node rows.
  const storedPage = (id: string) =>
    Buffer.from(
      JSON.stringify({
        format: "showai",
        version: 1,
        document: {
          id,
          content: {
            type: "doc",
            attrs: { id: `${id}-doc` },
            content: [
              {
                type: "paragraph",
                attrs: { id: `${id}-text` },
                content: [{ type: "text", text: id }],
              },
            ],
          },
        },
      }),
    );
  await library.writeFiles(
    new Map([["projects/p/pages/first.json", storedPage("first")]]),
    context,
  );
  const head = (await library.head())!;
  // Read from SQL first, then filtered from the cached full tree.
  const files = identity(await library.treeFiles(head));
  const tree = await library.tree(head);
  expect(tree.length).toBeGreaterThan(files.length);
  expect(files).toEqual(withoutNodes(tree));
  expect(files.map((entry) => entry.path)).toEqual(
    expect.arrayContaining(nodeLike.slice(1)),
  );
  await library.writeFiles(
    new Map([["projects/p/pages/second.json", storedPage("second")]]),
    context,
  );
  const next = (await library.head())!;
  const full = await library.tree(next);
  expect(identity(await library.treeFiles(next))).toEqual(withoutNodes(full));
  // A retained historical revision answers from its change rows.
  expect(identity(await library.treeFiles(archived))).toEqual(
    withoutNodes(await library.tree(archived)),
  );
});

test("page summaries and search follow an edit that changes only a page node", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-tree-entries-"));
  roots.push(root);
  const library = new ContentLibrary(root);
  await library.initialize();
  const store = new FileStore(root);
  const project = await store.createProject({ name: "Summaries" });
  const page = await store.createPage(project.id, { title: "Nodes" });
  const rootNode = page.document.content;
  const saved = await store.savePage(
    project.id,
    page.document.id,
    {
      ...page.document,
      content: {
        ...rootNode,
        content: [
          {
            type: "richText",
            attrs: { id: "block" },
            content: [
              {
                type: "paragraph",
                attrs: { id: "block-text" },
                content: [{ type: "text", text: "alpha" }],
              },
            ],
          },
        ],
      },
      surfaceViews: {
        [rootNode.attrs!.id]: {
          initial: null,
          saved: [],
          readingOrder: ["block"],
        },
      },
    } as never,
    page.hash,
    page.revision,
  );
  const index = new LibraryIndex(root);
  expect((await store.listPages(project.id))[0].hash).toBe(saved.hash);
  expect((await index.search({ query: "alpha" })).total).toBe(1);
  // The same artifact with one text changed: only that node's object differs.
  const path = `projects/${project.id}/pages/${page.document.id}.json`;
  const skeleton = async () =>
    (await library.treeFiles()).find((entry) => entry.path === path)!.oid;
  const before = await skeleton();
  const artifact = JSON.parse((await library.readFile(path)).toString());
  artifact.document.content.content[0].content[0].content[0].text = "omega";
  await library.writeFiles(
    new Map([[path, Buffer.from(JSON.stringify(artifact, null, 2))]]),
    context,
  );
  expect(await skeleton()).toBe(before);
  const current = await store.readPage(project.id, page.document.id);
  expect(current.hash).not.toBe(saved.hash);
  expect((await store.listPages(project.id))[0]).toMatchObject({
    hash: current.hash,
    revision: current.revision,
  });
  expect((await index.search({ query: "omega" })).total).toBe(1);
  expect((await index.search({ query: "alpha" })).total).toBe(0);
});
