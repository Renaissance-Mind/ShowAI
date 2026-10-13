import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FileStore } from "./store";
import { ContentLibrary as GitLibrary } from "./content-library";
import { GitLibrary as LegacyGitLibrary } from "./git-library";
import { SqliteLibrary } from "./sqlite-library";
import { LibraryOperations } from "./library-operations";
import { readArchivedReader, readerBindingPath } from "./archived-reader";

describe("retained legacy readers", () => {
  let directory: string,
    root: string,
    viewer: string,
    archive: string,
    originalViewer: string | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-reader-history-"));
    root = join(directory, "library");
    viewer = join(directory, "runtime", "viewer.html");
    archive = join(directory, "runtime", "reader-source.json");
    await mkdir(join(directory, "runtime"));
    await cp(resolve("dist-portable/portable.html"), viewer);
    await cp(resolve("dist-portable/reader-source.json"), archive);
    await symlink(
      resolve("node_modules"),
      join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    originalViewer = process.env.SHOWAI_VIEWER;
    process.env.SHOWAI_VIEWER = viewer;
    await new GitLibrary(root).initialize();
  });
  afterEach(async () => {
    if (originalViewer === undefined) delete process.env.SHOWAI_VIEWER;
    else process.env.SHOWAI_VIEWER = originalViewer;
    await rm(directory, { recursive: true, force: true });
  });
  async function readerVersion(label: string) {
    const raw = JSON.parse(
      await readFile(resolve("dist-portable/reader-source.json"), "utf8"),
    );
    raw.files["src/portable/main.tsx"] +=
      `\nwindow.document.documentElement.dataset.readerProof=${JSON.stringify(label)};\n`;
    raw.files["src/portable/portable.css"] +=
      `\nbody { --reader-proof: ${label}; }\n`;
    const { integrity: _old, ...payload } = raw;
    raw.integrity = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    await writeFile(archive, JSON.stringify(raw));
  }
  /**
   * Current saves no longer capture readers. Readers captured by a legacy Git
   * library remain retained recovery material after migration.
   */
  async function legacyCapturedPage() {
    const source = new FileStore(join(directory, "source"));
    const project = await source.createProject({ name: "Frozen renderer" });
    const page = await source.createPage(project.id, {
      title: "原始阅读器页面",
    });
    const projectPath = `projects/${project.id}/project.json`,
      path = `projects/${project.id}/pages/${page.document.id}.json`;
    await rm(root, { recursive: true, force: true });
    const legacy = new LegacyGitLibrary(root);
    await legacy.initialize();
    await readerVersion("A");
    const captured = await legacy.writeFiles(
      new Map([
        [projectPath, await readFile(join(source.root, projectPath))],
        [path, await readFile(page.path)],
      ]),
      { actor: { kind: "human" }, channel: "desktop" },
    );
    const reader = await readArchivedReader(path, (name) =>
      legacy.readFile(name, captured!.revision),
    );
    await new GitLibrary(root).initialize();
    return { project, page, path, revision: captured!.revision, reader };
  }
  it("renders a migrated legacy reader at its archived revision and captures none for current saves", async () => {
    const { project, page, revision, reader } = await legacyCapturedPage();
    const operations = new LibraryOperations(root);
    const old = await operations.historicalHtml(
      project.id,
      page.document.id,
      revision,
    );
    expect(old.reader).toEqual(reader.ref);
    expect(old.html).toContain("readerProof");
    expect(old.html).toContain("原始阅读器页面");
    await rm(join(directory, "runtime"), { recursive: true });
    expect(
      await operations.historicalHtml(project.id, page.document.id, revision),
    ).toEqual(old);
    const store = new FileStore(root);
    const current = await store.readPage(project.id, page.document.id);
    const next = await store.savePage(
      project.id,
      page.document.id,
      { ...current.document, title: "新的阅读器页面" },
      current.hash,
      current.revision,
    );
    // Saving keeps the retained binding instead of capturing a new reader.
    expect(
      (
        await operations.historicalHtml(
          project.id,
          page.document.id,
          next.revision!,
        )
      ).reader,
    ).toEqual(old.reader);
    const created = await store.createPage(project.id, { title: "当前页面" });
    await expect(
      operations.historicalHtml(
        project.id,
        created.document.id,
        created.revision!,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringMatching(/predates reader capture/),
    });
    expect(
      await operations.historicalHtml(project.id, page.document.id, revision),
    ).toEqual(old);
  }, 20000);
  it("rejects a corrupted archived runtime while retaining page content", async () => {
    const { project, page, revision, reader } = await legacyCapturedPage();
    const runtime = (await new SqliteLibrary(root).tree(revision)).find(
      (entry) =>
        entry.path === `runtimes/readers/${reader.ref.integrity}/viewer.html`,
    )!;
    const db = new DatabaseSync(join(root, "history", "content.sqlite"));
    try {
      db.prepare("UPDATE blobs SET data=?,codec=0 WHERE oid=?").run(
        Buffer.from("corrupt reader"),
        runtime.oid,
      );
    } finally {
      db.close();
    }
    await expect(
      new LibraryOperations(root).historicalHtml(
        project.id,
        page.document.id,
        revision,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(
      (await new FileStore(root).readPage(project.id, page.document.id))
        .document.id,
    ).toBe(page.document.id);
    expect(readerBindingPath(`projects/${project.id}/pages/x.json`)).toContain(
      "/reader.json",
    );
  });
});
