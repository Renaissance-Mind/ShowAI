import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseTestFixtures } from "./test-fixtures.mjs";

test("cleanup preserves evidence and dependencies outside the isolated checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-fixture-cleanup-"));
  const output = join(root, "output"),
    external = join(root, "dependencies");
  try {
    await mkdir(join(output, "checkout"), { recursive: true });
    await mkdir(join(output, "library"));
    await mkdir(external);
    await writeFile(join(external, "package.json"), "installed dependency");
    await symlink(
      external,
      join(output, "checkout/node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(join(output, "library/page.json"), "test data");
    await writeFile(join(output, "result.json"), "verified result");
    const screenshot = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(output, "screenshot.png"), screenshot);
    assert.equal(
      await releaseTestFixtures(output, [
        join(output, "checkout"),
        join(output, "library"),
      ]),
      false,
    );
    assert.deepEqual((await readdir(output)).sort(), [
      "result.json",
      "screenshot.png",
    ]);
    assert.deepEqual(
      await readFile(join(output, "screenshot.png")),
      screenshot,
    );
    assert.equal(
      await readFile(join(external, "package.json"), "utf8"),
      "installed dependency",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid fixture ownership is rejected before deleting any files", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-fixture-boundary-"));
  const output = join(root, "output"),
    fixture = join(output, "checkout");
  try {
    await mkdir(fixture, { recursive: true });
    await assert.rejects(
      releaseTestFixtures(output, [fixture, root]),
      /direct child/,
    );
    await assert.rejects(releaseTestFixtures(output, [output]), /direct child/);
    assert.deepEqual(await readdir(output), ["checkout"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit debugging retention keeps the owned fixture", async () => {
  const output = await mkdtemp(join(tmpdir(), "showai-fixture-retention-"));
  const prior = process.env.SHOWAI_KEEP_TEST_FIXTURES;
  try {
    const fixture = join(output, "checkout");
    await mkdir(fixture);
    process.env.SHOWAI_KEEP_TEST_FIXTURES = "1";
    assert.equal(await releaseTestFixtures(output, [fixture]), true);
    assert.deepEqual(await readdir(output), ["checkout"]);
  } finally {
    if (prior === undefined) delete process.env.SHOWAI_KEEP_TEST_FIXTURES;
    else process.env.SHOWAI_KEEP_TEST_FIXTURES = prior;
    await rm(output, { recursive: true, force: true });
  }
});
