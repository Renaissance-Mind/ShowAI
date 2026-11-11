import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import { documentHash, normalizeDocument } from "./diff";
import { parseArtifact } from "../portable/validation.mjs";

const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of clean.splice(0).reverse()) await done();
});
async function fixture() {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "stored-pages-"));
  clean.push(() => rm(root, { recursive: true }));
  const library = new ContentLibrary(root);
  await library.initialize();
  const store = new FileStore(root),
    project = await store.createProject({ name: "Stored pages" });
  const page = await store.createPage(project.id, { title: "Page" });
  return { library, store, project, page };
}

test("repeated page reads return independent documents equal to a full parse", async () => {
  const f = await fixture();
  const path = `projects/${f.project.id}/pages/${f.page.document.id}.json`;
  const parse = async () => {
    const document = normalizeDocument(
      parseArtifact(JSON.parse((await f.library.readFile(path)).toString()))
        .document,
      undefined,
      { validated: true },
    );
    return { document, hash: documentHash(document) };
  };
  const first = await f.store.readPage(f.project.id, f.page.document.id);
  const expected = await parse();
  expect(first.document).toEqual(expected.document);
  expect(first.hash).toBe(expected.hash);
  // A caller changing its copy does not change the next read.
  first.document.title = "Changed by a caller";
  first.document.content.content = [];
  const second = await f.store.readPage(f.project.id, f.page.document.id);
  expect(second.document).toEqual(expected.document);
  expect(second.document).not.toBe(first.document);
  expect(second.hash).toBe(expected.hash);
  expect(second.revision).toBe(first.revision);
  // New bytes are parsed again.
  const saved = await f.store.savePage(
    f.project.id,
    f.page.document.id,
    { ...second.document, title: "Saved" },
    second.hash,
    second.revision,
  );
  const third = await f.store.readPage(f.project.id, f.page.document.id);
  expect(third.document).toEqual((await parse()).document);
  expect(third.document.title).toBe("Saved");
  expect(third.hash).toBe(saved.hash);
  expect((await f.store.listPages(f.project.id))[0]).toMatchObject({
    title: "Saved",
    hash: saved.hash,
    revision: third.revision,
  });
});
