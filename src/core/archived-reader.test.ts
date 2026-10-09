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
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { FileStore } from "./store";
import { ContentLibrary as GitLibrary } from "./content-library";
import { LibraryOperations } from "./library-operations";
import { readArchivedReader, readerBindingPath } from "./archived-reader";
import { exportPage } from "../agent/exporter";

describe("frozen historical readers", () => {
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
  it("preserves emitted code, style and bindings across source updates, missing local runtime and restores", async () => {
    const store = new FileStore(root),
      library = new GitLibrary(root),
      operations = new LibraryOperations(root);
    const project = await store.createProject({ name: "Frozen renderer" });
    await readerVersion("A");
    const first = await store.createPage(project.id, {
      title: "原始阅读器页面",
    });
    const old = await operations.historicalHtml(
      project.id,
      first.document.id,
      first.revision!,
    );
    await readerVersion("B");
    const next = await store.savePage(
      project.id,
      first.document.id,
      { ...first.document, title: "新的阅读器页面" },
      first.hash,
      first.revision,
    );
    const current = await operations.historicalHtml(
      project.id,
      first.document.id,
      next.revision!,
    );
    expect(old.reader.integrity).not.toBe(current.reader.integrity);
    await rm(join(directory, "runtime"), { recursive: true });
    expect(
      await operations.historicalHtml(
        project.id,
        first.document.id,
        first.revision!,
      ),
    ).toEqual(old);
    const exported = await exportPage({
      root,
      projectId: project.id,
      pageId: first.document.id,
      revision: first.revision,
      format: "html",
      out: join(directory, "historical.html"),
    });
    expect(exported.pageIds).toEqual([first.document.id]);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(join(directory, "historical.html")).href);
      await page.locator('html[data-reader-proof="A"]').waitFor();
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.body)
            .getPropertyValue("--reader-proof")
            .trim(),
        ),
      ).toBe("A");
      expect(
        await page.getByText("原始阅读器页面", { exact: true }).count(),
      ).toBeGreaterThan(0);
      const currentPath = join(directory, "current.html");
      await writeFile(currentPath, current.html);
      await page.goto(pathToFileURL(currentPath).href);
      await page.locator('html[data-reader-proof="B"]').waitFor();
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
    const restored = await operations.restorePage({
      projectId: project.id,
      pageId: first.document.id,
      revision: first.revision!,
      baseRevision: next.revision!,
    });
    const reader = await readArchivedReader(
      `projects/${project.id}/pages/${first.document.id}.json`,
      (path) => library.readFile(path, restored.revision),
    );
    expect(reader.ref).toEqual(old.reader);
    const indexPaths = (await library.tree()).filter((item) =>
      item.path.endsWith("/viewer.html"),
    );
    expect(indexPaths).toHaveLength(2);
  }, 20000);
  it("rejects a corrupted frozen runtime while retaining page content", async () => {
    const library = new GitLibrary(root),
      store = new FileStore(root),
      project = await store.createProject({ name: "Integrity" }),
      page = await store.createPage(project.id);
    const path = `projects/${project.id}/pages/${page.document.id}.json`,
      reader = await readArchivedReader(path, (name) => library.readFile(name));
    await library.writeFiles(
      new Map([
        [
          `runtimes/readers/${reader.ref.integrity}/viewer.html`,
          Buffer.from("corrupt reader"),
        ],
      ]),
      { actor: { kind: "external" }, channel: "external" },
    );
    await expect(
      new LibraryOperations(root).historicalHtml(
        project.id,
        page.document.id,
        (await library.head())!,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(
      (await store.readPage(project.id, page.document.id)).document.id,
    ).toBe(page.document.id);
    expect(readerBindingPath(path)).toContain("/reader.json");
  });
});
