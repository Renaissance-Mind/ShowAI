import { expect, it } from "vitest";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { watchLibrary } from "./library-watcher";

it("delivers settled nested writes, renames and deletions, then releases the watcher", async () => {
  const output =
    process.env.SHOWAI_TEST_OUTPUT_ROOT ??
    join(homedir(), "ShowAI-Development/development/tests");
  await mkdir(output, { recursive: true });
  const root = await mkdtemp(join(output, "library-watch-"));
  const folder = join(root, "project/pages");
  await mkdir(folder, { recursive: true });
  const watcher = watchLibrary(root, (path) => path.endsWith(".tmp"));
  const events: string[] = [],
    errors: unknown[] = [];
  watcher.on("all", (_event, path) => events.push(path));
  watcher.on("error", (error) => errors.push(error));
  const wait = async (path: string) => {
    const deadline = Date.now() + 5000;
    while (!events.includes(path) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errors).toEqual([]);
    expect(events).toContain(path);
    events.length = 0;
  };
  try {
    await new Promise<void>((resolve) => watcher.once("ready", resolve));
    const file = join(folder, "page.json"),
      moved = join(folder, "renamed.json");
    await writeFile(file, "first");
    await wait(file);
    await writeFile(file, "a longer update");
    await wait(file);
    await rename(file, moved);
    await wait(moved);
    await rm(moved);
    await wait(moved);
    await writeFile(join(folder, "ignored.tmp"), "temporary");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events.some((path) => path.endsWith(".tmp"))).toBe(false);
    await watcher.close();
    events.length = 0;
    await writeFile(file, "after close");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events).toEqual([]);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
