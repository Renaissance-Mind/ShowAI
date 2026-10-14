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
  await new CloudState(restored, objects, key).restore();
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
