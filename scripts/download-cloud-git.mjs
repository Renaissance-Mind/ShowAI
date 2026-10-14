import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function cloudGitAsset(root, architecture = process.arch) {
  const metadata = JSON.parse(await readFile(join(root, "deployments/cloudflare/dugite-git-assets.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const dependency = lock.packages["node_modules/dugite"];
  if (dependency?.version !== metadata.dugiteVersion || dependency.integrity !== metadata.npmIntegrity)
    throw new Error("Dugite lock changed; refresh the Git asset checksums from that exact npm package before building.");
  const asset = metadata.assets[`linux-${architecture}`];
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.checksum) || !asset.url.startsWith("https://github.com/desktop/dugite-native/releases/download/"))
    throw new Error(`No verified Cloud MCP Git asset for linux-${architecture}.`);
  if (basename(new URL(asset.url).pathname) !== asset.name)
    throw new Error("Dugite Git asset filename does not match its URL.");
  return { ...asset, dugiteVersion: metadata.dugiteVersion };
}

/** Publish only a complete, verified archive into dugite's supported cache. */
export async function downloadGitAsset(asset, cacheDirectory, { attempts = 4, timeoutMs = 300000, retryDelayMs = 2000 } = {}) {
  await mkdir(cacheDirectory, { recursive: true });
  const archive = join(cacheDirectory, asset.name);
  let existing;
  try { existing = await checksum(archive); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing === asset.checksum) return archive;
  if (existing !== undefined) await rm(archive);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const partial = `${archive}.${process.pid}.${randomUUID()}.part`;
    try {
      console.log(`Downloading embedded Git (${attempt}/${attempts}): ${asset.name}`);
      const response = await fetch(asset.url, {
        headers: { Accept: "application/octet-stream", "User-Agent": "showai-cloud-mcp-build" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`Git download returned HTTP ${response.status}.`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: "wx" }));
      if (await checksum(partial) !== asset.checksum) {
        const error = new Error("Embedded Git SHA256 mismatch; refusing to install the archive.");
        error.retryable = false;
        throw error;
      }
      await rename(partial, archive);
      return archive;
    } catch (error) {
      if (error.retryable === false || ["EACCES", "EPERM", "ENOSPC", "EROFS", "EEXIST"].includes(error.code) || attempt === attempts) throw error;
      console.error(`Git download interrupted: ${error.message}; retrying.`);
    } finally {
      await rm(partial, { force: true });
    }
    await new Promise((done) => setTimeout(done, retryDelayMs));
  }
  throw new Error("Embedded Git download attempts exhausted.");
}

async function main() {
  if (process.platform !== "linux") throw new Error("This helper is for the Linux Cloud MCP image build.");
  const root = process.cwd();
  const asset = await cloudGitAsset(root);
  if (process.env.npm_config_arch && process.env.npm_config_arch !== process.arch)
    throw new Error("npm_config_arch must match the Docker build platform.");
  if (process.argv.includes("--verify-installed")) {
    const installed = JSON.parse(await readFile(join(root, "node_modules/dugite/package.json"), "utf8"));
    const embedded = JSON.parse(await readFile(join(root, "node_modules/dugite/script/embedded-git.json"), "utf8"));
    const actual = embedded[`linux-${process.arch}`];
    if (installed.version !== asset.dugiteVersion || actual?.url !== asset.url || actual?.checksum !== asset.checksum)
      throw new Error("Installed dugite metadata differs from the verified Git asset.");
    console.log("Installed dugite Git asset metadata verified.");
    return;
  }
  if (!process.env.DUGITE_CACHE_DIR) throw new Error("DUGITE_CACHE_DIR is required.");
  await downloadGitAsset(asset, resolve(process.env.DUGITE_CACHE_DIR));
  console.log("Embedded Git SHA256 verified; npm lifecycle scripts can use its cache.");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
