import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentLibrary } from "./content-library";
import { FileStore, validateProjectMetadata } from "./store";
import { DatasetStore, type DatasetRecord } from "./datasets";
import { DatasetClient } from "../datasets/client";
import { AgentService } from "../agent/service";
import { WorkspaceService } from "../agent/workspace-service";
import { createWorkbench } from "../workbench/actions";
import type { ProjectSummary, ShowDocument, SidebarEntryMove } from "./model";
import {
  createProjectDatabaseData,
  defaultProjectDatabaseViews,
  MAX_DATABASE_COLUMN_WIDTH,
  MIN_DATABASE_COLUMN_WIDTH,
  validateProjectDatabase,
  validateProjectDatabaseData,
  type ProjectDatabaseData,
} from "./project-database";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(storage: "sqlite" | "legacy" = "sqlite") {
  const root = await mkdtemp(join(tmpdir(), "showai-project-database-"));
  directories.push(root);
  const library = new ContentLibrary(root);
  if (storage === "sqlite") await library.initialize();
  const store = new FileStore(root);
  const service = new AgentService({ root });
  const invoke = createWorkbench(store, service, {
    info: () => ({
      home: root,
      version: "test",
      platform: process.platform,
      packaged: false,
      mode: "browser",
      cli: { command: "showai", args: [], env: {} },
    }),
    openDialog: async () => ({ canceled: true, filePaths: [] }),
    saveDialog: async () => ({ canceled: true }),
    invoke: async () => undefined,
  });
  return { root, library, store, service, invoke };
}

describe("project databases", () => {
  it("creates and persists named views and their settings through the workbench without changing records", async () => {
    const f = await fixture();
    const project = (await f.invoke("projects:create", {
      name: "View settings",
      database: true,
    })) as ProjectSummary;
    await f.store.createPage(project.id, { title: "A real record" });
    const args = {
      projectId: project.id,
      datasetId: project.database!.datasetId,
    };
    const initial = (await f.invoke("datasets:get", args)) as DatasetRecord;
    const original = initial.dataset.value as ProjectDatabaseData;
    expect(original.views).toEqual([
      { id: "table", name: "表格", type: "table", columnWidths: {} },
      { id: "board", name: "看板", type: "board", groupBy: "status" },
      { id: "list", name: "列表", type: "list" },
    ]);
    const defaults = defaultProjectDatabaseViews();
    defaults[0].name = "Changed locally";
    defaults[0].columnWidths!.status = 300;
    expect(defaultProjectDatabaseViews()[0].name).toBe("表格");
    expect(defaultProjectDatabaseViews()[0].columnWidths).toEqual({});
    await f.invoke("datasets:apply", {
      ...args,
      baseHash: initial.hash,
      operations: [
        {
          op: "set",
          path: ["views", { id: "table" }, "columnWidths", "$page-title"],
          value: 456,
          absent: true,
        },
        {
          op: "set",
          path: ["views", { id: "table" }, "columnWidths", "status"],
          value: 240,
          absent: true,
        },
        {
          op: "set",
          path: ["views", { id: "table" }, "name"],
          value: "进行中的文档",
        },
        {
          op: "set",
          path: ["views", { id: "table" }, "filter"],
          value: { column: "status", value: "进行中" },
        },
        {
          op: "set",
          path: ["views", { id: "table" }, "sort"],
          value: { column: "date", direction: "desc" },
        },
        {
          op: "set",
          path: ["views", { id: "board" }, "groupBy"],
          value: "removed-column",
        },
        {
          op: "insert",
          path: ["views"],
          after: "list",
          value: {
            id: "reading",
            name: "阅读清单",
            type: "list",
            filter: { column: "$page-title", value: "Paper" },
            sort: null,
          },
        },
      ],
    });
    const reopened = await new DatasetStore(new FileStore(f.root)).read(
      project.id,
      args.datasetId,
    );
    const saved = reopened.dataset.value as ProjectDatabaseData;
    expect(saved.views).toEqual([
      {
        id: "table",
        name: "进行中的文档",
        type: "table",
        columnWidths: { "$page-title": 456, status: 240 },
        filter: { column: "status", value: "进行中" },
        sort: { column: "date", direction: "desc" },
      },
      { id: "board", name: "看板", type: "board", groupBy: "removed-column" },
      { id: "list", name: "列表", type: "list" },
      {
        id: "reading",
        name: "阅读清单",
        type: "list",
        filter: { column: "$page-title", value: "Paper" },
        sort: null,
      },
    ]);
    expect(saved.columns).toEqual(original.columns);
    expect(saved.rows).toEqual(original.rows);
    for (const views of [
      [],
      [
        {
          id: "table",
          name: "Invalid",
          type: "table",
          sort: { column: "date", direction: "up" },
        },
      ],
      [
        {
          id: "table",
          name: "Invalid width",
          type: "table",
          columnWidths: { status: 79 },
        },
      ],
    ]) {
      await expect(
        f.invoke("datasets:apply", {
          ...args,
          baseHash: reopened.hash,
          operations: [{ op: "set", path: ["views"], value: views }],
        }),
      ).rejects.toMatchObject({ code: "INVALID_DATA" });
      expect(
        (await new DatasetStore(f.store).read(project.id, args.datasetId)).hash,
      ).toBe(reopened.hash);
    }
  });

  it("reads legacy data without views and can persist its first view definitions", async () => {
    const f = await fixture();
    const project = (await f.invoke("projects:create", {
      name: "Legacy views",
      database: true,
    })) as ProjectSummary;
    const args = {
      projectId: project.id,
      datasetId: project.database!.datasetId,
    };
    const initial = (await f.invoke("datasets:get", args)) as DatasetRecord;
    await f.invoke("datasets:apply", {
      ...args,
      baseHash: initial.hash,
      operations: [{ op: "remove", path: ["views"] }],
    });
    const legacy = await new DatasetStore(new FileStore(f.root)).read(
      project.id,
      args.datasetId,
    );
    const data = legacy.dataset.value as ProjectDatabaseData;
    expect(Object.hasOwn(data, "views")).toBe(false);
    expect(validateProjectDatabaseData(data)).toEqual(data);
    await f.invoke("datasets:apply", {
      ...args,
      baseHash: legacy.hash,
      operations: [
        {
          op: "set",
          path: ["views"],
          absent: true,
          value: defaultProjectDatabaseViews(),
        },
      ],
    });
    const saved = await new DatasetStore(new FileStore(f.root)).read(
      project.id,
      args.datasetId,
    );
    expect((saved.dataset.value as ProjectDatabaseData).views).toEqual(
      defaultProjectDatabaseViews(),
    );
  });

  it("strictly validates view settings while retaining references to removed properties", () => {
    const view = { id: "table", name: "Table", type: "table" };
    const data = { columns: [], rows: [] };
    for (const views of [
      null,
      [],
      Array.from({ length: 51 }, (_, index) => ({
        ...view,
        id: `view-${index}`,
      })),
      [view, view],
      [null],
      [{ ...view, id: "../view" }],
      [{ ...view, id: "constructor" }],
      [{ ...view, id: "CON" }],
      [{ ...view, id: "a".repeat(129) }],
      [{ ...view, name: "" }],
      [{ ...view, name: "   " }],
      [{ ...view, name: "a".repeat(201) }],
      [{ ...view, type: "calendar" }],
      [{ ...view, type: ["table"] }],
      [{ ...view, unknown: true }],
      [{ ...view, filter: null }],
      [{ ...view, filter: { column: "", value: "" } }],
      [{ ...view, filter: { column: "status", value: false } }],
      [{ ...view, filter: { column: "status", value: "", unknown: true } }],
      [{ ...view, sort: { column: "date", direction: "up" } }],
      [{ ...view, sort: { column: "date", direction: ["asc"] } }],
      [{ ...view, sort: { column: "date", direction: "asc", unknown: true } }],
      [{ ...view, groupBy: "" }],
      [{ ...view, groupBy: false }],
    ])
      expect(() => validateProjectDatabaseData({ ...data, views })).toThrow();
    const views = [
      {
        ...view,
        name: "a".repeat(200),
        filter: { column: "deleted", value: "" },
        sort: { column: "$page-title", direction: "asc" },
        groupBy: "removed-select",
      },
    ];
    expect(validateProjectDatabaseData({ ...data, views })).toEqual({
      ...data,
      views,
    });
    expect(
      validateProjectDatabaseData({
        ...data,
        views: Array.from({ length: 50 }, (_, index) => ({
          ...view,
          id: `view-${index}`,
        })),
      }).views,
    ).toHaveLength(50);
  });

  it("validates bounded integer column widths and safe property keys while accepting older views", () => {
    const view = { id: "table", name: "Table", type: "table" };
    const data = { columns: [], rows: [] };
    expect(
      validateProjectDatabaseData({ ...data, views: [view] }).views,
    ).toEqual([view]);
    const widths = {
      "$page-title": MIN_DATABASE_COLUMN_WIDTH,
      "removed-property": MAX_DATABASE_COLUMN_WIDTH,
    };
    expect(
      validateProjectDatabaseData({
        ...data,
        views: [{ ...view, columnWidths: widths }],
      }).views?.[0].columnWidths,
    ).toEqual(widths);
    for (const columnWidths of [
      null,
      [],
      250,
      "250",
      { status: 79 },
      { status: 1201 },
      { status: 200.5 },
      { status: NaN },
      { status: Infinity },
      { status: "250" },
      { status: undefined },
      { "": 250 },
      { ["a".repeat(201)]: 250 },
      { id: 250 },
      { constructor: 250 },
      { prototype: 250 },
      JSON.parse('{"__proto__":250}'),
      Object.create({ status: 250 }),
    ])
      expect(() =>
        validateProjectDatabaseData({
          ...data,
          views: [{ ...view, columnWidths }],
        }),
      ).toThrow();
  });

  it.each([
    ["201 characters", "研".repeat(201), "数据库属性"],
    ["1000 characters", "研".repeat(1000), "数据库属性"],
    ["emoji at the dataset limit", "🧪".repeat(100), "🧪".repeat(100)],
    ["emoji above the dataset limit", "🧪".repeat(101), "数据库属性"],
    ["emoji at the project limit", "🧪".repeat(500), "数据库属性"],
  ])(
    "preserves the project name with %s",
    async (_label, name, datasetName) => {
      const f = await fixture();
      const project = (await f.invoke("projects:create", {
        name,
        database: true,
      })) as ProjectSummary;
      const reopened = new FileStore(f.root);
      expect(project.name).toBe(name);
      expect((await reopened.readProject(project.id)).name).toBe(name);
      const properties = await new DatasetStore(reopened).read(
        project.id,
        project.database!.datasetId,
      );
      expect(properties.dataset.name).toBe(datasetName);
      expect(properties.dataset.value).toEqual(createProjectDatabaseData());
    },
  );

  it("creates a long-named database in an existing legacy library", async () => {
    const f = await fixture("legacy");
    await f.store.createProject({ name: "Existing legacy project" });
    const name = "研".repeat(1000);
    const project = (await f.invoke("projects:create", {
      name,
      database: true,
    })) as ProjectSummary;
    expect((await f.store.readProject(project.id)).name).toBe(name);
    expect(
      (
        await new DatasetStore(f.store).read(
          project.id,
          project.database!.datasetId,
        )
      ).dataset.name,
    ).toBe("数据库属性");
    expect(await f.store.listProjects()).toHaveLength(2);
  });

  it.each(["研".repeat(1001), "🧪".repeat(501)])(
    "keeps rejecting project names above the project budget",
    async (name) => {
      const f = await fixture();
      await expect(
        f.invoke("projects:create", { name, database: true }),
      ).rejects.toMatchObject({ code: "INVALID_DATA" });
      expect(await f.store.listProjects()).toEqual([]);
    },
  );

  it("creates a persistent database project through the workbench while ordinary projects stay ordinary", async () => {
    const f = await fixture();
    const plain = (await f.invoke("projects:create", {
      name: "Ordinary",
    })) as ProjectSummary;
    expect(plain.database).toBeUndefined();
    expect(await new DatasetStore(f.store).list(plain.id)).toEqual([]);
    const project = (await f.invoke("projects:create", {
      name: "Research",
      database: true,
    })) as ProjectSummary;
    expect(project.database?.datasetId).toBeTruthy();
    expect((await f.library.manifest()).storage).toBe("sqlite");
    const reopened = new FileStore(f.root);
    expect((await reopened.readProject(project.id)).database).toEqual(
      project.database,
    );
    const data = await new DatasetStore(reopened).read(
      project.id,
      project.database!.datasetId,
    );
    expect(data.dataset.origin).toEqual({ kind: "project-database" });
    expect(data.dataset.value).toEqual(createProjectDatabaseData());
    expect(
      (await f.service.listProjects()).find((item) => item.id === project.id)
        ?.database,
    ).toEqual(project.database);
    const page = await reopened.createPage(project.id, {
      title: "Paper notes",
    });
    expect((await reopened.listPages(project.id))[0].id).toBe(page.document.id);
    expect(
      (await new DatasetStore(reopened).read(project.id, data.dataset.id))
        .dataset.value,
    ).toMatchObject({ rows: [{ id: page.document.id }] });
    await expect(
      new DatasetStore(reopened).remove(project.id, data.dataset.id, {
        baseHash: data.hash,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.invoke("projects:create", { name: "Invalid", database: "yes" }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
  });

  it("rolls back the new project if creating its properties fails", async () => {
    const f = await fixture();
    vi.spyOn(DatasetStore.prototype, "create").mockRejectedValueOnce(
      new Error("properties failed"),
    );
    await expect(
      f.invoke("projects:create", { name: "Incomplete", database: true }),
    ).rejects.toThrow("properties failed");
    expect(await new FileStore(f.root).listProjects()).toEqual([]);
  });

  it("persists record properties, merges independent edits and rejects invalid new values", async () => {
    const f = await fixture();
    const project = (await f.invoke("projects:create", {
      name: "Research",
      database: true,
    })) as ProjectSummary;
    const page = await f.store.createPage(project.id, {
      title: "A real document",
    });
    const datasets = new DatasetStore(f.store);
    const initial = await datasets.read(
      project.id,
      project.database!.datasetId,
    );
    const row = { id: page.document.id, status: "待开始", date: "" };
    const inserted = await datasets.apply(project.id, initial.dataset.id, {
      baseHash: initial.hash,
      operations: [
        {
          op: "set",
          path: ["rows", { id: row.id }, "status"],
          absent: true,
          value: row.status,
        },
        {
          op: "set",
          path: ["rows", { id: row.id }, "date"],
          absent: true,
          value: row.date,
        },
      ],
    });
    const original = inserted.record;
    await datasets.apply(project.id, initial.dataset.id, {
      baseHash: original.hash,
      operations: [
        {
          op: "set",
          path: ["rows", { id: row.id }, "status"],
          before: "待开始",
          value: "进行中",
        },
      ],
    });
    const merged = await datasets.apply(project.id, initial.dataset.id, {
      baseHash: original.hash,
      operations: [
        {
          op: "set",
          path: ["rows", { id: row.id }, "date"],
          before: "",
          value: "2026-10-22",
        },
      ],
    });
    expect(merged.conflicts).toEqual([]);
    const reopened = await new DatasetStore(new FileStore(f.root)).read(
      project.id,
      initial.dataset.id,
    );
    expect((reopened.dataset.value as ProjectDatabaseData).rows).toEqual([
      { ...row, status: "进行中", date: "2026-10-22" },
    ]);
    const conflict = await datasets.apply(project.id, initial.dataset.id, {
      baseHash: original.hash,
      operations: [
        {
          op: "set",
          path: ["rows", { id: row.id }, "status"],
          before: "待开始",
          value: "已完成",
        },
      ],
    });
    expect(conflict.conflicts).toHaveLength(1);
    await expect(
      datasets.apply(project.id, initial.dataset.id, {
        baseHash: reopened.hash,
        operations: [
          {
            op: "set",
            path: ["rows", { id: row.id }, "date"],
            value: "tomorrow",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect((await datasets.read(project.id, initial.dataset.id)).hash).toBe(
      reopened.hash,
    );
    expect(
      (await f.store.readPage(project.id, page.document.id)).document.title,
    ).toBe("A real document");
  });

  it("creates page property stubs atomically so two windows can make their first independent edits", async () => {
    const f = await fixture();
    const project = (await f.invoke("projects:create", {
      name: "Concurrent",
      database: true,
    })) as ProjectSummary;
    const page = await f.store.createPage(project.id, { title: "Shared page" });
    const datasetId = project.database!.datasetId;
    const properties = await new DatasetStore(f.store).read(
      project.id,
      datasetId,
    );
    expect((properties.dataset.value as ProjectDatabaseData).rows).toEqual([
      { id: page.document.id },
    ]);
    expect(properties.revision).toBe(
      (await f.store.readPage(project.id, page.document.id)).revision,
    );
    const transport = {
      invoke: <T>(action: string, args?: Record<string, unknown>) =>
        f.invoke(action, args ?? {}) as Promise<T>,
    };
    const clients = [
      new DatasetClient(transport, "first-a"),
      new DatasetClient(transport, "first-b"),
    ];
    try {
      const [a, b] = clients.map((client) =>
        client.session(project.id, datasetId),
      );
      await Promise.all([a.load(), b.load()]);
      a.edit([
        {
          op: "set",
          path: ["rows", { id: page.document.id }, "status"],
          absent: true,
          value: "进行中",
        },
      ]);
      b.edit([
        {
          op: "set",
          path: ["rows", { id: page.document.id }, "date"],
          absent: true,
          value: "2026-10-22",
        },
      ]);
      expect(await a.flush()).toBe(true);
      expect(await b.flush()).toBe(true);
      expect(a.getSnapshot().conflicts).toEqual([]);
      expect(b.getSnapshot().conflicts).toEqual([]);
      const saved = await new DatasetStore(new FileStore(f.root)).read(
        project.id,
        datasetId,
      );
      expect((saved.dataset.value as ProjectDatabaseData).rows).toEqual([
        { id: page.document.id, status: "进行中", date: "2026-10-22" },
      ]);
    } finally {
      await Promise.all(clients.map((client) => client.prepareClose()));
    }
    vi.spyOn(DatasetStore.prototype, "apply").mockRejectedValueOnce(
      new Error("stub failed"),
    );
    await expect(
      f.store.createPage(project.id, { title: "Incomplete page" }),
    ).rejects.toThrow("stub failed");
    expect(
      (await f.store.listPages(project.id)).map((item) => item.id),
    ).toEqual([page.document.id]);
  });

  it.each(["store", "workbench", "agent"] as const)(
    "rejects database record and containing-folder cross-project moves through %s before any content writes",
    async (route) => {
      const f = await fixture();
      const source = (await f.invoke("projects:create", {
        name: "Source database",
        database: true,
      })) as ProjectSummary;
      const plain = await f.store.createProject({ name: "Plain destination" });
      const database = (await f.invoke("projects:create", {
        name: "Database destination",
        database: true,
      })) as ProjectSummary;
      const folder = await f.store.createFolder(source.id, { name: "Records" });
      const root = await f.store.createPage(source.id, {
        title: "Root record",
      });
      const nested = await f.store.createPage(source.id, {
        title: "Nested record",
        parentId: folder.id,
      });
      const datasets = new DatasetStore(f.store);
      const initial = await datasets.read(
        source.id,
        source.database!.datasetId,
      );
      await datasets.apply(source.id, initial.dataset.id, {
        baseHash: initial.hash,
        operations: [
          {
            op: "set",
            path: ["rows", { id: root.document.id }, "status"],
            absent: true,
            value: "进行中",
          },
          {
            op: "set",
            path: ["rows", { id: nested.document.id }, "date"],
            absent: true,
            value: "2026-10-22",
          },
        ],
      });
      const state = async () => ({
        head: await f.library.head(),
        tree: await f.library.tree(),
        source: await f.store.readProject(source.id),
        pages: await f.store.listPages(source.id),
        folders: await f.store.listFolders(source.id),
        properties: await datasets.read(source.id, initial.dataset.id),
        plain: await f.store.listPages(plain.id),
        destination: await f.store.readProject(database.id),
        destinationPages: await f.store.listPages(database.id),
        destinationProperties: await datasets.read(
          database.id,
          database.database!.datasetId,
        ),
        sidebar: await f.store.readSidebar(),
      });
      const baseline = await state();
      const prepare = vi.fn(async (document: ShowDocument) => document);
      const workspace = new WorkspaceService(f.root, source.id, {
        libraryAccess: true,
      });
      // The batch UI sends one sidebar move per page, including folder descendants.
      for (const destination of [plain, database]) {
        for (const item of [root, nested, folder]) {
          const page = "document" in item ? item : undefined;
          const move: SidebarEntryMove = {
            kind: page ? "page" : "folder",
            projectId: source.id,
            destinationProjectId: destination.id,
            id: page ? page.document.id : folder.id,
            parentId: null,
            ...(page
              ? { baseHash: page.hash, baseRevision: page.revision }
              : {}),
          };
          await expect(
            route === "store"
              ? f.store.arrangeEntry(move, prepare)
              : route === "workbench"
                ? f.invoke("sidebar:moveEntry", { ...move })
                : workspace.moveEntry(move),
          ).rejects.toMatchObject({ code: "INVALID_DATA" });
          expect(await state()).toEqual(baseline);
        }
      }
      expect(prepare).not.toHaveBeenCalled();
      expect(
        (baseline.properties.dataset.value as ProjectDatabaseData).rows,
      ).toEqual([
        { id: root.document.id, status: "进行中" },
        { id: nested.document.id, date: "2026-10-22" },
      ]);
    },
  );

  it("keeps database records and folders movable within their own project", async () => {
    const f = await fixture();
    const project = (await f.invoke("projects:create", {
      name: "Organize database",
      database: true,
    })) as ProjectSummary;
    const folder = await f.store.createFolder(project.id, { name: "Records" });
    const destination = await f.store.createFolder(project.id, {
      name: "Group",
    });
    const page = await f.store.createPage(project.id, { title: "Record" });
    const datasets = new DatasetStore(f.store);
    const properties = await datasets.read(
      project.id,
      project.database!.datasetId,
    );
    const workspace = new WorkspaceService(f.root, project.id);
    await workspace.moveEntry({
      kind: "page",
      id: page.document.id,
      destinationProjectId: project.id,
      parentId: folder.id,
      baseHash: page.hash,
      baseRevision: page.revision,
    });
    await f.invoke("sidebar:moveEntry", {
      kind: "folder",
      projectId: project.id,
      id: folder.id,
      destinationProjectId: project.id,
      parentId: destination.id,
    });
    expect(
      (await f.store.readPage(project.id, page.document.id)).document.parentId,
    ).toBe(folder.id);
    expect(
      (await f.store.listFolders(project.id)).find(
        (item) => item.id === folder.id,
      )?.parentId,
    ).toBe(destination.id);
    expect(await datasets.read(project.id, properties.dataset.id)).toEqual(
      properties,
    );
  });

  it("still moves ordinary project pages across projects", async () => {
    const f = await fixture();
    const source = await f.store.createProject({ name: "Ordinary source" });
    const destination = await f.store.createProject({
      name: "Ordinary destination",
    });
    const page = await f.store.createPage(source.id, { title: "Movable page" });
    await new WorkspaceService(f.root, source.id, {
      libraryAccess: true,
    }).moveEntry({
      kind: "page",
      id: page.document.id,
      destinationProjectId: destination.id,
      parentId: null,
      baseHash: page.hash,
      baseRevision: page.revision,
    });
    expect(await f.store.listPages(source.id)).toEqual([]);
    expect(
      (await f.store.readPage(destination.id, page.document.id)).document,
    ).toMatchObject({ id: page.document.id, title: "Movable page" });
  });

  it("validates database configuration and all existing column types without changing ordinary metadata", async () => {
    const f = await fixture();
    const project = await f.store.createProject({ name: "Metadata" });
    expect(
      validateProjectMetadata(project, project.id).database,
    ).toBeUndefined();
    for (const config of [
      null,
      true,
      {},
      { datasetId: "../escape" },
      { datasetId: "CON" },
      { datasetId: "valid", unknown: true },
    ]) {
      expect(() => validateProjectDatabase(config)).toThrow();
      expect(() =>
        validateProjectMetadata({ ...project, database: config }, project.id),
      ).toThrow();
      await expect(
        f.store.updateProject(project.id, { database: config as never }),
      ).rejects.toMatchObject({ code: "INVALID_DATA" });
    }
    const data = {
      columns: ["text", "number", "select", "checkbox", "url", "date"].map(
        (type) => ({ id: type, name: type, type }),
      ),
      rows: [
        {
          id: "page-1",
          text: "Notes",
          number: 4,
          select: "Open",
          checkbox: true,
          url: "https://example.com",
          date: "2026-10-22",
        },
      ],
    };
    expect(validateProjectDatabaseData(data)).toEqual(data);
    expect(() =>
      validateProjectDatabaseData({
        columns: [{ id: "$page-title", name: "Title", type: "text" }],
        rows: [],
      }),
    ).toThrow(/reserved/);
    await expect(
      f.store.updateProject(project.id, { database: { datasetId: "missing" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const value of [
      {},
      { columns: [], rows: {} },
      { columns: [{ id: "x", name: "x", type: "relation" }], rows: [] },
    ])
      expect(() => validateProjectDatabaseData(value)).toThrow();
  });
});
