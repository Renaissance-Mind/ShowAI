import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotLibrary } from "./interaction-perf-fixture.mjs";
import { distribution } from "./interaction-perf-metrics.mjs";

test("snapshot leaves a real WAL database unchanged and excludes sync credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-perf-fixture-"));
  const source = join(root, "source");
  await mkdir(join(source, "history"), { recursive: true });
  await mkdir(join(source, "local/sync"), { recursive: true });
  await writeFile(join(source, "local/sync/private.json"), "do not copy");
  await writeFile(
    join(source, "library.json"),
    JSON.stringify({
      format: "showai-library",
      storage: "sqlite",
      version: 2,
      id: "source-library",
    }),
  );
  const db = new DatabaseSync(join(source, "history/content.sqlite"));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE current_state(id INTEGER PRIMARY KEY, revision TEXT); INSERT INTO current_state VALUES(1,'revision-a');",
    );
    const original = await readFile(join(source, "library.json"));
    const result = await snapshotLibrary(source, join(root, "copy"));
    assert.equal(result.revision, "revision-a");
    assert.equal(result.sourceOpenedReadOnly, true);
    assert.deepEqual(await readdir(join(root, "copy")), [
      "history",
      "library.json",
    ]);
    const clone = new DatabaseSync(join(root, "copy/history/content.sqlite"));
    clone.exec("UPDATE current_state SET revision='changed-copy'");
    clone.close();
    assert.equal(
      db.prepare("SELECT revision FROM current_state").get().revision,
      "revision-a",
    );
    assert.deepEqual(await readFile(join(source, "library.json")), original);
    assert.notEqual(
      JSON.parse(await readFile(join(root, "copy/library.json"), "utf8")).id,
      "source-library",
    );
    await assert.rejects(
      snapshotLibrary(source, join(source, "forbidden")),
      /outside/,
    );
    await symlink(source, join(root, "alias"));
    await assert.rejects(
      snapshotLibrary(source, join(root, "alias/forbidden")),
      /outside/,
    );
    assert.ok(!(await readdir(source)).includes("forbidden"));
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("missing observations stay unavailable rather than becoming zero latency", () => {
  assert.deepEqual(distribution([null, undefined, NaN]), {
    count: 0,
    p50: null,
    p95: null,
    max: null,
  });
  assert.deepEqual(distribution([30, 10, 20]), {
    count: 3,
    p50: 20,
    p95: 30,
    max: 30,
  });
});
