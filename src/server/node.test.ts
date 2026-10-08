import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskObjects } from "./node";
import { hash } from "../sync/protocol";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("disk object storage", () => {
  it("writes and replaces objects without stray directories or temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "showai-disk-objects-"));
    fixtures.push(root);
    const store = new DiskObjects(root);
    const bytes = Buffer.from("Object upload on the host filesystem.");
    const name = await hash(bytes);
    const key = `projects/example/objects/${name}`;
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    expect(await readdir(join(root, "projects/example/objects"))).toEqual([
      name,
    ]);
  });
});
