import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import {
  DatasetStore,
  mergeDatasetVersions,
  validateDataset,
  type DatasetDocument,
} from "./datasets";
import { watchDatasetSources } from "./dataset-sources";
import { datasetDependents } from "./dataset-dependents";
import { changedResources } from "./change-notification";
import { CoreError } from "./model";

const directories: string[] = [];
async function library() {
  const root = await mkdtemp(join(tmpdir(), "showai-transforms-"));
  directories.push(root);
  const store = new FileStore(root);
  const projectId = (await store.createProject({ name: "处理脚本" })).id;
  return { root, store, projectId, datasets: new DatasetStore(store) };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const sum = `function transform({ numbers }) {
  return { total: numbers.list.reduce((a, b) => a + b, 0) };
}`;

describe("transform datasets", () => {
  it("run once per change of an input or the script", async () => {
    const { projectId, datasets } = await library();
    await datasets.create(projectId, {
      id: "numbers",
      name: "数字",
      value: { list: [1, 2, 3] },
    });
    const created = await datasets.defineTransform(projectId, {
      id: "total",
      name: "合计",
      inputs: { numbers: "numbers" },
      script: sum,
    });
    expect(created).toMatchObject({
      created: true,
      record: {
        status: "ok",
        editable: false,
        dataset: { value: { total: 6 } },
      },
    });
    const first = await datasets.read(projectId, "total");
    expect(first.transform).toMatchObject({
      inputs: { numbers: { datasetId: "numbers", status: "ok" } },
    });
    expect(typeof first.transform!.lastRunMs).toBe("number");
    // Unchanged inputs reuse the run.
    const again = await datasets.read(projectId, "total");
    expect(again.transform!.ranAt).toBe(first.transform!.ranAt);
    expect(again.hash).toBe(first.hash);
    const input = await datasets.read(projectId, "numbers");
    await datasets.apply(projectId, "numbers", {
      baseHash: input.hash,
      operations: [{ op: "set", path: ["list"], value: [10, 20] }],
    });
    const changed = await datasets.read(projectId, "total");
    expect(changed.dataset.value).toEqual({ total: 30 });
    expect(changed.transform!.ranAt).not.toBe(first.transform!.ranAt);
    // A new process reuses the cached output of the same inputs and script.
    const fresh = await new DatasetStore(new FileStore(datasets.root)).read(
      projectId,
      "total",
    );
    expect(fresh.transform!.ranAt).toBe(changed.transform!.ranAt);
    // Writing the output is refused; renaming changes only the definition.
    await expect(
      datasets.apply(projectId, "total", {
        baseHash: changed.hash,
        operations: [{ op: "set", path: ["total"], value: 1 }],
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    const renamed = await datasets.apply(projectId, "total", {
      baseHash: changed.hash,
      operations: [],
      name: "总数",
    });
    expect(renamed.record).toMatchObject({
      dataset: { name: "总数", value: { total: 30 } },
      transform: { scriptHash: changed.transform!.scriptHash },
    });
  });

  it("refuse cycles when defined and report them when read", async () => {
    const { store, projectId, datasets } = await library();
    await datasets.create(projectId, { id: "a", name: "A", value: [1] });
    await datasets.defineTransform(projectId, {
      id: "t1",
      name: "T1",
      inputs: { a: "a" },
      script: "function transform({ a }) { return a; }",
    });
    await datasets.defineTransform(projectId, {
      id: "t2",
      name: "T2",
      inputs: { t1: "t1" },
      script: "function transform({ t1 }) { return t1.concat(2); }",
    });
    const t1 = await datasets.read(projectId, "t1");
    await expect(
      datasets.defineTransform(projectId, {
        datasetId: "t1",
        baseHash: t1.hash,
        inputs: { t2: "t2" },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_DATA",
      message: expect.stringContaining("cycle"),
    });
    await expect(
      datasets.defineTransform(projectId, {
        id: "t3",
        name: "T3",
        inputs: { gone: "missing" },
        script: "function transform() { return 1; }",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    // A synchronized definition can still close a cycle; reads report it.
    const path = datasets.path(projectId, "t1");
    const stored = JSON.parse(await readFile(path, "utf8")) as DatasetDocument;
    stored.transform!.inputs = { t2: "t2" };
    await writeFile(path, JSON.stringify(stored));
    // t2 is computed from t1's last good output, marked stale.
    const stale = await datasets.read(projectId, "t2");
    expect(stale).toMatchObject({
      status: "stale",
      editable: false,
      dataset: { value: [1, 2] },
    });
    expect(stale.warnings[0]).toMatchObject({
      code: "TRANSFORM_FAILED",
      stage: "transform",
    });
    expect(
      stale.warnings.map((warning) => warning.message).join(" "),
    ).toContain("cycle");
    // Without last good outputs there is no value.
    await datasets.cache.remove(projectId, "t1");
    await datasets.cache.remove(projectId, "t2");
    const error = await datasets
      .read(projectId, "t2")
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(CoreError);
    expect(error.code).toBe("SOURCE_UNAVAILABLE");
    expect(error.details.warnings[0].message).toContain("cycle");
    const [t2] = (await datasets.list(projectId)).filter(
      (item) => item.id === "t2",
    );
    expect(t2).toMatchObject({ status: "empty", editable: false });
    expect(t2.warnings[0].code).toBe("TRANSFORM_FAILED");
    expect(store.root).toBe(datasets.root);
  });

  it("block deleting an input and merge definitions in sync", async () => {
    const { projectId, datasets } = await library();
    const input = await datasets.create(projectId, {
      id: "numbers",
      name: "数字",
      value: { list: [1] },
    });
    await datasets.defineTransform(projectId, {
      id: "total",
      name: "合计",
      inputs: { numbers: "numbers" },
      script: sum,
    });
    await expect(
      datasets.remove(projectId, "numbers", { baseHash: input.hash }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { transforms: [`${projectId}/total`] },
    });
    const base = validateDataset(
      JSON.parse(await readFile(datasets.path(projectId, "total"), "utf8")),
    );
    const local = {
      ...base,
      transform: { ...base.transform!, script: `${sum}\n// local` },
    };
    const remote = { ...base, name: "合计（远端）" };
    const merged = mergeDatasetVersions(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(merged.dataset).toMatchObject({
      name: "合计（远端）",
      transform: { script: `${sum}\n// local` },
    });
    expect(merged.dataset.value).toBeUndefined();
    const both = mergeDatasetVersions(base, local, {
      ...base,
      transform: { ...base.transform!, script: `${sum}\n// remote` },
    });
    expect(both.conflicts[0].path).toEqual(["$transform"]);
  });
});

describe("change propagation", () => {
  it("names transforms computed from a changed dataset", async () => {
    const { root, store, projectId, datasets } = await library();
    await datasets.create(projectId, { id: "a", name: "A", value: [1] });
    await datasets.create(projectId, { id: "b", name: "B", value: [2] });
    await datasets.defineTransform(projectId, {
      id: "t1",
      name: "T1",
      inputs: { a: "a" },
      script: "function transform({ a }) { return a; }",
    });
    expect(await datasetDependents(store, [`${projectId}/a`])).toEqual([
      `${projectId}/t1`,
    ]);
    // A transform defined later is found from the change that wrote it.
    await datasets.defineTransform(projectId, {
      id: "t2",
      name: "T2",
      inputs: { t1: "t1", b: "b" },
      script: "function transform({ t1, b }) { return t1.concat(b); }",
    });
    const written = changedResources(root, [
      datasets.path(projectId, "t2"),
    ]).datasets!;
    expect(written).toEqual([`${projectId}/t2`]);
    expect(await datasetDependents(store, written)).toEqual([]);
    expect((await datasetDependents(store, [`${projectId}/a`])).sort()).toEqual(
      [`${projectId}/t1`, `${projectId}/t2`],
    );
    expect(await datasetDependents(store, [`${projectId}/b`])).toEqual([
      `${projectId}/t2`,
    ]);
    expect((await datasetDependents(store, [`${projectId}/*`])).sort()).toEqual(
      [`${projectId}/t1`, `${projectId}/t2`],
    );
  });

  it("refreshes transforms when a linked file changes", async () => {
    const { root, projectId, datasets } = await library();
    const outside = await mkdtemp(join(tmpdir(), "showai-transform-files-"));
    directories.push(outside);
    const path = join(outside, "scores.csv");
    await writeFile(path, "id,score\nr1,3\nr2,4\n");
    const linked = await datasets.link(projectId, {
      id: "scores",
      name: "成绩",
      path,
    });
    await datasets.defineTransform(projectId, {
      id: "best",
      name: "最高分",
      inputs: { scores: linked.dataset.id },
      script:
        "function transform({ scores }) { return { best: Math.max(...scores.rows.map((row) => row.score)) }; }",
    });
    expect((await datasets.read(projectId, "best")).dataset.value).toEqual({
      best: 4,
    });
    const changes: string[][] = [];
    const watcher = watchDatasetSources(root, (keys) => changes.push(keys));
    try {
      await new Promise((done) => setTimeout(done, 400));
      await writeFile(path, "id,score\nr1,3\nr2,9\n");
      await expect
        .poll(() => changes.flat().sort(), { timeout: 5000 })
        .toEqual([`${projectId}/best`, `${projectId}/scores`]);
    } finally {
      await watcher.close();
    }
    expect((await datasets.read(projectId, "best")).dataset.value).toEqual({
      best: 9,
    });
  });
});
