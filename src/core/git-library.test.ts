import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import type { ChangeContext, FileChanges } from "./history-model";

const human: ChangeContext = {
  actor: { kind: "human" },
  channel: "desktop",
  message: "Edit report",
};
const agent: ChangeContext = {
  actor: { kind: "agent", harness: "codex", sessionId: "actual-test-session" },
  channel: "cli",
  message: "Update conclusion",
};

describe("Git-backed content library", () => {
  let root: string;
  let library: GitLibrary;
  let path: string;
  let initial: Buffer;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-git-"));
    const legacy = new FileStore(join(root, "source"));
    const project = await legacy.createProject({ name: "Research" });
    const page = await legacy.createPage(project.id, { title: "Report" });
    path = `projects/${project.id}/pages/${page.document.id}.json`;
    initial = await readFile(page.path);
    library = new GitLibrary(join(root, "library"));
    await library.initialize();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function content(text: string): Buffer {
    const artifact = JSON.parse(initial.toString("utf8"));
    artifact.document.content.content[0].content = [{ type: "text", text }];
    return Buffer.from(JSON.stringify(artifact));
  }

  it("records A → B → A as three commits with author/session attribution and reusable content", async () => {
    const a = await library.writeFiles(new Map([[path, content("A")]]), human);
    const b = await library.writeFiles(new Map([[path, content("B")]]), agent);
    const again = await library.writeFiles(
      new Map([[path, content("A")]]),
      human,
    );
    expect(new Set([a!.revision, b!.revision, again!.revision]).size).toBe(3);
    expect(await library.hasRevision(a!.revision)).toBe(true);
    expect(await library.hasRevision("0".repeat(40))).toBe(false);
    expect(await library.hasRevision("not-a-revision")).toBe(false);
    expect(
      await library.hasRevision((await library.tree(a!.revision))[0].oid),
    ).toBe(false);
    const history = await library.history({ path });
    expect(history.map((entry) => entry.revision)).toEqual([
      again!.revision,
      b!.revision,
      a!.revision,
    ]);
    expect(history[1].actor).toEqual(agent.actor);
    expect(history[1].parents).toEqual([a!.revision]);
    expect(await library.tree(a!.revision)).toEqual(
      await library.tree(again!.revision),
    );
    expect(
      JSON.parse((await library.readFile(path, b!.revision)).toString())
        .document.content.content[0].content[0].text,
    ).toBe("B");
    await library.verify();
  });

  it("stores shared image bytes once and changes only the edited node", async () => {
    const page = JSON.parse(initial.toString());
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=";
    page.document.content.content.push({
      type: "image",
      attrs: { id: "image-one", src: image },
    });
    page.document.cover = image;
    const first = await library.writeFiles(
      new Map([[path, Buffer.from(JSON.stringify(page))]]),
      human,
    );
    page.document.content.content[0].content = [
      { type: "text", text: "New conclusion" },
    ];
    const second = await library.writeFiles(
      new Map([[path, Buffer.from(JSON.stringify(page))]]),
      agent,
    );
    const before = await library.tree(first!.revision);
    const after = await library.tree(second!.revision);
    expect(
      after.filter((entry) => entry.path.startsWith("assets/")),
    ).toHaveLength(1);
    expect(
      after.filter(
        (entry) =>
          before.find((old) => old.path === entry.path)?.oid !== entry.oid,
      ),
    ).toHaveLength(1);
    expect(JSON.parse((await library.readFile(path)).toString())).toEqual(page);
    expect(
      JSON.parse(await readFile(join(library.workspace, path), "utf8")),
    ).toEqual(page);
  });

  it("serializes independent clients and refuses stale resource revisions", async () => {
    const first = await library.writeFiles(
      new Map([[path, content("base")]]),
      human,
    );
    const expected = new Map([[path, first!.revision]]);
    const results = await Promise.allSettled([
      library.writeFiles(new Map([[path, content("human")]]), human, expected),
      new GitLibrary(library.root).writeFiles(
        new Map([[path, content("agent")]]),
        agent,
        expected,
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await library.history({ path })).toHaveLength(2);
  });

  it("restores as a new commit and preserves the changed version", async () => {
    const first = await library.writeFiles(
      new Map([[path, content("old")]]),
      human,
    );
    const second = await library.writeFiles(
      new Map([[path, content("new")]]),
      agent,
    );
    const restored = await library.restore(
      [path],
      first!.revision,
      human,
      new Map([[path, second!.revision]]),
    );
    expect(restored!.restoredFrom).toBe(first!.revision);
    expect(restored!.parents).toEqual([second!.revision]);
    expect(
      JSON.parse((await library.readFile(path)).toString()).document.content
        .content[0].content[0].text,
    ).toBe("old");
    expect(
      JSON.parse((await library.readFile(path, second!.revision)).toString())
        .document.content.content[0].content[0].text,
    ).toBe("new");
  });

  it("deduplicates a retried operation after its expected revision is stale", async () => {
    const first = await library.writeFiles(
      new Map([[path, content("base")]]),
      human,
    );
    const context = {
      ...agent,
      operationId: "same-request",
      message: "Update result\n\nInclude evidence",
    };
    const expected = new Map([[path, first!.revision]]);
    const saved = await library.writeFiles(
      new Map([[path, content("changed")]]),
      context,
      expected,
    );
    expect(
      await library.writeFiles(
        new Map([[path, content("changed")]]),
        context,
        expected,
      ),
    ).toEqual(saved);
    expect(await library.history()).toHaveLength(2);
    await expect(
      library.writeFiles(new Map([[path, content("different")]]), context),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await library.history({ before: first!.revision })).toEqual([]);
  });

  it("retains unrelated resource writes, deletes removed nodes and compacts without losing history", async () => {
    const other = path.replace(/\/([^/]+)\.json$/, "/other-page.json");
    await library.writeFiles(new Map([[path, content("original")]]), human);
    await Promise.all([
      library.writeFiles(new Map([[other, content("another page")]]), agent),
      new GitLibrary(library.root).writeFiles(
        new Map([
          ["sidebar.json", Buffer.from('{"groups":[],"projectGroups":{}}')],
        ]),
        human,
      ),
    ]);
    const original = JSON.parse(initial.toString());
    original.document.content.content = [];
    await library.writeFiles(
      new Map([[path, Buffer.from(JSON.stringify(original))]]),
      human,
    );
    expect(
      (await library.tree()).filter((entry) =>
        entry.path.startsWith(`${path.slice(0, -5)}/nodes/`),
      ),
    ).toHaveLength(1);
    const revisions = (await library.history()).map((entry) => entry.revision);
    await library.compact();
    expect((await library.history()).map((entry) => entry.revision)).toEqual(
      revisions,
    );
    expect(await library.readFile(other)).toBeInstanceOf(Buffer);
    await library.verify();
    expect(await readdir(join(library.root, "local", "transactions"))).toEqual(
      [],
    );
  });

  it("reports damaged committed objects and retains readable files without inventing a repair", async () => {
    const saved = await library.writeFiles(
      new Map([[path, content("durable original")]]),
      human,
    );
    const projection = await readFile(join(library.workspace, path)),
      formal = await library.readFile(path, saved!.revision);
    const object = join(
      library.repository,
      "objects",
      saved!.revision.slice(0, 2),
      saved!.revision.slice(2),
    );
    const original = await readFile(object),
      damaged = Buffer.from("damaged Git object");
    await chmod(object, 0o600);
    await writeFile(object, damaged);
    await expect(library.verify()).rejects.toThrow();
    await expect(library.readFile(path, saved!.revision)).rejects.toThrow();
    expect(await readFile(object)).toEqual(damaged);
    expect(await readFile(join(library.workspace, path))).toEqual(projection);
    await writeFile(object, original);
    await library.verify();
    expect(await library.readFile(path, saved!.revision)).toEqual(formal);
  });
  it("rejects unsafe workspace paths before publishing a commit", async () => {
    await expect(
      library.writeFiles(new Map([["../outside.json", initial]]), human),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    const projectDir = join(library.workspace, "projects");
    await symlink(
      join(root, "source", "projects"),
      projectDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    const edits: FileChanges = new Map([[path, content("durable")]]);
    await expect(library.writeFiles(edits, agent)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
    expect(await library.head()).toBeNull();
    await rm(projectDir, { recursive: true });
    await library.writeFiles(edits, agent);
    expect(
      JSON.parse(await readFile(join(library.workspace, path), "utf8")).document
        .content.content[0].content[0].text,
    ).toBe("durable");
    expect(await readdir(join(library.root, "local", "transactions"))).toEqual(
      [],
    );
  });
});
