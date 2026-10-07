import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  readdir,
  rename,
  symlink,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { LibraryImport } from "./library-import";
import { GitLibrary } from "./git-library";
import { versionedLibrary } from "./library-runtime";
import {
  importComponent,
  resolveDocumentComponents,
  lockDocumentComponents,
  readComponentSource,
  saveTemplate,
} from "./catalog";
import { LibraryIndex } from "./library-index";
import { LibraryOperations } from "./library-operations";
import type { PageRecord } from "./model";
describe("one-time file library import", () => {
  let directory: string,
    source: string,
    destination: string,
    store: FileStore,
    projectId: string,
    page: PageRecord;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-import-"));
    source = join(directory, "old");
    destination = join(directory, "new");
    store = new FileStore(source);
    projectId = (
      await store.createProject({
        name: "Imported project",
      })
    ).id;
    const component = await importComponent(
      source,
      join(import.meta.dirname, "../../resources/catalog/value-slider"),
      projectId,
    );
    page = await store.createPage(projectId, { title: "导入前的论文图表" });
    page = await store.applyPage(projectId, page.document.id, {
      baseHash: page.hash,
      operations: [
        {
          type: "component.insert",
          kind: "custom",
          data: {
            componentId: component.id,
            version: component.version,
            integrity: component.integrity,
            scope: component.scope,
            props: { ...component.defaultData, value: 5 },
          },
        },
      ],
    });
    await saveTemplate(
      source,
      {
        id: "imported-template",
        name: "导入模板",
        description: "A preserved template",
        version: "1.0.0",
        document: page.document,
      },
      projectId,
    );
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("verifies pages, packages, editable sources and unknown old snapshots while preserving exact source bytes", async () => {
    const original = await readFile(page.path),
      importer = new LibraryImport(destination),
      report = await importer.prepare(source);
    expect(report.pages).toHaveLength(1);
    expect(report.components).toBe(1);
    expect(report.templates).toBe(1);
    expect(report.snapshots.length).toBeGreaterThan(1);
    expect(
      report.snapshots.every(
        (item) =>
          item.actor === "unknown" &&
          item.editTime === null &&
          item.order === null &&
          item.path,
      ),
    ).toBe(true);
    expect(
      await importer.original(
        report.id,
        `projects/${projectId}/pages/${page.document.id}.json`,
      ),
    ).toEqual(original);
    expect(versionedLibrary(destination)).toBeUndefined();
    expect(await readFile(page.path)).toEqual(original);
    await importer.activate(report.id);
    const migrated = await new FileStore(destination).readPage(
        projectId,
        page.document.id,
      ),
      library = new GitLibrary(destination);
    expect(migrated.document).toEqual(
      await lockDocumentComponents(source, page.document, projectId),
    );
    expect(migrated.revision).toBe(report.revision);
    expect(
      await resolveDocumentComponents(
        destination,
        migrated.document,
        projectId,
      ),
    ).toHaveLength(1);
    expect(
      (
        await readComponentSource(
          destination,
          "value-slider",
          "1.1.0",
          projectId,
        )
      ).source,
    ).toContain("export");
    expect(
      (
        await new LibraryIndex(destination).search({
          query: "论文图表",
          projectId,
        })
      ).items.length,
    ).toBeGreaterThan(0);
    expect(await library.history()).toHaveLength(1);
    expect((await library.history())[0].actor.kind).toBe("unknown");
    expect((await importer.list())[0].id).toBe(report.id);
    expect(await readFile(page.path)).toEqual(original);
    await importer.activate(report.id);
    const operations = new LibraryOperations(destination),
      retained = await operations.importedSnapshots(
        projectId,
        page.document.id,
      );
    expect(retained).toHaveLength(report.snapshots.length);
    const first = retained[0],
      historic = await operations.importedPage(projectId, page.document.id, {
        importId: first.importId,
        snapshotId: first.id,
      });
    const restored = await operations.restoreImportedSnapshot({
      projectId,
      pageId: page.document.id,
      importId: first.importId,
      snapshotId: first.id,
      baseRevision: migrated.revision!,
    });
    const { updatedAt: _time, ...expected } = historic.document;
    expect(restored.document).toMatchObject({ ...expected, archived: false });
    expect((await library.history())[0].restoredSnapshot).toEqual({
      importId: first.importId,
      snapshotId: first.id,
    });
    await expect(
      new LibraryOperations(destination, "other-project").importedPage(
        projectId,
        page.document.id,
        { importId: first.importId, snapshotId: first.id },
      ),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  }, 20000);
  it("activates in place, keeps the original tree and rejects a pre-import editor save", async () => {
    const original = await readFile(page.path),
      importer = new LibraryImport(source),
      report = await importer.prepare(source);
    expect(await readFile(page.path)).toEqual(original);
    expect(versionedLibrary(source)).toBeUndefined();
    await importer.activate(report.id);
    const migrated = await store.readPage(projectId, page.document.id);
    expect(migrated.path).toContain("workspace");
    expect(await readFile(page.path)).toEqual(original);
    await expect(
      store.savePage(
        projectId,
        page.document.id,
        { ...page.document, title: "stale editor" },
        page.hash,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    const saved = await store.savePage(
      projectId,
      page.document.id,
      { ...migrated.document, title: "新版本" },
      migrated.hash,
      migrated.revision,
    );
    expect(saved.document.title).toBe("新版本");
    expect(await readFile(page.path)).toEqual(original);
    expect(
      (await new LibraryOperations(source).history({ projectId })).items,
    ).toHaveLength(2);
  }, 20000);
  it("refuses activation after a later source edit and retains a damaged checkpoint as original bytes", async () => {
    const brokenPath = `projects/${projectId}/snapshots/${page.document.id}/${"0".repeat(64)}.json`;
    await writeFile(join(source, brokenPath), "{incomplete checkpoint");
    const importer = new LibraryImport(destination),
      report = await importer.prepare(source);
    expect(
      report.snapshots.find((item) => item.originalPath === brokenPath)?.issue,
    ).toBeTruthy();
    expect((await importer.original(report.id, brokenPath)).toString()).toBe(
      "{incomplete checkpoint",
    );
    await store.savePage(
      projectId,
      page.document.id,
      { ...page.document, title: "source updated after preview" },
      page.hash,
    );
    await expect(importer.activate(report.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(versionedLibrary(destination)).toBeUndefined();
    expect(versionedLibrary(source)).toBeUndefined();
  }, 20000);
  it("resumes a deployment interrupted after moving its repository without overwriting old files", async () => {
    const importer = new LibraryImport(source),
      report = await importer.prepare(source),
      planPath = join(
        source,
        "local",
        "imports",
        report.id,
        "installation.json",
      );
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    plan.state = "installing";
    await writeFile(planPath, JSON.stringify(plan));
    await rename(
      join(source, "local", "imports", report.id, "library", "repository.git"),
      join(source, "repository.git"),
    );
    const original = await readFile(page.path);
    await importer.activate(report.id);
    expect(await readFile(page.path)).toEqual(original);
    expect(versionedLibrary(source)).toBeDefined();
    expect(await new GitLibrary(source).head()).toBe(report.revision);
  }, 20000);
  it("retains an interrupted deployment when the source changes and activates a fresh verified import", async () => {
    const importer = new LibraryImport(source),
      first = await importer.prepare(source),
      planPath = join(
        source,
        "local",
        "imports",
        first.id,
        "installation.json",
      );
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    plan.state = "installing";
    await writeFile(planPath, JSON.stringify(plan));
    await rename(
      join(source, "local", "imports", first.id, "library", "repository.git"),
      join(source, "repository.git"),
    );
    const newer = await store.savePage(
      projectId,
      page.document.id,
      { ...page.document, title: "更新后的源内容" },
      page.hash,
    );
    await expect(importer.activate(first.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const second = await importer.prepare(source);
    await importer.activate(second.id);
    expect(
      (await store.readPage(projectId, page.document.id)).document.title,
    ).toBe(newer.document.title);
    const retained = new GitLibrary(
      join(source, "local", "imports", first.id, "retained-installation"),
    );
    expect(await retained.head()).toBe(first.revision);
    expect((await readFile(page.path)).toString()).toContain("更新后的源内容");
  }, 20000);
  it("refuses symbolic links and nested destinations", async () => {
    const importer = new LibraryImport(join(source, "packages", "nested"));
    await expect(importer.prepare(source)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    const canonical = await readdir(
      join(source, "projects", projectId, "pages"),
    );
    await mkdir(join(source, "packages"), { recursive: true });
    await symlink(
      join(source, "projects", projectId, "pages", canonical[0]),
      join(source, "packages", "linked"),
    );
    await expect(
      new LibraryImport(destination).prepare(source),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  });
  it("retains old whiteboard positions and supports restoring an orphaned checkpoint after its current page was removed", async () => {
    const legacy = {
      ...page.document,
      layout: undefined,
      surfaceViews: undefined,
      views: undefined,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "legacy-body" },
            content: [{ type: "text", text: "原始正文" }],
          },
          {
            type: "callout",
            attrs: {
              id: "legacy-floating",
              icon: "",
              tone: "neutral",
              canvas: { x: 1100, y: 120, width: 360 },
            },
            content: [
              {
                type: "paragraph",
                attrs: { id: "legacy-reference" },
                content: [{ type: "text", text: "旁注引用" }],
              },
            ],
          },
        ],
      },
    };
    const saved = await store.createPage(projectId, {
      document: JSON.parse(JSON.stringify(legacy)),
    });
    const importer = new LibraryImport(destination),
      report = await importer.prepare(source);
    await importer.activate(report.id);
    const imported = await new FileStore(destination).readPage(
      projectId,
      saved.document.id,
    );
    expect(imported.document.content.attrs?.kind).toBe("page");
    expect(imported.document.content.content![1].attrs?.kind).toBe("board");
    expect(imported.document.layout?.["legacy-floating"]).toMatchObject({
      x: 1100,
      y: 120,
      width: 360,
    });
    expect(JSON.stringify(imported.document.content)).toContain("原始正文");
    expect(JSON.stringify(imported.document.content)).toContain("旁注引用");
    await rm(saved.path);
    const orphanDestination = join(directory, "orphan-target"),
      orphanImporter = new LibraryImport(orphanDestination),
      orphanReport = await orphanImporter.prepare(source);
    await orphanImporter.activate(orphanReport.id);
    const operations = new LibraryOperations(orphanDestination),
      snapshots = await operations.importedSnapshots(
        projectId,
        saved.document.id,
      );
    const chosen = snapshots.find((item) => item.originalHash === saved.hash)!;
    expect(chosen.path).toBeTruthy();
    const restored = await operations.restoreImportedSnapshot({
      projectId,
      pageId: saved.document.id,
      importId: chosen.importId,
      snapshotId: chosen.id,
      baseRevision: null,
    });
    expect(restored.document.id).toBe(saved.document.id);
    expect(restored.document.layout?.["legacy-floating"]).toMatchObject({
      x: 1100,
      y: 120,
    });
    await expect(
      operations.restoreImportedSnapshot({
        projectId,
        pageId: saved.document.id,
        importId: chosen.importId,
        snapshotId: chosen.id,
        baseRevision: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await rm(
      join(orphanDestination, "local", "imports", orphanReport.id, "originals"),
      { recursive: true },
    );
    expect(
      (
        await orphanImporter.original(orphanReport.id, chosen.originalPath)
      ).toString(),
    ).toContain("原始正文");
  }, 20000);
});
