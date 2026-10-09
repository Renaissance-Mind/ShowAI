import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, lstat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskObjects } from "./node";
import { hash } from "../sync/protocol";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("disk object storage", () => {
  it("writes and replaces objects without stray directories or temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "showai-disk-objects-"));
    fixtures.push(root);
    const store = new DiskObjects(root);
    const bytes = Buffer.from("Object upload on the host filesystem.");
    const name = await hash(bytes);
    const key = `projects/example/objects/${name}`;
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    expect(await readdir(join(root, "projects/example/objects"))).toEqual([
      name,
    ]);
  });
});

it("bundling the Linux server library neither starts a listener nor creates a default data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-server-library-"));
  fixtures.push(root);
  const entry = join(root, "library.mjs"),
    unintended = join(root, "unintended");
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents:
        'import {startSyncServer} from "./src/server/node";console.log(typeof startSyncServer);',
    },
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    banner: {
      js: 'import {createRequire as __showaiRequire} from "node:module";const require=__showaiRequire(import.meta.url);',
    },
  });
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      SHOWAI_SERVER_HOME: unintended,
      SHOWAI_SERVER_PORT: "0",
    },
  });
  let output = "";
  child.stdout.on("data", (value) => {
    output += value;
  });
  child.stderr.on("data", (value) => {
    output += value;
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
  const code = await new Promise<number | null>((done) =>
    child.once("exit", done),
  );
  clearTimeout(timer);
  expect(code).toBe(0);
  expect(output.trim()).toBe("function");
  await expect(lstat(unintended)).rejects.toMatchObject({ code: "ENOENT" });
});
