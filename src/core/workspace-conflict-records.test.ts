import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { WorkspaceProtection } from "./workspace-conflicts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("listed conflict records follow every rewrite of their files, including resolved back to unresolved", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-workspace-conflicts-"));
  roots.push(root);
  const library = new ContentLibrary(root);
  await library.initialize();
  const path = "projects/p/pages/a.json",
    observed = Buffer.from(JSON.stringify({ external: 1 }));
  const states = async () =>
    (await new WorkspaceProtection(library).list()).map((record) => [
      record.id,
      record.state,
    ]);
  const protection = new WorkspaceProtection(library);
  const captured = await protection.capture(path, null, observed, true);
  expect(await states()).toEqual([[captured.id, "unresolved"]]);
  expect(await states()).toEqual([[captured.id, "unresolved"]]);
  await protection.resolve(captured.id, "discard", null);
  expect(await states()).toEqual([[captured.id, "resolved"]]);
  expect(await states()).toEqual([[captured.id, "resolved"]]);
  // The same external bytes on the same base reuse the id of the resolved record.
  const again = await protection.capture(path, null, observed, true);
  expect(again.id).toBe(captured.id);
  expect(await states()).toEqual([[captured.id, "unresolved"]]);
  // An in-place rewrite by another process is seen as well.
  const file = join(root, "local", "conflicts", captured.id, "conflict.json");
  const record = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...record, state: "resolved" }));
  expect(await states()).toEqual([[captured.id, "resolved"]]);
  // Returned records are copies; changing one leaves the next listing intact.
  (await protection.list())[0].state = "unresolved";
  expect(await states()).toEqual([[captured.id, "resolved"]]);
  await writeFile(file, JSON.stringify({ ...record, version: 2 }));
  await expect(protection.list()).rejects.toMatchObject({
    code: "INVALID_DATA",
  });
  await expect(protection.list()).rejects.toMatchObject({
    code: "INVALID_DATA",
  });
  await rm(join(root, "local", "conflicts", captured.id), { recursive: true });
  expect(await states()).toEqual([]);
});
