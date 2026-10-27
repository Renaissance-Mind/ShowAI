import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  instanceDirectory,
  publishInstance,
  readInstances,
} from "./instance-presence.mjs";

let home: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-presence-"));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

it("announces this process, ignores gone or reused pids and withdraws on removal", async () => {
  const directory = instanceDirectory(home);
  await mkdir(directory, { recursive: true });
  // A crashed App left its record behind; pid 2^31-2 does not exist.
  await writeFile(
    join(directory, "2147483646.json"),
    JSON.stringify({ format: "showai-instance", version: 1, pid: 2147483646 }),
  );
  const handle = await publishInstance(home, {
    mode: "browser",
    channel: "development",
    appVersion: "9.9.9",
    sourceCommit: "abc1234",
    cli: { command: process.execPath, args: ["/runtime/cli.mjs"] },
    url: "http://127.0.0.1:5999/",
  });
  // Publishing prunes records of processes that no longer exist.
  expect(await readdir(directory)).toEqual([`${process.pid}.json`]);
  await writeFile(
    join(directory, "2147483645.json"),
    JSON.stringify({ format: "showai-instance", version: 1, pid: 2147483645 }),
  );
  const live = await readInstances(home);
  expect(live.instances).toHaveLength(1);
  expect(live.instances[0]).toMatchObject({
    pid: process.pid,
    mode: "browser",
    channel: "development",
    appVersion: "9.9.9",
    sourceCommit: "abc1234",
    executable: process.execPath,
    cli: { command: process.execPath, args: ["/runtime/cli.mjs"] },
    url: "http://127.0.0.1:5999/",
  });
  expect(live.ignored).toMatchObject([{ pid: 2147483645, reason: "NOT_RUNNING" }]);
  // A pid now running another program is not this App any more.
  const reused = await readInstances(
    home,
    new Map([[process.pid, "/usr/bin/some-other-program"]]),
  );
  expect(reused.instances).toEqual([]);
  expect(reused.ignored.map((item) => item.reason)).toContain(
    "COMMAND_MISMATCH",
  );
  await handle.remove();
  expect((await readInstances(home)).instances).toEqual([]);
});
