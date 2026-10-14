import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { cloudGitAsset, downloadGitAsset } from "./download-cloud-git.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), "showai-cloud-git-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return { directory, url: `http://127.0.0.1:${server.address().port}/git.tar.gz` };
}

test("Linux asset pins match the locked installed dugite metadata for both architectures", async () => {
  const root = resolve(import.meta.dirname, "..");
  const embedded = JSON.parse(await readFile(join(root, "node_modules/dugite/script/embedded-git.json"), "utf8"));
  for (const arch of ["x64", "arm64"]) {
    const asset = await cloudGitAsset(root, arch);
    assert.equal(asset.url, embedded[`linux-${arch}`].url);
    assert.equal(asset.checksum, embedded[`linux-${arch}`].checksum);
    assert.equal(asset.name, embedded[`linux-${arch}`].name);
  }
  await assert.rejects(cloudGitAsset(root, "unknown"), /No verified/);
});

test("real fetch bodies repair corrupt caches, verify SHA256 and clean up rejected archives", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "showai-cloud-git-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.alloc(2 * 1024 * 1024, 71);
  const asset = { name: "git.tar.gz", url: `data:application/octet-stream;base64,${bytes.toString("base64")}`, checksum: digest(bytes) };
  await writeFile(join(directory, asset.name), "truncated cached archive");
  const archive = await downloadGitAsset(asset, directory);
  assert.equal(digest(await readFile(archive)), asset.checksum);
  // The verified cache succeeds even when a subsequent download URL is unusable.
  assert.equal(await downloadGitAsset({ ...asset, url: "invalid URL" }, directory), archive);
  await rm(archive);
  await assert.rejects(downloadGitAsset({ ...asset, checksum: digest("different expected bytes") }, directory), /SHA256 mismatch/);
  assert.deepEqual(await readdir(directory), []);
});

test("interrupted HTTP bodies retry, replace corrupt caches and publish only a verified archive", async (t) => {
  const bytes = Buffer.alloc(512 * 1024, 71);
  let requests = 0;
  const { directory, url } = await fixture(t, (_req, res) => {
    requests++;
    res.writeHead(200, { "content-length": bytes.length });
    if (requests === 1) {
      res.write(bytes.subarray(0, 8192));
      setImmediate(() => res.destroy());
    } else res.end(bytes);
  });
  const asset = { name: "git.tar.gz", url, checksum: digest(bytes) };
  await writeFile(join(directory, asset.name), "previous interrupted download");
  const archive = await downloadGitAsset(asset, directory, { retryDelayMs: 0 });
  assert.equal(requests, 2);
  assert.equal(digest(await readFile(archive)), asset.checksum);
  assert.deepEqual(await readdir(directory), [asset.name]);
  await downloadGitAsset(asset, directory);
  assert.equal(requests, 2, "valid cache avoids another request");
});

test("checksum mismatches fail closed and never enter dugite's cache", async (t) => {
  let requests = 0;
  const { directory, url } = await fixture(t, (_req, res) => { requests++; res.end("wrong archive"); });
  await assert.rejects(downloadGitAsset({ name: "git.tar.gz", url, checksum: digest("expected archive") }, directory, { retryDelayMs: 0 }), /SHA256 mismatch/);
  assert.equal(requests, 1);
  assert.deepEqual(await readdir(directory), []);
});

test("HTTP failures have bounded retries and remove partial downloads", async (t) => {
  let requests = 0;
  const { directory, url } = await fixture(t, (_req, res) => { requests++; res.writeHead(503); res.end(); });
  await assert.rejects(downloadGitAsset({ name: "git.tar.gz", url, checksum: digest("expected") }, directory, { attempts: 2, retryDelayMs: 0 }), /HTTP 503/);
  assert.equal(requests, 2);
  assert.deepEqual(await readdir(directory), []);
});
