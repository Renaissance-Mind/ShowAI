import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteLibrary } from "./sqlite-library";

test("current reads stay on one database snapshot while saves replace the current revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-current-read-race-"));
  const library = new SqliteLibrary(root);
  try {
    await library.initialize();
    const paths = ["projects/current/left.json", "projects/current/right.json"];
    const save = (value: number) =>
      library.writeFiles(
        new Map(
          paths.map((path) => [path, Buffer.from(JSON.stringify({ value }))]),
        ),
        { actor: { kind: "human" }, channel: "desktop" },
      );
    await save(0);
    const first = (await library.head())!;
    let writing = true;
    const writer = (async () => {
      try {
        for (let value = 1; value <= 40; value++) await save(value);
      } finally {
        writing = false;
      }
    })();
    const reader = (async () => {
      let reads = 0;
      while (writing || reads < 80) {
        const files = await library.readFiles(paths);
        const values = paths.map(
          (path) => JSON.parse(files.get(path)!.toString()).value,
        );
        expect(values[0]).toBe(values[1]);
        expect(values[0]).toBeGreaterThanOrEqual(0);
        expect(values[0]).toBeLessThanOrEqual(40);
        expect((await library.tree()).map((entry) => entry.path)).toEqual(
          paths,
        );
        expect(
          [...(await library.resourceRevisions(paths)).values()].every(
            (value) => typeof value === "string",
          ),
        ).toBe(true);
        reads++;
      }
    })();
    const results = await Promise.allSettled([writer, reader]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    // Explicit historical reads retain their strict meaning.
    await expect(library.readFile(paths[0], first)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      JSON.parse((await library.readFile(paths[0])).toString()).value,
    ).toBe(40);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
