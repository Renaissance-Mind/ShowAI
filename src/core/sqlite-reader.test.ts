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
it("reads current content and per-resource tokens through changes, removals and shared asset decoding", async () => {
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
  expect(JSON.parse((await a.readFile(path)).toString())).toEqual({
    value: "A",
    image,
  });
  expect(JSON.parse((await a.readFile(path, third)).toString()).value).toBe(
    "A",
  );
  // Superseded states are not retained.
  await expect(a.readFile(path, second)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
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
  expect(JSON.parse((await a.readFile(other)).toString()).value).toBe(
    "unrelated",
  );
  expect((await a.resourceRevisions([other])).get(other)).toBe(first);
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
it("reuses an immutable object at new paths", async () => {
  const { library: a } = await library();
  const bytes = Buffer.from("reusable content ".repeat(20000));
  await a.writeFiles(new Map([["assets/first", bytes]]), context());
  await a.writeFiles(
    new Map([
      ["assets/second", bytes],
      ["assets/third", bytes],
    ]),
    context(),
  );
  expect((await a.objectStatistics()).packedObjects).toBe(1);
  expect(await a.readFile("assets/first")).toEqual(bytes);
  expect(await a.readFile("assets/second")).toEqual(bytes);
  await a.verify();
});
it("reclaims a replaced object only after no current path or archived change uses it", async () => {
  const { root, library: a } = await library();
  const shared = Buffer.from("shared object ".repeat(200));
  await a.writeFiles(
    new Map([
      ["assets/one", shared],
      ["assets/two", shared],
    ]),
    context(),
  );
  const objects = () => {
    const db = new DatabaseSync(join(root, "history/content.sqlite"));
    try {
      return Number(db.prepare("SELECT COUNT(*) AS n FROM blobs").get()!.n);
    } finally {
      db.close();
    }
  };
  const before = objects();
  await a.writeFiles(
    new Map([["assets/one", Buffer.from("replaced")]]),
    context(),
  );
  expect(await a.readFile("assets/two")).toEqual(shared);
  expect(objects()).toBe(before + 1);
  await a.writeFiles(new Map([["assets/two", null]]), context());
  expect(objects()).toBe(before);
  await a.verify();
});
