import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DatasetSourceLinks,
  externalPath,
  parseSource,
  readExternal,
  serializeSource,
  sourceFormat,
  watchDatasetSources,
  writeExternal,
} from "./dataset-sources";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "showai-sources-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("external dataset files", () => {
  it("read tables with typed cells and write untouched cells back unchanged", () => {
    const text =
      'id,title,score,code,done\r\nm1,"体检, 年度",9.5,001,false\r\nm2,"说 ""好""",10,,true\r\n';
    const { value, layout } = parseSource(text, "csv");
    expect(value).toEqual({
      columns: ["id", "title", "score", "code", "done"],
      rows: [
        { id: "m1", title: "体检, 年度", score: 9.5, code: "001", done: false },
        { id: "m2", title: '说 "好"', score: 10, code: "", done: true },
      ],
    });
    expect(serializeSource(value, "csv", layout)).toBe(text);
    const tsv = "a\tb\nx\t1\n";
    const parsed = parseSource(tsv, "tsv");
    expect(serializeSource(parsed.value, "tsv", parsed.layout)).toBe(tsv);
  });

  it("add new columns and reject cells a table cannot hold", () => {
    const { value, layout } = parseSource("id\nm1\n", "csv");
    const table = value as { columns: string[]; rows: object[] };
    expect(
      serializeSource(
        { ...table, rows: [{ id: "m1", note: "新" }] },
        "csv",
        layout,
      ),
    ).toBe("id,note\nm1,新\n");
    expect(() =>
      serializeSource({ rows: [{ id: { nested: true } }] }, "csv"),
    ).toThrow(/text, numbers or true\/false/);
    expect(() => serializeSource([1, 2], "csv")).toThrow(/columns, rows/);
    expect(() => parseSource("id,id\n1,2\n", "csv")).toThrow(/twice/);
  });

  it("keep a JSON file's indentation, line endings and final newline", () => {
    for (const text of [
      '{\n    "a": [\n        1\n    ]\n}\n',
      '{\n\t"a": 1\n}',
      '{"a":1}',
      "[\r\n  1\r\n]\r\n",
    ]) {
      const { value, layout } = parseSource(text, "json");
      expect(serializeSource(value, "json", layout)).toBe(text);
    }
    expect(() => parseSource('{"secret": nope}', "json")).toThrow(
      /not valid JSON/,
    );
    expect(() => parseSource('{"secret": nope}', "json")).not.toThrow(/secret/);
  });

  it("accept only absolute paths outside the library with a known format", async () => {
    const home = await directory();
    expect(() => externalPath(home, "data.json")).toThrow(/absolute/);
    expect(() => externalPath(home, join(home, "data.json"))).toThrow(
      /inside the content library/,
    );
    expect(externalPath(home, "/tmp/x/../data.json")).toBe("/tmp/data.json");
    expect(sourceFormat("/a/B.CSV")).toBe("csv");
    expect(() => sourceFormat("/a/data.txt")).toThrow(/format/);
    expect(sourceFormat("/a/data.txt", "json")).toBe("json");
  });

  it("never overwrite a file changed after it was read", async () => {
    const folder = await directory();
    const path = join(folder, "data.json");
    await writeFile(path, '{"a":1}\n');
    const read = await readExternal(path, "json", 1024);
    await new Promise((done) => setTimeout(done, 20));
    await writeFile(path, '{"a":2}\n');
    await expect(writeExternal(path, '{"a":3}\n', read.stamp)).rejects.toThrow(
      /changed outside ShowAI/,
    );
    expect(await readFile(path, "utf8")).toBe('{"a":2}\n');
    await expect(writeExternal(path, "{}", null)).rejects.toThrow(
      /changed outside/,
    );
    await expect(readExternal(path, "json", 3)).rejects.toThrow(
      /at most 3 bytes/,
    );
  });

  it("report changes of linked files and links as dataset keys", async () => {
    const home = await directory();
    const folder = await directory();
    await mkdir(join(home, "local"), { recursive: true });
    const path = join(folder, "data.json");
    await writeFile(path, "{}\n");
    const changes: string[][] = [];
    const watcher = watchDatasetSources(home, (keys) => changes.push(keys));
    try {
      await new DatasetSourceLinks(home).set("p1", "d1", path);
      await expect
        .poll(() => changes.flat(), { timeout: 5000 })
        .toContain("p1/d1");
      changes.length = 0;
      await new Promise((done) => setTimeout(done, 300));
      await writeFile(path, '{"a":1}\n');
      await expect
        .poll(() => changes.flat(), { timeout: 5000 })
        .toEqual(["p1/d1"]);
    } finally {
      await watcher.close();
    }
  });
});
