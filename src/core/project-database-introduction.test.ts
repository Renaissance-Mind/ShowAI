import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSchema, type JSONContent } from "@tiptap/core";
import { createExtensions } from "../components/rich-text/extensions";
import { markdownToRichText } from "../components/rich-text/model.mjs";
import { DatasetClient, type DatasetSession } from "../datasets/client";
import { databaseIntroductionOperations } from "../studio/database-introduction";
import { databaseCellOperations } from "../studio/project-database-view";
import {
  handleDatasetAction,
  datasetMutationActions,
} from "../workbench/dataset-actions";
import { ContentLibrary } from "./content-library";
import { initializeProjectDatabase } from "./create-database-project";
import { DatasetStore } from "./datasets";
import { mutateLibrary } from "./library-runtime";
import { FileStore } from "./store";
import {
  createProjectDatabaseData,
  validateProjectDatabaseData,
} from "./project-database";
import {
  DATABASE_INTRODUCTION_MAX_BYTES,
  validateProjectDatabaseIntroduction,
} from "./project-database-introduction";

const roots: string[] = [];
const clients: DatasetClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.prepareClose()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const document = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-database-introduction-"));
  roots.push(root);
  await new ContentLibrary(root).initialize();
  const store = new FileStore(root);
  const project = await mutateLibrary(root, async () => {
    const project = await store.createProject({ name: "Introduction" });
    return initializeProjectDatabase(store, project.id);
  });
  const datasetId = project.database!.datasetId;
  const transport = {
    invoke: <T>(action: string, args: Record<string, unknown> = {}) =>
      (datasetMutationActions.has(action)
        ? mutateLibrary(root, () => handleDatasetAction(store, action, args))
        : handleDatasetAction(store, action, args)) as Promise<T>,
  };
  const session = async (clientId: string) => {
    const client = new DatasetClient(transport, clientId);
    clients.push(client);
    const session = client.session(project.id, datasetId);
    await session.load();
    expect(session.getSnapshot().status).toBe("ready");
    return session;
  };
  const read = async () =>
    validateProjectDatabaseData(
      (await new DatasetStore(new FileStore(root)).read(project.id, datasetId))
        .dataset.value,
    );
  return { root, store, project, datasetId, session, read, transport };
}

const introduction = (session: DatasetSession) =>
  validateProjectDatabaseData(session.getSnapshot().value).intro;

describe("database introduction contract", () => {
  it("keeps old databases without an introduction valid and does not add the field", () => {
    const old = { columns: [], rows: [] };
    expect(validateProjectDatabaseData(old)).toBe(old);
    expect(Object.hasOwn(old, "intro")).toBe(false);
    expect(Object.hasOwn(createProjectDatabaseData(), "intro")).toBe(false);
  });

  it("accepts native headings, formatted paragraphs, and nested lists compatible with the editor schema", () => {
    const intro = markdownToRichText(
      "# Research notes\n\nAn **editable** introduction.\n\n- First\n  - Nested\n- Second\n\n1. Plan\n2. Write",
    );
    expect(validateProjectDatabaseIntroduction(intro)).toBe(intro);
    expect(() =>
      getSchema(createExtensions()).nodeFromJSON(intro).check(),
    ).not.toThrow();
    expect(
      validateProjectDatabaseData({ ...createProjectDatabaseData(), intro })
        .intro,
    ).toBe(intro);
  });

  it("rejects arbitrary objects, malformed rich text, unsafe marks, and hosted component data", () => {
    const invalid = [
      null,
      "Plain text",
      {},
      { type: "doc" },
      { type: "doc", content: [], extra: "not a native document key" },
      { type: "doc", content: [{ type: "script", text: "bad" }] },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "heading", attrs: { level: 1 } }],
          },
        ],
      },
      { type: "doc", content: [{ type: "bulletList", content: [] }] },
      { type: "doc", content: [{ type: "heading", attrs: { level: 7 } }] },
      { type: "doc", content: [{ type: "text", text: "Root inline text" }] },
      {
        type: "doc",
        content: [{ type: "widget", attrs: { kind: "chart", data: {} } }],
      },
      document(""),
      { ...document("Text"), attrs: [] },
      { ...document("Text"), attrs: { invalid: Infinity } },
      { ...document("Text"), attrs: { invalid: () => undefined } },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Link",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
            ],
          },
        ],
      },
    ];
    for (const intro of invalid) {
      expect(
        () => validateProjectDatabaseIntroduction(intro),
        JSON.stringify(intro),
      ).toThrow();
      expect(() =>
        validateProjectDatabaseData({ ...createProjectDatabaseData(), intro }),
      ).toThrow();
    }
  });

  it("bounds serialized UTF-8 size, structural complexity, and cyclic inputs", () => {
    const overhead = new TextEncoder().encode(
      JSON.stringify(document("")),
    ).length;
    const within = document(
      "a".repeat(DATABASE_INTRODUCTION_MAX_BYTES - overhead),
    );
    expect(validateProjectDatabaseIntroduction(within)).toBe(within);
    for (const intro of [
      document("a".repeat(DATABASE_INTRODUCTION_MAX_BYTES - overhead + 1)),
      document("汉".repeat(Math.floor(DATABASE_INTRODUCTION_MAX_BYTES / 2))),
      {
        type: "doc",
        content: Array.from({ length: 13000 }, () => ({ type: "paragraph" })),
      },
    ])
      expect(() => validateProjectDatabaseIntroduction(intro)).toThrow();
    const cyclic = document("Text");
    cyclic.content!.push(cyclic);
    expect(() => validateProjectDatabaseIntroduction(cyclic)).toThrow();
  });
});

describe("database introduction persistence", () => {
  it("saves rich text through the shared session and restores it from a reopened SQLite store", async () => {
    const f = await fixture();
    const session = await f.session("writer");
    const intro = markdownToRichText(
      "## Reading list\n\nNotes **above** every view.\n\n- Read\n- Discuss",
    );
    expect(introduction(session)).toBeUndefined();
    session.edit(databaseIntroductionOperations(intro, undefined));
    expect(await session.flush()).toBe(true);
    expect((await f.read()).intro).toEqual(intro);
    const reopened = await f.session("reopened-window");
    expect(introduction(reopened)).toEqual(intro);
    expect(
      databaseIntroductionOperations(intro, introduction(reopened)),
    ).toEqual([]);
    // Returning to an empty document remains valid and saves without dropping views.
    const empty: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
    reopened.edit(
      databaseIntroductionOperations(empty, introduction(reopened)),
    );
    expect(await reopened.flush()).toBe(true);
    expect((await f.read()).intro).toEqual(empty);
    expect((await f.read()).views).toHaveLength(3);
  });

  it("preserves simultaneous property, schema, and view edits from another window", async () => {
    const f = await fixture();
    const page = await mutateLibrary(f.root, () =>
      f.store.createPage(f.project.id, { title: "A document" }),
    );
    const a = await f.session("introduction-writer");
    const b = await f.session("property-writer");
    const before = validateProjectDatabaseData(b.getSnapshot().value);
    const intro = document("A shared introduction");
    a.edit(databaseIntroductionOperations(intro, undefined));
    b.edit([
      ...databaseCellOperations(
        before,
        page.document.id,
        "status",
        "进行中",
        undefined,
      ),
      {
        op: "set",
        path: ["views", { id: "table" }, "name"],
        value: "Working documents",
        before: "表格",
      },
      {
        op: "set",
        path: ["columns", { id: "date" }, "name"],
        value: "Deadline",
        before: "日期",
      },
    ]);
    expect(await a.flush()).toBe(true);
    expect(await b.flush()).toBe(true);
    await Promise.all([a.refresh(), b.refresh()]);
    const saved = await f.read();
    expect(saved.intro).toEqual(intro);
    expect(saved.rows).toEqual([{ id: page.document.id, status: "进行中" }]);
    expect(saved.columns[1].name).toBe("Deadline");
    expect(saved.views![0].name).toBe("Working documents");
    expect(a.getSnapshot().value).toEqual(saved);
    expect(b.getSnapshot().value).toEqual(saved);
  });

  it("holds an external introduction change against the typing basis and lets the existing conflict flow resolve it", async () => {
    const f = await fixture();
    const session = await f.session("focused-writer");
    const first = document("Original introduction");
    session.edit(databaseIntroductionOperations(first, undefined));
    expect(await session.flush()).toBe(true);
    const basis = introduction(session);
    const other = await f.session("external-writer");
    const external = document("Updated elsewhere");
    other.edit(databaseIntroductionOperations(external, introduction(other)));
    expect(await other.flush()).toBe(true);
    await session.refresh();
    const mine = document("Typing in the focused editor");
    const held = session.edit(databaseIntroductionOperations(mine, basis));
    expect(held).toMatchObject([{ path: ["intro"], mine, theirs: external }]);
    expect(await session.flush()).toBe(false);
    expect((await f.read()).intro).toEqual(external);
    session.resolve(session.getSnapshot().conflicts[0].id, "mine");
    expect(await session.flush()).toBe(true);
    expect((await f.read()).intro).toEqual(mine);
  });

  it("rejects an invalid persisted introduction without changing the saved database", async () => {
    const f = await fixture();
    const before = await f.read();
    await expect(
      f.transport.invoke("datasets:apply", {
        projectId: f.project.id,
        datasetId: f.datasetId,
        operations: [
          { op: "set", path: ["intro"], value: { arbitrary: "object" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(await f.read()).toEqual(before);
  });
});
