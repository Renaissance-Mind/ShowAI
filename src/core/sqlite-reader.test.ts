import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SqliteLibrary } from "./sqlite-library";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function library() {
  const root = await mkdtemp(join(tmpdir(), "showai-scoped-reader-"));
  roots.push(root);
  const library = new SqliteLibrary(root);
  await library.initialize();
  return { root, library };
}
const context = () => ({
  actor: { kind: "human" as const },
  channel: "desktop" as const,
});
it("pins indexed reads to their requested revision through changes, removals and shared asset decoding", async () => {
  const { library: a } = await library(),
    { library: b } = await library();
  const path = "projects/project-a/settings.json",
    other = "projects/project-b/settings.json";
  const image =
    "data:image/png;base64," + Buffer.from("retained image").toString("base64");
  await a.writeFiles(
    new Map([
      [path, Buffer.from(JSON.stringify({ value: "A", image }))],
      [other, Buffer.from('{"value":"unrelated"}')],
    ]),
    context(),
  );
  const first = (await a.head())!;
  await a.writeFiles(
    new Map([[path, Buffer.from(JSON.stringify({ value: "B", image }))]]),
    context(),
  );
  const second = (await a.head())!;
  await a.writeFiles(
    new Map([[path, Buffer.from(JSON.stringify({ value: "A", image }))]]),
    context(),
  );
  const third = (await a.head())!;
  expect(JSON.parse((await a.readFile(path, first)).toString())).toEqual({
    value: "A",
    image,
  });
  expect(JSON.parse((await a.readFile(path, second)).toString()).value).toBe(
    "B",
  );
  expect((await a.resourceRevisions([path, other], third)).get(path)).toBe(
    third,
  );
  expect((await a.resourceRevisions([path, other], third)).get(other)).toBe(
    first,
  );
  await b.writeFiles(
    new Map([[path, Buffer.from('{"value":"different library"}')]]),
    context(),
  );
  expect(JSON.parse((await b.readFile(path)).toString()).value).toBe(
    "different library",
  );
  await a.writeFiles(new Map([[path, null]]), context());
  await expect(a.readFile(path)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(JSON.parse((await a.readFile(path, first)).toString()).image).toBe(
    image,
  );
  expect(await a.readFiles([])).toEqual(new Map());
  await expect(a.readFile("projects/../secret")).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
});
it("keeps returned trees and bytes isolated and detects corruption on repeated reads", async () => {
  const { root, library: a } = await library();
  const path = "projects/project-a/settings.json";
  await a.writeFiles(
    new Map([[path, Buffer.from('{"value":"retained"}')]]),
    context(),
  );
  const revision = (await a.head())!,
    tree = await a.tree(revision);
  tree[0].path = "mutated";
  expect((await a.tree(revision))[0].path).toBe(path);
  (await a.readFile(path)).fill(0);
  expect(JSON.parse((await a.readFile(path)).toString()).value).toBe(
    "retained",
  );
  const db = new DatabaseSync(join(root, "history/content.sqlite"));
  try {
    db.prepare(
      "UPDATE blobs SET digest=? WHERE oid=(SELECT oid FROM current_files WHERE path=?)",
    ).run("0".repeat(64), path);
  } finally {
    db.close();
  }
  await expect(a.readFile(path)).rejects.toMatchObject({
    code: "INVALID_DATA",
  });
});
it("reuses an immutable object at new paths while retaining both historical revisions", async () => {
  const { library: a } = await library();
  const bytes = Buffer.from("reusable content ".repeat(20000));
  await a.writeFiles(new Map([["assets/first", bytes]]), context());
  const first = (await a.head())!;
  await a.writeFiles(
    new Map([
      ["assets/second", bytes],
      ["assets/third", bytes],
    ]),
    context(),
  );
  expect((await a.objectStatistics()).packedObjects).toBe(1);
  expect(await a.readFile("assets/first", first)).toEqual(bytes);
  expect(await a.readFile("assets/second")).toEqual(bytes);
  await a.verify();
});
