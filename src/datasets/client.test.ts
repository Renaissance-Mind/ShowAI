import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { FileStore } from "../core/store";
import { DatasetStore } from "../core/datasets";
import { mutateLibrary } from "../core/library-runtime";
import { syncManager } from "../sync/manager";
import {
  handleDatasetAction,
  datasetMutationActions,
} from "../workbench/dataset-actions";
import { DatasetClient, type DatasetSession } from "./client";
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
