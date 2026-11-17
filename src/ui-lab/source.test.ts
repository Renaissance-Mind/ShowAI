import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { sourceIdentity } from "./source";

test("source identity follows rendered files through staging and commits", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-ui-source-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const commit = () =>
    git(
      "-c",
      "user.name=UI Lab Test",
      "-c",
      "user.email=ui-lab@example.test",
      "commit",
      "-qm",
      "test: record source",
    );
  try {
    git("init", "-q");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/app.ts"), "export const state = 1;\n");
    git("add", "src/app.ts");
    commit();
    const first = sourceIdentity(root);
    await writeFile(
      join(root, "src/flow.ts"),
      "export const node = 'setup';\n",
    );
    const added = sourceIdentity(root);
    expect(added.hash).not.toBe(first.hash);
    git("add", "src/flow.ts");
    expect(sourceIdentity(root).hash).toBe(added.hash);
    commit();
    expect(sourceIdentity(root).commit).not.toBe(added.commit);
    expect(sourceIdentity(root).hash).toBe(added.hash);
    await writeFile(join(root, "src/app.ts"), "export const state = 2;\n");
    expect(sourceIdentity(root).hash).not.toBe(added.hash);
    await rm(join(root, "src/flow.ts"));
    const removed = sourceIdentity(root);
    git("add", "-u");
    commit();
    expect(sourceIdentity(root).hash).toBe(removed.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
