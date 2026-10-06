import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import { WorkspaceProtection, workspaceHash } from "./workspace-conflicts";
import type { ChangeContext } from "./history-model";

const context: ChangeContext = {
  actor: { kind: "human" },
  channel: "desktop",
  message: "Edit page",
};
describe("external workspace conflict protection", () => {
  let root: string,
    library: GitLibrary,
    store: FileStore,
    projectId: string,
    pageId: string,
    path: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-workspace-conflict-"));
    library = new GitLibrary(root);
    await library.initialize();
    store = new FileStore(root);
    projectId = (await store.createProject({ name: "Conflict" })).id;
    const record = await store.createPage(projectId, { title: "Original" });
    pageId = record.document.id;
    path = `projects/${projectId}/pages/${pageId}.json`;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  async function external(title: string) {
    const artifact = JSON.parse((await library.readFile(path)).toString());
    artifact.document.title = title;
    const bytes = Buffer.from(JSON.stringify(artifact));
    await writeFile(join(library.workspace, path), bytes);
    return bytes;
  }

  it("preserves external edits, blocks only their resource and permits other writes", async () => {
    const before = await library.head();
    const bytes = await external("External edit");
    const formal = await store.readPage(projectId, pageId);
    expect(formal.document.title).toBe("Original");
    expect(formal.workspaceConflicts).toHaveLength(1);
    await expect(
      store.savePage(
        projectId,
        pageId,
        { ...formal.document, title: "Human edit" },
        formal.hash,
        formal.revision,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await library.head()).toBe(before);
    expect(await readFile(join(library.workspace, path))).toEqual(bytes);
    const saved = await new WorkspaceProtection(library).input(
      formal.workspaceConflicts![0].id,
    );
    expect(saved.bytes).toEqual(bytes);
    await store.createPage(projectId, { title: "Independent page" });
    expect(await store.listPages(projectId)).toHaveLength(2);
    expect(await readFile(join(library.workspace, path))).toEqual(bytes);
  });

  it("imports a validated external page as a new version and keeps its original snapshot", async () => {
    const bytes = await external("Imported external");
    const formal = await store.readPage(projectId, pageId);
    const id = formal.workspaceConflicts![0].id;
    const imported = await library.resolveWorkspaceConflict(
      id,
      "import",
      { actor: { kind: "unknown" }, channel: "external" },
      async (input) => {
        const document = JSON.parse(input!.toString()).document;
        return store.savePage(
          projectId,
          pageId,
          document,
          formal.hash,
          formal.revision,
        );
      },
    );
    expect(imported.entry!.externalConflictId).toBe(id);
    expect((await store.readPage(projectId, pageId)).document.title).toBe(
      "Imported external",
    );
    expect((await new WorkspaceProtection(library).input(id)).bytes).toEqual(
      bytes,
    );
    expect(
      (await new WorkspaceProtection(library).input(id)).conflict.state,
    ).toBe("resolved");
  });

  it("discard restores the formal projection and refuses to discard newer external bytes", async () => {
    await external("First external");
    const first = await store.readPage(projectId, pageId);
    const id = first.workspaceConflicts![0].id;
    await external("Newer external");
    await expect(
      library.resolveWorkspaceConflict(id, "discard", context),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      JSON.parse((await readFile(join(library.workspace, path))).toString())
        .document.title,
    ).toBe("Newer external");
    const latest = (await new WorkspaceProtection(library).list(path))[0];
    await library.resolveWorkspaceConflict(latest.id, "discard", context);
    expect(
      (await store.readPage(projectId, pageId)).workspaceConflicts,
    ).toBeUndefined();
    expect(
      JSON.parse((await readFile(join(library.workspace, path))).toString())
        .document.title,
    ).toBe("Original");
  });

  it("recovers a committed journal without overwriting an external edit made after its baseline", async () => {
    const before = await library.readFile(path);
    const current = await store.readPage(projectId, pageId);
    const saved = await store.savePage(
      projectId,
      pageId,
      { ...current.document, title: "Committed" },
      current.hash,
      current.revision,
    );
    const transactionId = "committed-recovery-test";
    const directory = join(root, "local", "transactions", transactionId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "journal.json"),
      JSON.stringify({
        id: transactionId,
        parent: current.revision,
        candidate: saved.revision,
        paths: [path],
        before: { [path]: workspaceHash(path, before) },
      }),
    );
    const bytes = await external("External after commit");
    await library.recover();
    expect(await readFile(join(library.workspace, path))).toEqual(bytes);
    expect((await store.readPage(projectId, pageId)).document.title).toBe(
      "Committed",
    );
    expect(await readdir(join(root, "local", "transactions"))).toContain(
      transactionId,
    );
    const conflict = (await new WorkspaceProtection(library).list(path))[0];
    await library.resolveWorkspaceConflict(conflict.id, "discard", context);
    expect(await readdir(join(root, "local", "transactions"))).toEqual([]);
    expect(
      JSON.parse((await readFile(join(library.workspace, path))).toString())
        .document.title,
    ).toBe("Committed");
  });
});
