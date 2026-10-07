import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { developmentCache } from "./dev-cache.mjs";

test("development cache validates sources, dependencies and artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-dev-cache-"));
  try {
    for (const folder of [
      "src",
      "scripts",
      "resources",
      "cache",
      "node_modules/example",
    ])
      await mkdir(join(root, folder), { recursive: true });
    const source = join(root, "src/main.ts");
    const dependency = join(root, "node_modules/example/index.js");
    const artifact = join(root, "cache/main.mjs");
    const directory = join(root, "cache");
    await writeFile(source, "export const value = 1;");
    await writeFile(dependency, "export const dependency = 1;");
    await writeFile(artifact, "compiled output");
    const cache = developmentCache(root, directory, "desktop");
    const save = async () =>
      cache.save(await cache.fingerprint(), new Set([dependency]), [artifact]);
    assert.equal(await cache.restore(), undefined);
    await save();
    assert.deepEqual(await cache.restore(), [dependency]);
    assert.equal(
      await developmentCache(root, directory, "browser").restore(),
      undefined,
    );
    await writeFile(source, "export const value = 2;");
    assert.equal(await cache.restore(), undefined);
    await save();
    await writeFile(join(root, "src/new.ts"), "new source");
    assert.equal(await cache.restore(), undefined);
    await save();
    await rm(join(root, "src/new.ts"));
    assert.equal(await cache.restore(), undefined);
    await save();
    await writeFile(dependency, "export const dependency = 2;");
    assert.equal(await cache.restore(), undefined);
    await save();
    await writeFile(join(root, "package-lock.json"), "changed dependencies");
    assert.equal(await cache.restore(), undefined);
    await save();
    await writeFile(artifact, "damaged output");
    assert.equal(await cache.restore(), undefined);
    await save();
    await rm(artifact);
    assert.equal(await cache.restore(), undefined);
    await writeFile(artifact, "compiled output");
    const before = await cache.fingerprint();
    await writeFile(source, "changed while compiling");
    await cache.save(before, new Set([dependency]), [artifact]);
    assert.equal(await cache.restore(), undefined);
    await writeFile(
      join(directory, "build-cache.json"),
      "{interrupted receipt",
    );
    assert.equal(await cache.restore(), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
