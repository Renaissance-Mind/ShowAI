import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const inputPaths = [
  "package.json", "package-lock.json", "src", "scripts", "resources", "public",
  "vite.portable.config.ts", "tsconfig.json", "index.html", "portable.html", "LICENSE",
  "deployments/cloudflare/mcp.Dockerfile", "deployments/cloudflare/mcp.Dockerfile.dockerignore",
  "deployments/cloudflare/mcp-worker.mjs", "deployments/cloudflare/mcp-state-broker.mjs",
  "deployments/cloudflare/dugite-git-assets.json",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safePath = (path) => typeof path === "string" && !path.includes("\\") && path.split("/").every((part) => part && part !== "." && part !== "..");

export async function cloudMcpBuildInputs(source) {
  const files = [];
  async function visit(path) {
    const full = join(source, path);
    const stat = await lstat(full);
    if (stat.isDirectory()) {
      for (const name of (await readdir(full)).sort()) await visit(`${path}/${name}`);
    } else if (stat.isFile()) {
      files.push({ path, sha256: sha256(await readFile(full)) });
    } else throw new Error(`Release build input must be a regular file or directory: ${path}`);
  }
  for (const path of inputPaths) await visit(path);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { algorithm: "sha256", sha256: sha256(JSON.stringify(files)), files };
}

export async function verifyCloudMcpRelease(source, manifest) {
  if (!manifest?.prepared || !Array.isArray(manifest.sourceChanges) || !manifest.buildInputs?.sha256)
    throw new Error("Release source has no complete integrity manifest. Prepare and verify the snapshot before deploying.");
  for (const file of manifest.sourceChanges) {
    if (!safePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid release manifest entry.");
    if (sha256(await readFile(join(source, file.path))) !== file.sha256)
      throw new Error(`Release source differs from its manifest: ${file.path}`);
  }
  const actual = await cloudMcpBuildInputs(source);
  if (manifest.buildInputs.algorithm !== "sha256" || actual.sha256 !== manifest.buildInputs.sha256 || JSON.stringify(actual.files) !== JSON.stringify(manifest.buildInputs.files))
    throw new Error("Docker COPY inputs changed since release verification. Refresh and verify the snapshot before deploying.");
  return { sha256: actual.sha256, verifiedFiles: actual.files.length };
}
