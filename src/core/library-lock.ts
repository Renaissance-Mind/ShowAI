import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CoreError } from "./model";

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
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

/** All library writers and maintenance cooperate across processes, without a daemon. */
export async function withLibraryLock<T>(
  root: string,
  action: () => Promise<T>,
  name = "writer",
): Promise<T> {
  if (!/^[a-z-]+$/.test(name))
    throw new CoreError("INVALID_PATH", "Invalid library lock name.");
  const local = join(root, "local");
  await mkdir(local, { recursive: true });
  const lock = join(local, `${name}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readFile(join(lock, "owner.json"), "utf8").then(
        (source) => JSON.parse(source) as { pid: number; token: string },
        (error) => {
          if (absent(error)) return undefined;
          throw error;
        },
      );
      if (
        owner &&
        Number.isInteger(owner.pid) &&
        owner.pid > 0 &&
        dead(owner.pid)
      ) {
        // One recovery lease ensures we never remove a replacement writer's lock.
        const lease = join(local, `${name}-recovery.lock`);
        const acquired = await mkdir(lease).then(
          () => true,
          (error) => {
            if ((error as NodeJS.ErrnoException).code === "EEXIST")
              return false;
            throw error;
          },
        );
        if (acquired) {
          try {
            const latest = await readFile(
              join(lock, "owner.json"),
              "utf8",
            ).then(
              (source) => JSON.parse(source) as { pid: number; token: string },
              (error) => {
                if (absent(error)) return undefined;
                throw error;
              },
            );
            if (latest?.token === owner.token && dead(latest.pid)) {
              const stale = join(local, `dead-writer-${token}`);
              await rename(lock, stale);
              await rm(stale, { recursive: true });
            }
          } finally {
            await rm(lease, { recursive: true });
          }
        }
      }
      if (Date.now() >= deadline)
        throw new CoreError(
          "LOCKED",
          "Another library write is still running. Retry after it finishes.",
        );
      await new Promise((done) => setTimeout(done, 25));
    }
  }
  try {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, token }),
      { flag: "wx", mode: 0o600 },
    );
    return await action();
  } finally {
    await rm(lock, { recursive: true });
  }
}
