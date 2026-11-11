import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import { MaintenanceScheduler, setMaintenancePolicy } from "./maintenance-scheduler";
import { BUNDLE_GRACE_MS, bundleDirectory } from "./dataset-bundles";

const clean: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of clean.splice(0).reverse()) await done();
});

test("an idle tick repeats no work while nothing changed, yet still collects copies whose grace ends", async () => {
  const base = process.env.SHOWAI_TEST_ROOT ?? tmpdir();
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "maintenance-scheduler-"));
  clean.push(() => rm(root, { recursive: true }));
  await new ContentLibrary(root).initialize();
  const store = new FileStore(root);
  await store.createProject({ name: "Maintenance" });
  await setMaintenancePolicy(root, { idleMs: 0 });
  const directory = bundleDirectory(root);
  await mkdir(directory, { recursive: true });
  // An unreferenced copy whose grace period ends shortly after the first pass.
  const expiring = "a".repeat(64);
  await writeFile(join(directory, expiring), "copy");
  const modified = new Date(Date.now() - BUNDLE_GRACE_MS + 1500);
  await utimes(join(directory, expiring), modified, modified);
  const scheduler = new MaintenanceScheduler(root, (error) => {
    throw error;
  });
  await scheduler.tick();
  expect(await readdir(directory)).toEqual([expiring]);
  const index = join(root, "index.sqlite");
  // Unchanged: the pass is skipped, so it does not rebuild a removed index.
  await rm(index, { force: true });
  await rm(`${index}-wal`, { force: true });
  await rm(`${index}-shm`, { force: true });
  await scheduler.tick();
  expect(await readdir(root)).not.toContain("index.sqlite");
  // A new stored copy changes the state.
  const old = "b".repeat(64);
  await writeFile(join(directory, old), "copy");
  const past = new Date(Date.now() - 2 * BUNDLE_GRACE_MS);
  await utimes(join(directory, old), past, past);
  await scheduler.tick();
  expect(await readdir(directory)).toEqual([expiring]);
  expect(await readdir(root)).toContain("index.sqlite");
  // Unchanged again, until the first copy outlives its grace period.
  await new Promise((done) => setTimeout(done, 1600));
  await scheduler.tick();
  expect(await readdir(directory)).toEqual([]);
  await scheduler.stop();
});
