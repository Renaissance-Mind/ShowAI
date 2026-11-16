import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export function selectPerfPages(catalog, options) {
  const active = catalog.filter(
    (p) => !p.archived && !/验收|regression|smoke|测试|stress/i.test(p.title),
  );
  const pages = active
    .filter((p) => p.kind === "page" && p.text > 1000)
    .sort((a, b) => a.text - b.text);
  const substantial = pages.filter((p) => p.text > 5000);
  const representative = substantial.length ? substantial : pages;
  const document = options.document
    ? catalog.find((p) => p.pageId === options.document)
    : representative[Math.floor(representative.length / 2)];
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

export function workflowPages(catalog, selected) {
  const pages = catalog
    .filter(
      (p) =>
        !p.archived &&
        p.kind === "page" &&
        p.text > 1000 &&
        !/验收|regression|smoke|测试|stress/i.test(p.title),
    )
    .sort((a, b) => a.text - b.text);
  const chosen = new Map(
    [pages[0], selected.document, pages.at(-1)]
      .filter(Boolean)
      .map((p) => [p.pageId, p]),
  );
  if (chosen.size < 3 && pages.length > 2) {
    const middle = pages.filter((p) => !chosen.has(p.pageId));
    const page = middle[Math.floor(middle.length / 2)];
    if (page) chosen.set(page.pageId, page);
  }
  return [...chosen.values()].sort((a, b) => a.text - b.text);
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
