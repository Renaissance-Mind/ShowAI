import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { ReadBaselines } from "./read-baselines";
import type { PageRecord } from "./model";

let home: string, store: FileStore, projectId: string, page: PageRecord;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-read-baselines-"));
  store = new FileStore(home);
  projectId = (await store.createProject({ name: "Baselines" })).id;
  page = await store.createPage(projectId, { title: "First" });
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
const directory = () => join(home, "local", "read-baselines");
const documents = async () =>
  (await readdir(directory())).filter((name) => name.endsWith(".json"));

test("one file per page version, found by hash or revision without reading others", async () => {
  const baselines = new ReadBaselines(home);
  await baselines.remember(projectId, page);
  const [file] = await documents();
  const written = (await stat(join(directory(), file))).mtimeMs;
  // Reading the same version again keeps the file and refreshes its time.
  await new Promise((done) => setTimeout(done, 20));
  await baselines.remember(projectId, page);
  expect(await documents()).toEqual([file]);
  const again = await stat(join(directory(), file));
  expect(again.mtimeMs).toBeGreaterThan(written);
  expect(again.ino).toBe((await stat(join(directory(), file))).ino);

  const next = await store.savePage(
    projectId,
    page.document.id,
    { ...page.document, title: "Second" },
    page.hash,
    page.revision,
  );
  await baselines.remember(projectId, next);
  expect(await documents()).toHaveLength(2);
  expect((await baselines.read(projectId, page.document.id, page.hash))?.title).toBe(
    "First",
  );
  expect((await baselines.read(projectId, next.document.id, next.hash))?.title).toBe(
    "Second",
  );
  if (next.revision)
    expect(
      (await baselines.read(projectId, next.document.id, next.revision))?.title,
    ).toBe("Second");
  expect(await baselines.revision(projectId, page.document.id, page.hash)).toBe(
    page.revision,
  );
  expect(await baselines.revision(projectId, next.document.id, next.hash)).toBe(
    next.revision,
  );
  expect(
    await baselines.revision(projectId, page.document.id, "0".repeat(64)),
  ).toBeUndefined();
  expect(await baselines.read(projectId, page.document.id, "0".repeat(64))).toBeUndefined();
  expect(await baselines.read("other", page.document.id, page.hash)).toBeUndefined();
});

test("a damaged baseline is ignored, and the cache keeps the newest 64 versions", async () => {
  const baselines = new ReadBaselines(home);
  await baselines.remember(projectId, page);
  const [file] = await documents();
  const path = join(directory(), file);
  const record = JSON.parse(
    await (await import("node:fs/promises")).readFile(path, "utf8"),
  );
  record.document.title = "Edited by hand";
  await writeFile(path, JSON.stringify(record));
  expect(await baselines.read(projectId, page.document.id, page.hash)).toBeUndefined();

  let current = page;
  for (let index = 0; index < 66; index++) {
    current = await store.savePage(
      projectId,
      page.document.id,
      { ...current.document, title: `Version ${index}` },
      current.hash,
      current.revision,
    );
    await baselines.remember(projectId, current);
  }
  expect(await documents()).toHaveLength(64);
  expect(
    (await baselines.read(projectId, page.document.id, current.hash))?.title,
  ).toBe("Version 65");
}, 60000);
