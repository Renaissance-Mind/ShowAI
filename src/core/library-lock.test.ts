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
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir, uptime } from "node:os";
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

  it("hands the lease between holders in this process in order without overlap", async () => {
    const path = join(root, "local-queue");
    await mkdir(path);
    // Each turn still creates and removes the shared lease, which takes far
    // longer on Windows; measure that work for 20 uncontended turns first.
    let started = performance.now();
    for (let index = 0; index < 20; index++)
      await withLibraryLock(path, async () => {
        await new Promise((done) => setImmediate(done));
      });
    const uncontended = performance.now() - started;
    let inside = 0;
    const order: number[] = [];
    started = performance.now();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        withLibraryLock(path, async () => {
          inside++;
          expect(inside).toBe(1);
          // Yield without a timer: Windows timers wait at least ~15 ms each.
          await new Promise((done) => setImmediate(done));
          order.push(index);
          inside--;
        }),
      ),
    );
    expect(order).toEqual(Array.from({ length: 20 }, (_, index) => index));
    // Polling every 25 ms would add about 12 ms per waiter to the same lease
    // work; taking turns adds none.
    expect(performance.now() - started - uncontended).toBeLessThan(20 * 10);
    expect(await readdir(join(path, "local"))).not.toContain("writer.lock");
  });

  it("reclaims an incomplete lease left before this boot but rejects a current one", async () => {
    const path = join(root, "interrupted");
    await mkdir(join(path, "local"), { recursive: true });
    const lock = join(path, "local", "writer.lock");
    await writeFile(lock, "");
    await expect(
      withLibraryLock(path, async () => "current"),
    ).rejects.toMatchObject({ code: "INVALID_DATA" });
    const beforeBoot = (Date.now() - uptime() * 1000 - 60_000) / 1000;
    await utimes(lock, beforeBoot, beforeBoot);
    await expect(withLibraryLock(path, async () => "recovered")).resolves.toBe(
      "recovered",
    );
    expect(await readdir(join(path, "local"))).not.toContain("writer.lock");
  });
});
