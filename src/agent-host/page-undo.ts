import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PageWrite } from "../core/page-write-capture";
import { readOptional, writeProtected } from "./storage";

/** One file per committed MCP call also supports concurrent tool requests. */
export async function savePageWrites(directory: string, writes: PageWrite[]) {
  if (writes.length)
    await writeProtected(join(directory, `${randomUUID()}.json`), writes);
}

export async function readPageWrites(directory: string): Promise<PageWrite[]> {
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const writes = await Promise.all(
    files
      .filter((file) => /^[a-f0-9-]+\.json$/.test(file))
      .map(
        async (file) =>
          (await readOptional<PageWrite[]>(join(directory, file))) ?? [],
      ),
  );
  return writes.flat();
}

/** An intervening writer breaks the chain; restoring a whole-page snapshot is then unsafe. */
export function undoBaseline(writes: PageWrite[], currentHash: string) {
  if (!writes.length) return undefined;
  const remaining = [...writes];
  let hash = currentHash;
  let baseline: PageWrite["before"] | undefined;
  while (remaining.length) {
    const matches = remaining.filter((write) => write.afterHash === hash);
    if (matches.length !== 1) return undefined;
    const write = matches[0];
    remaining.splice(remaining.indexOf(write), 1);
    baseline = write.before;
    hash = write.beforeHash;
  }
  return baseline;
}
