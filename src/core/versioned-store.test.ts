import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import { withChangeContext } from "./history-context";
import { mutateLibrary } from "./library-runtime";
import type { ChangeContext } from "./history-model";

const human: ChangeContext = {
  actor: { kind: "human" },
  channel: "desktop",
  message: "Edit page",
};
const agent: ChangeContext = {
  actor: { kind: "agent", harness: "codex", sessionId: "versioned-session" },
  channel: "cli",
  message: "Update page",
};

describe("FileStore on a versioned library", () => {
  let root: string;
  let library: GitLibrary;
  let store: FileStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-versioned-store-"));
    library = new GitLibrary(root);
    await library.initialize();
    store = new FileStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves project/page records through Git, attributes their source and creates no duplicate checkpoints", async () => {
    const project = await withChangeContext(human, () =>
      store.createProject({ name: "Report" }),
    );
    const page = await withChangeContext(agent, () =>
      store.createPage(project.id, { title: "Evidence" }),
    );
    expect(page.revision).toBeTruthy();
    expect(page.path).toContain(join(root, "workspace", "projects"));
    expect((await store.listProjects())[0].pageCount).toBe(1);
    expect((await store.listPages(project.id))[0].revision).toBe(page.revision);
    expect(
      (await store.readPage(project.id, page.document.id)).document,
    ).toEqual(page.document);
    const history = await library.history();
    expect(history).toHaveLength(2);
    expect(history[0].actor).toEqual(agent.actor);
    expect(history[1].actor).toEqual(human.actor);
    expect(
      (await library.tree()).some((entry) => entry.path.includes("snapshots/")),
    ).toBe(false);
  });

  it("requires a resource revision and detects A → B → A even when the old content hash matches", async () => {
    const project = await store.createProject({ name: "Report" });
    const a = await store.createPage(project.id);
    const paragraph = a.document.content.content![0].attrs!.id;
    const b = await withChangeContext(agent, () =>
      store.applyPage(project.id, a.document.id, {
        baseHash: a.hash,
        baseRevision: a.revision,
        operations: [{ type: "block.text.set", blockId: paragraph, text: "B" }],
      }),
    );
    const restored = await store.savePage(
      project.id,
      a.document.id,
      a.document,
      b.hash,
      b.revision,
    );
    expect(restored.hash).toBe(a.hash);
    expect(restored.revision).not.toBe(a.revision);
    await expect(
      store.applyPage(project.id, a.document.id, {
        baseHash: a.hash,
        baseRevision: a.revision,
        operations: [{ type: "page.set", fields: { title: "stale" } }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      store.savePage(project.id, a.document.id, a.document, restored.hash),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
  });

  it("stages multiple resources and commits only after the complete operation succeeds", async () => {
    const project = await store.createProject({ name: "Batch" });
    const before = await library.head();
    await mutateLibrary(
      root,
      async () => {
        const page = await store.createPage(project.id, { title: "First" });
        await expect(readFile(page.path)).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect((await store.listPages(project.id))[0].title).toBe("First");
        await store.applyPage(project.id, page.document.id, {
          baseHash: page.hash,
          operations: [
            {
              type: "block.text.set",
              blockId: page.document.content.content![0].attrs!.id,
              text: "Created and edited together",
            },
          ],
        });
        await store.createPage(project.id, { title: "Second" });
        expect(await library.head()).toBe(before);
      },
      agent,
    );
    expect(await store.listPages(project.id)).toHaveLength(2);
    expect(await library.history()).toHaveLength(2);
    expect(
      (await library.history())[0].resources.filter(
        (resource) => resource.kind === "page",
      ),
    ).toHaveLength(2);
    await expect(
      mutateLibrary(
        root,
        async () => {
          await store.createPage(project.id, { title: "Rejected" });
          throw new Error("operation failed");
        },
        agent,
      ),
    ).rejects.toThrow("operation failed");
    expect(await store.listPages(project.id)).toHaveLength(2);
  });

  it("round-trips real component manifest and schema bytes without changing source fingerprints", async () => {
    const packageRoot = join(
      import.meta.dirname,
      "../../resources/catalog/value-slider",
    );
    const manifest = await readFile(join(packageRoot, "manifest.json"));
    const schema = await readFile(join(packageRoot, "props.schema.json"));
    const identity = JSON.parse(manifest.toString());
    const prefix = `packages/components/${identity.id}/${identity.version}`;
    await library.writeFiles(
      new Map([
        [`${prefix}/manifest.json`, manifest],
        [`${prefix}/props.schema.json`, schema],
      ]),
      agent,
    );
    expect(await library.readFile(`${prefix}/manifest.json`)).toEqual(manifest);
    expect(await library.readFile(`${prefix}/props.schema.json`)).toEqual(
      schema,
    );
  });
});
