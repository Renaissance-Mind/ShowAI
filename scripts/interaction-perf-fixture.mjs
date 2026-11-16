import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export function selectPerfPages(catalog, options) {
  const active = catalog.filter(
    (p) => !p.archived && !/验收|regression|smoke|测试|stress/i.test(p.title),
  );
  const document = options.document
    ? catalog.find((p) => p.pageId === options.document)
    : active
        .filter((p) => p.kind === "page" && p.text > 1000)
        .sort((a, b) => b.text - a.text)[0];
  const board = options.board
    ? catalog.find((p) => p.pageId === options.board)
    : active
        .filter((p) => p.kind === "board" && p.topObjects > 1)
        .sort((a, b) => b.nodes - a.nodes)[0];
  assert.ok(
    document && board,
    "Select a real page and board with --document and --board (inspect catalog.json)",
  );
  assert.ok(
    !document.archived && !board.archived,
    "Select active pages; archived pages are not in normal navigation",
  );
  return { document, board };
}

export async function snapshotLibrary(source, destination) {
  source = await realpath(source);
  destination = resolve(destination);
  const parent = await realpath(dirname(destination));
  destination = join(parent, destination.split(sep).at(-1));
  const child = relative(source, destination);
  assert.ok(
    child.startsWith(`..${sep}`),
    "The snapshot must be outside the source library",
  );
  const manifest = JSON.parse(
    await readFile(join(source, "library.json"), "utf8"),
  );
  assert.equal(
    manifest.storage,
    "sqlite",
    "A SQLite content library is required",
  );
  await mkdir(destination);
  await mkdir(join(destination, "history"));
  const path = join(source, "history/content.sqlite");
  const before = await stat(path);
  const database = new DatabaseSync(path, { readOnly: true });
  let receipt;
  try {
    const pages = await backup(
      database,
      join(destination, "history/content.sqlite"),
    );
    const copied = new DatabaseSync(
      join(destination, "history/content.sqlite"),
      { readOnly: true },
    );
    try {
      receipt = {
        source,
        destination,
        sourceOpenedReadOnly: true,
        pages,
        revision: copied
          .prepare("SELECT revision FROM current_state WHERE id=1")
          .get()?.revision,
        sourceSize: before.size,
        sourceMtimeBefore: before.mtimeMs,
        sourceMtimeAfter: (await stat(path)).mtimeMs,
        copiedFiles: ["history/content.sqlite", "library.json"],
        copiedSyncConfiguration: false,
      };
    } finally {
      copied.close();
    }
  } finally {
    database.close();
  }
  await writeFile(
    join(destination, "library.json"),
    JSON.stringify({ ...manifest, id: randomUUID() }, null, 2),
  );
  return receipt;
}
