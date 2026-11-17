import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function sourceIdentity(repository: string) {
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: repository, encoding: "utf8" });
  const paths = [
    "src",
    "scripts/ui-lab.mjs",
    "scripts/ui-lab-electron.cjs",
    "package.json",
    "package-lock.json",
  ];
  const commit = git(["rev-parse", "HEAD"]).trim();
  const hash = createHash("sha256");
  const files = git([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...paths,
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const path of [...new Set(files)]) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(repository, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    hash
      .update(path)
      .update("\0")
      .update(String(bytes.length))
      .update("\0")
      .update(bytes);
  }
  return { commit, hash: hash.digest("hex") };
}
