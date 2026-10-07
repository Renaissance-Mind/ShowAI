// Explicitly build and install a frozen macOS application from a Git commit.
import { execFile, spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const execute = promisify(execFile);
const { values } = parseArgs({
  options: { ref: { type: "string", default: "HEAD" } },
});
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("The stable local app installer requires macOS arm64.");
const installed = join(homedir(), "Applications/ShowAI 稳定版.app");
async function assertClosed() {
  const { stdout } = await execute("/bin/ps", ["-axo", "command="]);
  if (
    stdout
      .split("\n")
      .some((line) => line.includes(join(installed, "Contents/MacOS/")))
  )
    throw new Error(
      "请保存内容并退出 ShowAI 稳定版，再执行更新。开发版可以继续运行。",
    );
}
await assertClosed();
const { stdout } = await execute(
  "git",
  ["rev-parse", "--verify", "--end-of-options", `${values.ref}^{commit}`],
  { cwd: root },
);
const sourceCommit = stdout.trim();
const working = await mkdtemp(join(tmpdir(), "showai-stable-build-"));
console.log(
  `Building frozen ShowAI from ${sourceCommit}. Development files and processes stay in place.`,
);
await execute(
  "git",
  [
    "archive",
    "--format=tar",
    "--output",
    join(working, "source.tar"),
    sourceCommit,
  ],
  { cwd: root },
);
const source = join(working, "source");
await mkdir(source);
await execute("/usr/bin/tar", [
  "-xf",
  join(working, "source.tar"),
  "-C",
  source,
]);
for (const name of ["package.json", "package-lock.json"]) {
  if (
    !(await readFile(join(root, name))).equals(
      await readFile(join(source, name)),
    )
  )
    throw new Error(
      `The selected commit has different ${name}. Install matching dependencies in an isolated build before updating.`,
    );
}
const installedLock = JSON.parse(
  await readFile(join(root, "node_modules/.package-lock.json"), "utf8"),
);
const sourceLock = JSON.parse(
  await readFile(join(source, "package-lock.json"), "utf8"),
);
for (const [name, dependency] of Object.entries(sourceLock.packages)) {
  if (!name || (dependency.optional && !installedLock.packages[name])) continue;
  if (installedLock.packages[name]?.version !== dependency.version)
    throw new Error(
      `Installed dependency ${name} differs from the frozen lockfile. Run npm ci before updating.`,
    );
}
// APFS clones isolate caches and dependency bytes without changing the live tree.
await execute("/bin/cp", [
  "-cR",
  join(root, "node_modules"),
  join(source, "node_modules"),
]);
await rm(join(source, "node_modules/.cache"), { recursive: true, force: true });
const env = { ...process.env, SHOWAI_SOURCE_COMMIT: sourceCommit };
for (const name of Object.keys(env))
  if (name.startsWith("SHOWAI_") && name !== "SHOWAI_SOURCE_COMMIT")
    delete env[name];
delete env.ELECTRON_RUN_AS_NODE;
async function run(command, args) {
  const child = spawn(command, args, { cwd: source, env, stdio: "inherit" });
  await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? done()
        : reject(
            new Error(
              `${command} ${args.join(" ")} failed (${signal ?? code}). Build retained at ${working}.`,
            ),
          ),
    );
  });
}
await run("npm", ["run", "check"]);
await run("npm", ["run", "build"]);
await run("npm", ["test", "--", "--maxWorkers=2"]);
await run(join(root, "node_modules/.bin/electron-builder"), [
  "--mac",
  "--arm64",
  "--dir",
  "--config",
  "electron-builder.yml",
  "--config.productName=ShowAI 稳定版",
  "--config.appId=ai.renaissancemind.showai.stable",
]);
const built = join(source, "release/mac-arm64/ShowAI 稳定版.app");
const build = JSON.parse(
  await readFile(
    join(built, "Contents/Resources/runtime/assets/build.json"),
    "utf8",
  ),
);
if (build.sourceCommit !== sourceCommit || build.sourceDirty === true)
  throw new Error("Built app does not match the requested frozen commit.");
await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", built]);
await assertClosed();
await mkdir(dirname(installed), { recursive: true });
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const staging = join(working, "ShowAI 稳定版.app");
await cp(built, staging, { recursive: true, verbatimSymlinks: true });
await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", staging]);
await assertClosed();
const previous = await access(installed).then(
  () => true,
  (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  },
);
const backup = join(
  homedir(),
  "Library/Application Support/ShowAI/stable-backups",
  timestamp,
  "ShowAI 稳定版.app",
);
if (previous) {
  await mkdir(dirname(backup), { recursive: true });
  await rename(installed, backup);
}
try {
  await rename(staging, installed);
} catch (error) {
  if (previous) await rename(backup, installed);
  throw error;
}
await execute(
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
  ["-f", installed],
);
const receipt = {
  app: installed,
  version: build.version,
  sourceCommit,
  installedAt: new Date().toISOString(),
  updatePolicy: "manual",
  homeDefault: join(homedir(), ".showai"),
  source: "git archive",
  tests: "check, unit tests, build, bundle signature",
  backup: previous ? backup : null,
};
await mkdir(join(root, "artifacts"), { recursive: true });
await writeFile(
  join(root, "artifacts/stable-install.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
await rm(working, { recursive: true });
console.log(JSON.stringify(receipt, null, 2));
