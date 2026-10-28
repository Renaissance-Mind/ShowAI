import { AsyncLocalStorage } from "node:async_hooks";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { uptime } from "node:os";
import { CoreError } from "./model";
import { safeLibraryPath } from "./library-files";
import { withWindowsSharingRetry } from "./atomic-rename";

const lockContext = new AsyncLocalStorage<Map<string, string>>();
const activeLocks = new Map<string, string>();
/** Holders in this process take turns instead of polling the shared lease. */
const localTurns = new Map<string, Promise<void>>();

interface LeaseOwner {
  pid: number;
  token: string;
}
function dead(pid: number): boolean {
  if (pid === 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}
async function ownerAt(
  root: string,
  path: string,
): Promise<LeaseOwner | undefined> {
  return withWindowsSharingRetry(async () => {
    await safeLibraryPath(root, path);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return undefined;
    // Earlier development revisions used an owner file inside a lock directory.
    const source = await readFile(
      info.isDirectory() ? join(path, "owner.json") : path,
      "utf8",
    ).catch((error: NodeJS.ErrnoException) => {
      // A cooperating owner may release the lease between stat and read.
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (source === undefined) return undefined;
    let value: LeaseOwner;
    try {
      value = JSON.parse(source) as LeaseOwner;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // Leases are not flushed to disk. Only an OS crash can leave one
      // incomplete, and a lease from before this boot has no live owner.
      if (info.mtimeMs < Date.now() - uptime() * 1000 - 2000)
        return { pid: 0, token: "interrupted" };
      throw new CoreError(
        "INVALID_DATA",
        "The library lock has invalid ownership information.",
      );
    }
    if (
      !Number.isInteger(value.pid) ||
      value.pid < 1 ||
      !/^[\w-]{1,200}$/.test(value.token)
    )
      throw new CoreError(
        "INVALID_DATA",
        "The library lock has invalid ownership information.",
      );
    return value;
  });
}

/** Whether the calling operation already holds this lease. */
export function holdsLibraryLock(root: string, name = "writer"): boolean {
  const key = `${root}:${name}`;
  const token = lockContext.getStore()?.get(key);
  return !!token && activeLocks.get(key) === token;
}

/** Publish a fully written owner with an atomic hard link; no reader sees a partial owner. */
export async function withLibraryLock<T>(
  root: string,
  action: () => Promise<T>,
  name = "writer",
): Promise<T> {
  if (!/^[a-z-]+$/.test(name))
    throw new CoreError("INVALID_PATH", "Invalid library lock name.");
  const key = `${root}:${name}`;
  const inherited = lockContext.getStore()?.get(key);
  if (inherited && activeLocks.get(key) === inherited) return action();
  const deadline = Date.now() + 30_000;
  const previous = localTurns.get(key) ?? Promise.resolve();
  let finish!: () => void;
  const turn = new Promise<void>((done) => {
    finish = done;
  });
  const queue = previous.then(() => turn);
  localTurns.set(key, queue);
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = await Promise.race([
      previous.then(() => false),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(true), deadline - Date.now());
      }),
    ]);
    clearTimeout(timer);
    if (expired)
      throw new CoreError(
        "LOCKED",
        "Another library operation is still running. Retry after it finishes.",
      );
    return await acquireLibraryLock(root, name, key, deadline, action);
  } finally {
    finish();
    if (localTurns.get(key) === queue) localTurns.delete(key);
  }
}

async function acquireLibraryLock<T>(
  root: string,
  name: string,
  key: string,
  deadline: number,
  action: () => Promise<T>,
): Promise<T> {
  const local = join(root, "local");
  await safeLibraryPath(root, local);
  await mkdir(local, { recursive: true });
  const token = randomUUID(),
    owner: LeaseOwner = { pid: process.pid, token };
  const prepared = join(local, "leases", `${name}-${token}.json`);
  await safeLibraryPath(root, prepared);
  await mkdir(join(local, "leases"), { recursive: true });
  await safeLibraryPath(root, prepared);
  // The lease is complete before it is linked; durability only matters across
  // an OS crash, after which ownerAt treats a pre-boot partial lease as stale.
  try {
    const lease = await open(prepared, "wx", 0o600);
    try {
      await lease.writeFile(JSON.stringify(owner));
    } finally {
      await lease.close();
    }
  } catch (error) {
    await rm(prepared, { force: true });
    throw error;
  }
  const lock = join(local, `${name}.lock`);
  const reclaim = async (
    path: string,
    observed: LeaseOwner,
    depth = 0,
  ): Promise<void> => {
    if (depth > 16)
      throw new CoreError(
        "LOCKED",
        "Too many interrupted recovery leases. Inspect the library before retrying.",
      );
    const recovery = `${path}.recover-${observed.token}`;
    let acquired = false;
    while (!acquired) {
      acquired = await link(prepared, recovery).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST") return false;
          throw error;
        },
      );
      if (!acquired) {
        const holder = await ownerAt(root, recovery);
        if (!holder) continue;
        if (!dead(holder.pid)) return;
        await reclaim(recovery, holder, depth + 1);
      }
    }
    try {
      const latest = await ownerAt(root, path);
      if (latest?.token === observed.token && dead(latest.pid))
        await rm(path, { recursive: true });
    } finally {
      const lease = await ownerAt(root, recovery);
      if (lease?.token === token) await unlink(recovery);
    }
  };
  let acquired = false;
  try {
    while (!acquired) {
      await safeLibraryPath(root, lock);
      acquired = await link(prepared, lock).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST") return false;
          throw error;
        },
      );
      if (acquired) break;
      const existing = await ownerAt(root, lock);
      if (existing && dead(existing.pid)) await reclaim(lock, existing);
      if (Date.now() >= deadline)
        throw new CoreError(
          "LOCKED",
          "Another library operation is still running. Retry after it finishes.",
        );
      await new Promise((done) => setTimeout(done, 25));
    }
    activeLocks.set(key, token);
    const context = new Map(lockContext.getStore());
    context.set(key, token);
    return await lockContext.run(context, action);
  } finally {
    if (activeLocks.get(key) === token) activeLocks.delete(key);
    if (acquired) {
      const latest = await ownerAt(root, lock);
      if (latest?.token === token) await unlink(lock);
    }
    await rm(prepared, { force: true });
  }
}
