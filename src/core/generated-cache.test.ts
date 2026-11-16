import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import {
  collectGeneratedCache,
  generatedCacheRecords,
  GENERATED_CACHE_MAX_AGE_MS,
  writeGeneratedCache,
} from "./generated-cache";
import { recordReadingCache } from "./reading-cache";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import {
  MaintenanceScheduler,
  setMaintenancePolicy,
} from "./maintenance-scheduler";
import { LibraryMaintenance } from "./library-maintenance";
import { libraryFingerprint } from "./library-fingerprints";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-generated-cache-"));
  roots.push(root);
  return root;
}
const preview = (root: string, key = "a") =>
  join(root, "local", "agent-previews", key.repeat(64), "page.html");

test("reuses identical generated files and retains modified files, exports, drafts and unknown previews", async () => {
  const root = await fixture(),
    path = preview(root);
  await Promise.all([
    writeGeneratedCache(root, path, "preview"),
    writeGeneratedCache(root, path, "preview"),
  ]);
  expect((await generatedCacheRecords(root)).length).toBe(1);
  const modified = preview(root, "b");
  await writeGeneratedCache(root, modified, "generated");
  await writeFile(modified, "person's edit");
  await expect(
    writeGeneratedCache(root, modified, "generated"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  for (const relative of [
    "exports/report.html",
    "local/editor-drafts/draft.json",
    "local/agent-previews/old-preview/page.showai.json",
  ]) {
    await mkdir(join(root, relative, ".."), { recursive: true });
    await writeFile(join(root, relative), "keep");
  }
  const fresh = await collectGeneratedCache(root);
  expect(fresh.files).toBe(0);
  const expired = await collectGeneratedCache(
    root,
    Date.now() + GENERATED_CACHE_MAX_AGE_MS + 1000,
  );
  expect(expired).toMatchObject({ files: 1, freedBytes: 7, retained: 1 });
  expect(await readFile(modified, "utf8")).toBe("person's edit");
  expect(await readFile(join(root, "exports/report.html"), "utf8")).toBe(
    "keep",
  );
  expect(
    await readFile(join(root, "local/editor-drafts/draft.json"), "utf8"),
  ).toBe("keep");
  expect(
    await readFile(
      join(root, "local/agent-previews/old-preview/page.showai.json"),
      "utf8",
    ),
  ).toBe("keep");
});

test("collects registered legacy readings and leaves unregistered outputs intact", async () => {
  const root = await fixture();
  const directory = join(root, "workspace/projects/project/exports/reads");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `page-${"a".repeat(12)}-${"b".repeat(36)}.html`);
  await writeFile(path, "legacy");
  await recordReadingCache(root, path, "legacy");
  await writeFile(join(directory, "explicit.html"), "keep");
  const result = await collectGeneratedCache(
    root,
    Date.now() + GENERATED_CACHE_MAX_AGE_MS + 1000,
  );
  expect(result.freedBytes).toBe(6);
  expect(await readdir(directory)).toEqual(["explicit.html"]);
  expect(await generatedCacheRecords(root)).toEqual([]);
});

test("rejects symlink substitution during collection", async () => {
  const root = await fixture(),
    path = preview(root);
  await writeGeneratedCache(root, path, "preview");
  const original = join(root, "original.txt");
  await writeFile(original, "preserve");
  await rm(path);
  await symlink(original, path);
  await expect(
    collectGeneratedCache(root, Date.now() + GENERATED_CACHE_MAX_AGE_MS + 1000),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  expect(await readFile(original, "utf8")).toBe("preserve");
});

test("rejects protected destinations before writing any file", async () => {
  const root = await fixture();
  const path = join(root, "original.txt");
  await expect(
    writeGeneratedCache(root, path, "generated"),
  ).rejects.toMatchObject({ code: "INVALID_PATH" });
  expect(await readdir(root)).toEqual([]);
});

test("evicts a large old cache by quota while preserving the last hour of output", async () => {
  const root = await fixture();
  const path = preview(root);
  await mkdir(join(root, "local/agent-previews", "a".repeat(64)), {
    recursive: true,
  });
  const file = await open(path, "wx");
  try {
    await file.truncate(513 * 1024 * 1024);
  } finally {
    await file.close();
  }
  const relative = `local/agent-previews/${"a".repeat(64)}/page.html`;
  const fingerprint = await libraryFingerprint(root, path);
  await mkdir(join(root, "local/generated-cache"), { recursive: true });
  await writeFile(
    join(
      root,
      "local/generated-cache",
      `${createHash("sha256").update(relative).digest("hex")}.json`,
    ),
    JSON.stringify({
      format: "showai-generated-cache",
      version: 1,
      path: relative,
      ...fingerprint,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
    }),
  );
  await writeGeneratedCache(root, preview(root, "b"), "fresh");
  const collected = await collectGeneratedCache(root);
  expect(collected).toMatchObject({ files: 1, freedBytes: 513 * 1024 * 1024 });
  expect(await readFile(preview(root, "b"), "utf8")).toBe("fresh");
  expect(await generatedCacheRecords(root)).toHaveLength(1);
});

test("idle maintenance collects expired caches without changing content or history and reports sync copies separately", async () => {
  const root = await fixture();
  const library = new ContentLibrary(root);
  await library.initialize();
  const store = new FileStore(root);
  const project = await store.createProject({ name: "Cache retention" });
  const page = await store.createPage(project.id);
  const head = await library.head();
  const path = preview(root);
  await writeGeneratedCache(root, path, "cached");
  const [record] = await generatedCacheRecords(root);
  await writeFile(
    join(root, record.path),
    JSON.stringify({
      ...JSON.parse(await readFile(join(root, record.path), "utf8")),
      createdAt: new Date(
        Date.now() - GENERATED_CACHE_MAX_AGE_MS - 1000,
      ).toISOString(),
    }),
  );
  await mkdir(join(root, "local/sync/current-objects"), { recursive: true });
  await writeFile(
    join(root, "local/sync/current-objects/recovery"),
    "sync recovery",
  );
  const maintenance = new LibraryMaintenance(root);
  const storage = await maintenance.storage();
  expect(storage.categories.sync.bytes).toBe(13);
  expect(storage.categories.previews.bytes).toBe(6);
  const plan = await maintenance.prepareCleanup({
    olderThanDays: 0,
    receipts: false,
    orphanAssets: false,
    importCopies: false,
  });
  expect(plan.files.map((item) => item.path)).toContain(record.record.path);
  expect(plan.files.some((item) => item.path.includes("sync/"))).toBe(false);
  await setMaintenancePolicy(root, { idleMs: 0 });
  const scheduler = new MaintenanceScheduler(root);
  await scheduler.tick();
  await scheduler.stop();
  expect(await generatedCacheRecords(root)).toEqual([]);
  expect(await library.head()).toBe(head);
  expect((await store.readPage(project.id, page.document.id)).document).toEqual(
    page.document,
  );
  expect(
    await readFile(join(root, "local/sync/current-objects/recovery"), "utf8"),
  ).toBe("sync recovery");
});
