import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import { EditorDrafts } from "./editor-drafts";
import {
  LibraryMaintenance,
  verifyLibraryArchive,
} from "./library-maintenance";
import { LibraryIndex } from "./library-index";
import {
  MaintenanceScheduler,
  setMaintenancePolicy,
} from "./maintenance-scheduler";
import type { PageRecord } from "./model";
import { recordReadingCache } from "./reading-cache";

describe("library space, cleanup and archival", () => {
  let directory: string,
    root: string,
    library: GitLibrary,
    store: FileStore,
    maintenance: LibraryMaintenance,
    projectId: string,
    page: PageRecord;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-maintenance-"));
    root = join(directory, "library");
    library = new GitLibrary(root);
    await library.initialize();
    store = new FileStore(root);
    projectId = (await store.createProject({ name: "Space accounting" })).id;
    page = await store.createPage(projectId);
    maintenance = new LibraryMaintenance(root);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("counts actual files and compacts objects without changing revisions or historical content", async () => {
    const before = await maintenance.storage();
    expect(before.totalBytes).toBeGreaterThan(0);
    expect(before.categories.repository.files).toBeGreaterThan(0);
    expect(
      Object.values(before.categories).reduce(
        (sum, category) => sum + category.bytes,
        0,
      ),
    ).toBe(before.totalBytes);
    const head = await library.head(),
      bytes = await library.readFile(
        `projects/${projectId}/pages/${page.document.id}.json`,
      );
    await maintenance.compact();
    expect(await library.head()).toBe(head);
    expect(
      await library.readFile(
        `projects/${projectId}/pages/${page.document.id}.json`,
      ),
    ).toEqual(bytes);
    expect((await maintenance.state())?.state).toBe("complete");
  });
  it("keeps live drafts, conflicts and history while collecting orphan assets and replaying cleaned receipts", async () => {
    const drafts = new EditorDrafts(root),
      image = `data:image/png;base64,${Buffer.from("live asset").toString("base64")}`;
    const one = await drafts.save({
      kind: "component",
      clientId: "first",
      resourceId: "one",
      content: { image },
    });
    const two = await drafts.save({
      kind: "component",
      clientId: "second",
      resourceId: "two",
      content: {
        image: `data:image/png;base64,${Buffer.from("orphan asset").toString("base64")}`,
      },
    });
    await drafts.remove(two.id, two.generation);
    const newTitle = "Request replay after cleanup",
      context = {
        actor: { kind: "human" as const },
        channel: "desktop" as const,
        operationId: "cleaned-request",
        requestFingerprint: "a".repeat(64),
      };
    const saved = await library.transaction(context, () =>
      store.savePage(
        projectId,
        page.document.id,
        { ...page.document, title: newTitle },
        page.hash,
        page.revision,
      ),
    );
    await writeFile(
      saved.value.path,
      JSON.stringify({
        format: "showai",
        version: 3,
        document: { ...saved.value.document, title: "external draft" },
      }),
    );
    await store.readPage(projectId, page.document.id);
    const plan = await maintenance.prepareCleanup({
      cache: false,
      importCopies: false,
    });
    expect(plan.protectedDrafts).toBe(1);
    expect(plan.protectedConflicts).toBeGreaterThan(0);
    expect(plan.files.some((file) => file.path.endsWith(one.assets[0]))).toBe(
      false,
    );
    expect(plan.files.some((file) => file.path.endsWith(two.assets[0]))).toBe(
      true,
    );
    const head = await library.head();
    await maintenance.cleanup(plan.id);
    expect(await library.head()).toBe(head);
    expect((await drafts.read(one.id)).content).toEqual({ image });
    expect((await drafts.list()).length).toBe(1);
    await rm(join(root, "local", "operation-index.sqlite"));
    const replay = await library.transaction(context, async () => {
      throw new Error("A retried committed request must not run again");
    });
    expect(replay.entry?.revision).toBe(saved.entry?.revision);
    expect((replay.value as PageRecord).document.title).toBe(newTitle);
  });
  it("rejects a stale cleanup plan after a new draft references a planned orphan", async () => {
    const drafts = new EditorDrafts(root),
      image = `data:image/png;base64,${Buffer.from("temporarily orphaned").toString("base64")}`;
    const source = await drafts.save({
      kind: "component",
      clientId: "one",
      resourceId: "one",
      content: { image },
    });
    await drafts.remove(source.id, source.generation);
    const plan = await maintenance.prepareCleanup({
      receipts: false,
      cache: false,
      importCopies: false,
    });
    const next = await drafts.save({
      kind: "component",
      clientId: "two",
      resourceId: "two",
      content: { image },
    });
    await expect(maintenance.cleanup(plan.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await drafts.read(next.id)).content).toEqual({ image });
  });
  it("archives complete history and drafts, verifies the copy and detects changed archive bytes", async () => {
    const draft = await new EditorDrafts(root).save({
      kind: "template",
      clientId: "window",
      resourceId: "unfinished",
      content: { description: "未提交内容" },
    });
    await new LibraryIndex(root).synchronize();
    const target = join(directory, "saved.showai-archive");
    const copied = await maintenance.archive(target);
    expect(copied.revision).toBe(await library.head());
    expect((await verifyLibraryArchive(target)).verified).toBe(true);
    const restored = new FileStore(target);
    expect(
      (await restored.readPage(projectId, page.document.id)).document,
    ).toEqual(page.document);
    expect((await new EditorDrafts(target).read(draft.id)).content).toEqual({
      description: "未提交内容",
    });
    const cache = await new LibraryIndex(target).search({ query: "Space" });
    expect(cache.items.length).toBeGreaterThan(0);
    await writeFile(join(target, "library.json"), "changed archive metadata");
    await expect(verifyLibraryArchive(target)).rejects.toMatchObject({
      code: "INVALID_DATA",
    });
  }, 15000);
  it("cleans only registered reading outputs and rejects an output edited after planning", async () => {
    const generated = join(
      root,
      "projects",
      projectId,
      "exports",
      "reads",
      `${page.document.id}-${page.hash.slice(0, 12)}-11111111-1111-1111-1111-111111111111.html`,
    );
    const explicit = join(
      root,
      "projects",
      projectId,
      "exports",
      "reads",
      "user-selected-report.html",
    );
    await mkdir(join(root, "projects", projectId, "exports", "reads"), {
      recursive: true,
    });
    await writeFile(generated, "generated preview");
    await writeFile(explicit, "user output");
    await recordReadingCache(root, generated, "generated preview");
    const plan = await maintenance.prepareCleanup({
      olderThanDays: 0,
      receipts: false,
      orphanAssets: false,
      importCopies: false,
    });
    expect(
      plan.files.some((file) =>
        file.path.endsWith("user-selected-report.html"),
      ),
    ).toBe(false);
    expect(
      plan.files.some((file) => file.path.endsWith("111111111111.html")),
    ).toBe(true);
    await writeFile(generated, "edited by a person");
    await expect(maintenance.cleanup(plan.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("rejects an archive path that aliases a child of the active library", async () => {
    const alias = join(directory, "alias");
    await symlink(
      root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      maintenance.archive(join(alias, "nested-backup")),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  });
  it("runs an enabled compaction through the actual background timer and stops cleanly", async () => {
    await setMaintenancePolicy(root, {
      idleMs: 0,
      intervalMs: 50,
      minimumPacks: 0,
      minimumLooseObjects: 0,
      minimumLooseBytes: 0,
    });
    const failures: unknown[] = [],
      scheduler = new MaintenanceScheduler(root, (error) =>
        failures.push(error),
      ).start();
    try {
      const deadline = Date.now() + 5000;
      while (
        (await maintenance.state())?.state !== "complete" &&
        Date.now() < deadline
      )
        await new Promise((done) => setTimeout(done, 30));
      expect((await maintenance.state())?.state).toBe("complete");
    } finally {
      await scheduler.stop();
    }
    expect(failures).toEqual([]);
  });
});
