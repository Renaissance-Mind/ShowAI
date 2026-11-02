import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  DatasetSourceLinks,
  REMOTE_FETCH,
  externalPath,
  fetchSource,
  isDatasetSource,
  parseSource,
  readExternal,
  serializeSource,
  sourceFormat,
  sourceUrl,
  watchDatasetSources,
  writeExternal,
} from "./dataset-sources";
import { CoreError } from "./model";
import { xlsxWorkbook } from "../test/xlsx";
import { dataServer } from "../test/data-server";

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
    expect(
      externalPath(home, [tmpdir(), "x", "..", "data.json"].join(sep)),
    ).toBe(join(tmpdir(), "data.json"));
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

  it("refuse files that are not UTF-8 instead of damaging them", async () => {
    const folder = await directory();
    const path = join(folder, "gbk.csv");
    // "名称\n你好" in GBK, as a Chinese Excel "CSV" save writes it.
    await writeFile(
      path,
      Buffer.from([0xc3, 0xfb, 0xb3, 0xc6, 0x0a, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]),
    );
    await expect(readExternal(path, "csv", 1024)).rejects.toThrow(
      /not UTF-8 text/,
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

const reasonOf = async (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => {
      expect(error).toBeInstanceOf(CoreError);
      return {
        code: (error as CoreError).code,
        reason: (error as CoreError).details?.reason,
        message: (error as Error).message,
      };
    },
  );

describe("spreadsheets", () => {
  it("read every sheet of a workbook into typed rows and are never written", async () => {
    const folder = await directory();
    const path = join(folder, "budget.xlsx");
    await writeFile(
      path,
      xlsxWorkbook([
        {
          name: "Budget",
          rows: [
            ["id", "item", "amount", "paid", "due"],
            [
              "b1",
              "差旅, 上海",
              1200.5,
              true,
              new Date("2026-11-03T00:00:00Z"),
            ],
            ["b2", "设备", 300, false, null],
          ],
        },
        { name: "Notes", rows: [["备注"], ["含税"]] },
      ]),
    );
    expect(sourceFormat(path)).toBe("xlsx");
    const read = await readExternal(path, "xlsx", 1024 * 1024);
    expect(read.value).toEqual({
      sheets: [
        {
          name: "Budget",
          rows: [
            ["id", "item", "amount", "paid", "due"],
            ["b1", "差旅, 上海", 1200.5, true, "2026-11-03T00:00:00.000Z"],
            ["b2", "设备", 300, false, null],
          ],
        },
        { name: "Notes", rows: [["备注"], ["含税"]] },
      ],
    });
    expect(read.state).toMatchObject({ path, format: "xlsx" });
    expect(() => serializeSource(read.value, "xlsx")).toThrow(
      expect.objectContaining({ code: "READ_ONLY" }),
    );
    await writeFile(path, "not a workbook");
    expect(await reasonOf(readExternal(path, "xlsx", 1024))).toMatchObject({
      code: "INVALID_DATA",
      reason: "PARSE_FAILED",
    });
  });
});

describe("online data", () => {
  it("accept only http(s) addresses without credentials", () => {
    expect(sourceUrl(" https://example.com/a.json ")).toBe(
      "https://example.com/a.json",
    );
    expect(() => sourceUrl("ftp://example.com/a.json")).toThrow(/http/);
    expect(() => sourceUrl("https://user:secret@example.com/a.json")).toThrow(
      /user name and password/,
    );
    expect(() => sourceUrl("not an address")).toThrow(/not a valid address/);
    expect(sourceFormat(new URL("https://h/x/data.XLSX?x=1").pathname)).toBe(
      "xlsx",
    );
    expect(
      isDatasetSource({
        kind: "url",
        format: "csv",
        url: "https://example.com/a.csv",
        refreshSeconds: 0,
      }),
    ).toBe(true);
    expect(
      isDatasetSource({
        kind: "url",
        format: "csv",
        url: "https://u:p@example.com/a.csv",
      }),
    ).toBe(false);
    expect(
      isDatasetSource({
        kind: "url",
        format: "json",
        url: "https://example.com/a.json",
        refreshSeconds: 90_000,
      }),
    ).toBe(false);
  });

  it("fetch with validators, follow http redirects and stop at limits", async () => {
    let body = "id,n\nr1,1\n";
    let version = 1;
    const server = await dataServer((request, response) => {
      const path = request.url ?? "";
      if (path === "/data.csv") {
        const etag = `"v${version}"`;
        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304, { etag }).end();
          return;
        }
        response.writeHead(200, { "content-type": "text/csv", etag }).end(body);
      } else if (path === "/moved")
        response.writeHead(302, { location: "/data.csv" }).end();
      else if (path === "/away")
        response.writeHead(302, { location: "file:///etc/passwd" }).end();
      else if (path === "/large")
        response
          .writeHead(200, { "content-length": "4096" })
          .end("x".repeat(4096));
      else if (path === "/stream") {
        // No declared length: the body is cut off once it passes the limit.
        response.writeHead(200);
        response.write("[" + "1,".repeat(600));
        setTimeout(() => response.end("1]"), 50);
      } else if (path === "/slow") setTimeout(() => response.end("{}"), 2000);
      else response.writeHead(500).end("broken");
    });
    try {
      const first = await fetchSource(`${server.origin}/data.csv`, "csv", 1024);
      expect(first).toMatchObject({
        notModified: false,
        value: { columns: ["id", "n"], rows: [{ id: "r1", n: 1 }] },
        etag: '"v1"',
      });
      expect(server.requests[0].headers.cookie).toBeUndefined();
      expect(
        await fetchSource(`${server.origin}/data.csv`, "csv", 1024, {
          etag: '"v1"',
        }),
      ).toEqual({ notModified: true, etag: '"v1"' });
      body = "id,n\nr1,2\n";
      version = 2;
      expect(
        await fetchSource(`${server.origin}/moved`, "csv", 1024, {
          etag: '"v1"',
        }),
      ).toMatchObject({ notModified: false, value: { rows: [{ n: 2 }] } });
      expect(
        await reasonOf(fetchSource(`${server.origin}/away`, "csv", 1024)),
      ).toMatchObject({
        code: "SOURCE_UNAVAILABLE",
        reason: "SOURCE_UNREACHABLE",
      });
      expect(
        await reasonOf(fetchSource(`${server.origin}/large`, "json", 1024)),
      ).toMatchObject({ reason: "TOO_LARGE" });
      expect(
        await reasonOf(fetchSource(`${server.origin}/stream`, "json", 1024)),
      ).toMatchObject({ reason: "TOO_LARGE" });
      expect(
        await reasonOf(fetchSource(`${server.origin}/error`, "json", 1024)),
      ).toMatchObject({
        reason: "SOURCE_UNREACHABLE",
        message: /answered 500/,
      });
      const timeout = REMOTE_FETCH.timeoutMs;
      REMOTE_FETCH.timeoutMs = 300;
      try {
        expect(
          await reasonOf(fetchSource(`${server.origin}/slow`, "json", 1024)),
        ).toMatchObject({ reason: "SOURCE_UNREACHABLE", message: /0.3 s/ });
      } finally {
        REMOTE_FETCH.timeoutMs = timeout;
      }
      // A hosted server never fetches addresses of its own network.
      const requests = server.requests.length;
      REMOTE_FETCH.publicAddressesOnly = true;
      try {
        expect(
          await reasonOf(fetchSource(`${server.origin}/data.csv`, "csv", 1024)),
        ).toMatchObject({
          reason: "SOURCE_UNREACHABLE",
          message: /127.0.0.1 is not a public internet address/,
        });
        const port = new URL(server.origin).port;
        expect(
          await reasonOf(
            fetchSource(`http://localhost:${port}/data.csv`, "csv", 1024),
          ),
        ).toMatchObject({
          reason: "SOURCE_UNREACHABLE",
          message: /localhost is not a public internet address/,
        });
        expect(
          await reasonOf(fetchSource("http://[::1]:9/x.json", "json", 1024)),
        ).toMatchObject({ message: /::1 is not a public/ });
      } finally {
        REMOTE_FETCH.publicAddressesOnly = false;
      }
      expect(server.requests).toHaveLength(requests);
    } finally {
      await server.close();
    }
  });
});
