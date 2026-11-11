import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import { CoreError, integrityError } from "./model";
import { checkLibraryIntegrity, integrityResult } from "./library-integrity";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function library() {
  const root = await mkdtemp(join(tmpdir(), "showai-integrity-"));
  roots.push(root);
  await new ContentLibrary(root).initialize();
  const store = new FileStore(root);
  const project = await store.createProject({ name: "Checked" });
  await store.createPage(project.id, { title: "Page" });
  return root;
}
function tamper(root: string, sql: string) {
  const db = new DatabaseSync(join(root, "history", "content.sqlite"));
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

describe("library integrity check", () => {
  it("reports an intact library", async () => {
    const result = await checkLibraryIntegrity(await library());
    expect(result).toEqual({ ok: true, checkedAt: expect.any(String) });
  });

  it("names damaged stored content", async () => {
    const root = await library();
    tamper(root, "UPDATE blobs SET digest=printf('%064d', 0)");
    expect(await checkLibraryIntegrity(root)).toMatchObject({
      ok: false,
      problem: "content",
    });
  });

  it("names an inconsistent save record", async () => {
    const root = await library();
    tamper(root, "UPDATE current_state SET checksum=printf('%064d', 0)");
    expect(await checkLibraryIntegrity(root)).toMatchObject({
      ok: false,
      problem: "history",
    });
  });

  it("names a damaged database file", async () => {
    const root = await library();
    tamper(root, "PRAGMA wal_checkpoint(TRUNCATE)");
    const path = join(root, "history", "content.sqlite");
    const bytes = await readFile(path);
    // Overwrite every page after the header page with noise.
    bytes.fill(0xa5, 4096);
    await writeFile(path, bytes);
    expect(await checkLibraryIntegrity(root)).toMatchObject({
      ok: false,
      problem: "database",
    });
  });

  it("maps failures by kind and leaves other errors to the caller", () => {
    expect(
      integrityResult(integrityError("database", "broken"), "now"),
    ).toEqual({
      ok: false,
      checkedAt: "now",
      problem: "database",
      message: "broken",
    });
    expect(
      integrityResult(new CoreError("INVALID_DATA", "odd"), "now"),
    ).toMatchObject({ problem: "unknown", message: "odd" });
    const missing = new CoreError("NOT_FOUND", "gone");
    expect(() => integrityResult(missing)).toThrow(missing);
    const io = new Error("EACCES");
    expect(() => integrityResult(io)).toThrow(io);
  });
});
