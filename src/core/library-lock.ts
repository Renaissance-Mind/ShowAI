import { link, lstat, mkdir, readFile, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CoreError } from "./model";
import { atomicLibraryFile, safeLibraryPath } from "./library-files";
import { withWindowsSharingRetry } from "./atomic-rename";

interface LeaseOwner {
  pid: number;
  token: string;
}
function dead(pid: number): boolean {
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
    const value = JSON.parse(source) as LeaseOwner;
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

/** Publish a fully persisted owner with an atomic hard link: no empty-owner crash window. */
export async function withLibraryLock<T>(
  root: string,
  action: () => Promise<T>,
  name = "writer",
): Promise<T> {
  if (!/^[a-z-]+$/.test(name))
    throw new CoreError("INVALID_PATH", "Invalid library lock name.");
  const local = join(root, "local");
  await safeLibraryPath(root, local);
  await mkdir(local, { recursive: true });
  const token = randomUUID(),
    owner: LeaseOwner = { pid: process.pid, token };
  const prepared = join(local, "leases", `${name}-${token}.json`);
  await atomicLibraryFile(root, prepared, Buffer.from(JSON.stringify(owner)));
  const lock = join(local, `${name}.lock`);
  const deadline = Date.now() + 30_000;
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
    return await action();
  } finally {
    if (acquired) {
      const latest = await ownerAt(root, lock);
      if (latest?.token === token) await unlink(lock);
    }
    await rm(prepared, { force: true });
  }
}
