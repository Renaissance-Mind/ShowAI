import { rename } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/** Bound retries for Windows files briefly held by another reader or writer. */
export async function withWindowsSharingRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")
      )
        throw error;
      await setTimeout(25 * 2 ** attempt);
    }
  }
}

/** Replace atomically; never remove the destination to work around a lock. */
export async function atomicRename(
  source: string,
  destination: string,
): Promise<void> {
  return withWindowsSharingRetry(() => rename(source, destination));
}
