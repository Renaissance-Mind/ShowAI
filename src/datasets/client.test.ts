import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { FileStore } from "../core/store";
import { DatasetStore } from "../core/datasets";
import { initializeProjectDatabase } from "../core/create-database-project";
import { mutateLibrary } from "../core/library-runtime";
import { validateProjectDatabaseData } from "../core/project-database";
import { syncManager } from "../sync/manager";
import { databaseCellOperations } from "../studio/project-database-view";
import {
  handleDatasetAction,
  datasetMutationActions,
} from "../workbench/dataset-actions";
import {
  DatasetClient,
  type DatasetSession,
  type DatasetTransport,
} from "./client";
import { valueAt } from "./operations.mjs";

let root: string;
let store: FileStore;
let projectId: string;
let datasetId: string;

const transport = {
  invoke: <T>(action: string, args: Record<string, unknown> = {}) =>
    (datasetMutationActions.has(action)
      ? mutateLibrary(root, () => handleDatasetAction(store, action, args))
      : handleDatasetAction(store, action, args)) as Promise<T>,
};
const plan = {
  objectives: [
    {
      id: "o1",
      title: "发布",
      keyResults: [
        {
          id: "k1",
          title: "文档",
          tasks: [
            { id: "t1", title: "写指南", due: "2026-10-22" },
            { id: "t2", title: "审稿" },
          ],
        },
      ],
    },
  ],
};
const task = (id: string, field: string) => [
  "objectives",
  { id: "o1" },
  "keyResults",
  { id: "k1" },
  "tasks",
  { id },
  field,
];
const ready = async (session: DatasetSession) => {
  await session.load();
  expect(session.getSnapshot().status).toBe("ready");
  return session;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Pause a real GET after it has read SQLite, allowing another write to commit. */
function gatedTransport(datasetId: string) {
  const queued: {
    captured: ReturnType<typeof deferred<unknown>>;
    released: ReturnType<typeof deferred<void>>;
  }[] = [];
  const transportWithGates: DatasetTransport = {
    async invoke<T>(action: string, args: Record<string, unknown> = {}) {
      const gate =
        action === "datasets:get" && args.datasetId === datasetId
          ? queued.shift()
          : undefined;
      const result = await transport.invoke<T>(action, args);
      if (gate) {
        gate.captured.resolve(result);
        await gate.released.promise;
      }
      return result;
    },
  };
  return {
    transport: transportWithGates,
    nextGet() {
      const gate = {
        captured: deferred<unknown>(),
        released: deferred<void>(),
      };
      queued.push(gate);
      return {
        captured: gate.captured.promise,
        release: () => gate.released.resolve(),
      };
    },
  };
}

async function databaseProject() {
  return mutateLibrary(root, async () => {
    const project = await store.createProject({ name: "刷新验证" });
    return initializeProjectDatabase(store, project.id);
  });
}

async function editNewRecord(
  session: DatasetSession,
  projectId: string,
  datasetId: string,
  pageId: string,
) {
  const data = validateProjectDatabaseData(session.getSnapshot().value);
  expect(data.rows).toContainEqual({ id: pageId });
  session.edit(
    databaseCellOperations(data, pageId, "status", "进行中", undefined),
  );
  expect(await session.flush()).toBe(true);
  expect(session.getSnapshot().conflicts).toEqual([]);
  const saved = await new DatasetStore(store).read(projectId, datasetId);
  expect(validateProjectDatabaseData(saved.dataset.value).rows).toContainEqual({
    id: pageId,
    status: "进行中",
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-dataset-client-"));
  await openLibrary(root);
  store = new FileStore(root);
  projectId = (
    await mutateLibrary(root, () => store.createProject({ name: "管理台" }))
  ).id;
  datasetId = (
    await mutateLibrary(root, () =>
      new DatasetStore(store).create(projectId, { name: "OKR", value: plan }),
    )
  ).dataset.id;
});
afterAll(async () => {
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

test("two windows edit different records and both see the merged value", async () => {
  const a = await ready(
    new DatasetClient(transport, "window-a").session(projectId, datasetId),
  );
  const b = await ready(
    new DatasetClient(transport, "window-b").session(projectId, datasetId),
  );
  a.edit([
    {
      op: "set",
      path: task("t1", "due"),
      value: "2026-10-24",
      before: "2026-10-22",
    },
  ]);
  b.edit([{ op: "set", path: task("t2", "done"), value: true, absent: true }]);
  expect(await a.flush()).toBe(true);
  expect(await b.flush()).toBe(true);
  await a.refresh();
  for (const session of [a, b]) {
    expect(valueAt(session.getSnapshot().value, task("t1", "due"))).toBe(
      "2026-10-24",
    );
    expect(valueAt(session.getSnapshot().value, task("t2", "done"))).toBe(true);
  }
});

test("a field changed in two windows is held with both values until chosen", async () => {
  const a = await ready(
    new DatasetClient(transport, "window-c").session(projectId, datasetId),
  );
  const b = await ready(
    new DatasetClient(transport, "window-d").session(projectId, datasetId),
  );
  a.edit([
    {
      op: "set",
      path: task("t1", "title"),
      value: "写使用指南",
      before: "写指南",
    },
  ]);
  b.edit([
    {
      op: "set",
      path: task("t1", "title"),
      value: "改写指南",
      before: "写指南",
    },
  ]);
  b.edit([
    { op: "set", path: task("t2", "title"), value: "终审", before: "审稿" },
  ]);
  expect(await a.flush()).toBe(true);
  expect(await b.flush()).toBe(false);
  const held = b.getSnapshot().conflicts;
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({ mine: "改写指南", theirs: "写使用指南" });
  // The other change of the same window was merged and saved.
  const saved = await new DatasetStore(store).read(projectId, datasetId);
  expect(valueAt(saved.dataset.value, task("t2", "title"))).toBe("终审");
  expect(valueAt(saved.dataset.value, task("t1", "title"))).toBe("写使用指南");
  // The held version survives a reload of the window.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const reloaded = await ready(
    new DatasetClient(transport, "window-d").session(projectId, datasetId),
  );
  expect(reloaded.getSnapshot().conflicts).toHaveLength(1);
  reloaded.resolve(reloaded.getSnapshot().conflicts[0].id, "mine");
  expect(await reloaded.flush()).toBe(true);
  await a.refresh();
  expect(valueAt(a.getSnapshot().value, task("t1", "title"))).toBe("改写指南");
});

test("unsaved writes are restored in the same window and offered to others", async () => {
  const first = await ready(
    new DatasetClient(transport, "window-e").session(projectId, datasetId),
  );
  first.edit([
    {
      op: "insert",
      path: ["objectives", { id: "o1" }, "keyResults", { id: "k1" }, "tasks"],
      value: { id: "t3", title: "发布说明" },
    },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  // The window closes before saving; its draft remains.
  const again = await ready(
    new DatasetClient(transport, "window-e").session(projectId, datasetId),
  );
  expect(valueAt(again.getSnapshot().value, task("t3", "title"))).toBe(
    "发布说明",
  );
  const other = await ready(
    new DatasetClient(transport, "window-f").session(projectId, datasetId),
  );
  expect(other.getSnapshot().recovered.map((draft) => draft.clientId)).toEqual([
    "window-e",
  ]);
  expect(await again.flush()).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = await ready(
    new DatasetClient(transport, "window-g").session(projectId, datasetId),
  );
  expect(after.getSnapshot().recovered).toEqual([]);
});

test("undo writes back the previous value and does not override newer edits elsewhere", async () => {
  const a = await ready(
    new DatasetClient(transport, "window-h").session(projectId, datasetId),
  );
  const before = valueAt(a.getSnapshot().value, task("t1", "due"));
  a.edit([{ op: "set", path: task("t1", "due"), value: "2026-11-01", before }]);
  expect(await a.flush()).toBe(true);
  expect(a.undo()).toBe(true);
  expect(await a.flush()).toBe(true);
  expect(
    valueAt(
      (await new DatasetStore(store).read(projectId, datasetId)).dataset.value,
      task("t1", "due"),
    ),
  ).toBe(before);
  // Redo after someone else changed the field is a held conflict, not an overwrite.
  const b = await ready(
    new DatasetClient(transport, "window-i").session(projectId, datasetId),
  );
  b.edit([{ op: "set", path: task("t1", "due"), value: "2026-12-01", before }]);
  expect(await b.flush()).toBe(true);
  await a.refresh();
  a.redo();
  expect(a.getSnapshot().conflicts).toHaveLength(1);
  expect(
    valueAt(
      (await new DatasetStore(store).read(projectId, datasetId)).dataset.value,
      task("t1", "due"),
    ),
  ).toBe("2026-12-01");
});

test("closing names shared data whose writes can be neither saved nor kept", async () => {
  // The library refuses writes (for example a read-only or full disk).
  let refuse = false;
  const failing = {
    invoke: <T>(action: string, args: Record<string, unknown> = {}) => {
      if (
        refuse &&
        (action === "datasets:apply" || action === "datasets:draftSave")
      )
        return Promise.reject(
          Object.assign(new Error(`${action} refused: EROFS`), {
            code: "INVALID_DATA",
          }),
        );
      return transport.invoke<T>(action, args);
    },
  };
  const client = new DatasetClient(failing, "window-close");
  const session = await ready(client.session(projectId, datasetId));
  expect(await client.closeProblems()).toEqual([]);
  refuse = true;
  const before = valueAt(session.getSnapshot().value, task("t2", "title"));
  session.edit([
    { op: "set", path: task("t2", "title"), value: "终稿", before },
  ]);
  const problems = await client.closeProblems();
  expect(problems).toEqual([
    {
      projectId,
      datasetId,
      name: "OKR",
      draftError: "datasets:draftSave refused: EROFS",
      saveError: "datasets:apply refused: EROFS",
      conflicts: 0,
    },
  ]);
  expect(await client.prepareClose()).toBe(false);
  refuse = false;
  expect(await client.closeProblems()).toEqual([]);
});

test("concurrent refreshes all wait for a follow-up read after a new record commits", async () => {
  const project = await databaseProject();
  const datasetId = project.database!.datasetId;
  const gated = gatedTransport(datasetId);
  const client = new DatasetClient(gated.transport, "refresh-follow-up");
  const session = await ready(client.session(project.id, datasetId));
  // Make the first GET return a full, older record rather than an unchanged token.
  await mutateLibrary(root, () =>
    new DatasetStore(store).apply(project.id, datasetId, {
      operations: [
        {
          op: "set",
          path: ["columns", { id: "status" }, "name"],
          value: "进度",
        },
      ],
    }),
  );
  const stale = gated.nextGet();
  let followUp: ReturnType<typeof gated.nextGet> | undefined;
  const pending: Promise<void>[] = [];
  try {
    let firstSettled = false;
    const first = session.refresh().then(() => {
      firstSettled = true;
    });
    pending.push(first);
    expect(await stale.captured).toMatchObject({
      dataset: { value: { rows: [] } },
    });
    session.edit([
      {
        op: "set",
        path: ["columns", { id: "date" }, "name"],
        value: "截止日期",
        before: "日期",
      },
    ]);
    const page = await mutateLibrary(root, () =>
      store.createPage(project.id, { title: "刷新期间创建" }),
    );
    followUp = gated.nextGet();
    let secondSettled = false;
    const second = session.refresh().then(() => {
      secondSettled = true;
    });
    pending.push(second);
    stale.release();
    expect(
      await Promise.race([
        second.then(() => "resolved"),
        followUp.captured.then(() => "read"),
      ]),
    ).toBe("read");
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);
    followUp.release();
    await Promise.all(pending);
    expect(
      validateProjectDatabaseData(session.getSnapshot().value).columns[0].name,
    ).toBe("进度");
    expect(
      validateProjectDatabaseData(session.getSnapshot().value).columns[1].name,
    ).toBe("截止日期");
    await editNewRecord(session, project.id, datasetId, page.document.id);
    expect(
      validateProjectDatabaseData(
        (await new DatasetStore(store).read(project.id, datasetId)).dataset
          .value,
      ).columns[1].name,
    ).toBe("截止日期");
  } finally {
    stale.release();
    followUp?.release();
    await Promise.all(pending);
    await client.prepareClose();
  }
});

test("refresh during initial loading reads again before allowing a new record edit", async () => {
  const project = await databaseProject();
  const datasetId = project.database!.datasetId;
  const gated = gatedTransport(datasetId);
  const initial = gated.nextGet();
  const client = new DatasetClient(gated.transport, "refresh-during-load");
  const session = client.session(project.id, datasetId);
  let followUp: ReturnType<typeof gated.nextGet> | undefined;
  let refreshing: Promise<void> | undefined;
  try {
    expect(await initial.captured).toMatchObject({
      dataset: { value: { rows: [] } },
    });
    const page = await mutateLibrary(root, () =>
      store.createPage(project.id, { title: "加载期间创建" }),
    );
    followUp = gated.nextGet();
    let settled = false;
    refreshing = session.refresh().then(() => {
      settled = true;
    });
    initial.release();
    expect(
      await Promise.race([
        refreshing.then(() => "resolved"),
        followUp.captured.then(() => "read"),
      ]),
    ).toBe("read");
    expect(settled).toBe(false);
    followUp.release();
    await refreshing;
    await editNewRecord(session, project.id, datasetId, page.document.id);
  } finally {
    initial.release();
    followUp?.release();
    await refreshing;
    await client.prepareClose();
  }
});
