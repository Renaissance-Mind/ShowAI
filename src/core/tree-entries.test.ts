import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { GitLibrary } from "./git-library";
import { migrateGitContent } from "./content-migration";
import { FileStore } from "./store";
import { nodePrefix } from "./history-codec";
import { selectTreeEntries, type TreeQuery } from "./sqlite-reader";

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
