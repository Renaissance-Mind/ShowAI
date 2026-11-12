import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncManager } from "./manager";
import { startSyncServer } from "../server/node";
import { ContentLibrary as GitLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { withChangeContext } from "../core/history-context";
import { DatasetStore } from "../core/datasets";
import { bundlePath, readPackaging } from "../core/dataset-bundles";
import { logicalPath } from "../core/library-runtime";
import {
  bundledResource,
  setSyncPackaging,
  syncPackagingPlan,
} from "../core/packaging";
import { AgentService } from "../agent/service";
import { localFileRef } from "../document/local-files.mjs";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const actions: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of actions.splice(0).reverse()) await action();
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const asAgent = <T>(action: () => Promise<T>) =>
  withChangeContext(
    {
      actor: { kind: "agent", harness: "codex", sessionId: "bundles-test" },
      channel: "cli",
      message: "Bundles test",
    },
    action,
  );

/** Two devices with their own libraries and a project shared through a real sync server. */
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "showai-bundles-"));
  actions.push(() => rm(directory, { recursive: true, force: true }));
  const server = await startSyncServer({
    home: join(directory, "server"),
    port: 0,
    registrationMode: "open",
  });
  actions.push(() => server.close());
  const clients = [];
  for (const name of ["Alice", "Bob"]) {
    const home = join(directory, name),
      library = new GitLibrary(home);
    await library.initialize();
    const store = new FileStore(home),
      manager = new SyncManager(home);
    actions.push(async () => manager.stop());
    const connection = await manager.connect({
      url: server.url,
      account: `${name}-${crypto.randomUUID()}`,
      password: "test-password",
      register: true,
    });
    await manager.stop();
    clients.push({ home, library, store, manager, connection });
  }
  const [alice, bob] = clients;
  const project = await alice.store.createProject({ name: "Shared files" });
  // Alice's files live outside her library, where only her device sees them.
  const files = join(directory, "alice-files");
  const csv = join(files, "schedule.csv");
  const image = join(files, "photo.png");
  await mkdir(files, { recursive: true });
  await writeFile(csv, "id,title\nm1,体检\n");
  await writeFile(image, png);
  const datasetId = (
    await asAgent(() =>
      new DatasetStore(alice.store).link(project.id, {
        name: "日程",
        path: csv,
      }),
    )
  ).dataset.id;
  await asAgent(() =>
    new AgentService({ root: alice.home }).createPage(project.id, {
      title: "Photo",
      blocks: [{ kind: "image", data: { src: localFileRef(image), alt: "" } }],
    }),
  );
  await alice.manager.attach(alice.connection.id, project.id);
  await alice.manager.stop();
  const invitation = (await alice.manager.manage(
    alice.connection.id,
    project.id,
    "invite",
    { role: "editor" },
  )) as { url: string };
  await bob.manager.join(bob.connection.id, invitation.url);
  await bob.manager.stop();
  return { alice, bob, project, datasetId, csv, image };
}

it("carries copies of linked files to other devices and writes their edits back", async () => {
  const { alice, bob, project, datasetId, csv, image } = await fixture();
  await alice.manager.run(project.id);
  const aliceData = new DatasetStore(alice.store);
  const shared = (await aliceData.definition(project.id, datasetId)).source;
  const first = sha(await readFile(csv));
  expect(shared).toMatchObject({
    kind: "file",
    bundle: { sync: true, hash: first, base: first },
  });
  // Copies synchronize without entering history.
  expect(logicalPath(alice.home, bundlePath(alice.home, first))).toBeUndefined();
  const tree = await alice.library.tree((await alice.library.head())!);
  expect(tree.some((entry) => entry.path.startsWith("bundles/"))).toBe(false);
  expect(
    tree.some(
      (entry) => entry.path === `projects/${project.id}/packaging.json`,
    ),
  ).toBe(true);

  await bob.manager.run(project.id);
  const bobData = new DatasetStore(bob.store);
  const received = await bobData.read(project.id, datasetId);
  expect(received).toMatchObject({
    status: "ok",
    editable: true,
    bundled: { hash: first, format: "csv" },
    warnings: [],
  });
  expect(received.external).toBeUndefined();
  expect(received.dataset.value).toEqual({
    columns: ["id", "title"],
    rows: [{ id: "m1", title: "体检" }],
  });
  // The image shows Bob the copy of Alice's file.
  const copy = await bundledResource(bob.store, localFileRef(image));
  expect(copy && (await readFile(copy.path))).toEqual(png);

  // Bob edits the copy; Alice's file receives the edit.
  await asAgent(() =>
    bobData.apply(project.id, datasetId, {
      baseHash: received.hash,
      operations: [{ op: "set", path: "rows[id=m1].title", value: "复查" }],
    }),
  );
  await bob.manager.run(project.id);
  await alice.manager.run(project.id);
  expect(await readFile(csv, "utf8")).toBe("id,title\nm1,复查\n");
  expect((await aliceData.read(project.id, datasetId)).warnings).toEqual([]);

  // Both change at once: Alice keeps her file and sees the conflict.
  await writeFile(csv, "id,title\nm1,本机修改\n");
  const before = await bobData.read(project.id, datasetId);
  await asAgent(() =>
    bobData.apply(project.id, datasetId, {
      baseHash: before.hash,
      operations: [
        { op: "set", path: "rows[id=m1].title", value: "另一台修改" },
      ],
    }),
  );
  await bob.manager.run(project.id);
  await alice.manager.run(project.id);
  expect(await readFile(csv, "utf8")).toBe("id,title\nm1,本机修改\n");
  const conflicted = await aliceData.read(project.id, datasetId);
  expect(conflicted.warnings).toEqual([
    expect.objectContaining({
      code: "WRITE_CONFLICT",
      actions: ["retry", "open-file"],
    }),
  ]);
  // Combining both in the file ends the conflict and shares the result.
  await writeFile(csv, "id,title\nm1,本机修改 / 另一台修改\n");
  await alice.manager.run(project.id);
  expect((await aliceData.read(project.id, datasetId)).warnings).toEqual([]);
  await bob.manager.run(project.id);
  expect(
    (await bobData.read(project.id, datasetId)).dataset.value,
  ).toMatchObject({ rows: [{ title: "本机修改 / 另一台修改" }] });
});

it("leaves files out when the person chooses, and other devices say so", async () => {
  const { alice, bob, project, datasetId, image } = await fixture();
  await alice.manager.run(project.id);
  await bob.manager.run(project.id);
  const bobData = new DatasetStore(bob.store);
  expect((await bobData.read(project.id, datasetId)).status).toBe("ok");

  const plan = await syncPackagingPlan(alice.store, project.id);
  expect(plan).toMatchObject({ purpose: "sync", confirm: true });
  const items = Object.fromEntries(plan.items.map((item) => [item.kind, item]));
  expect(items["file-dataset"]).toMatchObject({
    id: `dataset:${project.id}/${datasetId}`,
    choices: ["bundle", "skip"],
    choice: "bundle",
    available: true,
  });
  expect(items["file-resource"]).toMatchObject({
    id: localFileRef(image),
    bytes: png.length,
    choice: "bundle",
  });
  // Bob's plan lists the copy he received (both devices share one disk here,
  // so only the dataset, linked per device, shows it).
  expect(
    (await syncPackagingPlan(bob.store, project.id)).items.find(
      (item) => item.kind === "file-dataset",
    ),
  ).toMatchObject({ bundled: true, available: true });
  expect(
    (await syncPackagingPlan(bob.store, project.id)).items.find(
      (item) => item.kind === "file-dataset",
    )?.path,
  ).toBeUndefined();
  const after = await asAgent(() =>
    setSyncPackaging(alice.store, project.id, {
      [items["file-dataset"].id]: "skip",
      [items["file-resource"].id]: "skip",
    }),
  );
  expect(after.items.map((item) => item.choice)).toEqual(["skip", "skip"]);
  expect(
    (await new DatasetStore(alice.store).definition(project.id, datasetId))
      .source,
  ).toMatchObject({ bundle: { sync: false } });
  expect(
    (await readPackaging(alice.store, project.id)).resources[
      localFileRef(image)
    ],
  ).toEqual({ sync: false });
  await alice.manager.run(project.id);
  await bob.manager.run(project.id);
  // Bob keeps the value he read last, marked stale and not bundled.
  const stale = await bobData.read(project.id, datasetId);
  expect(stale.status).toBe("stale");
  expect(stale.warnings[0]).toMatchObject({
    code: "NOT_BUNDLED",
    actions: ["link-file"],
  });
  // Without that value the dataset has no data on Bob's device.
  await rm(join(bob.home, "local", "dataset-cache"), {
    recursive: true,
    force: true,
  });
  await expect(bobData.read(project.id, datasetId)).rejects.toMatchObject({
    code: "SOURCE_UNAVAILABLE",
    details: { reason: "NOT_BUNDLED" },
  });
  expect(await bundledResource(bob.store, localFileRef(image))).toBeUndefined();
});
