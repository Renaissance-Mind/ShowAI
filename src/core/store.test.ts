import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import { documentHash } from "./diff";
import type { PageRecord } from "./model";
import { fileSymlink } from "../test/file-symlink";

describe("file-first project store", () => {
  let directory: string;
  let store: FileStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "showai-store-"));
    store = new FileStore(join(directory, "home"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function page(): Promise<{ projectId: string; record: PageRecord }> {
    const project = await store.createProject({ name: "Research" });
    const record = await store.createPage(project.id, { title: "A page" });
    return { projectId: project.id, record };
  }

  it("persists canonical artifact files and discovers them in a fresh process store", async () => {
    const { projectId, record } = await page();
    expect(JSON.parse(await readFile(record.path, "utf8"))).toMatchObject({
      format: "showai",
      version: 3,
      document: { id: record.document.id },
    });
    const reopened = new FileStore(store.root);
    expect(await reopened.listProjects()).toMatchObject([
      { id: projectId, name: "Research", pageCount: 1 },
    ]);
    expect(await reopened.listPages(projectId)).toMatchObject([
      {
        id: record.document.id,
        title: "A page",
        hash: record.hash,
        blockCount: 2,
      },
    ]);
    expect(await reopened.readPage(projectId, record.document.id)).toEqual(
      record,
    );
  });

  it("persists project icons, preserves them on rename and clears them without changing pages", async () => {
    const created = await store.createProject({
      name: "Icon project",
      icon: "🧪",
    });
    const page = await store.createPage(created.id, {
      title: "Keep this page",
    });
    const reopened = new FileStore(store.root);
    expect((await reopened.listProjects())[0].icon).toBe("🧪");
    await reopened.updateProject(created.id, { name: "Renamed" });
    expect((await reopened.readProject(created.id)).icon).toBe("🧪");
    await reopened.updateProject(created.id, {
      icon: "https://example.com/icon.png",
    });
    expect((await new FileStore(store.root).listProjects())[0].icon).toBe(
      "https://example.com/icon.png",
    );
    await expect(
      reopened.updateProject(created.id, { icon: "javascript:alert(1)" }),
    ).rejects.toThrow("project.icon");
    await reopened.updateProject(created.id, { icon: "" });
    expect((await reopened.readProject(created.id)).icon).toBe("");
    expect(
      (await reopened.readPage(created.id, page.document.id)).document,
    ).toEqual(page.document);
  });

  it("uses stable harness/session bindings independently of cwd and project names", async () => {
    const first = await store.createProject({
      name: "First",
      binding: {
        harness: "codex",
        sessionId: "session-one",
        sourceDirectory: "/old",
      },
    });
    const again = await store.createProject({
      name: "Changed name",
      binding: {
        harness: "codex",
        sessionId: "session-one",
        sourceDirectory: "/renamed",
      },
    });
    expect(again.id).toBe(first.id);
    const second = await store.createProject({
      name: "Second",
      binding: {
        harness: "codex",
        sessionId: "session-two",
        sourceDirectory: "/old",
      },
    });
    expect(second.id).not.toBe(first.id);
    await store.bindProject(first.id, {
      harness: "claude",
      sessionId: "claude-one",
    });
    expect(
      (
        await store.createProject({
          name: "Recovered",
          binding: { harness: "claude", sessionId: "claude-one" },
        })
      ).id,
    ).toBe(first.id);
    await expect(
      store.bindProject(second.id, {
        harness: "claude",
        sessionId: "claude-one",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reuses one binding even when independent clients create it concurrently", async () => {
    const input = {
      name: "Session",
      binding: { harness: "codex", sessionId: "same-session" },
    };
    const results = await Promise.all([
      store.createProject(input),
      new FileStore(store.root).createProject(input),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(await store.listProjects()).toHaveLength(1);
  });

  it("serializes directory ownership across stores and rejects archived or ambiguous ownership", async () => {
    const source = join(directory, "host-project");
    const results = await Promise.all([
      store.resolveDirectoryProject(source),
      new FileStore(store.root).resolveDirectoryProject(source),
    ]);
    expect(results[0].project.id).toBe(results[1].project.id);
    expect(results.filter((item) => item.created)).toHaveLength(1);
    await store.updateProject(results[0].project.id, { archived: true });
    await expect(store.resolveDirectoryProject(source)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await store.updateProject(results[0].project.id, { archived: false });
    const duplicate = await store.createProject({ name: "Duplicate" });
    const path = join(store.projectPath(duplicate.id), "project.json");
    const metadata = JSON.parse(await readFile(path, "utf8"));
    await writeFile(
      path,
      JSON.stringify({ ...metadata, sourceDirectory: source }),
    );
    await expect(store.resolveDirectoryProject(source)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("keeps checkpoint-based text diffs and rejects stale saves without losing human edits", async () => {
    const { projectId, record } = await page();
    const blockId = record.document.content.content![0].attrs!.id as string;
    const paragraphId = record.document.content.content![0].content![0].attrs!
      .id as string;
    const changed = await store.applyPage(projectId, record.document.id, {
      baseHash: record.hash,
      operations: [
        { type: "block.text.set", blockId, text: "人工修订后的结论" },
      ],
    });
    expect(changed.hash).not.toBe(record.hash);
    const diff = await store.diffPage(
      projectId,
      record.document.id,
      record.hash,
    );
    expect(diff).toMatchObject({
      changed: true,
      currentHash: changed.hash,
      changes: [{ type: "block.changed", blockId: paragraphId }],
    });
    expect(JSON.stringify(diff)).toContain("人工修订后的结论");
    await expect(
      store.savePage(
        projectId,
        record.document.id,
        { ...record.document, title: "Stale" },
        record.hash,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", currentHash: changed.hash });
    expect(
      (await store.readPage(projectId, record.document.id)).document.title,
    ).toBe("A page");
    expect(
      await store.diffPage(projectId, record.document.id, changed.hash),
    ).toMatchObject({ changed: false, changes: [] });
  });

  it("serializes competing writers with one success and one conflict", async () => {
    const { projectId, record } = await page();
    const attempts = await Promise.allSettled([
      store.savePage(
        projectId,
        record.document.id,
        { ...record.document, title: "First edit" },
        record.hash,
      ),
      new FileStore(store.root).savePage(
        projectId,
        record.document.id,
        { ...record.document, title: "Second edit" },
        record.hash,
      ),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const failed = attempts.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failed.reason.code).toBe("CONFLICT");
    const saved = await store.readPage(projectId, record.document.id);
    expect(["First edit", "Second edit"]).toContain(saved.document.title);
  });

  it("detects direct external file edits while the app is closed", async () => {
    const { projectId, record } = await page();
    const source = JSON.parse(await readFile(record.path, "utf8"));
    source.document.title = "External edit";
    source.document.content.content.push({
      type: "paragraph",
      content: [{ type: "text", text: "New external block" }],
    });
    await writeFile(record.path, JSON.stringify(source));
    const fresh = new FileStore(store.root);
    const read = await fresh.readPage(projectId, record.document.id);
    expect((await fresh.readPage(projectId, record.document.id)).hash).toBe(
      read.hash,
    );
    const diff = await fresh.diffPage(
      projectId,
      record.document.id,
      record.hash,
    );
    expect(diff.changes.some((change) => change.type === "page.changed")).toBe(
      true,
    );
    expect(diff.changes.some((change) => change.type === "block.added")).toBe(
      true,
    );
  });

  it("ignores document date-only edits without ignoring dates inside content", async () => {
    const { projectId, record } = await page();
    const changed = await store.savePage(
      projectId,
      record.document.id,
      { ...record.document, updatedAt: "2050-01-01T00:00:00.000Z" },
      record.hash,
    );
    expect(changed.hash).toBe(record.hash);
    expect(
      documentHash({
        ...record.document,
        createdAt: "2050-01-01T00:00:00.000Z",
      }),
    ).toBe(record.hash);
  });

  it("returns an explicit error when a consumer's baseline is unavailable", async () => {
    const { projectId, record } = await page();
    await expect(
      store.diffPage(projectId, record.document.id, "f".repeat(64)),
    ).rejects.toMatchObject({
      code: "MISSING_BASELINE",
      currentHash: record.hash,
    });
  });

  it("rejects corrupted checkpoint data instead of reporting a misleading diff", async () => {
    const { projectId, record } = await page();
    const checkpoint = join(
      store.projectPath(projectId),
      "snapshots",
      record.document.id,
      `${record.hash}.json`,
    );
    const source = JSON.parse(await readFile(checkpoint, "utf8"));
    source.document.title = "Corrupted";
    await writeFile(checkpoint, JSON.stringify(source));
    await expect(
      store.diffPage(projectId, record.document.id, record.hash),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
  });

  it("rejects traversal and malformed IDs", async () => {
    const { projectId } = await page();
    expect(() => store.projectPath("../escape")).toThrow();
    expect(() => store.pagePath(projectId, "CON")).toThrow();
    await expect(
      store.readPage(projectId, "../../outside"),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("rejects symlinked pages", async (context) => {
    const { projectId, record } = await page();
    const target = join(directory, "external.json");
    await writeFile(target, await readFile(record.path, "utf8"));
    await rm(record.path);
    await fileSymlink(context, target, record.path);
    await expect(
      store.readPage(projectId, record.document.id),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    await expect(store.listPages(projectId)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects symlinked project directories before writing outside the root", async () => {
    const project = await store.createProject({ name: "Project" });
    await rm(store.projectPath(project.id), { recursive: true });
    await symlink(
      directory,
      store.projectPath(project.id),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(store.createPage(project.id)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("does not persist malformed or unsupported patches", async () => {
    const { projectId, record } = await page();
    const blockId = record.document.content.content![0].attrs!.id as string;
    await expect(
      store.applyPage(projectId, record.document.id, {
        baseHash: record.hash,
        operations: [
          { type: "block.attrs.set", blockId, attrs: { id: "replacement" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect((await store.readPage(projectId, record.document.id)).hash).toBe(
      record.hash,
    );
  });
});
