// Removes the parts of dugite's macOS/Linux Git that ShowAI never runs. ShowAI keeps local history only
// (init, cat-file, fast-import, fsck, …), so the App does not need Git Credential Manager (a .NET app with
// its runtime and ~200 DLLs), Git LFS, or the dashed copies of the git binary in libexec/git-core: `git
// <command>` runs built-in commands in process. Every Mach-O file left in the App is signed one by one at
// release, so each file removed here is one codesign call and one timestamp request fewer.
import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const credentialManager = /^(git-credential-manager(\..+)?|createdump|uninstall\.sh|.+\.dll|lib.+\.dylib)$/;

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

// Returns the removed paths relative to gitDir.
export async function trimEmbeddedGit(gitDir) {
  const core = join(gitDir, "libexec/git-core");
  const git = join(core, "git");
  const gitDigest = await digest(git);
  const removed = [];
  for (const entry of await readdir(core, { withFileTypes: true })) {
    const path = join(core, entry.name);
    if (entry.isDirectory()) {
      // Satellite resource folders (de/, zh-Hans/, …) belong to Git Credential Manager.
      const files = await readdir(path);
      if (files.length && files.every((name) => name.endsWith(".resources.dll"))) {
        await rm(path, { recursive: true });
        removed.push(`libexec/git-core/${entry.name}/`);
      }
      continue;
    }
    const remove =
      credentialManager.test(entry.name) ||
      entry.name === "git-lfs" ||
      (entry.name.startsWith("git-") && (await stat(path)).size === (await stat(git)).size && (await digest(path)) === gitDigest);
    if (remove) {
      await rm(path);
      removed.push(`libexec/git-core/${entry.name}`);
    }
  }
  return removed.sort();
}
