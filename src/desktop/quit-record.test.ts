import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuitRecord, type QuitBlockedRecord } from "./quit-record";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-quit-record-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

it("records held-open windows and disappears once nothing is held", async () => {
  const errors: unknown[] = [];
  const record = new QuitRecord(
    join(directory, "logs"),
    () => ({
      pid: 42,
      appVersion: "1.2.3",
      packaged: false,
      mode: "desktop",
      sourceCommit: "abc",
      home: "/library",
      log: "/logs/showai-main.log",
    }),
    (error) => errors.push(error),
  );
  const blocker = {
    code: "PAGE_NOT_RETAINED" as const,
    source: "pages" as const,
    pageId: "p1",
    title: "Plan",
    message: "EACCES",
  };
  await record.set(1, {
    title: "Plan — ShowAI",
    trigger: "quit",
    state: "awaiting-decision",
    blockers: [blocker],
  });
  const first = JSON.parse(
    await readFile(record.path, "utf8"),
  ) as QuitBlockedRecord;
  expect(first).toMatchObject({
    format: "showai-quit-blocked",
    version: 1,
    pid: 42,
    appVersion: "1.2.3",
    home: "/library",
    windows: [
      {
        windowId: 1,
        trigger: "quit",
        state: "awaiting-decision",
        blockers: [blocker],
      },
    ],
  });
  await record.set(1, {
    title: "Plan — ShowAI",
    trigger: "quit",
    state: "kept-open",
    blockers: [blocker],
  });
  await record.set(2, {
    title: "ShowAI",
    trigger: "close",
    state: "kept-open",
    blockers: [{ code: "NO_REPLY", source: "window", seconds: 20 }],
  });
  const second = JSON.parse(
    await readFile(record.path, "utf8"),
  ) as QuitBlockedRecord;
  expect(second.windows.map((window) => [window.windowId, window.state])).toEqual([
    [1, "kept-open"],
    [2, "kept-open"],
  ]);
  // The first refusal time is kept while the window stays held.
  expect(second.windows[0].since).toBe(first.windows[0].since);
  await record.delete(2);
  expect(
    (JSON.parse(await readFile(record.path, "utf8")) as QuitBlockedRecord)
      .windows.length,
  ).toBe(1);
  await record.clear();
  expect(await exists(record.path)).toBe(false);
  expect(errors).toEqual([]);
});
