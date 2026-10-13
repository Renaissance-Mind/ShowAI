import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnWrites } from "./own-writes";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "showai-own-writes-"));
  roots.push(root);
  return root;
}

it("reports a client's own write once and keeps other paths and clients separate", async () => {
  const root = await directory(),
    page = join(root, "page.json"),
    other = join(root, "other.json");
  await writeFile(page, "saved by window 1");
  await writeFile(other, "unrelated");
  const writes = new OwnWrites();
  await writes.record("1", page);
  const first = await writes.echoes([page, other]);
  expect([...first.keys()]).toEqual(["1"]);
  expect([...first.get("1")!]).toEqual([page]);
  // A later event for the same path is a new change, not the recorded echo.
  expect((await writes.echoes([page])).size).toBe(0);
});

it("treats bytes changed after the save as an external change", async () => {
  const root = await directory(),
    page = join(root, "page.json");
  await writeFile(page, "saved by window 1");
  const writes = new OwnWrites();
  await writes.record("1", page);
  await writeFile(page, "edited by an Agent right afterwards");
  expect((await writes.echoes([page])).size).toBe(0);
});

it("forgets expectations after their lifetime and ignores missing files", async () => {
  const root = await directory(),
    page = join(root, "page.json");
  await writeFile(page, "saved");
  const writes = new OwnWrites(0);
  await writes.record("1", page);
  expect((await writes.echoes([page])).size).toBe(0);
  await writes.record("1", join(root, "missing.json"));
  expect((await writes.echoes([join(root, "missing.json")])).size).toBe(0);
});
