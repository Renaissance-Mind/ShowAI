import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = join(root, "dist-runtime");
const metadata = JSON.parse(
  await readFile(join(runtime, "assets/build.json"), "utf8"),
);
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
if (
  metadata.platform !== process.platform ||
  metadata.architecture !== process.arch ||
  metadata.version !== version
)
  throw new Error(
    "Build the browser distribution on its target OS and architecture before packaging.",
  );
const nodeVersion = Number(process.versions.node.split(".")[0]);
if (
  nodeVersion < 22 ||
  (nodeVersion === 22 && Number(process.versions.node.split(".")[1]) < 12) ||
  process.versions.electron
)
  throw new Error("Package with Node.js 22.12+ (not Electron).");
const name = `ShowAI-browser-${version}-${process.platform}-${process.arch}`;
const output = join(root, "release", name);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(runtime, join(output, "runtime"), {
  recursive: true,
  verbatimSymlinks: true,
});
await mkdir(join(output, "bin"));
// Use the standalone official distribution: developer Node installations can depend
// on Homebrew/system libraries that are absent on the recipient's machine.
const nodeVersionTag =
  process.env.SHOWAI_PACKAGE_NODE_VERSION ?? process.versions.node;
if (
  !/^\d+\.\d+\.\d+$/.test(nodeVersionTag) ||
  Number(nodeVersionTag.split(".")[0]) < 22 ||
  (Number(nodeVersionTag.split(".")[0]) === 22 &&
    Number(nodeVersionTag.split(".")[1]) < 12)
)
  throw new Error("SHOWAI_PACKAGE_NODE_VERSION must select Node 22.12+.");
const nodePlatform = process.platform === "win32" ? "win" : process.platform;
const nodeName = `node-v${nodeVersionTag}-${nodePlatform}-${process.arch}`;
const nodeArchiveName =
  nodeName + (process.platform === "win32" ? ".zip" : ".tar.gz");
const cache = join(root, "node_modules/.cache/showai-node");
await mkdir(cache, { recursive: true });
const nodeArchive = join(cache, nodeArchiveName);
const nodeUrl = `https://nodejs.org/dist/v${nodeVersionTag}/`;
async function fetchOfficial(file) {
  const response = await fetch(nodeUrl + file);
  if (!response.ok)
    throw new Error(`Cannot download ${file}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const checksums = (await fetchOfficial("SHASUMS256.txt")).toString("utf8");
const checksum = checksums
  .split("\n")
  .find((line) => line.endsWith("  " + nodeArchiveName))
  ?.split(/\s+/)[0];
if (!checksum) throw new Error(`No official checksum for ${nodeArchiveName}.`);
let archiveBytes = await readFile(nodeArchive).catch((error) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (
  !archiveBytes ||
  createHash("sha256").update(archiveBytes).digest("hex") !== checksum
) {
  console.log(
    `Downloading standalone Node v${nodeVersionTag} for ${nodePlatform}/${process.arch}…`,
  );
  archiveBytes = await fetchOfficial(nodeArchiveName);
  if (createHash("sha256").update(archiveBytes).digest("hex") !== checksum)
    throw new Error("Node archive checksum mismatch.");
  await writeFile(nodeArchive, archiveBytes);
}
await rm(join(cache, nodeName), { recursive: true, force: true });
if (process.platform === "win32")
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Expand-Archive -LiteralPath $env:SHOWAI_NODE_ARCHIVE -DestinationPath $env:SHOWAI_NODE_CACHE -Force",
    ],
    {
      env: {
        ...process.env,
        SHOWAI_NODE_ARCHIVE: nodeArchive,
        SHOWAI_NODE_CACHE: cache,
      },
    },
  );
else await run("tar", ["-xzf", nodeArchive, "-C", cache]);
const binary = join(
  output,
  "bin",
  process.platform === "win32" ? "node.exe" : "node",
);
await copyFile(
  join(cache, nodeName, process.platform === "win32" ? "node.exe" : "bin/node"),
  binary,
);
await chmod(binary, 0o755);
await copyFile(
  join(cache, nodeName, "LICENSE"),
  join(output, "NODE-LICENSE.txt"),
);
const bundled = await run(binary, ["--version"]);
if (bundled.stdout.trim() !== `v${nodeVersionTag}`)
  throw new Error("Bundled Node executable failed verification.");
await writeFile(
  join(output, "build.json"),
  JSON.stringify(
    {
      version,
      pageModelVersion: metadata.pageModelVersion,
      supportedArtifactVersions: metadata.supportedArtifactVersions,
      sourceCommit: metadata.sourceCommit,
      sourceDirty: metadata.sourceDirty,
      frontendFiles: metadata.frontendFiles,
      platform: process.platform,
      architecture: process.arch,
      node: nodeVersionTag,
      nodeArchiveSha256: checksum,
    },
    null,
    2,
  ) + "\n",
);
const shell =
  '#!/bin/sh\nset -eu\nSHOWAI_PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$SHOWAI_PACKAGE_DIR/bin/node" "$SHOWAI_PACKAGE_DIR/runtime/scripts/cli.mjs"';
for (const [file, command] of [
  ["showai", ' "$@"'],
  ["start.sh", ' serve "$@"'],
  ...(process.platform === "darwin" ? [["start.command", ' serve "$@"']] : []),
]) {
  await writeFile(join(output, file), shell + command + "\n");
  await chmod(join(output, file), 0o755);
}
await writeFile(
  join(output, "showai.cmd"),
  '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0runtime\\scripts\\cli.mjs" %*\r\n',
);
await writeFile(
  join(output, "start.cmd"),
  '@echo off\r\n"%~dp0bin\\node.exe" "%~dp0runtime\\scripts\\cli.mjs" serve %*\r\nif errorlevel 1 pause\r\n',
);
await writeFile(
  join(output, "README.txt"),
  `ShowAI ${version} — local browser workbench\n\nmacOS: double-click start.command.\nLinux: run ./start.sh.\nWindows: double-click start.cmd.\nThe package includes Node, the compiler, the workbench and the Agent CLI.\nNo Electron installation or separate Node installation is required.\nKeep the terminal open while using the workbench. Ctrl+C stops the server.\n\nChoose storage: ./start.sh --home /absolute/library/path\nWindows: start.cmd --home C:\\Users\\you\\ShowAI\nDefault storage: ~/.showai (same format as the desktop app).\nAgent CLI: ./showai projects list --json (Windows: showai.cmd).\nCLI runs independently of the browser server.\nAgent configuration is in Settings > Connect Agent, and agent-runtime.json in the content library.\nStart once or run ./showai runtime register --json to register it.\n\nThis build is for ${process.platform}/${process.arch}; use a package built for your OS and architecture.\nYou can move the package; restart it to refresh the registered CLI path.\n`,
);
const archive = join(
  root,
  "release",
  name + (process.platform === "win32" ? ".zip" : ".tar.gz"),
);
await rm(archive, { force: true });
if (process.platform === "win32") {
  // Paths are arguments/environment, never interpolated into PowerShell source.
  await run(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Compress-Archive -LiteralPath $env:SHOWAI_ARCHIVE_SOURCE -DestinationPath $env:SHOWAI_ARCHIVE_TARGET -Force",
    ],
    {
      env: {
        ...process.env,
        SHOWAI_ARCHIVE_SOURCE: output,
        SHOWAI_ARCHIVE_TARGET: archive,
      },
    },
  );
} else await run("tar", ["-czf", archive, "-C", dirname(output), name]);
console.log(`Prepared browser distribution: ${archive}`);
