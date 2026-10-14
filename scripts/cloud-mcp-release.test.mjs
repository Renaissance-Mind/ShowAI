import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { cloudMcpBuildInputs, verifyCloudMcpRelease } from "./cloud-mcp-release.mjs";

test("release verification rejects changed, additional and removed Docker inputs", async (t) => {
  const source = await mkdtemp(join(tmpdir(), "showai-cloud-release-"));
  t.after(() => rm(source, { recursive: true, force: true }));
  const real = await cloudMcpBuildInputs(resolve(import.meta.dirname, ".."));
  // Small real filesystem fixture with each required build input directory.
  for (const file of real.files) {
    await mkdir(dirname(join(source, file.path)), { recursive: true });
    await writeFile(join(source, file.path), "release fixture");
  }
  const buildInputs = await cloudMcpBuildInputs(source);
  const manifest = { prepared: true, sourceChanges: [], buildInputs };
  assert.equal((await verifyCloudMcpRelease(source, manifest)).verifiedFiles, buildInputs.files.length);
  await writeFile(join(source, "portable.html"), "changed input");
  await assert.rejects(verifyCloudMcpRelease(source, manifest), /COPY inputs changed/);
  await writeFile(join(source, "portable.html"), "release fixture");
  await writeFile(join(source, "src/unreviewed.ts"), "extra input");
  await assert.rejects(verifyCloudMcpRelease(source, manifest), /COPY inputs changed/);
  await rm(join(source, "src/unreviewed.ts"));
  await rm(join(source, "portable.html"));
  await assert.rejects(verifyCloudMcpRelease(source, manifest), /ENOENT/);
});

test("release verification requires a complete manifest and rejects unsafe overlays", async () => {
  await assert.rejects(verifyCloudMcpRelease("unused", { prepared: true }), /complete integrity/);
  await assert.rejects(verifyCloudMcpRelease("unused", { prepared: true, sourceChanges: [{ path: "../escape", sha256: "a".repeat(64) }], buildInputs: { sha256: "b".repeat(64) } }), /Invalid release manifest/);
});

test("symlinked Docker COPY inputs are rejected", async (t) => {
  const source = await mkdtemp(join(tmpdir(), "showai-cloud-release-link-"));
  t.after(() => rm(source, { recursive: true, force: true }));
  await symlink("/etc/passwd", join(source, "package.json"));
  await assert.rejects(cloudMcpBuildInputs(source), /regular file/);
});
