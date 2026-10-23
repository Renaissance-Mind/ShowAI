import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FileStore } from "./store";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0))
    await rm(home, { recursive: true, force: true });
});

it("lists readable projects and reports a damaged one by directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-project-scan-"));
  homes.push(home);
  const store = new FileStore(home);
  const good = await store.createProject({ name: "Readable" });
  const broken = await store.createProject({ name: "Damaged" });
  await writeFile(
    join(store.projectPath(broken.id), "project.json"),
    "{ not json",
  );
  const scan = await store.scanProjects();
  expect(scan.projects.map((project) => project.id)).toEqual([good.id]);
  expect(scan.unreadable).toHaveLength(1);
  expect(scan.unreadable[0]).toMatchObject({
    directory: broken.id,
    path: store.projectPath(broken.id),
  });
  expect(scan.unreadable[0].message).toBeTruthy();
  // Callers that need every project still see the failure.
  await expect(store.listProjects()).rejects.toThrow();
  expect(
    (await store.scanProjects({ projectIds: [good.id] })).unreadable,
  ).toEqual([]);
});
