import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteLibrary } from "./sqlite-library";
import { ContentLibrary } from "./content-library";
import { scanWorkspaceResources } from "./package-recovery";
import { withLibraryLock } from "./library-lock";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("lets interactive reads acquire the lease between conflict scan batches", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-scan-scheduling-"));
  roots.push(root);
  const store = new SqliteLibrary(root);
  await store.initialize();
  const paths = Array.from(
    { length: 64 },
    (_, i) => `packages/components/chart/1.0.0/source-${i}.ts`,
  );
  await store.writeFiles(
    new Map(
      paths.map((path) => [path, Buffer.from("export const value = 1;")]),
    ),
    { actor: { kind: "human" }, channel: "desktop" },
  );
  for (const path of paths)
    await writeFile(join(root, "workspace", path), "export const value = 2;");
  await mkdir(join(root, "local"), { recursive: true });
  let finished = false,
    readBeforeFinished = false;
  const scan = scanWorkspaceResources(new ContentLibrary(root)).then(
    (found) => {
      finished = true;
      return found;
    },
  );
  try {
    const deadline = Date.now() + 10000;
    while (
      !(await access(join(root, "local/writer.lock")).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ))
    ) {
      if (Date.now() > deadline)
        throw new Error("The real scan never acquired its first batch lease");
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await withLibraryLock(root, async () => {
      readBeforeFinished = !finished;
      expect((await store.readFile(paths[0])).toString()).toContain(
        "value = 1",
      );
    });
  } finally {
    await scan;
  }
  expect(readBeforeFinished).toBe(true);
  expect(await scan).toHaveLength(paths.length);
}, 30000);
