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
  const hash = createHash("sha256").update(commit);
  hash.update(git(["diff", "HEAD", "--", ...paths]));
  const untracked = git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...paths,
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const path of untracked)
    hash.update(path).update(readFileSync(join(repository, path)));
  return { commit, hash: hash.digest("hex") };
}
