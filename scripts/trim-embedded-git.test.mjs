import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { trimEmbeddedGit } from "./trim-embedded-git.mjs";

test("removes Credential Manager, LFS and dashed copies of git, keeping helpers and scripts", async () => {
  const gitDir = await mkdtemp(join(tmpdir(), "showai-trim-git-"));
  const core = join(gitDir, "libexec/git-core");
  await mkdir(join(core, "de"), { recursive: true });
  await mkdir(join(core, "mergetools"), { recursive: true });
  const files = {
    git: "git binary",
    "git-add": "git binary",
    "git-fast-import": "git binary",
    "git-remote-http": "http helper",
    "git-sh-setup": "shell library",
    "git-lfs": "lfs",
    "git-credential-manager": "gcm",
    "git-credential-manager.dll": "gcm",
    "git-credential-manager.deps.json": "{}",
    "Avalonia.Base.dll": "gcm ui",
    "libcoreclr.dylib": "dotnet",
    createdump: "dotnet",
    "uninstall.sh": "gcm uninstaller",
    "de/System.CommandLine.resources.dll": "gcm strings",
    "mergetools/vimdiff": "merge tool",
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(core, name), content);

  const removed = await trimEmbeddedGit(gitDir);

  assert.deepEqual(removed, [
    "libexec/git-core/Avalonia.Base.dll",
    "libexec/git-core/createdump",
    "libexec/git-core/de/",
    "libexec/git-core/git-add",
    "libexec/git-core/git-credential-manager",
    "libexec/git-core/git-credential-manager.deps.json",
    "libexec/git-core/git-credential-manager.dll",
    "libexec/git-core/git-fast-import",
    "libexec/git-core/git-lfs",
    "libexec/git-core/libcoreclr.dylib",
    "libexec/git-core/uninstall.sh",
  ]);
  assert.deepEqual((await readdir(core)).sort(), ["git", "git-remote-http", "git-sh-setup", "mergetools"]);
  await rm(gitDir, { recursive: true });
});
