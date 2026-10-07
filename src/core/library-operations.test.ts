import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import { LibraryOperations } from "./library-operations";
import {
  importComponent,
  resolveDocumentComponents,
  readComponentSource,
} from "./catalog";
import { mutateLibrary } from "./library-runtime";
import { withChangeContext } from "./history-context";
import type { PageRecord } from "./model";

describe("shared history/search/restore operations", () => {
  let root: string,
    library: GitLibrary,
    store: FileStore,
    operations: LibraryOperations,
    projectId: string,
    page: PageRecord;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-library-operations-"));
    library = new GitLibrary(root);
    await library.initialize();
    store = new FileStore(root);
    operations = new LibraryOperations(root);
    projectId = (await store.createProject({ name: "Operations" })).id;
    page = await store.createPage(projectId, { title: "Initial report" });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists image icons through summaries, copies, history and removal without losing page content", async () => {
    const icon = "data:image/png;base64," + "a".repeat(20000);
    const saved = await store.savePage(
      projectId,
      page.document.id,
      { ...page.document, icon },
      page.hash,
      page.revision,
    );
    const reopened = new FileStore(root);
    expect((await reopened.listPages(projectId))[0].icon).toBe(icon);
    expect(
      (await reopened.readPage(projectId, page.document.id)).document.icon,
    ).toBe(icon);
    const copy = await reopened.createPage(projectId, {
      document: saved.document,
    });
    expect(copy.document.icon).toBe(icon);
    const removed = await reopened.applyPage(projectId, page.document.id, {
      baseHash: saved.hash,
      baseRevision: saved.revision,
      operations: [{ type: "page.set", fields: { icon: "" } }],
    });
    expect(removed.document.icon).toBe("");
    const restored = await operations.restorePage({
      projectId,
      pageId: page.document.id,
      revision: saved.revision!,
      baseRevision: removed.revision!,
    });
    expect(restored.document.icon).toBe(icon);
    expect(restored.document.content).toEqual(saved.document.content);
  });

  it("reads history, searches and compares exact revisions while enforcing project scope", async () => {
    const changed = await withChangeContext(
      {
        actor: {
          kind: "agent",
          harness: "codex",
          sessionId: "operations-session",
        },
        channel: "cli",
      },
      () =>
        store.applyPage(projectId, page.document.id, {
          baseHash: page.hash,
          baseRevision: page.revision,
          operations: [
            {
              type: "block.text.set",
              blockId: page.document.content.content![0].attrs!.id,
              text: "新的论文图表证据",
            },
          ],
        }),
    );
    expect(
      (await operations.search({ query: "图表", projectId })).items,
    ).toHaveLength(1);
    expect(
      (
        await operations.history({
          projectId,
          pageId: page.document.id,
          sessionId: "operations-session",
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await operations.changes(page.revision!, changed.revision!, {
          projectId,
          pageId: page.document.id,
        })
      ).changes?.length ?? 0,
    ).toBeGreaterThan(0);
    expect(
      (await operations.pageAt(projectId, page.document.id, page.revision!))
        .document,
    ).toEqual(page.document);
    const bound = new LibraryOperations(root, projectId);
    await expect(
      bound.pageAt("other-project", page.document.id, page.revision!),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    expect(() =>
      bound.history({
        path: "packages/components/foreign/1.0.0/compiled.json",
      }),
    ).toThrow("shared or foreign");
  });

  it("restores missing compiled/source dependencies and keeps same-name current identities intact", async () => {
    const saved = await mutateLibrary(root, async () => {
      const component = await importComponent(
        root,
        join(import.meta.dirname, "../../resources/catalog/value-slider"),
        projectId,
      );
      const document = structuredClone(page.document);
      document.content.content!.push({
        type: "widget",
        attrs: {
          id: "slider",
          kind: "custom",
          data: {
            componentId: component.id,
            version: component.version,
            integrity: component.integrity,
            props: component.defaultData,
          },
        },
      });
      return store.savePage(
        projectId,
        page.document.id,
        document,
        page.hash,
        page.revision,
      );
    });
    const historical = await operations.pageAt(
      projectId,
      page.document.id,
      saved.revision!,
    );
    expect(historical.components).toHaveLength(1);
    const packagePaths = (await library.tree())
      .filter((entry) =>
        entry.path.startsWith(`projects/${projectId}/packages/components/`),
      )
      .map((entry) => entry.path);
    await library.writeFiles(
      new Map(packagePaths.map((path) => [path, null])),
      {
        actor: { kind: "system" },
        channel: "system",
        message: "Remove current package files",
      },
    );
    const restored = await operations.restorePage({
      projectId,
      pageId: page.document.id,
      revision: saved.revision!,
      baseRevision: saved.revision!,
    });
    expect(restored.revision).not.toBe(saved.revision);
    expect(
      await resolveDocumentComponents(root, restored.document, projectId),
    ).toHaveLength(1);
    const ref = historical.components[0];
    expect(
      (
        await readComponentSource(root, ref.id, ref.version, projectId, {
          integrity: ref.integrity,
        })
      ).source,
    ).toContain("export default");
    expect(
      (
        await library.history({
          path: `projects/${projectId}/pages/${page.document.id}.json`,
          limit: 1,
        })
      )[0].restoredFrom,
    ).toBe(saved.revision);
    await library.verify();
  });

  it("merges a draft against its base and refuses a stale reviewed merge", async () => {
    const current = await store.savePage(
      projectId,
      page.document.id,
      { ...page.document, icon: "🧪" },
      page.hash,
      page.revision,
    );
    const draft = { ...page.document, title: "Updated title" };
    const preview = await operations.previewMerge({
      projectId,
      pageId: page.document.id,
      baseRevision: page.revision!,
      document: draft,
    });
    expect(preview.conflicts).toEqual([]);
    expect(preview.document.icon).toBe("🧪");
    expect(preview.document.title).toBe("Updated title");
    const merged = await operations.saveMerge({
      projectId,
      pageId: page.document.id,
      baseRevision: page.revision!,
      currentRevision: current.revision!,
      document: preview.document,
    });
    expect(merged.revision).toBeTruthy();
    await expect(
      operations.saveMerge({
        projectId,
        pageId: page.document.id,
        baseRevision: page.revision!,
        currentRevision: current.revision!,
        document: preview.document,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
