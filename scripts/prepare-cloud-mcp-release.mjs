import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudMcpBuildInputs } from "./cloud-mcp-release.mjs";

// Exports one committed revision as the deployment source, so a release never
// includes uncommitted or parallel work from the shared checkout.
// Usage: node scripts/prepare-cloud-mcp-release.mjs <handoff-directory> [commit]
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2])
  throw new Error("Usage: node scripts/prepare-cloud-mcp-release.mjs <handoff-directory> [commit]");
const handoff = resolve(process.argv[2]);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", "--verify", `${process.argv[3] ?? "HEAD"}^{commit}`);
const source = join(handoff, "release-source");
await mkdir(source, { recursive: true });
if ((await readdir(source)).length)
  throw new Error(`Release source already exists: ${source}. Use a new handoff directory.`);
const archive = spawnSync("git", ["archive", "--format=tar", commit], { cwd: root, maxBuffer: 1 << 30 });
if (archive.status !== 0) throw new Error(archive.stderr.toString());
const extract = spawnSync("tar", ["-x", "-C", source], { input: archive.stdout });
if (extract.status !== 0) throw new Error(extract.stderr.toString());
const buildInputs = await cloudMcpBuildInputs(source);
await writeFile(
  join(handoff, "release-source.json"),
  `${JSON.stringify({ prepared: true, baseCommit: commit, sourceChanges: [], buildInputs, preparedAt: new Date().toISOString() }, null, 2)}\n`,
);
console.log(`Prepared ${commit} with ${buildInputs.files.length} Docker inputs in ${source}`);
