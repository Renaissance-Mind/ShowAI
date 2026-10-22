import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureConsole, createMainLog, redactLogText } from "./main-log";

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "showai-main-log-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("main log", () => {
  it("redacts the home directory and credentials", () => {
    expect(
      redactLogText(
        "open /Users/someone/.showai failed; Authorization: Bearer abcdef123456 token=secretvalue https://x/cb?code=123456&flow=a sk-abcdefghijklmnop",
        "/Users/someone",
      ),
    ).toBe(
      "open ~/.showai failed; Authorization: [redacted] [redacted] token=[redacted] https://x/cb?code=[redacted]&flow=a sk-[redacted]",
    );
    expect(redactLogText("code: 'ENOENT'", "/Users/someone")).toBe(
      "code: 'ENOENT'",
    );
  });

  it("appends redacted lines and rotates at the size limit", async () => {
    const root = await directory();
    const log = createMainLog({
      directory: join(root, "logs"),
      home: root,
      maxBytes: 200,
      files: 3,
    });
    for (let index = 0; index < 12; index++)
      log.write("error", "main", `failure ${index} in ${root}/library`, {
        index,
      });
    const names = (await readdir(join(root, "logs"))).sort();
    expect(names).toEqual([
      "showai-main.1.log",
      "showai-main.2.log",
      "showai-main.log",
    ]);
    const latest = await readFile(log.path, "utf8");
    expect(latest).toContain("failure 11 in ~/library");
    expect(latest).not.toContain(root);
    expect(latest).toMatch(/^\d{4}-\d\d-\d\dT.+ \[error\] \[main\] /);
  });

  it("does not clash with other files in the logs directory", async () => {
    const root = await directory();
    await writeFile(join(root, "main.log"), "other\n");
    const log = createMainLog({ directory: root, home: "/nowhere" });
    log.write("warn", "renderer", "hello");
    expect(await readFile(join(root, "main.log"), "utf8")).toBe("other\n");
    expect(await readFile(log.path, "utf8")).toContain("[warn] [renderer] hello");
  });

  it("reports once and stops when the log cannot be written", async () => {
    const root = await directory();
    const blocker = join(root, "file");
    await writeFile(blocker, "");
    const reports: string[] = [];
    const log = createMainLog({
      directory: join(blocker, "logs"),
      fallback: (message) => reports.push(message),
    });
    log.write("error", "main", "one");
    log.write("error", "main", "two");
    expect(reports).toHaveLength(1);
  });

  it("mirrors console errors into the log", async () => {
    const root = await directory();
    const log = createMainLog({ directory: root, home: "/nowhere" });
    const restore = captureConsole(log);
    const error = console.error;
    try {
      console.error("ShowAI file watcher:", new Error("boom"));
    } finally {
      restore();
    }
    expect(console.error).not.toBe(error);
    const contents = await readFile(log.path, "utf8");
    expect(contents).toContain("[error] [main] ShowAI file watcher: Error: boom");
  });
});
