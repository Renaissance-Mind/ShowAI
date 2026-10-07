import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withLibraryLock } from "./library-lock";

describe("cross-process library leases", () => {
  let root: string, entry: string;
  const children: ChildProcess[] = [];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-library-lease-"));
    entry = join(root, "worker.mjs");
    await build({
      stdin: {
        contents: `import {readFile,writeFile} from "node:fs/promises";import {join} from "node:path";import { withLibraryLock } from ${JSON.stringify(resolve(import.meta.dirname, "library-lock.ts"))};if(process.argv[3]==="churn"){for(let i=0;i<100;i++)await withLibraryLock(process.argv[2],async()=>{const file=join(process.argv[2],"counter");const value=Number(await readFile(file,"utf8"));await writeFile(file,String(value+1));});}else await withLibraryLock(process.argv[2],async()=>{process.stdout.write('locked\\n');await new Promise(()=>{setInterval(()=>{},1000)});});`,
        resolveDir: process.cwd(),
        sourcefile: "lock-worker.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: entry,
    });
  });
  afterAll(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  });
  async function acquire(path: string): Promise<ChildProcess> {
    const child = spawn(process.execPath, [entry, path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Child did not acquire its library lease")),
        5000,
      );
      child.stdout!.once("data", (bytes) => {
        clearTimeout(timeout);
        if (!String(bytes).includes("locked"))
          reject(new Error("Unexpected child output"));
        else resolve();
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return child;
  }

  it("serializes rapidly released leases across real independent processes", async () => {
    const path = join(root, "contention");
    await mkdir(path);
    await writeFile(join(path, "counter"), "0");
    await Promise.all(
      Array.from({ length: 4 }, () =>
        promisify(execFile)(process.execPath, [entry, path, "churn"], {
          timeout: 30000,
        }),
      ),
    );
    expect(await readFile(join(path, "counter"), "utf8")).toBe("400");
    expect(await readdir(join(path, "local"))).not.toContain("writer.lock");
  }, 35000);
  it("recovers a lease after the actual owning process is killed", async () => {
    const path = join(root, "crash");
    await mkdir(path);
    const child = await acquire(path);
    const owner = JSON.parse(
      await readFile(join(path, "local", "writer.lock"), "utf8"),
    );
    expect(owner.pid).toBe(child.pid);
    const stopped = once(child, "exit");
    child.kill("SIGKILL");
    await stopped;
    await expect(withLibraryLock(path, async () => "recovered")).resolves.toBe(
      "recovered",
    );
    expect(await readdir(join(path, "local"))).not.toContain("writer.lock");
  });

  it("waits for a live process instead of removing its lock", async () => {
    const path = join(root, "live");
    await mkdir(path);
    const child = await acquire(path);
    let acquired = false;
    const next = withLibraryLock(path, async () => {
      acquired = true;
    });
    await new Promise((done) => setTimeout(done, 80));
    expect(acquired).toBe(false);
    const stopped = once(child, "exit");
    child.kill("SIGKILL");
    await stopped;
    await next;
    expect(acquired).toBe(true);
  });

  it("recovers the earlier owner-directory format without accepting invalid ownership", async () => {
    const path = join(root, "old");
    await mkdir(path);
    const child = await acquire(path);
    const pid = child.pid!;
    const stopped = once(child, "exit");
    child.kill("SIGKILL");
    await stopped;
    await rm(join(path, "local", "writer.lock"));
    await mkdir(join(path, "local", "writer.lock"));
    await writeFile(
      join(path, "local", "writer.lock", "owner.json"),
      JSON.stringify({ pid, token: "old-owner" }),
    );
    expect(await withLibraryLock(path, async () => "directory recovered")).toBe(
      "directory recovered",
    );
  });
});
