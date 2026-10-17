import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudState, type ObjectStore } from "./cloud-state";
import { DatabaseSync } from "node:sqlite";
import { withLibraryLock } from "../core/library-lock";
import { ignoreRemoteAgentState } from "../agent-host/remote-state";
const directories: string[] = [];
async function directory() {
  const value = await mkdtemp(join(tmpdir(), "showai-cloud-state-"));
  directories.push(value);
  return value;
}
afterEach(async () => {
  for (const value of directories.splice(0))
    await rm(value, { recursive: true, force: true });
});
async function store(): Promise<ObjectStore & { failHead: boolean }> {
  const root = await directory();
  const result: ObjectStore & { failHead: boolean } = {
    failHead: false,
    async get(key) {
      return readFile(join(root, key)).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
    },
    async put(key, bytes) {
      if (result.failHead && key === "head")
        throw new Error("Storage unavailable");
      await writeFile(join(root, key), bytes);
    },
  };
  return result;
}
test("encrypted checkpoints restore a real SQLite authorization database, artifacts and large files", async () => {
  const root = await directory(),
    objects = await store(),
    key = "a".repeat(64);
  await mkdir(join(root, "auth"));
  const db = new DatabaseSync(join(root, "auth", "authorization.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE grants(token TEXT); INSERT INTO grants VALUES('private-test-token'); PRAGMA wal_checkpoint(TRUNCATE)",
  );
  await writeFile(join(root, "large"), Buffer.alloc(9 * 1024 * 1024, 42));
  const state = new CloudState(root, objects, key);
  await state.save();
  db.close();
  expect(Buffer.from((await objects.get("head"))!).toString()).not.toContain(
    "authorization.sqlite",
  );
  const restored = await directory();
  const progress: [number, number][] = [];
  await new CloudState(restored, objects, key, {
    onRestoreProgress: (completed, total) => progress.push([completed, total]),
  }).restore();
  expect(progress[0]).toEqual([0, 0]);
  expect(progress.at(-1)![0]).toBe(progress.at(-1)![1]);
  expect(progress.at(-1)![1]).toBeGreaterThan(0);
  const reopened = new DatabaseSync(
    join(restored, "auth", "authorization.sqlite"),
  );
  expect(reopened.prepare("SELECT token FROM grants").get()?.token).toBe(
    "private-test-token",
  );
  reopened.close();
  expect((await readFile(join(restored, "large"))).byteLength).toBe(
    9 * 1024 * 1024,
  );
  await expect(
    new CloudState(await directory(), objects, "b".repeat(64)).restore(),
  ).rejects.toThrow();
});
test("Agent checkpoints capture a live WAL database and exclude process locks", async () => {
  const root = await directory(),
    objects = await store(),
    key = "d".repeat(64);
  const db = new DatabaseSync(join(root, "running.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE turns(id INTEGER); INSERT INTO turns VALUES(1)",
  );
  await mkdir(join(root, ".locks"));
  await writeFile(join(root, ".locks", "writer"), "process-local owner");
  const state = new CloudState(root, objects, key, {
    snapshotSqlite: true,
    ignore: (path) => path.startsWith(".locks"),
  });
  await state.save();
  db.exec("INSERT INTO turns VALUES(2)");
  const restored = await directory();
  await new CloudState(restored, objects, key).restore();
  const saved = new DatabaseSync(join(restored, "running.sqlite"));
  expect(
    saved.prepare("SELECT COUNT(*) AS count FROM turns").get()?.count,
  ).toBe(1);
  await expect(
    readFile(join(restored, ".locks", "writer")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  saved.close();
  db.close();
});
test("Agent restore discards legacy live-PID leases and checkpoints exclude held library locks", async () => {
  const root = await directory(),
    objects = await store(),
    key = "e".repeat(64);
  const library = join(root, "library");
  await mkdir(join(library, "local", "leases"), { recursive: true });
  await writeFile(join(library, "content"), "retained project");
  const owner = JSON.stringify({
    pid: process.pid,
    token: "previous-container",
  });
  for (const path of [
    "writer.lock",
    "writer.lock.recover-previous-container",
    "leases/writer-previous-container.json",
  ])
    await writeFile(join(library, "local", path), owner);
  // A previous release saved these leases, and the new container may reuse its PID.
  await new CloudState(root, objects, key).save();
  const restored = await directory();
  const state = new CloudState(restored, objects, key, {
    ignore: ignoreRemoteAgentState,
  });
  await state.restore();
  for (const path of [
    "writer.lock",
    "writer.lock.recover-previous-container",
    "leases/writer-previous-container.json",
  ])
    await expect(
      readFile(join(restored, "library", "local", path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  await state.save((read) => withLibraryLock(join(restored, "library"), read));
  const restarted = await directory();
  // Verify the saved checkpoint itself is clean without relying on a restore filter.
  await new CloudState(restarted, objects, key).restore();
  expect(await readFile(join(restarted, "library", "content"), "utf8")).toBe(
    "retained project",
  );
  await expect(
    readFile(join(restarted, "library", "local", "writer.lock")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
test("network checkpoint uploads release the library lock and retain one immutable capture", async () => {
  const root = await directory(),
    objects = await store(),
    key = "f".repeat(64);
  const library = join(root, "library");
  await mkdir(library);
  await writeFile(join(library, "a"), "before A");
  await writeFile(join(library, "z"), "before Z");
  let uploaded = false;
  const transport: ObjectStore = {
    get: (key) => objects.get(key),
    async put(key, bytes) {
      await expect(
        readFile(join(library, "local", "writer.lock")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      if (!uploaded) {
        uploaded = true;
        await withLibraryLock(library, async () => {
          await writeFile(join(library, "a"), "after A");
          await writeFile(join(library, "z"), "after Z");
        });
      }
      await objects.put(key, bytes);
    },
  };
  const state = new CloudState(root, transport, key, {
    ignore: ignoreRemoteAgentState,
  });
  await state.save((read) => withLibraryLock(library, read));
  const first = await directory();
  await new CloudState(first, objects, key).restore();
  expect(await readFile(join(first, "library", "a"), "utf8")).toBe("before A");
  expect(await readFile(join(first, "library", "z"), "utf8")).toBe("before Z");
  expect(await readFile(join(library, "z"), "utf8")).toBe("after Z");
  await state.save((read) => withLibraryLock(library, read));
  const second = await directory();
  await new CloudState(second, objects, key).restore();
  expect(await readFile(join(second, "library", "a"), "utf8")).toBe("after A");
  expect(await readFile(join(second, "library", "z"), "utf8")).toBe("after Z");
});
test("failed checkpoints never acknowledge success and are retried before a later mutation", async () => {
  const root = await directory(),
    objects = await store(),
    state = new CloudState(root, objects, "c".repeat(64));
  await state.save();
  objects.failHead = true;
  await expect(
    state.run(
      async () => {
        await writeFile(join(root, "draft"), "retained draft");
        return new Response("ok");
      },
      () => {},
    ),
  ).rejects.toThrow("Storage unavailable");
  let executed = false;
  await expect(
    state.run(
      async () => {
        executed = true;
        return new Response();
      },
      () => {},
    ),
  ).rejects.toThrow();
  expect(executed).toBe(false);
  objects.failHead = false;
  await state.run(
    async () => new Response(),
    () => {},
  );
  const restored = await directory();
  await new CloudState(restored, objects, "c".repeat(64)).restore();
  expect(await readFile(join(restored, "draft"), "utf8")).toBe(
    "retained draft",
  );
});
test("unsafe filesystem links and nonempty restore destinations are rejected", async () => {
  const root = await directory(),
    objects = await store(),
    state = new CloudState(root, objects, "d".repeat(64));
  await symlink("/etc", join(root, "escape"));
  await expect(state.save()).rejects.toThrow("symbolic links");
  await expect(state.restore()).rejects.toThrow("empty directory");
});
