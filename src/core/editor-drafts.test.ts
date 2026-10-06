import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditorDrafts } from "./editor-drafts";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import type { EditorDraftInput } from "./editor-drafts";
describe("persistent local editor drafts", () => {
  let root: string,
    library: GitLibrary,
    drafts: EditorDrafts,
    input: EditorDraftInput;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-editor-draft-"));
    library = new GitLibrary(root);
    await library.initialize();
    drafts = new EditorDrafts(root);
    const store = new FileStore(root),
      project = await store.createProject({ name: "Drafts" });
    const page = await store.createPage(project.id, { title: "Draft page" });
    input = {
      kind: "page",
      clientId: "editor-window",
      projectId: project.id,
      resourceId: page.document.id,
      baseRevision: page.revision,
      title: page.document.title,
      content: page.document,
      sequence: 1,
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists and reloads a page without creating formal history, reusing image bytes across generations", async () => {
    const before = await library.head();
    const document = structuredClone(input.content) as {
      cover: string;
      title: string;
    };
    document.cover =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=";
    const first = await drafts.save({ ...input, content: document });
    document.title = "Continued draft";
    const second = await drafts.save({
      ...input,
      content: document,
      sequence: 2,
    });
    expect(first.id).toBe(second.id);
    expect(first.generation).not.toBe(second.generation);
    expect((await new EditorDrafts(root).read(second.id)).content).toEqual(
      document,
    );
    expect(await readdir(join(root, "local", "draft-assets"))).toHaveLength(1);
    expect(await library.head()).toBe(before);
    await drafts.remove(second.id, first.generation);
    expect(await drafts.list()).toHaveLength(1);
    await drafts.remove(second.id, second.generation);
    await drafts.remove(second.id, second.generation);
    expect(await drafts.list()).toEqual([]);
    expect(
      await readdir(join(root, "local", "discarded-drafts", second.id)),
    ).toHaveLength(1);
  });

  it("rejects stale clear operations, retains a draft until matching content is committed", async () => {
    const first = await drafts.save(input);
    const content = {
      ...(input.content as object),
      title: "Unsubmitted change",
    };
    const second = await drafts.save({ ...input, content, sequence: 2 });
    expect((await drafts.save(input)).generation).toBe(second.generation);
    expect(
      await drafts.completePage(
        second.id,
        first.generation,
        input.baseRevision!,
      ),
    ).toBe(false);
    await expect(
      drafts.completePage(second.id, second.generation, input.baseRevision!),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const store = new FileStore(root),
      current = await store.readPage(input.projectId!, input.resourceId);
    const saved = await store.savePage(
      input.projectId!,
      input.resourceId,
      content as typeof current.document,
      current.hash,
      current.revision,
    );
    expect(
      await drafts.completePage(second.id, second.generation, saved.revision!),
    ).toBe(true);
    expect(await drafts.list()).toEqual([]);
  });

  it("keeps different windows independent and retains incomplete component/template input", async () => {
    const one = await drafts.save(input),
      two = await drafts.save({ ...input, clientId: "other-window" });
    expect(one.id).not.toBe(two.id);
    const code = {
      manifest: { id: "unfinished" },
      source: "export default function( {",
      assets: { "pixel.bin": Buffer.from("asset bytes").toString("base64") },
    };
    const component = await drafts.save({
      kind: "component",
      clientId: "editor-window",
      resourceId: "component-edit",
      projectId: input.projectId,
      content: code,
    });
    expect((await drafts.read(component.id)).content).toEqual(code);
    const form = { schema: '{"unfinished":', source: code };
    const formDraft = await drafts.save({
      kind: "component",
      clientId: "form-window",
      resourceId: "form",
      content: form,
    });
    expect((await drafts.read(formDraft.id)).content).toEqual(form);
    const assetFiles = await readdir(join(root, "local", "draft-assets"));
    expect(assetFiles).toHaveLength(1);
    const template = await drafts.save({
      kind: "template",
      clientId: "editor-window",
      resourceId: "template-edit",
      content: { composition: "incomplete" },
    });
    expect((await drafts.read(template.id)).content).toEqual({
      composition: "incomplete",
    });
    expect(await drafts.list()).toHaveLength(5);
  });
  it("rejects a modified manifest that points outside its generation", async () => {
    const record = await drafts.save(input);
    const path = join(root, "local", "editor-drafts", record.id, "draft.json");
    await writeFile(
      path,
      JSON.stringify({ ...record, path: "../../../../library.json" }),
    );
    await expect(drafts.read(record.id)).rejects.toMatchObject({
      code: "INVALID_DATA",
    });
    await expect(drafts.save({ ...input, sequence: 2 })).rejects.toMatchObject({
      code: "INVALID_DATA",
    });
  });
});
